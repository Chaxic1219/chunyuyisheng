# 自定义小程序贴片封面与文案 · 设计

**日期:** 2026-07-24  
**状态:** 已批准，进入实现

## 背景

企微原生小程序卡封面依赖 `thumbUrl` + 封面三件套（`coverFileAesKey` / `coverFileId` / `coverFileSize`）。此前只能真机采集；编号中心已有按编号改 title/desc，但封面能力分散。需在企微配置页一站式完成：自定义上传封面、编辑文案、真机重采。

## 目标

1. 超管在企微配置页上传 jpg/png，作为指定编号贴片封面。
2. 封面三件套经企微 CDN 上传写入模板；**默认同步同短链组**封面字段，**不覆盖**各编号 title/desc。
3. 按编号单独编辑标题 + 描述（与编号中心 `codes_cards` 同源写 `qiwe_weapp_templates`）。
4. 后台预览使用本地 `/uploads/qiwe-covers/` 图，避免微信防盗链。

## 非目标

- 不删除编号中心既有文案编辑。
- 不替代真机重采流程（保留为备选）。
- 不开放非超管上传。

## 方案

- 上传：JSON `imageDataUrl`（同头像）→ 落盘 `public/uploads/qiwe-covers/` → CDN 上传得三件套 → 写库并同步同组。
- CDN：复用 `/cloud/cdnBigUpload`；封面运维单独入口，不依赖「发图给患者」实验开关语义。
- 文案：`POST .../cover-copy` 更新单编号 title/desc。
- `raw_payload` 标记 `custom_upload` 上锁。

## 验收

- 上传后群发编号，卡面大图为自定义图。
- 改 101 文案不影响 102；改 101 封面同步 102/301。
- 本地缩略图可在后台直接显示。
