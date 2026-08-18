# 普通医助产品使用手册制作实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 基于当前新版后台，生成一份仅覆盖普通医助日常操作、只使用黑色文字和截图占位框的 Word 使用手册。

**Architecture:** 先从当前 Vue 页面和后端权限定义核对普通医助真实可见功能，再编写自然、可执行的手册正文。使用 bundled Python 与 `python-docx` 生成 DOCX，截图位置使用黑色边框占位图片，并在占位图中写明截图路径和范围；最后渲染全部页面逐页检查。

**Tech Stack:** Markdown、Python、python-docx、Pillow、LibreOffice、Poppler

---

### Task 1: 核对普通医助真实页面与操作

**Files:**
- Read: `C:/Users/11/Desktop/www/chunyu-doctor-review/admin-ui/src/router/modules/chunyu.ts`
- Read: `C:/Users/11/Desktop/www/chunyu-doctor-review/admin-ui/src/views/chunyu/`
- Read: `C:/Users/11/Desktop/www/chunyu-doctor-review/app/authz.js`
- Read: `C:/Users/11/Desktop/www/chunyu-doctor-review/app/server.js`

- [ ] **Step 1:** 核对普通医助角色能力和可见菜单。
- [ ] **Step 2:** 核对七个页面中的真实按钮、状态词和操作结果。
- [ ] **Step 3:** 列出需要截图的页面入口和具体截图范围。

### Task 2: 编写手册正文和截图清单

**Files:**
- Create: `C:/Users/11/Desktop/www/.logs/assistant-manual/manual_content.md`

- [ ] **Step 1:** 按“登录 - 上班处理 - 下班交班”的顺序编写正文。
- [ ] **Step 2:** 为每个页面写明入口、处理步骤、完成判断和风险提醒。
- [ ] **Step 3:** 添加急症、需医生判断、发错群、投诉、联系不上和页面异常的处理办法。
- [ ] **Step 4:** 检查正文不含管理员菜单、凭证、真实账号、服务器地址和患者信息。

### Task 3: 生成截图占位图片和 DOCX

**Files:**
- Create: `C:/Users/11/Desktop/www/.logs/assistant-manual/build_assistant_manual.py`
- Create: `C:/Users/11/Desktop/www/.logs/assistant-manual/placeholders/*.png`
- Create: `C:/Users/11/Desktop/春雨医患通_普通医助日常操作手册_20260715.docx`

- [ ] **Step 1:** 生成黑字白底、黑色边框的截图占位图片。
- [ ] **Step 2:** 使用 `compact_reference_guide` 参数生成 Word，并将所有颜色覆盖为纯黑或白色。
- [ ] **Step 3:** 插入真实 Word 标题样式、编号步骤、检查清单、必要表格和页码。
- [ ] **Step 4:** 检查 DOCX 中所有文字颜色为黑色，图片只包含黑白信息。

### Task 4: 渲染和逐页视觉检查

**Files:**
- Render input: `C:/Users/11/Desktop/春雨医患通_普通医助日常操作手册_20260715.docx`
- QA output: `C:/Users/11/Desktop/www/.logs/assistant-manual/rendered/`

- [ ] **Step 1:** 使用 `render_docx.py` 渲染全部页面。
- [ ] **Step 2:** 逐页查看 PNG，检查文字、表格、占位图、分页和页码。
- [ ] **Step 3:** 修复截断、重叠、孤立标题、过大空白或表格挤压后重新渲染。
- [ ] **Step 4:** 运行结构检查和敏感信息扫描，确认最终文件可交付。
