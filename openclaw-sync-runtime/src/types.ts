export type ConflictPolicy = "keep_newer" | "keep_larger" | "keep_both_and_rename";

export interface AlibabaOssConfig {
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  dataPrefix: string;
  lockPrefix: string;
}

export interface VaultConfig {
  id: string;
  rootDir: string;
  stateDir: string;
  socketPath: string;
  debounceMs: number;
  conflictPolicy: ConflictPolicy;
  excludeGlobs: string[];
  lockTtlSec: number;
}

export interface DaemonConfig {
  oss: AlibabaOssConfig;
  vault: VaultConfig;
}

export type LockStatus = "acquired" | "released" | "failed" | "contended";

export interface SyncResult {
  success: boolean;
  action: string;
  vault_id: string;
  lock_status: LockStatus;
  queued_files: number;
  uploaded_files: number;
  pulled_files: number;
  deleted_files: number;
  conflicts: number;
  elapsed_ms: number;
  error?: string;
}

export interface FileSnapshot {
  path: string;
  size: number;
  mtimeMs: number;
}

export interface RemoteFileSnapshot {
  path: string;
  size: number;
  mtimeMs: number;
  etag?: string;
}

export interface LocalState {
  files: Record<string, FileSnapshot>;
  lastSuccessfulSyncAt?: string;
}

export interface LockPayload {
  holder_id: string;
  hostname: string;
  agent_id: string;
  pid: number;
  started_at: string;
  expires_at: string;
  session_purpose: string;
  program_version: string;
}

export interface LockAcquireResult {
  ok: boolean;
  status: LockStatus;
  payload?: LockPayload;
  reason?: string;
}
