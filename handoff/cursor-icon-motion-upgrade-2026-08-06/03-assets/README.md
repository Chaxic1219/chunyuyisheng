# 资产证据说明

## 相对源目录

- `current-icon-inventory.csv` 的 `filename` 相对于 `patient-uniapp/src/static/icons/`。
- `current-tab-inventory.csv` 的 `filename` 相对于 `patient-uniapp/src/static/tab/`；`source_path` 给出项目内完整相对路径。
- `current-icons-to-replace/` 与 `current-tab-assets/` 是上述源目录在 2026-08-06 的只读证据副本。

## 禁止事项

所有 `current-*` 目录、CSV 与其中资源都是旧资产证据，仅用于比对、哈希核验和迁移追踪。禁止把其中任何 PNG/SVG 直接复制、改名或批量搬运到 `patient-uniapp/src/static/icons/v2/`。v2 必须从批准的 24×24、1.8px 纯线性 SVG 母版重新导出。

## 最终 README 必须保留的注意点

> `03-assets/current-*` 全部为旧资产证据，不是新版素材源。实施者不得复制到 v2；新版 PNG 只能由批准的 SVG 母版按输出规范导出、压缩并通过 400KB 预算核验。

