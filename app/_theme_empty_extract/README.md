# 春雨主题空状态素材

这是一套可跟随系统主题变量变化的空状态图片素材，视觉基调贴近 Element Plus 原默认空状态：低饱和、浅层次、底部阴影、居中构图，并加入医疗记录、十字标识与问诊气泡语义。

## 文件

- `chunyu-empty-themeable.svg`：可内联到页面的 SVG 图片。
- `ChunyuThemeEmpty.vue`：Vue 组件版本，适合后台管理端直接接入。
- `preview.html`：本地预览页，可查看不同主题变量下的效果。

## 使用注意

要跟随系统主题色变化，请以内联 SVG 或 Vue 组件方式使用。

如果用 `<img src="chunyu-empty-themeable.svg">` 引入，浏览器会把 SVG 当作外部图片处理，通常无法读取页面里的 `--el-color-primary` 等主题变量。

Element Plus 空状态推荐用法：

```vue
<ElEmpty description="暂无数据" :image-size="120">
  <template #image>
    <ChunyuThemeEmpty />
  </template>
</ElEmpty>
```
