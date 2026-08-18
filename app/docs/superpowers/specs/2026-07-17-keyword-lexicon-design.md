# 评级关键词词库扩充设计（2026-07-17）

## 目标

从公开诊疗/分诊资料收集关键词，补强 L1–L6 本地地板与群门控，减少「急症漏报」和「轻症被当闲聊静默」。

## 接入点

| 层级 | 文件 | 作用 |
|------|------|------|
| L1 急症/高危 | `triage.js` ← `keyword_lexicon.RED_FLAG_EXTRAS` | emergency/urgent 地板 |
| L2/L3 转人工 | `HUMAN_TRIGGER_EXTRAS` | medium 专科线索 |
| 哨兵 | `SENTINEL_EXTRA_TERMS` | low 沾症状 → 离线升 medium |
| 防 L6 静默 | `group_gate` ← `buildSymptomAskRe()` | 群内症状求助进分诊 |

## 来源

- CEM《急诊预检分诊专家共识》/分级标准（气道、胸痛、卒中、过敏、失血等）
- 《中国急性缺血性卒中诊治指南2023》FAST/BE-FAST；协和「中风120」
- WGO 消化道症状；MSD 消化科评估口语
- 心梗/过敏性休克典型自述

## 安全口径（不变）

- emergency 用复合锚定，避免科普裸词乱升 120
- 地板宁误报转人工，不假阴性放过危急
- 纯闲聊（天气/吃饭）仍 L6 静默
