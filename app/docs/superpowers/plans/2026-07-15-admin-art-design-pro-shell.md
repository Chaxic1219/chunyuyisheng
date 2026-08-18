# 医助后台 Art Design Pro 全量套壳 Implementation Plan

> **For agentic workers:** 按任务顺序执行；后端 API 零改动红线。可用 subagent-driven-development 并行做无交叉页面。

**Goal:** 用 [Art Design Pro](https://github.com/Daymychen/art-design-pro)（Vue3+Vite+TS+Element Plus）完整重做全部 15 个医助后台 Tab，同域 Cookie 调用现有 `/api/admin/*`，部署后替换 `/admin` 入口（旧版保留 `/admin-legacy`）。

**Architecture:** 新建独立前端工程 `admin-ui/`；构建产物输出到 `app/public/admin-v2/`；Node 静态托管 + SPA fallback。鉴权继续 `sid` Cookie（`credentials: 'include'`）。业务逻辑仍在现有 Node 后端。

**Tech Stack:** Vue 3、TypeScript、Vite、Element Plus、Art Design Pro 壳、现有 spring Node admin API。

**非目标（本期）：** 不改 `server.js` 业务 API、不改患者端、不迁 SQLite、不换会话存储。

---

## 文件地图

| 路径 | 职责 |
|------|------|
| `admin-ui/` | Art Design Pro 清理后的前端工程 |
| `admin-ui/src/api/http.ts` | fetch 封装 + Cookie |
| `admin-ui/src/api/*.ts` | 按域封装现有 endpoint |
| `admin-ui/src/router/routes/*.ts` | 15 Tab 路由 |
| `admin-ui/src/views/**` | 各业务页 |
| `app/public/admin-v2/` | `pnpm build` 产物 |
| `app/public/admin-legacy.html` + `src/admin.js` | 旧后台兜底 |
| `app/server.js`（仅静态路由） | `/admin` → v2，`/admin-legacy` → 旧版 |

## Tab 对照

| key | 菜单名 | 优先序 |
|-----|--------|--------|
| triage | AI分诊台 | P0 |
| community | 社群工作台 | P0 |
| archive | 患者档案 | P0 |
| accounts | 账户与权限 | P0 |
| followup | 随访队列 | P1 |
| waitlist | 候补名单 | P1 |
| dash | 仪表盘 | P1 |
| subs | 提交记录 | P1 |
| ops | 运营策略 | P2 |
| config | 运营配置 | P2 |
| rules | 关键词规则 | P2 |
| faq | FAQ | P2 |
| doctors | 医生管理 | P1 |
| audit | 审计日志 | P2 |
| qiwe | 企微配置 | P1 |

## 任务

### Task 1: 脚手架

- [ ] 浅克隆 art-design-pro → `admin-ui/`
- [ ] `pnpm install` + `pnpm clean:dev`（清 demo）
- [ ] `vite.config`：`base: '/admin-v2/'`，`outDir: ../app/public/admin-v2`，dev proxy `/api` → `localhost:3200` 或 `3000`

### Task 2: 鉴权与壳

- [ ] `http.ts`：`credentials:'include'`，401 → 登录页
- [ ] 登录页对接 `POST /api/admin/login`、`GET /api/admin/me`、`GET /api/admin/me/capabilities`
- [ ] 布局：医生下拉 `GET /api/admin/doctors`，菜单按 capabilities 过滤
- [ ] 顶栏改密 / 退出：`POST /api/admin/me/password`、`POST /api/admin/logout`

### Task 3: 15 路由骨架

- [ ] 注册全部路由；未完成的页用「列表/表单最小可用」但仍真实调 API，禁止假数据冒充完成

### Task 4: P0 页面实装

- [ ] triage：消息列表筛选、详情、回复/转医生/已处理（对标现 `admin.js`）
- [ ] community：群列表、入站、出站、风控按钮
- [ ] archive：列表 + 详情对话 + 家庭医生编辑
- [ ] accounts：账号列表/角色/改密权限

### Task 5: P1/P2 页面实装

- [ ] 按对照表逐页迁移，优先保操作闭环，视觉跟 Art Design Pro

### Task 6: 服务器挂载

- [x] 现 `admin.html` 复制为 `admin-legacy.html`；`/admin-legacy` 可访问旧版
- [x] `/admin` 与 `/admin/` 返回 v2 `index.html`；静态资源 `/admin-v2/*`
- [x] 本地：`cd admin-ui && pnpm build` → `app/public/admin-v2/`；生产同步该目录 + `admin-legacy.html` + `server.js` 静态段后 `pm2 restart chunyu-doctor`

### Task 7: 验收

- [ ] 登录/切换医生/15 菜单均可进入
- [ ] P0 四页主路径可用；与旧版对照无坏接口
- [ ] Ctrl+F5 后生产可见新壳

## 红线

1. 不修改业务 API 语义与鉴权矩阵含义  
2. 不同域拆前端（避免 Cookie 丢）  
3. 旧版至少保留一个版本周期可回退  
