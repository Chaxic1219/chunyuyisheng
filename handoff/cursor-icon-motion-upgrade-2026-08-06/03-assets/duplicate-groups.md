# 完全重复资源组

判定方式：对 `patient-uniapp/src/static/icons/**/*.png` 逐文件计算 SHA-256；同一组内字节完全一致。组号与 `current-icon-inventory.csv` 一致。

## DG-01

- 文件：`asset-elder.png`, `az.png`
- SHA-256：`ec38d832a3625d5fcfa5f8fb58c0f8ff69ff4f2d46b728b6b6f726b23fa305e6`
- 建议：统一替换为 elder-mode。

## DG-02

- 文件：`asset-family.png`, `team.png`
- SHA-256：`4309ff68ba574d63145ecdc170f12d44720d06a335a57638f84085efdead1198`
- 建议：家庭成员使用 member-record；医生群使用 doctor-group。

## DG-03

- 文件：`asset-health-log.png`, `heart.png`
- SHA-256：`5bf29e5685be1e09739d0ccee15692d715703b12f1f290c4fc9aebd28045ccb9`
- 建议：健康记录使用 health-log；计划入口使用 health-plan。

## DG-04

- 文件：`asset-plans.png`, `form.png`
- SHA-256：`0eaad6b66e3441b12188fcd57b84ae146c4b96a9e1c854578c1b9f83cb366848`
- 建议：计划使用 health-plan；表单编辑使用 record-edit。

## DG-05

- 文件：`asset-privacy.png`, `asset-security.png`, `asset-settings.png`, `lock.png`
- SHA-256：`0141c12aa64939b2ae3f9c64470571814f9f75ecd59becb3d2eddb0f8705c1e3`
- 建议：按语义拆分为 privacy、account-security、settings；退出和解绑另用 account-logout、wechat-unbind，禁止一锁多义。

## DG-06

- 文件：`asset-records.png`, `file.png`
- SHA-256：`6a263f5a2394485b62eb8e88d5b539af2d5a70bef92a1887691085877ee094d1`
- 建议：档案记录统一为 health-record；附件使用 attachment。

## DG-07

- 文件：`asset-reminders.png`, `clock.png`
- SHA-256：`9ea21c81accb81593cd83a99f9caaf07447d4dcf57747ac8e0f1edd40060785f`
- 建议：提醒统一为 reminder；助手共享改用 group-service。

## DG-08

- 文件：`asset-services.png`, `shield.png`
- SHA-256：`cdfd53efae68aa62725dd44754a2b113dc5b5ddfa0d0481e1eb102258930524c`
- 建议：服务中心、服务包、健康助手分别使用 service-center、service-package、health-assistant。

## DG-09

- 文件：`chevron-muted.png`, `chevron.png`
- SHA-256：`8c20f8ae28c43d3b48280296e481ff53a96a0cf91fdbb0e1052025908a898ec9`
- 建议：合并为 nav-chevron-right，灰色由 muted 版本提供。

## 非重复但必须移除的文字栅格按钮

- `view-archive-btn.png`：69.46KB，图片内同时固化了“查看档案”文字、按钮轮廓与装饰。
- 问题：无法随字体、长辈模式、无障碍名称和状态色适配；单资源体积显著高于线性图标。
- 替换：删除图片式按钮，改用真实 `AppButton`，文本保留“查看档案”，图标使用 `health-record`；按下反馈由公共组件负责。

## 汇总

- 完全重复组：9 组。
- 重复组涉及文件：20 个。
- 清理顺序：先迁移生产调用点，再删除旧 PNG；服务端旧名称只保留在语义别名层。
