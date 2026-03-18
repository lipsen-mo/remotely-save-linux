# rs-openclaw（Linux + OpenClaw + OSS）文档对齐说明

> 本文档用于明确：当前仓库以 OpenClaw 触发同步为中心，删除与该目标无关的说明，并保留同步核心能力与特性。

## 1. 当前目标（唯一主线）

`rs-openclaw` 的目标是提供一个可在 Linux 上常驻运行、可被 OpenClaw 调用、基于 Alibaba OSS 的触发式同步系统：

- **触发入口**：文件变更触发 + OpenClaw 命令触发
- **运行形态**：daemon + CLI
- **存储后端**：Alibaba OSS（S3 兼容）
- **并发控制**：vault 级锁 + 租约续期 + 过期抢占

## 2. 保留能力（核心特性不变）

以下能力为本项目必须保留：

1. 基于本地状态快照的增量同步
2. 事件队列 + 防抖合并后的批处理同步
3. 支持 `sync_once`、`status`、`flush_queue`、`reconcile` 等可调用动作
4. 支持锁获取、续租、释放、过期抢占恢复
5. 命令输出支持 JSON，便于 OpenClaw 自动化集成
6. 保留同步与锁审计信息，便于排障

## 3. 已删除/不再维护的非目标说明

为避免文档误导，以下方向被明确排除：

- 面向通用插件市场的多云能力介绍
- 与 OpenClaw 触发同步无关的 UI 配置页说明
- 浏览器环境限制、前端交互流程等非 Linux daemon 关键路径内容
- 非 OSS 后端（Dropbox/WebDAV/OneDrive/Google Drive/Box/pCloud 等）接入指导

> 注：如历史文档仍有残留旧描述，以本文件与根目录 README 为准。

## 4. 最小可用运行路径

```bash
# 1) 启动守护进程
npx tsx openclaw-sync-runtime/src/daemon.ts ./openclaw.config.yaml

# 2) OpenClaw 或运维侧触发一次同步
npx tsx openclaw-sync-runtime/src/cli.ts sync_once --config ./openclaw.config.yaml --json

# 3) 查询状态
npx tsx openclaw-sync-runtime/src/cli.ts status --config ./openclaw.config.yaml --json
```

## 5. 后续文档维护原则

后续新增或修改 Markdown 文档时，遵循：

- 只保留对 OpenClaw 触发同步链路有直接价值的内容
- 与当前 Linux + OSS + daemon/CLI 范围无关的说明应删除或迁移到历史资料
- 任何新特性文档都需标注是否影响：触发链路、锁机制、增量同步状态模型
