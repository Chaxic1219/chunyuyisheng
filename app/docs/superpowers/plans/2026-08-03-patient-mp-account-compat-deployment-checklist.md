# 2026-08-03 兼容优先部署检查清单（约束 B）

> 扩展自 `2026-07-31-patient-mp-account-deployment-checklist.md`。  
> **默认不执行生产写入。** 任一步生产动作需主人单独批准。

## 0. 本地已完成的兼容补丁（本轮）

- [x] `MP_SESSION_COMPAT`（默认开）：旧未撤销 token 可读；登录/换绑仍轮换
- [x] 核心就绪与私密上传就绪拆分：缺私密目录不阻断启动/core ready
- [x] `/api/message` 身份测试通过；保持不信任客户端 patient 伪造
- [x] 小程序数据申请对 `404` 友好降级（「数据申请暂不可用」）
- [x] `node _mp_data_requests_test.js` 通过（轮换用例改为真实 revoke+新会话，对齐兼容模式）
- [x] 小程序 `type-check` / `test:ui` 77/77 / `build:mp-weixin` 通过
- [x] `npm test` 仍约 61 项分诊/社群旧契约失败（已知门禁，未降急症等级）

## 1. 发布前批准门槛

- [x] 切片清单已定：`2026-08-03-patient-mp-account-release-slice.md` 哈希已填（2026-08-03 只读对照）
- [x] `server.js` 符号对照：ClinicalRisk/SendPolicy/community/triage require 与生产 delta 0；增量主要为 ready/lifecycle
- [ ] **确认**部署 `db.js` 时社群 `mdg-merge`（演练见 keep 4 drop id=748）可接受，或先在维护窗评估
- [ ] `MP_SESSION_COMPAT=1` 写入发布 env
- [ ] 新生产 DB 备份已在**服务器上**创建并验证可恢复（本地仅有只读副本演练）
- [x] 本地备份副本迁移演练通过（新表齐全；31 会话未批量 revoke；integrity ok）
- [ ] `PRIVATE_UPLOAD_DIR` 目录 `0700` 已创建
- [ ] orphan 公开凭证隔离方案确认（不删、不挂档）
- [ ] 旧 token 冒烟用例：部署后未重登仍可访问原主流程
- [ ] 管理端 / 社群 / bootstrap / message 冒烟清单写好
- [ ] Linux PM2 `SIGTERM` 演练（本窗含 lifecycle）
- [ ] `npm test` 61 项策略失败已由业务/安全裁定（不得降急症等级刷绿）
- [ ] 主人单独批准本维护窗

## 2. 发布顺序

1. 冻结非必要写入；记录 PM2 / Nginx / 代码版本  
2. 备份代码切片 + SQLite 一致性备份  
3. 副本迁移演练通过  
4. 维护窗停 PM2  
5. **只同步切片文件**（对照 sha256）  
6. 写入 env：`NODE_ENV`、`MP_SESSION_COMPAT=1`、`PRIVATE_UPLOAD_DIR`  
7. 启 PM2；检查 `/api/bootstrap`、`/api/health|ready`（core ok；uploads 可单独 degraded）  
8. 旧 token 冒烟 → 新登录/换绑/邀请/上传/AI/数据申请  
9. 管理端 + 社群 + message 冒烟  
10. 发小程序新包  
11. 观察 30 分钟（重启、5xx、429、DB 锁）

## 3. 明确不做（同窗）

- 不批量 `UPDATE mp_sessions.revoked_at`
- 不关闭 `MP_SESSION_COMPAT`（另批）
- 不自动删除 orphan 公开凭证
- 不整仓 scp 覆盖
- 不为变绿修改急症/社群策略

## 4. 回滚

1. 停 PM2  
2. 恢复部署前代码切片  
3. 恢复部署前 DB 备份（已迁移库不给旧代码继续写）  
4. 保留 `private-uploads` 快照对账  
5. 验 bootstrap / 管理端 / 旧小程序主路径  

## 5. 兼容开关关闭（后续单独窗口）

仅在多数用户已自然重登、公告完成、主人批准后将 `MP_SESSION_COMPAT=0`。
