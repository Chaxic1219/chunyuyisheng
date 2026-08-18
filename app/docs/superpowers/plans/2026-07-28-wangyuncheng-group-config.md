# 王云程医生群配置补全 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将王云程医生补全为一套可运行的群编号配置，复用现有患者端与春雨承接能力，不新增页面。

**Architecture:** 直接修改 `seed.js` 中医生种子配置，复用周玉春的轻配置骨架与现有规则引擎。欢迎语、编号脚本、`content.menu`、`quickKeywords`、`rules`、`faq` 统一替换为王云程口径，并使用统一春雨主页短链承接主页类入口。

**Tech Stack:** Node.js、SQLite 种子配置、现有规则引擎、患者端 `bootstrap` 数据结构

---

### Task 1: 找到王云程配置并补齐脚本常量

**Files:**
- Modify: `app/seed.js`
- Test: `app/_run_check_wang_config.py`

- [ ] **Step 1: 写出要补的常量**

```js
const WANG_HOME_SHORT_LINK = "#小程序://春雨医生/T2ZrR81CrFmWgfG";
const WANG_ADMISSION_URL = "https://www.chunyuyisheng.com/rec/lsx2qjqsu6";
const WANG_REVIEW_URL = "https://www.chunyuyisheng.com/rec/sewaya7aqe";
const WANG_HOSPITAL_PHONE = "010-67992043";
const WANG_SURGERY_ARTICLE = "https://www.bjdxzxy.com/content/details54_264.html";
const WANG_FAQ_A = "https://www.bjdxzxy.com/service/must.html";
const WANG_FAQ_B = "https://www.bjdxzxy.com/service/insurance.html";
```

- [ ] **Step 2: 运行语法检查确认当前文件仍可解析**

Run: `node -e "require('./seed.js'); console.log('ok seed load')"`

Expected: PASS, 输出 `ok seed load`

### Task 2: 补齐王云程 content / intro / menu

**Files:**
- Modify: `app/seed.js`

- [ ] **Step 1: 更新 content 菜单与快捷入口**

```js
menu: {
  title: "群功能菜单",
  items: [
    { code: "101", label: "医生咨询" },
    { code: "102", label: "视频问诊" },
    { code: "103", label: "查看就医相关电话" },
    { code: "105", label: "查看回复" },
    { code: "201", label: "挂号及门诊时间" },
    { code: "301", label: "加号" },
    { code: "302", label: "住院预约" },
    { code: "606", label: "学习科普" },
    { code: "616", label: "了解住院及手术知识" },
    { code: "626", label: "就医常见问题" },
    { code: "808", label: "医生简介展示" },
    { code: "818", label: "医生介绍给亲友" },
    { code: "909", label: "感谢医生" },
    { code: "919", label: "评价医生" },
    { code: "929", label: "给医生写感谢信" },
    { code: "联络表", label: "医患联络表" }
  ]
}
```

- [ ] **Step 2: 更新欢迎 intro**

```js
items: [
  { bot: "小王医助", type: "text", text: WANG_WELCOME },
  {
    type: "link",
    title: "医患联络表",
    sub: "提交基础信息",
    thumb: "mpForm",
    external: webLink({ provider: "春雨医生", label: "医患联络表", service: "建档问卷", url: WANG_CONTACT_URL }),
    ctaLabel: "填写联络表",
    fallbackPage: "contact-form"
  }
]
```

### Task 3: 补齐编号 rules

**Files:**
- Modify: `app/seed.js`

- [ ] **Step 1: 主页类入口统一接王云程主页短链**

```js
extCard({ type: "mp", title: "王云程医生主页", sub: "医生咨询 / 主页入口", thumb: "mpForm", page: "doctor-profile" }, WANG_CY.consultHome)
```

- [ ] **Step 2: 住院 / 评价 / 医院链接项按表格配置**

```js
{
  code: "302",
  responses: [{
    type: "link",
    title: "住院申请表",
    sub: "春雨问卷 · 在线填写",
    external: webLink({ provider: "春雨医生", label: "住院申请表", url: WANG_ADMISSION_URL }),
    ctaLabel: "填写住院申请表",
    fallbackPage: "admission"
  }]
}
```

- [ ] **Step 3: 关闭不做项**

```js
// 不加入 menu / quickKeywords / rules:
// 202, 501, 888
```

### Task 4: 补齐脚本与 FAQ

**Files:**
- Modify: `app/seed.js`

- [ ] **Step 1: 写入编号脚本文案**

```js
code201: "请您选择合适的时间，通过医院官方挂号平台挂号，挂号成功后持医保卡前往医院取号。"
code606: "🌻 王主任的科普在以下渠道发布，欢迎大家关注\n\n1、抖音：骨科王云程\n2、小红书：骨科王云程"
code929: "🌻 感谢您对王主任的认可。诚邀您分享您的医患情缘与经历。\n\n这就是对我们医护团队的最好表扬，也是对其他患友的帮助与鼓励！"
```

- [ ] **Step 2: FAQ 只保留必要问答**

```js
[
  { grp: "看病就医", q: "怎么找王主任看病？", a: "发送 201 查看挂号入口；需要咨询可发 101。", sort: 1 },
  { grp: "群内服务", q: "群里数字代号是什么？", a: "发 1 查看完整功能菜单。", sort: 2 }
]
```

### Task 5: 验证

**Files:**
- Modify: `app/seed.js`
- Test: `app/_run_check_wang_config.py`

- [ ] **Step 1: 解析 seed**

Run: `node -e "require('./seed.js'); console.log('ok seed load')"`

Expected: PASS

- [ ] **Step 2: 检查 bootstrap 返回**

Run:

```bash
node -e "const seed=require('./seed.js'); const hit=seed.find(x=>String(x.name||'').includes('王云程')); console.log(hit && hit.content && hit.content.menu && hit.content.menu.items.map(x=>x.code).join(','))"
```

Expected: 输出包含 `101,102,103,105,201,301,302,606,616,626,808,818,909,919,929,联络表`

- [ ] **Step 3: 语义检查**

Run:

```bash
node -e "const seed=require('./seed.js'); const hit=seed.find(x=>String(x.name||'').includes('王云程')); console.log(hit.rules.some(r=>r.code==='302'), hit.rules.some(r=>r.code==='808'), hit.rules.some(r=>r.code==='919'))"
```

Expected: `true true true`

