# 2026-08-03 患者小程序账号发布切片

> 配合设计：`docs/superpowers/specs/2026-08-03-patient-mp-account-compat-launch-design.md`  
> 禁止整目录覆盖生产。哈希对照日期：2026-08-03（只读拉取）。

## 1. 可同步文件与 sha256

| 相对路径 | 生产基线 sha256 | 待发布(本地) sha256 | 对照 |
|---|---|---|---|
| `app/mp_auth.js` | `a73486abcc077310a7f5aaf01244885b6d538f4ca8c4a7743ed4fe6190d71cef` | `c6ece1cd284570bf0e0a6efd4c26c5fb331e431d5073eb4f2dbdcac5025d51bb` | DIFF（需发） |
| `app/mp_runtime_config.js` | （生产不存在） | `c461ff36a0a969084422529367a44b297e8a616bcff21810ee75f41e270ddcc4` | NEW |
| `app/routes/mp-auth.js` | `aa3192378a1740d4ba47179b717ea8780d8d8c3ddfd1b6d2ab61f2dc469911eb` | `b77255c961f71426d5a8fcdcc7051c0b8e006d17ae452c80a78de2e9aeb9b117` | DIFF |
| `app/routes/mp-ai.js` | `6c981ae64880c3358c2e8706f263f58664849008d4795bd84350ad1359c4645a` | `4913acd51cb1acc1e94947547aa24399d1fb6f77595ec1dd12198f021dd0701e` | DIFF |
| `app/routes/patient-public.js` | `6d66bbf9b17fc7443164c5018fa68ea61a1ea7233cc5c48178ec00d670fcf688` | `704c74203149c563fdf5297668e2bc76b880137d7204331dd7e15f015c576c00` | DIFF |
| `app/db.js` | `9da02bac950f0c12d7b33a5faf8b6865a845c0b16a95b098686a9ecc652e1d41` | `168faaa908ea9ef90bd6d85ac7f615fe8ead2b32aef58473b150a4f47b46584d` | DIFF（含迁移；启动有 reconcile 副作用，见下） |
| `app/rate_limit.js` | （生产不存在） | `d080220d18e2bc8751e3ab7c21a1b4a90ebccdc4d0236607701722a679675960` | NEW |
| `app/sms_provider.js` | `3de81ddd281c8ff9c0e0ea765853bf8644a138a14f555a757ceaf1f105765d68` | `f28642552f9328635c9eae1fd27371a67685914587c2db89ca8d1fa5348dd193` | DIFF |
| `app/sms_code_verifier.js` | （生产不存在） | `fa70d527b09a788c382ce51a39a8cc76d479512f2837770ad2382d010c976791` | NEW |
| `app/wechat_mp.js` | `a6bb7b12a1c48bbf9d2c86a56e29dfa57b121be66af41ad1a6b2285b82d79390` | `8cac9cf119106a5a129eeaf2e7e476db6fbfa2c66d6f9600cbab1caa7f377232` | DIFF |
| `app/server_lifecycle.js` | （生产不存在） | `379abc0cb6c0793212cc4ab7c03ecd14168bf61f8c1dbdf9d5e46109d0ec6afa` | NEW |
| `app/server.js` | `542663bca4007c5031eafd3958dbe662481ad9ce52b42db511ef69a28b616aa5` | `10f29e13944ca6c9fad03a17a9f7ce273f7e76d6762cec05cbd52cc1869b9446` | DIFF（主要为 ready/lifecycle/core readiness；见对照摘要） |

小程序：`patient-uniapp` 生产构建产物与后端**同维护窗**发布。

原始对照表：`_slice_hash_report.txt`  
`server.js` 符号摘要：`_server_js_diff_summary.txt`

## 2. 禁止同步（除非证明与当前生产行为一致）

- `app/agent/**` 行为漂移文件
- 分诊 engine 策略漂移文件（本窗不以刷绿 `npm test` 61 项为目的同步）
- `app/modules/community/**` 未评审行为漂移
- 测试临时文件、本地 rehearsal 目录

## 3. `/api/message` 兼容结论

本地身份边界测试通过；首发保持不信任客户端 `patientId`/`patientKey` 伪造。

## 4. 环境变量（首发）

```text
NODE_ENV=production
MP_SESSION_COMPAT=1
PRIVATE_UPLOAD_DIR=/var/lib/chunyu-doctor/private-uploads
```

保留：`PORT`、`DB_PATH`、`WECHAT_MP_APP_ID`、`WECHAT_MP_APP_SECRET`。

当前生产只读：无 `NODE_ENV` / `PRIVATE_UPLOAD_DIR` / `MP_SESSION_COMPAT`；`PRIVATE_DIR=no`；PM2 online、restarts≈70。

## 5. 本地生产库副本迁移演练（2026-08-03）

- 只读拉取：`data.db` + WAL/SHM → `C:\Users\11\Desktop\www\_prod_db_rehearsal`
- 在副本上加载本地 `db.js` 后：
  - 新增表：`mp_storage_scopes`、`mp_data_requests`、`mp_private_files`、`mp_ai_audit`
  - `mp_sessions.revoked_at` 已添加
  - 会话行数 **31→31**，`revoked_at` **未批量填充**（仍为 0）
  - `PRAGMA integrity_check` = ok
- 报告：`_migration_rehearsal_report.json`
- 注意：加载完整 `db.js` 时副本上出现社群 `[mdg-merge] ... keep 4 drop 748`（合并重复企微群记录，drop 的是 **id=748** 而非 748 行）。上线前需确认生产是否已跑过同等 reconcile；若未跑，部署 `db.js` 可能改写社群群组重复数据。

## 6. `server.js` 对照结论（约束 B）

相对生产，本地 `server.js` 增量主要是：

- `mp_runtime_config` / `runtimeCoreReadiness` 启动门禁
- `/api/health|ready` 动态配置与 uploads 分项
- `server_lifecycle` graceful shutdown
- `sms_code_verifier` 抽离

符号计数：`ClinicalRisk`/`SendPolicy`/`modules/community`/`require("./triage")` 与生产一致（delta 0）。**未见** `health_chat` 新增。本窗可带 `server.js`，但仍建议维护窗后做管理端+社群+message 冒烟。

## 7. 回滚包

部署前打包：

- 上表「生产基线」对应文件完整副本
- SQLite 一致性备份（含 WAL/SHM）
