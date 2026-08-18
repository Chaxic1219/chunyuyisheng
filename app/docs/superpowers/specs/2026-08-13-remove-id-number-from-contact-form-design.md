# 医患联络表去掉身份证号

日期：2026-08-13  
背景：王云程主任反馈，联络表「身份证号」易引起患者警惕。决策：**患者端与后台均下线采集/展示**（方案 A）；库内历史值不批量清除。

## 目标

- 患者填写医患联络表、邀请建档、档案编辑时不再出现身份证号。
- 后台患者档案不再展示/编辑身份证号。
- 新写入路径忽略 `idNumber`；旧客户端提交带该字段时不校验、不落库更新。
- 读接口对管理/患者侧不再返回可用身份证（掩码也不再展示）。

## 非目标

- 不批量 `UPDATE`/`DELETE` 历史身份证数据。
- 不改动 PII 掩码工具本身（消息正文脱敏仍保留）。
- 不改病案复印等文案里「携带身份证」类就诊指引。

## 改动面

1. `patient_profile.defaultContactProfileFields`：移除 `idNumber` 字段定义。
2. 校验/抽取：有值才校验改为**始终忽略**写入；extract 可仍解析但不用于 profile patch。
3. 医生 `content.contactForm.fields`：bootstrap/下发时过滤 `idNumber` / 标签「身份证号」。
4. 小程序：`invite/form.vue`、`archive/profile.vue` 字段列表去掉；相关 payload 组装不再带出。
5. 后台 `archive/index.vue`：去掉身份证 UI 与保存逻辑。
6. Admin/MP API：PATCH 忽略 `idNumber`；GET profile 不回传该字段（或固定空）。

## 验收

- 打开联络表/邀请表无「身份证号」。
- 后台档案无身份证区块。
- 提交联络表成功，且带旧字段也不报「身份证号格式不正确」。
