import fs from "node:fs";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { OSSLifecycleLockManager } from "./lockManager";
import { S3OssAdapter } from "./s3OssAdapter";
import { StateStore } from "./stateStore";
import { DaemonConfig, FileSnapshot, RemoteFileSnapshot, SyncResult } from "./types";

function shouldExclude(relativePath: string, patterns: string[]): boolean {
  return patterns.some((p) => {
    if (p.endsWith("*")) {
      return relativePath.startsWith(p.slice(0, -1));
    }
    if (p.startsWith("*")) {
      return relativePath.endsWith(p.slice(1));
    }
    return relativePath.includes(p);
  });
}

function walk(rootDir: string, current: string, excludes: string[], out: Record<string, FileSnapshot>) {
  for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
    const absolutePath = path.join(current, entry.name);
    const relativePath = path.relative(rootDir, absolutePath);
    if (!relativePath || shouldExclude(relativePath, excludes)) {
      continue;
    }
    if (entry.isDirectory()) {
      walk(rootDir, absolutePath, excludes, out);
      continue;
    }
    if (!entry.isFile()) continue;
    const stat = fs.statSync(absolutePath);
    out[relativePath] = {
      path: relativePath,
      size: stat.size,
      mtimeMs: stat.mtimeMs,
    };
  }
}

export class OpenClawCore {
  private readonly config: DaemonConfig;
  private readonly store: StateStore;
  private readonly remote: S3OssAdapter;
  private readonly locks: OSSLifecycleLockManager;

  constructor(config: DaemonConfig) {
    this.config = config;
    this.store = new StateStore(config.vault.stateDir);
    this.remote = new S3OssAdapter(config);
    this.locks = new OSSLifecycleLockManager(config);
  }

  getLockManager(): OSSLifecycleLockManager {
    return this.locks;
  }

  scanSnapshots(): Record<string, FileSnapshot> {
    const out: Record<string, FileSnapshot> = {};
    walk(this.config.vault.rootDir, this.config.vault.rootDir, this.config.vault.excludeGlobs, out);
    return out;
  }

  private changedFromBase(base: FileSnapshot | undefined, next: { mtimeMs: number; size: number } | undefined): boolean {
    if (!base && !next) return false;
    if (!base || !next) return true;
    return base.mtimeMs !== next.mtimeMs || base.size !== next.size;
  }

  private chooseConflictWinner(local: FileSnapshot, remote: RemoteFileSnapshot): "local" | "remote" {
    if (this.config.vault.conflictPolicy === "keep_larger") {
      return local.size >= remote.size ? "local" : "remote";
    }
    return local.mtimeMs >= remote.mtimeMs ? "local" : "remote";
  }

  private resolveConflictPath(relativePath: string): string {
    const ext = path.extname(relativePath);
    const stem = relativePath.slice(0, relativePath.length - ext.length);
    const suffix = `.conflict-${new Date().toISOString().replaceAll(":", "-")}`;
    return `${stem}${suffix}${ext}`;
  }

  private snapshotFromPath(relativePath: string): FileSnapshot | undefined {
    if (shouldExclude(relativePath, this.config.vault.excludeGlobs)) {
      return undefined;
    }
    const absolutePath = path.join(this.config.vault.rootDir, relativePath);
    if (!fs.existsSync(absolutePath)) {
      return undefined;
    }
    const stat = fs.statSync(absolutePath);
    if (!stat.isFile()) {
      return undefined;
    }
    return {
      path: relativePath,
      size: stat.size,
      mtimeMs: stat.mtimeMs,
    };
  }

  private async fastSyncLocalChanges(action: string, started: number, forceLockSteal: boolean, changedPaths: string[]): Promise<SyncResult> {
    const lock = await this.locks.acquire(action, forceLockSteal);
    if (!lock.ok || !lock.payload) {
      return {
        success: false,
        action,
        vault_id: this.config.vault.id,
        lock_status: lock.status,
        queued_files: 0,
        uploaded_files: 0,
        pulled_files: 0,
        deleted_files: 0,
        conflicts: 0,
        elapsed_ms: Math.round(performance.now() - started),
        error: lock.reason ?? "failed_to_acquire_lock",
      };
    }

    try {
      const previous = this.store.load();
      const nextFiles: Record<string, FileSnapshot> = { ...previous.files };
      const touched = Array.from(new Set(changedPaths)).filter((p) => !!p && !shouldExclude(p, this.config.vault.excludeGlobs));

      const uploaded: string[] = [];
      const deleted: string[] = [];

      for (const relativePath of touched) {
        const current = this.snapshotFromPath(relativePath);
        const base = previous.files[relativePath];
        if (current) {
          nextFiles[relativePath] = current;
          if (this.changedFromBase(base, current)) {
            await this.remote.uploadFile(relativePath, path.join(this.config.vault.rootDir, relativePath));
            uploaded.push(relativePath);
          }
        } else if (base) {
          delete nextFiles[relativePath];
          await this.remote.deleteFile(relativePath);
          deleted.push(relativePath);
        }
      }

      this.store.save({ files: nextFiles, lastSuccessfulSyncAt: new Date().toISOString() });
      return {
        success: true,
        action,
        vault_id: this.config.vault.id,
        lock_status: "acquired",
        queued_files: touched.length,
        uploaded_files: uploaded.length,
        pulled_files: 0,
        deleted_files: deleted.length,
        conflicts: 0,
        elapsed_ms: Math.round(performance.now() - started),
      };
    } catch (err) {
      return {
        success: false,
        action,
        vault_id: this.config.vault.id,
        lock_status: "failed",
        queued_files: 0,
        uploaded_files: 0,
        pulled_files: 0,
        deleted_files: 0,
        conflicts: 0,
        elapsed_ms: Math.round(performance.now() - started),
        error: err instanceof Error ? err.message : String(err),
      };
    } finally {
      await this.locks.release(lock.payload);
    }
  }

  async syncOnce(action: string, forceLockSteal = false, changedPaths?: string[]): Promise<SyncResult> {
    const started = performance.now();
    if (changedPaths && changedPaths.length > 0) {
      return this.fastSyncLocalChanges(action, started, forceLockSteal, changedPaths);
    }

    const lock = await this.locks.acquire(action, forceLockSteal);
    if (!lock.ok || !lock.payload) {
      return {
        success: false,
        action,
        vault_id: this.config.vault.id,
        lock_status: lock.status,
        queued_files: 0,
        uploaded_files: 0,
        pulled_files: 0,
        deleted_files: 0,
        conflicts: 0,
        elapsed_ms: Math.round(performance.now() - started),
        error: lock.reason ?? "failed_to_acquire_lock",
      };
    }

    try {
      const previous = this.store.load();
      const latest = this.scanSnapshots();
      const remote = await this.remote.listFiles();

      const uploaded: string[] = [];
      const pulled: string[] = [];
      const deleted: string[] = [];
      let conflicts = 0;

      const allPaths = new Set<string>([
        ...Object.keys(previous.files),
        ...Object.keys(latest),
        ...Object.keys(remote),
      ]);

      for (const relativePath of allPaths) {
        const base = previous.files[relativePath];
        const local = latest[relativePath];
        const remoteFile = remote[relativePath];
        const localChanged = this.changedFromBase(base, local);
        const remoteChanged = this.changedFromBase(base, remoteFile);
        const absolutePath = path.join(this.config.vault.rootDir, relativePath);

        if (local && remoteFile) {
          if (localChanged && remoteChanged) {
            conflicts += 1;
            if (this.config.vault.conflictPolicy === "keep_both_and_rename") {
              const conflictPath = this.resolveConflictPath(relativePath);
              const conflictAbsolutePath = path.join(this.config.vault.rootDir, conflictPath);
              await this.remote.downloadFile(relativePath, conflictAbsolutePath);
              pulled.push(conflictPath);
              await this.remote.uploadFile(relativePath, absolutePath);
              uploaded.push(relativePath);
            } else {
              const winner = this.chooseConflictWinner(local, remoteFile);
              if (winner === "local") {
                await this.remote.uploadFile(relativePath, absolutePath);
                uploaded.push(relativePath);
              } else {
                await this.remote.downloadFile(relativePath, absolutePath);
                pulled.push(relativePath);
              }
            }
            continue;
          }

          if (localChanged && !remoteChanged) {
            await this.remote.uploadFile(relativePath, absolutePath);
            uploaded.push(relativePath);
            continue;
          }

          if (!localChanged && remoteChanged) {
            await this.remote.downloadFile(relativePath, absolutePath);
            pulled.push(relativePath);
          }
          continue;
        }

        if (local && !remoteFile) {
          if (!base || localChanged) {
            await this.remote.uploadFile(relativePath, absolutePath);
            uploaded.push(relativePath);
          } else {
            if (fs.existsSync(absolutePath)) {
              fs.unlinkSync(absolutePath);
            }
            deleted.push(relativePath);
          }
          continue;
        }

        if (!local && remoteFile) {
          if (!base || remoteChanged) {
            await this.remote.downloadFile(relativePath, absolutePath);
            pulled.push(relativePath);
          } else {
            await this.remote.deleteFile(relativePath);
            deleted.push(relativePath);
          }
        }
      }

      const finalSnapshots = this.scanSnapshots();
      this.store.save({ files: finalSnapshots, lastSuccessfulSyncAt: new Date().toISOString() });

      return {
        success: true,
        action,
        vault_id: this.config.vault.id,
        lock_status: "acquired",
        queued_files: Object.keys(finalSnapshots).length,
        uploaded_files: uploaded.length,
        pulled_files: pulled.length,
        deleted_files: deleted.length,
        conflicts,
        elapsed_ms: Math.round(performance.now() - started),
      };
    } catch (err) {
      return {
        success: false,
        action,
        vault_id: this.config.vault.id,
        lock_status: "failed",
        queued_files: 0,
        uploaded_files: 0,
        pulled_files: 0,
        deleted_files: 0,
        conflicts: 0,
        elapsed_ms: Math.round(performance.now() - started),
        error: err instanceof Error ? err.message : String(err),
      };
    } finally {
      await this.locks.release(lock.payload);
    }
  }
}
