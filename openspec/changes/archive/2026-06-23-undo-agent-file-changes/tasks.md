## 1. 快照模块 (electron/server/snapshot.ts)

- [x] 1.1 创建快照模块，实现 createSnapshot(sessionId, turnId, workspaceRoot)：遍历工作区文本文件并复制到 .nexo-data/snapshots/。
- [x] 1.2 实现 estoreSnapshot(sessionId, turnId, workspaceRoot)：从快照目录还原文件并删除快照。
- [x] 1.3 实现 hasSnapshot(sessionId, turnId)：检查快照目录是否存在且非空。
- [x] 1.4 实现 cleanupOldSnapshots(dataDir, maxAgeMs)：启动时清理超过 24 小时的快照。
- [x] 1.5 添加文件路径安全校验（防止路径穿越）。

## 2. Agent Loop 集成

- [x] 2.1 在 gent.ts 中为每个 assistant turn 生成 unique turnId（使用 assistant 消息 id）。
- [x] 2.2 在首条 shell_command 执行前调用 createSnapshot。
- [x] 2.3 在 done 事件中增加 hasSnapshot: boolean 字段，告知前端该 turn 可撤回。

## 3. 撤回 API 路由

- [x] 3.1 新增 POST /api/chat/:sessionId/undo 路由，调用 estoreSnapshot。
- [x] 3.2 新增 GET /api/chat/:sessionId/can-undo 路由（可选，如果 done 事件方案足够则不必须）。

## 4. 类型定义

- [x] 4.1 在 	ypes.ts 的 done 事件类型中增加 hasSnapshot?: boolean 字段。
- [x] 4.2 在 ChatMessage 类型中增加 	urnId?: string 字段（或将 turnId 与会话关联存储）。

## 5. 前端交互

- [x] 5.1 在 ChatPanel 的 assistant 消息旁增加「撤回」按钮（仅当 hasSnapshot 为 true 时展示）。
- [x] 5.2 实现撤回点击逻辑：调用 undo API，成功后更新 UI。
- [x] 5.3 撤回完成后按钮消失，显示 toast 提示「已撤回本次文件修改」。

## 6. 清理与验证

- [x] 6.1 实现启动时清理过期快照（>24h）。
- [x] 6.2 确保快照相关文件被 .gitignore 忽略。
- [x] 6.3 完整流程测试：发送消息 → 文件被修改 → 点击撤回 → 文件恢复。
- [x] 6.4 运行项目构建，确认无类型错误。
