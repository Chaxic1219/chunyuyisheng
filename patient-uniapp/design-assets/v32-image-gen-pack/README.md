# 春雨健康患者端 V3.2 · Image Gen 任务包

交给 **Codex Image Gen**（或其它文生图工具）批量出图，生成文件放入本包 `output/` 后，拷贝到小程序：

```text
patient-uniapp/src/static/visual/
patient-uniapp/src/static/tab/
patient-uniapp/src/static/icons/  （可选：快捷入口）
```

并更新 `src/constants/v32Assets.ts` 中的路径。

## 怎么用

1. 先读 `STYLE.md`（品牌色与禁止项）。
2. 按 `manifest.json` 逐条生成；每条有 `prompt_en`（推荐喂模型）与 `prompt_zh`。
3. 输出文件名必须与 `filename` **完全一致**（PNG，透明底优先）。
4. 生成后放到 `output/` 对应子目录，保持相对路径。
5. 不要在图内写中文/英文 UI 文案、不要加水印、不要 emoji。

## 目录

| 路径 | 说明 |
|------|------|
| `STYLE.md` | 风格与色板 |
| `manifest.json` | 全量资产清单 |
| `prompts/*.txt` | 单条英文 prompt 副本，便于复制 |
| `output/` | 生成结果放置处（初始为空目录说明） |

## 优先顺序

P0：Tab 三图标（含 active）、双助手头像、首页 Hero、无计划空态  
P1：快捷入口五图标、档案/家属空态、默认头像刷新  
P2：服务 Hero 替换、康复封面（若需统一风格）
