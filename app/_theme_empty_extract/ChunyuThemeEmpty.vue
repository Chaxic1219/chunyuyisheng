<template>
  <svg
    class="chunyu-empty-image"
    viewBox="0 0 160 160"
    role="img"
    aria-label="暂无内容"
    xmlns="http://www.w3.org/2000/svg"
  >
    <ellipse class="shadow" cx="80" cy="136" rx="58" ry="7" />

    <path class="back" d="M36 88h88l-14 44H50L36 88Z" />
    <path class="side" d="M36 88 58 62h44l22 26H36Z" />
    <path class="side-light" d="M58 62h44l22 26H80L58 62Z" />
    <path class="front" d="M48 86h64v48H48V86Z" />

    <path class="paper" d="M63 34h42l18 18v44H63V34Z" />
    <path class="paper-fold" d="M105 34v18h18" />
    <rect class="line" x="76" y="62" width="30" height="5" rx="2.5" />
    <rect class="line" x="76" y="75" width="22" height="5" rx="2.5" />
    <path class="cross" d="M51 58h11V47h10v11h11v10H72v11H62V68H51V58Z" />

    <path
      class="bubble"
      d="M100 71h27c6 0 11 5 11 11v15c0 6-5 11-11 11h-12l-12 10v-10h-3c-6 0-11-5-11-11V82c0-6 5-11 11-11Z"
    />
    <circle class="dot" cx="107" cy="90" r="3" />
    <circle class="dot" cx="118" cy="90" r="3" />
    <circle class="dot" cx="129" cy="90" r="3" />
  </svg>
</template>

<style scoped>
  .chunyu-empty-image {
    width: 100%;
    height: 100%;
    color: var(--el-color-primary, #5d87ff);
    overflow: visible;
  }

  .shadow {
    fill: var(--el-text-color-primary, #2f3349);
    opacity: var(--empty-shadow-opacity, 0.06);
  }

  .back,
  .paper {
    fill: var(--el-fill-color-lighter, #f2f3f5);
  }

  .side {
    fill: var(--el-fill-color-light, #ebeef5);
  }

  .side-light,
  .paper-fold {
    fill: var(--el-fill-color-extra-light, #f7f8fa);
  }

  .front {
    fill: var(--el-fill-color-blank, #ffffff);
    stroke: var(--el-border-color-extra-light, #e9edf3);
    stroke-width: 1;
  }

  .paper {
    stroke: var(--el-border-color-lighter, #ebeef5);
    stroke-width: 1;
  }

  .line,
  .cross,
  .bubble,
  .dot {
    fill: currentColor;
    opacity: var(--empty-accent-opacity, 0.16);
  }

  .bubble {
    opacity: var(--empty-bubble-opacity, 0.11);
  }

  .paper-fold {
    stroke: var(--el-border-color-lighter, #ebeef5);
    stroke-width: 1;
  }
</style>
