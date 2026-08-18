# 入群欢迎视频页 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 周/王入群只发欢迎语 + 极简视频播放页链接卡；吕及其它医生不变。

**Architecture:** 静态 HTML/MP4 挂 yht `/welcome-video/` 与 `/assets/welcome-video/`；医生 `content.welcomeVideo` 驱动；`fireGroupWelcome` 对有配置者清空 weappCodes、写入 linkCards；压缩原片后部署。

**Tech Stack:** Node/SQLite 现有企微出站、nginx 静态、ffmpeg 压码

---

### Task 1: 静态播放页 + 压码视频

**Files:**
- Create: `app/public/welcome-video/zhou.html`, `wang.html`
- Create: `app/public/assets/welcome-video/*.mp4`（压缩后）

- [ ] 压码两段视频到 ~25MB
- [ ] 写极简 HTML
- [ ] 部署到生产 site + app public

### Task 2: seed / welcome 文案 + welcomeVideo 配置

**Files:**
- Modify: `seed.js` ZHOU/WANG welcome + content.welcomeVideo
- Production ops scripts groupWelcome 同步

### Task 3: 入群发送链路

**Files:**
- Modify: `callback.js` fireGroupWelcome payload
- Possibly small helper for resolveWelcomeVideoLinkCard

### Task 4: 测试与验收

- [ ] 单测：周/王 payload 含 linkCards、无 weappCodes；吕仍有 weappCodes
- [ ] 生产部署重启
