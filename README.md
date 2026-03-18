# rs-openclaw

English | [中文](./README.zh-cn.md)

`rs-openclaw` is a Linux-first, OpenClaw-oriented sync runtime extracted from Remotely Save.
It focuses on **event-triggered synchronization** and **OpenClaw callable workflows**.

## Project Positioning

This repository is **not** a generic multi-cloud Obsidian plugin distribution.
Current focus is:

- Linux daemon + CLI workflow
- Alibaba OSS (S3-compatible) as the only storage backend for OpenClaw scenarios
- Local file change triggers (`fs.watch` + debounce queue)
- OpenClaw-triggered commands (`sync_once`, `flush_queue`, `status`, etc.)
- Vault-level lock with lease/expiration recovery for multi-process or multi-host coordination

## Core Capabilities (Kept)

- Incremental sync based on local snapshot state
- Trigger sync from file changes and command calls
- Lock acquire / renew / release + expired lock steal flow
- JSON machine-readable CLI output for OpenClaw integration
- Audit-friendly lock and sync runtime records

See implementation details in [openclaw/README.md](./openclaw/README.md).

## Out-of-Scope (Removed)

The following are intentionally excluded from this fork target:

- Non-OSS backends (Dropbox/WebDAV/OneDrive/Google Drive/Box/etc.)
- Obsidian settings UI and browser runtime coupling
- Multi-cloud abstraction as a first-class design goal
- Non-Linux runtime support

## Quick Start

```bash
# start daemon
npx tsx openclaw/src/daemon.ts ./openclaw.config.yaml

# run one-shot sync
npx tsx openclaw/src/cli.ts sync_once --config ./openclaw.config.yaml --json

# query status
npx tsx openclaw/src/cli.ts status --config ./openclaw.config.yaml --json
```

## Documentation

- OpenClaw runtime overview: [openclaw/README.md](./openclaw/README.md)
- OpenClaw fork design notes: [docs/openclaw_fork_plan.zh-cn.md](./docs/openclaw_fork_plan.zh-cn.md)

## Safety Notes

- Always back up local data before enabling automatic sync.
- Use dedicated OSS prefixes for vault data and lock objects.
- Keep lock bucket/prefix in a non-versioned area to preserve lock semantics.
