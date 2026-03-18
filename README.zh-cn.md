# rs-openclaw

[English](./README.md) | 中文

`rs-openclaw` 是从 Remotely Save 抽离并面向 OpenClaw 的 Linux 同步运行时，核心是**触发式同步**与**可被 OpenClaw 调用**。

## 目录命名说明

为避免 `openclaw` 目录名歧义（看不出是“集成代码”还是“同步运行时”），已将实现目录统一更名为 `openclaw-sync-runtime`。
该目录专门存放 **OpenClaw 可调用的 Linux 同步守护进程与 CLI**，不是 OpenClaw 主程序本体。

## 项目定位

本仓库当前不是面向通用多云的 Obsidian 插件发行版，重点为：

- Linux 常驻 daemon + CLI 工作流
- 仅支持 Alibaba OSS（S3 兼容）
- 基于本地文件变化触发同步（`fs.watch` + 防抖队列）
- 支持 OpenClaw 主动触发命令（`sync_once`、`flush_queue`、`status` 等）
- 支持 vault 级别锁、续租与过期抢占，保障多进程/多机协作

## 保留的核心能力

- 基于本地快照状态的增量同步
- 文件变更触发与命令触发两种入口
- 加锁 / 续租 / 解锁 / 过期锁抢占恢复流程
- 便于 OpenClaw 解析的 JSON 输出
- 可审计的锁与同步运行记录

实现细节见 [openclaw-sync-runtime/README.md](./openclaw-sync-runtime/README.md)。

## 已明确移除的范围

以下内容不属于当前 OpenClaw 目标范围：

- 非 OSS 后端（Dropbox/WebDAV/OneDrive/Google Drive/Box 等）
- Obsidian 设置页与浏览器运行时耦合逻辑
- 以多云抽象为优先目标的设计
- 非 Linux 运行时支持

## 快速开始

```bash
# 或使用 npm scripts:
# npm run runtime:daemon
# npm run runtime:cli -- status --config ./openclaw.config.yaml --json

# 启动守护进程
npx tsx openclaw-sync-runtime/src/daemon.ts ./openclaw.config.yaml

# 执行一次同步
npx tsx openclaw-sync-runtime/src/cli.ts sync_once --config ./openclaw.config.yaml --json

# 查看状态
npx tsx openclaw-sync-runtime/src/cli.ts status --config ./openclaw.config.yaml --json
```

## 文档入口

- OpenClaw 运行时说明：[openclaw-sync-runtime/README.md](./openclaw-sync-runtime/README.md)
- OpenClaw Fork 建设方案（中文）：[docs/openclaw_fork_plan.zh-cn.md](./docs/openclaw_fork_plan.zh-cn.md)

## 安全提示

- 启用自动同步前请先备份本地数据。
- 建议对数据对象与锁对象使用不同 OSS 前缀。
- 锁对象建议放在未开启版本控制的桶/前缀中，避免锁语义失效。
