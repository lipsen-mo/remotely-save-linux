# rs-openclaw (Alibaba OSS + Linux terminal only)

This is a special customized build target for OpenClaw:

- only Alibaba OSS (S3-compatible endpoint under `aliyuncs.com`)
- only Linux runtime
- only terminal/daemon/CLI workflow (no UI, no browser-hosted plugin logic)

> Folder purpose: `openclaw-sync-runtime/` is the dedicated runtime implementation for OpenClaw-triggered sync on Linux.

## Included core capabilities

- `src/core.ts`: incremental push sync based on local state snapshots + remote OSS lock acquisition/release.
- `src/daemon.ts`: Linux daemon process with recursive `fs.watch`, debounce queue, and Unix socket command handling.
- `src/cli.ts`: CLI entry for `sync_once`, `acquire_lock`, `release_lock`, `status`, `flush_queue`, and `reconcile`.
- `src/lockManager.ts`: lock object + lease object + expiration steal + audit writing.
- `src/s3OssAdapter.ts`: OSS object upload/delete adapter.

## Commands

```bash
# daemon
npx tsx openclaw-sync-runtime/src/daemon.ts ./openclaw.config.yaml

# CLI examples
npx tsx openclaw-sync-runtime/src/cli.ts sync_once --config ./openclaw.config.yaml --json
npx tsx openclaw-sync-runtime/src/cli.ts acquire_lock --config ./openclaw.config.yaml --json
npx tsx openclaw-sync-runtime/src/cli.ts release_lock --config ./openclaw.config.yaml --json
npx tsx openclaw-sync-runtime/src/cli.ts status --config ./openclaw.config.yaml --json
```

## Scope intentionally removed

- Non-OSS backends (Dropbox/WebDAV/OneDrive/Google Drive).
- Any Obsidian settings UI and browser-runtime glue.
- Multi-cloud abstraction and non-Linux runtime support.

## Current known limits

- Pull/reconcile conflict merge is not implemented yet (current core is push-focused).
- Runtime state store is currently JSON file; SQL schema is prepared in `src/state_schema.sql` for SQLite migration.
- OSS lock currently uses `If-None-Match: *`; wiring `x-oss-forbid-overwrite=true` as explicit request header remains a follow-up.
