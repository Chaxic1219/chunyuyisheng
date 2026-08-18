<script setup lang="ts">
import { onLaunch } from "@dcloudio/uni-app";
import { useAppStore } from "./stores/app";
import { migrateLegacyAiStorage } from "./utils/storageScope";

onLaunch(() => {
  try {
    migrateLegacyAiStorage();
  } catch {
    // 旧 AI 正文迁移失败不应阻断小程序启动。
  }
  const store = useAppStore();
  store.hydrateElderMode();
  store.hydrateReducedMotion();
  // B3 来源归因：群卡片/分享链接/线下物料二维码进入小程序时解析来源参数
  try {
    const launch = uni.getLaunchOptionsSync();
    store.setSourceFromQuery(launch?.query);
  } catch {
    /* 解析失败不影响启动 */
  }
  void store.load().catch(() => {});
});
</script>

<style>
@import "./colorui/main.css";
@import "./colorui/icon.css";
@import "./colorui/animation.css";
@import "@chunyu/patient-design/tokens.css";

page {
  min-height: 100%;
  background: var(--page-bg, #f0f3f5);
  color: var(--text-strong, #2a3547);
  font-family: -apple-system, BlinkMacSystemFont, "PingFang SC", "HarmonyOS Sans SC", "Microsoft YaHei UI", "Microsoft YaHei", sans-serif;
  font-size: var(--font-body, 18px);
  line-height: var(--line-body, 1.6);
  -webkit-font-smoothing: antialiased;
}

page,
view,
text,
button,
input,
textarea,
image,
scroll-view {
  box-sizing: border-box;
}

button,
input,
textarea {
  font-family: inherit;
  font-size: inherit;
  /* 不继承 page 的 line-height：微信 input placeholder 在 1.6 行高下会叠字重影 */
  line-height: normal;
}

button::after {
  border: 0;
}

.page-shell {
  position: relative;
  min-height: 100vh;
  overflow-x: hidden;
  background: var(--page-bg, #f0f3f5);
  color: var(--text-strong, #2a3547);
}

/* 去掉氛围渐变：与后台一致的纯色页底 */
.ambient-bg {
  background: var(--page-bg, #f0f3f5);
}

.section-heading {
  margin: 0;
  color: var(--text-strong, #2a3547);
  font-size: var(--font-subheading, 19px);
  font-weight: 600;
  line-height: var(--line-compact, 1.4);
}

.state-card {
  margin: var(--sp-4, 16px);
  padding: var(--sp-5, 24px) var(--sp-4, 16px);
  border: 1px solid var(--line, #e5eaf2);
  border-radius: var(--r-lg, 12px);
  background: var(--surface, #ffffff);
  box-shadow: var(--shadow-card);
  color: var(--text-secondary, #5a6a85);
  font-size: var(--font-body, 18px);
  line-height: var(--line-body, 1.6);
  text-align: center;
}

.pressable {
  min-width: var(--touch-target, 44px);
  min-height: var(--touch-target, 44px);
  transition: opacity 140ms ease-out, background-color 140ms ease-out, transform 140ms ease-out;
}

.pressable.pressable--motion:active {
  opacity: 0.88;
  transform: scale(0.98);
}

.pressable:active .app-icon--motion-up {
  transform: translateY(-3px);
}

.pressable:active .app-icon--motion-right {
  transform: translateX(3px);
}

.pressable:active .app-icon--motion-left {
  transform: translateX(-3px);
}

.pressable:active .app-icon--motion-expand {
  transform: scale(1.08);
}

.app-icon--state-loading.app-icon--motion-rotate {
  animation: icon-spin 800ms linear infinite;
}

.app-icon--state-success.app-icon--motion-confirm {
  animation: icon-confirm 220ms ease-out both;
}

@keyframes icon-spin {
  to {
    transform: rotate(360deg);
  }
}

@keyframes icon-confirm {
  from {
    opacity: 0;
    transform: translateY(3px) scale(0.94);
  }
  to {
    opacity: 1;
    transform: none;
  }
}

.safe-bottom {
  padding-bottom: calc(var(--sp-5, 24px) + constant(safe-area-inset-bottom));
  padding-bottom: calc(var(--sp-5, 24px) + env(safe-area-inset-bottom));
}
</style>
