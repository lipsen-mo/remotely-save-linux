import fs from "node:fs";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { OSSLifecycleLockManager } from "./lockManager";
import { S3OssAdapter } from "./s3OssAdapter";
import { StateStore } from "./stateStore";
import { DaemonConfig, FileSnapshot, SyncResult } from "./types";

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

  async syncOnce(action: string, forceLockSteal = false): Promise<SyncResult> {
    const started = performance.now();
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

      const uploaded: string[] = [];
      const deleted: string[] = [];

      for (const [relativePath, snapshot] of Object.entries(latest)) {
        const old = previous.files[relativePath];
        const changed = !old || old.mtimeMs !== snapshot.mtimeMs || old.size !== snapshot.size;
        if (!changed) continue;

        await this.remote.uploadFile(relativePath, path.join(this.config.vault.rootDir, relativePath));
        uploaded.push(relativePath);
      }

      for (const relativePath of Object.keys(previous.files)) {
        if (latest[relativePath]) continue;
        await this.remote.deleteFile(relativePath);
        deleted.push(relativePath);
      }

      this.store.save({ files: latest, lastSuccessfulSyncAt: new Date().toISOString() });

      return {
        success: true,
        action,
        vault_id: this.config.vault.id,
        lock_status: "acquired",
        queued_files: Object.keys(latest).length,
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
}
