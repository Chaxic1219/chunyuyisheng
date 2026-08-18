# 去掉联络表身份证号 — 实施计划

> 对应规格：`docs/superpowers/specs/2026-08-13-remove-id-number-from-contact-form-design.md`

## 文件

| 文件 | 变更 |
|------|------|
| `app/patient_profile.js` | 默认字段去掉 idNumber；校验不再要求/校验该字段；可选 strip 辅助 |
| `app/routes/patient-public.js` | 联络表落库 payload 不写身份证号；写入 profile 时不 patch idNumber |
| `app/routes/patients-admin.js` | PATCH 忽略 idNumber；GET 不返回 idNumber |
| `app/routes/mp-auth.js` | archive/prefill 不返回 idNumber |
| `app/routes/mp-me.js` | 不展示 idNumber |
| `app/server.js` | contactForm 升级/规范化时用无 idNumber 的默认字段（自然生效） |
| `patient-uniapp/.../invite/form.vue` | 字段列表删除 |
| `patient-uniapp/.../archive/profile.vue` | 字段列表删除 |
| `admin-ui/.../archive/index.vue` | UI + 保存去掉 |
| `app/seed.js` | 种子 contactForm 去掉（可选，避免新环境再出现） |

## 任务

1. 改 `patient_profile.js` 核心
2. 改 API 读写路径
3. 改小程序 + 后台 UI
4. 过滤已有医生 content（启动升级已会用 defaultContactProfileFields，确认升级逻辑）
5. 部署服务端 + 后台；小程序本地改好待发版
