# Linux 下基于 Remotely Save Fork 的 OpenClaw 专用同步版建设计划书

## 一、项目名称

**Remotely Save OpenClaw Fork 版增量同步系统建设项目**

## 二、项目建设背景

现有 Remotely Save 已具备三项非常适合复用的基础能力：

1. 原生支持 S3 兼容存储。
2. 同步算法 V3 已转向本地保存状态、增量 push、增量 pull、partial sync 与基础冲突处理。
3. 其设计强调“最小侵入”，从 0.4.1 起不再向远端写额外元数据。

同时，原项目也存在与本次目标不一致的边界：它是 Obsidian 浏览器环境插件，自动同步只在 Obsidian 打开时生效，sync on save 也是围绕编辑器内事件触发，这决定了它不能直接满足 Linux 常驻后台、OpenClaw 主动调用、多机多进程协同锁这几个需求。

因此，本项目建议路线为：**以 Remotely Save 为上游 fork，保留其同步核心思路和 S3 兼容适配经验，重构为“headless daemon + CLI/OpenClaw 调用接口”的专用版**。

## 三、项目目标

### （一）总体目标

建设一个仅支持 Alibaba OSS S3 的 Linux 常驻同步系统，作为 Remotely Save 的 OpenClaw 优化 fork 版，具备以下能力：

- 监听指定目录树文件变化并自动触发同步。
- 支持 OpenClaw 通过命令行或本地 RPC 直接调用。
- 支持多台电脑、多进程同时运行时的简单协同锁。
- 保留增量同步、小文件快速同步、低侵入状态管理的核心体验。
- 不建设图形界面，仅提供配置文件、日志、CLI 命令和机器可读输出。

### （二）边界约束

- 只支持 Alibaba OSS 的 S3 兼容接口。
- 不支持 Dropbox、WebDAV、OneDrive、Google Drive 等其他后端。
- 不建设 Obsidian 插件设置页。
- 不建设 Web 管理后台。
- 协同锁以“简单可靠、适合 OpenClaw 多开”为目标，不追求分布式事务级强一致。

## 四、总体方案结论

本项目适合采用“Fork 上游项目 + 核心逻辑抽离 + Headless 化重构”的实施路径。

原因有三点：

1. Remotely Save 已明确支持 S3 兼容服务，并公开其同步算法方向，包括 keep newer、keep larger、keep both and rename、true deletion status computation、no remote metadata、incremental push only、incremental pull only、partial sync。直接吸收这些设计，比从零写一套同步器更稳。
2. Alibaba OSS 对 S3 API 有较高兼容度，已兼容 ListObjectsV2、HeadObject、PutObject、DeleteObject、CompleteMultipartUpload 等关键接口，足以覆盖本项目同步主链路。
3. 原项目运行于浏览器插件环境，自动同步只能在 Obsidian 打开时工作，这与 OpenClaw 的 Linux 常驻后台模式不一致，因此需要 fork 后进行服务化改造。

## 五、建设原则

### （一）单后端深优化

围绕 Alibaba OSS 做专项适配，不保留多云抽象优先级。这样可减少兼容层复杂度，把精力集中在监听、增量、锁和 OpenClaw 接口。

### （二）本地状态为主

沿用 Remotely Save V3 的方向，以本地状态库为核心，不向远端写整套同步元数据文件。这样更利于与 OpenClaw、rclone 或人工上传等其他工具并存。

### （三）事件驱动为主，周期校准为辅

日常通过 Linux 文件系统监听实现“保存后快速同步”，低频再做远端校准，兼顾速度与稳健。

### （四）锁设计从简

锁只解决“同一时刻多个程序对同一 vault 大批量写入远端”的碰撞问题，不承担复杂分布式协调职责。

## 六、目标产品形态

项目落地后形成三部分：

1. **rs-openclaw-daemon**  
   Linux 常驻守护进程，负责监听目录、维护队列、执行同步、续租锁、写日志。

2. **rs-openclaw-cli**  
   命令行入口，供 OpenClaw 调用。示例命令包括：
   - `sync once`
   - `acquire lock`
   - `release lock`
   - `status`
   - `reconcile`
   - `flush queue`

3. **rs-openclaw-core**  
   从 Remotely Save fork 后抽离的核心同步库，负责：
   - 本地状态库
   - 文件清单计算
   - 增量 push / pull
   - 冲突判定
   - OSS 适配
   - 锁对象管理

## 七、基于 Fork 的重构策略

### （一）保留内容

- **同步算法 V3 思路**：继续采用增量 push、增量 pull、partial sync、keep newer / larger / both-and-rename 这套策略框架。
- **最小侵入思想**：继续保持“不向远端上传专用同步元数据文件”的原则，本地保存 previous successful sync status。
- **S3 兼容层经验**：保留 Remotely Save 处理 S3 兼容服务所积累的路径、前缀、对象列举、对象上传下载等逻辑方向。

### （二）替换内容

- 替换 Obsidian API 依赖：原项目的自动同步和保存触发依赖 Obsidian 插件环境，本项目改为 Linux 文件监听器。
- 替换 UI 配置页：改为 YAML 配置文件。
- 替换浏览器存储：改为 SQLite + 本地文件缓存。
- 替换手工点击同步：改为守护进程常驻 + OpenClaw 命令触发 + 文件变化自动触发。

### （三）新增内容

- OSS 专用适配层
- 协同锁模块
- OpenClaw 调用协议
- systemd 用户服务
- 机器可读 JSON 输出
- 失败重试与健康检查

## 八、Alibaba OSS 专项适配方案

### （一）接口层选型

Alibaba OSS 已兼容对象存储常用的 S3 API，包括 PutObject、DeleteObject、HeadObject、ListObjectsV2、Multipart Upload 等，本项目同步核心完全可以建立在这些接口之上。

### （二）必须处理的 OSS 差异

1. **请求风格**  
   OSS 仅支持 virtual-hosted style，请求需按 bucket 作为子域名方式组织，不能按 path-style 假定。

2. **ETag 差异**  
   OSS 与 S3 的 ETag 存在差异，尤其 multipart upload 的 ETag 计算方式不同，旧文档还指出普通对象 ETag 大小写与 S3 不同。锁与同步状态判断不能把 ETag 当作唯一真相，应辅以 size、mtime、自定义 metadata 或 version id。

3. **覆盖保护语义**  
   OSS 的 `x-oss-forbid-overwrite=true` 可阻止同名对象被覆盖，但在目标 bucket 开启或暂停版本控制时，该请求头无效；同时高频使用会影响 QPS 表现。

### （三）桶配置建议

- 数据桶使用单独 prefix，如 `vaults/<vault_id>/`
- 锁对象使用单独 prefix，如 `locks/<vault_id>/`
- 为简化锁语义，建议锁所在 bucket 或锁所在专用 bucket 关闭版本控制
- Vault 数据对象可按业务需要决定是否开版本控制，但若开版本控制，锁对象不要与数据对象共用同一策略桶

## 九、多人协同锁方案

### （一）设计目标

适配以下场景：

- 同一台电脑上多个 OpenClaw session 并发运行
- 不同电脑同时运行同步守护进程
- OpenClaw 主动发起 sync、flush、reconcile 时避免大规模交叉写入
- 在程序异常退出时锁能自动过期

### （二）锁模型

采用“OSS 锁对象 + TTL 心跳续租 + 本地快速退避”的简单协同锁。

锁对象示例：

`locks/<vault_id>/writer.lock`

锁内容示例：

- holder_id
- hostname
- agent_id
- pid
- started_at
- expires_at
- session_purpose
- program_version

### （三）加锁流程

1. 进程准备执行写同步前，先尝试创建锁对象。
2. 写入时设置 `x-oss-forbid-overwrite=true`，利用 OSS 的“禁止同名覆盖”语义抢锁。
3. 若创建成功，获得写锁。
4. 若对象已存在，则读取锁内容，判断是否过期。
5. 若未过期，则本地退避等待。
6. 若已过期，则执行“抢占恢复”流程，将旧锁转存为审计对象后，再尝试新建锁。

该方案依赖 OSS 的覆盖保护语义，而官方文档明确说明该请求头可阻止同名对象被覆盖，但在版本控制开启或暂停时失效，因此锁前缀必须放在关闭版本控制的桶或区域。

### （四）续租流程

- 拿到锁的进程每 15 秒续租一次。
- 续租方式为更新锁对象内容中的 `expires_at`。
- 续租时不直接覆盖主锁对象，建议采用“锁主对象 + 锁租约对象”双对象模式：
  - `locks/<vault_id>/writer.lock`
  - `locks/<vault_id>/leases/<holder_id>.json`

主锁对象用于互斥占位，租约对象用于心跳详情和审计。

### （五）解锁流程

1. 同步批次完成后主动删除租约对象。
2. 删除主锁对象。
3. 写入一条本地审计日志。

### （六）异常恢复

- 若进程崩溃，心跳停止，租约超时。
- 后续竞争者读取到 `expires_at` 已过期后，可进入抢占恢复。
- 为避免误抢，占用方与抢占方时钟差建议控制在 30 秒以内。
- 每次抢占恢复都记录审计对象，便于排查多机竞争。

### （七）锁粒度建议

- 写锁按 vault 级别：适合同一 vault 高可靠同步。
- 读操作不加锁：如 `status`、`list remote`、`dry-run`。
- 手工强制同步命令支持 `--force-lock-steal`：仅供运维排障使用。

## 十、监听文件夹变化自动触发同步方案

### （一）技术实现

Linux 下采用 inotify 体系监听目录树变化，守护进程常驻运行。触发事件包括：

- `close_write`
- `create`
- `delete`
- `move`
- `mkdir`
- `rmdir`

### （二）事件处理链路

文件变化 → 进入本地事件队列 → 1 秒防抖合并 → 查询 SQLite 状态库 → 判断是否纳入本批次 → 尝试获取写锁 → 执行增量同步 → 更新状态库 → 释放锁

### （三）事件合并规则

- 同一路径 1 秒内重复修改合并一次
- `create + modify` 合并为 upsert
- `move` 识别成功时按 rename 处理
- `move` 识别失败时按 `delete + create` 处理
- `.obsidian/cache`、临时文件、swap 文件默认排除

### （四）触发策略

- **默认实时模式**：文件保存后 1 至 3 秒内触发一轮小批量同步。
- **批量模式**：若 10 秒内累计变更超过阈值，则合并为一个批次。
- **OpenClaw 优先模式**：当 OpenClaw 正在执行需要稳定远端状态的操作时，可向 daemon 发起“优先刷新队列”命令。

## 十一、OpenClaw 对接优化方案

### （一）调用模式

推荐两种方式并存：

1. **CLI 调用**：OpenClaw 直接调用本地命令，例如：
   `rs-openclaw-cli sync once --vault <name> --json`
2. **本地 Unix Socket**：daemon 暴露本地 socket，OpenClaw 发送 JSON 命令，适合高频调用和状态查询。

### （二）返回格式

所有命令支持 JSON 输出，字段包括：

- success
- action
- vault_id
- lock_status
- queued_files
- uploaded_files
- pulled_files
- deleted_files
- conflicts
- elapsed_ms
- error

### （三）推荐 OpenClaw 交互动作

- `pre_task_sync`：OpenClaw 开始编辑 vault 前先触发快速 `sync once`。
- `post_task_flush`：OpenClaw 完成批量写入后触发 `flush queue`。
- `guarded_write`：OpenClaw 进行大批量重写时先申请 exclusive lock lease。
- `health_check`：OpenClaw 定时检查 daemon 状态和锁持有者。

### （四）多 session 优化

- 同机多个 OpenClaw session 共享同一 daemon。
- session 不直接各自监听目录。
- session 通过 daemon 排队提交任务。
- 同机并发竞争先由本地队列收敛，再由 daemon 统一向 OSS 申请远端锁。

这样可以减少 OSS 锁冲突和无效重试次数。

## 十二、本地状态库设计

采用 SQLite，核心表如下：

### （一）file_state

- path
- size
- mtime_ns
- content_hash
- remote_etag
- remote_version_id
- last_synced_at
- deleted_flag
- conflict_flag

### （二）event_queue

- id
- path
- event_type
- enqueue_at
- merged_flag
- retry_count
- status

### （三）lock_audit

- holder_id
- vault_id
- host
- pid
- acquired_at
- released_at
- steal_flag
- reason

### （四）sync_run_log

- run_id
- trigger_source
- started_at
- finished_at
- uploaded_count
- deleted_count
- pulled_count
- conflict_count
- lock_wait_ms
- result

## 十三、同步策略

### （一）日常同步

- 本地事件触发增量 push
- 每 10 至 15 分钟执行一次远端增量 pull
- 每日执行一次全量 reconcile

### （二）冲突策略

沿用 Remotely Save 已公开的几种策略，但默认策略建议调整为：

- Markdown 小文件：`keep both and rename`
- 非 Markdown 或大文件：`keep newer`，并保留冲突副本
- OpenClaw 生成文件：若路径位于专用输出目录，可配置为“本地优先”

### （三）删除策略

继续采用 true deletion status computation 思路，但删除状态仅保存在本地状态库与审计日志中，不向远端写专用元数据文件。

## 十四、实施步骤

### （一）第一阶段：Fork 与裁剪

- Fork 上游仓库
- 移除非 OSS 后端
- 移除 Obsidian 设置页和非必要 UI
- 抽出 sync core、S3 adapter、conflict handler
- 建立 headless 分支结构

**交付物：**

- fork 仓库
- 代码模块边界图
- 迁移清单

### （二）第二阶段：Daemon 化

- 增加 Linux 监听器
- 增加 SQLite 状态库
- 增加队列与批处理调度
- 增加 systemd 用户服务文件

**交付物：**

- 可常驻运行的 daemon
- YAML 配置文件
- 基础日志

### （三）第三阶段：OSS 锁模块

- 增加锁对象协议
- 增加续租、过期、抢占恢复
- 增加 lock audit
- 增加同机 session 聚合策略

**交付物：**

- 可用的多人协同锁
- 锁异常恢复机制
- 审计日志

### （四）第四阶段：OpenClaw 接口

- 增加 CLI
- 增加 JSON 输出
- 增加 Unix Socket 服务
- 补充 OpenClaw 调用范式

**交付物：**

- rs-openclaw-cli
- socket 协议文档
- OpenClaw 集成样例

### （五）第五阶段：可靠性增强

- 增加失败重试
- 增加全量校准
- 增加冲突副本策略
- 增加性能统计

**交付物：**

- 稳定版守护进程
- 运行手册
- 发布包

## 十五、主要风险与控制

### （一）直接 Fork 的适配成本高

原项目是 Obsidian 插件，并且自动同步受限于浏览器环境，说明其代码中一定存在较多 UI 和宿主依赖。Fork 后虽然可以复用算法方向，但真正可直接复用的 headless 代码比例未必很高。

**控制措施：**

- 先做模块审计
- 核心逻辑抽离优先
- UI 依赖不做兼容，直接替换

### （二）OSS 锁语义受版本控制影响

`x-oss-forbid-overwrite` 在 bucket 版本控制开启或暂停时无效。

**控制措施：**

- 锁对象单独放在关闭版本控制的 bucket 或专用 prefix 所在 bucket
- 锁模块发布前先完成桶策略检查

### （三）ETag 判断不稳定

OSS 与 S3 的 ETag 语义并不完全等价，multipart 也有差异。

**控制措施：**

- 不以 ETag 作为唯一冲突依据
- 结合 size、mtime、content_hash、version_id 综合判断

### （四）高频锁操作影响 QPS

OSS 文档明确提示 `x-oss-forbid-overwrite` 会影响高 QPS 场景表现。

**控制措施：**

- 同机 session 汇聚到单 daemon
- 每个批次一次加锁，不按文件逐个加锁
- 小批量合并，减少锁抖动

## 十六、最终建议

本项目建议正式命名为：

**Remotely Save OpenClaw Fork for OSS**

建议采取以下最终架构：

- 以 Remotely Save 为上游 fork
- 仅保留 OSS S3 路径
- 抽离同步核心为 `rs-openclaw-core`
- 新增 `rs-openclaw-daemon` 负责监听和自动同步
- 新增 `rs-openclaw-cli` 负责 OpenClaw 调用
- 使用 OSS 锁对象 + TTL 心跳实现简单多人协同锁
- 锁对象放在关闭版本控制的独立 bucket 或独立锁桶
- 默认同机多个 OpenClaw session 共用一个 daemon

## 十七、实施优先级

### 第一优先级

- Fork 裁剪
- OSS 单后端
- daemon 常驻
- 文件监听自动同步

### 第二优先级

- 协同锁
- OpenClaw CLI
- JSON 输出

### 第三优先级

- Unix Socket
- 全量校准
- 性能统计与审计
