# 咨询对话本机按账号保留

日期：2026-08-03  
状态：已批准（主人选 A）

## 目标

小程序咨询页对话在刷新/重进后仍可恢复，并按账号（opaque `storageScopeId`）隔离。

## 方案

- 存储键：`mpAiChatTranscript:{mps_…}`（opaque scope only）
- API：`loadMpAiTranscript` / `saveMpAiTranscript` / `clearMpAiTranscript`
- 只存 `id/role/text`，单条 text 截断，最多 50 条；欢迎语一并落盘，刷新后原样恢复
- 写入：用户消息入列、助手/欢迎语打字完成；空列表写入不落盘也不清库（避免误删）
- 读取：挂载、scope 就绪、`onShow` 在仅欢迎/空态时二次恢复
- 清理：仅垃圾桶 / `clearScopedStorage` / 退出登录
- 禁止：`deep: true`；禁止旧键名 `mpAiChatHistory` / `loadMpAiHistory` / `saveMpAiHistory`

## 非目标

- 服务端同步、跨设备
