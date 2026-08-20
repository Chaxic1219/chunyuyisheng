import { createSSRApp } from "vue";
import { createPinia } from "pinia";
import App from "./App.vue";
import {
  defaultShareAppMessagePayload,
  defaultShareTimelinePayload,
} from "./utils/shareAppMessage";

export function createApp() {
  const app = createSSRApp(App);
  app.use(createPinia());
  // ponytail: 全局兜底分享；单页若已自定义 onShareAppMessage 会覆盖此默认行为。
  app.mixin({
    onShareAppMessage() {
      return defaultShareAppMessagePayload();
    },
    onShareTimeline() {
      return defaultShareTimelinePayload();
    },
  });
  return { app };
}
