# 周玉春群功能编号与配置界面 Implementation Plan

> **For agentic workers:** Use executing-plans or implement task-by-task. Steps use checkbox syntax.

**Goal:** 周玉春群 101/102/301/909 等具备引导语+春雨主页原生贴片配置；按医生隔离；配置中心可改主页短链；新建编号总览页；吕配置不变。

**Architecture:** seed + 新 schema_patch 写周玉春 rules/scripts/chunyuIntegration；发布时同步短链到 mp；总览 API 聚合 rules+scripts+weapp；UI 跟当前医生。

**Tech Stack:** Node.js/SQLite, Vue3 admin-ui, 现有 qiwe_weapp_templates

---

### Task 1: Seed 周玉春主页短链与 mp 规则
- Modify: `app/seed.js`
- [ ] 增加 `zhouDoctor` 短链与 `ZHOU_CY`
- [ ] 101/102/301/909 写入 extCard mp；更新 code301 文案；content.chunyuIntegration

### Task 2: DB 补丁落地老库
- Modify: `app/db.js`
- [ ] 新 patch：重写 zhou rules/content/scripts；sync weapp 占位
- Test: node 探测 101 含 mp + shortLink

### Task 3: 配置发布同步主页短链
- Modify: `app/server.js` + config fields/UI
- [ ] 保存/发布 doctorHomeShortLink 并刷新 101/102/301/909

### Task 4: 编号总览 API + 页面
- Create: overview API + `admin-ui` 视图与路由
- [ ] 按 doctorId 返回编号行与原生卡状态

### Task 5: 构建部署验证
- [ ] admin-ui build + deploy；周 101 有 mp；吕 101 未改
