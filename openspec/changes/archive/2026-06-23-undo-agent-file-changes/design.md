## Context

Nexo Agent 唯一可修改工作区文件的工具是 shell_command。Agent 通过调用 streamFromLLM 执行多轮 tool-calling，每轮用户消息可能产生多次 shell_command 调用，最终生成一条 assistant 消息。

目前 agent 操作是不可逆的——用户不认可结果时只能手动 git checkout 或 Ctrl+Z。

Codex 的撤回模式是：
1. Agent 完成代码写入后，消息旁边出现「Undo」按钮
2. 点击 Undo → 工作区恢复到该轮 agent 操作之前的状态
3. 撤回后按钮消失，不可重复撤回

## Goals / Non-Goals

**Goals:**
- 每次 assistant turn 开始第一个 shell_command 之前，自动对该命令涉及的写操作文件做快照。
- 前端在 assistant 消息旁展示「撤回」按钮（仅当该 turn 实际修改了文件时）。
- 撤回 = 将快照文件复制回原位，同时删除快照。
- 撤回后不可再撤（一次性操作）。
- 新旧会话之间快照隔离，不影响其他会话。

**Non-Goals:**
- 不基于 git（工作区可能不是 git 仓库）。
- 不支持撤回对话中的某一条消息（仅撤回文件修改）。
- 不追踪非 shell_command 的文件变更。
- 不支持多级 undo 堆栈（仅最新一次）。

## Decisions

### 1. 快照时机：第一个 shell_command 之前

在 gent.ts 的 tool-calling 循环中，当检测到本轮第一次 shell_command 调用时，在 execute 之前先做快照。

选择理由：延迟到最后一刻快照，避免对纯对话/搜索类 turn 产生无意义的快照。

替代方案：在 agent loop 开始时对所有文件做全量快照 → 太慢，大多数 turn 不写文件。

### 2. 快照内容：只快照即将被修改/删除的文件

shell_command 参数中包含 command 字符串。通过启发式解析识别其中引用的文件路径（如 Get-Content、Set-Content、Out-File、Remove-Item、Move-Item、Copy-Item 等 PowerShell cmdlet 和 >、>> 重定向操作符）。

**重要**：此解析是 best-effort。命令可能是复合的（&&、;）、跨行的、或通过变量间接引用文件。我们只快照能解析到的显式路径，并在 shell_command 返回的 	ool_result 中附带一份 modifiedFiles 列表（由 executor 在执行后通过文件系统对比或命令自身输出来确定）。

更稳健的做法：**执行前快照工作区中所有非 node_modules/.git 的已知源码文件**的开销太大。折中方案：执行前不清点路径，而是通过一个**基于时间的文件系统扫描**：执行前后各记录一次工作区文件的 mtime，执行后找出新增/修改的文件，将它们从执行前的状态恢复（如果有的话）。

**最终选择**：执行后扫描方案。

工作流程：
1. 首条 shell_command 执行前：记录 snapshotTime = Date.now()
2. shell_command 执行完成后：在工作区（排除 node_modules、.git、.nexo-data）中扫描 mtimeMs > snapshotTime 的文件
3. 读取这些文件的当前内容，保存到 .nexo-data/snapshots/<sessionId>/<turnId>/ 目录
4. 执行前的文件状态：由于我们在**第一个** shell_command 执行**前**扫描了文件系统的基线（或者更简单：在第一个 shell_command 之前扫描一遍工作区文件并记录 {path: mtime}，执行后对比）

**简化方案**：第一个 shell_command 执行前，扫描并备份工作区中所有非忽略文件的路径与内容。执行后不再需要基线对比——直接存快照，撤回时从快照恢复。

但这个太慢。再简化：

**最终采纳方案（简单可靠）**：
- 在 agent loop 中，第一个文件修改型 tool call 之前，调用 createSnapshot(sessionId, turnId)。
- 快照创建逻辑：递归遍历 workspaceRoot，跳过 
ode_modules、.git、.nexo-data、dist、dist-electron、.vite-cache 等目录，将所有非二进制文件（或所有文件，按扩展名黑名单过滤）的内容复制到 .nexo-data/snapshots/<sessionId>/<turnId>/。
- 弊端：大型仓库快照可能很慢。用**白名单扩展名**过滤（.ts, .tsx, .js, .jsx, .json, .md, .yaml, .yml, .css, .html, .py, .go, .rs, .toml, .env, .gitignore 等文本文件）。
- 撤回：将快照目录中的文件逐个还原到原路径，删除快照。

### 3. 撤回 API

新增 POST /api/chat/:sessionId/undo 路由：
- 找到该 session 中最近一次 assistant 消息对应的 turnId
- 查找 .nexo-data/snapshots/<sessionId>/<turnId>/ 目录
- 如果存在，还原文件并删除快照目录，返回 { ok: true, restoredCount: N }
- 如果不存在（已被撤回或未产生文件修改），返回 { ok: false, reason: "no_snapshot" }

### 4. 前端交互

在 ChatPanel 中，每条 assistant 消息（状态为 completed 且有快照）旁展示一个「撤回」按钮（回退图标 + "撤回修改" tooltip）。

点击后：
1. 调用 POST /api/chat/:sessionId/undo
2. 成功后按钮消失，系统提示「已撤回 N 个文件」
3. 失败则提示具体原因

如何知道 assistant 消息是否有快照？两种方案：
- 前端调用 GET /api/chat/:sessionId/can-undo 查询
- 在 SSE done 事件中增加 hasSnapshot: boolean 字段

选择：done 事件中增加 hasSnapshot 字段，简单可靠。

### 5. 快照存储结构

`
.nexo-data/
  snapshots/
    <sessionId>/
      <turnId>/
        <relative-path-to-file>   (内容为原文件内容)
`

turnId 使用 assistant 消息的 id。

## Risks / Trade-offs

- **大型仓库快照慢**：通过白名单扩展名（只快照代码/配置文件，跳过二进制、图片、视频等）和跳过目录列表来控制体积。预计典型项目快照 <5MB，耗时 <500ms。
- **并发写入**：用户可能在 agent 执行期间手动修改文件。快照在执行前创建，撤回恢复的是快照时刻的状态 + agent 的修改。如果用户手动修改了 agent 未触及的文件，撤回不会影响那些文件（因为快照中没有那些文件的记录）。
- **快照未清理**：如果用户不点撤回，快照目录会一直存在。需要定期清理策略（启动时清理超过 24 小时的快照）。
- **文件路径安全**：快照恢复时需要确保目标路径仍在工作区内，防止路径穿越攻击。

## Migration Plan

1. 新增快照模块 electron/server/snapshot.ts。
2. 在 shell_command executor 或 agent loop 中集成快照逻辑。
3. 新增 undo API 路由。
4. 前端增加撤回按钮交互。
5. 无需数据迁移，纯增量功能。
6. 回滚：如出现问题，禁用功能只需前端不展示按钮 + 后端路由返回 404 即可。
