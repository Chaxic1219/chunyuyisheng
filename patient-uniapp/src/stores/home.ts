import { defineStore } from "pinia";
import { computed, ref } from "vue";
import { getHomeFeed } from "../api/v32";
import type { HomeFeed } from "../types/v32";

export const useHomeStore = defineStore("home-v32", () => {
  const feed = ref<HomeFeed | null>(null);
  const loading = ref(false);
  const error = ref("");
  const refreshedAt = ref("");

  const ready = computed(() => !!feed.value && !loading.value);

  async function load(force = false) {
    if (feed.value && !force) return;
    loading.value = true;
    error.value = "";
    try {
      feed.value = await getHomeFeed();
      refreshedAt.value = new Date().toISOString();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e || "");
      if (/unauthorized|401|请先绑定|未登录/i.test(msg)) {
        error.value = "请先登录并绑定手机号";
      } else {
        error.value = "健康首页加载失败，请重试";
      }
      console.error(e);
    } finally {
      loading.value = false;
    }
  }

  async function reload() {
    await load(true);
  }

  function reset() {
    feed.value = null;
    error.value = "";
    loading.value = false;
  }

  return {
    feed,
    loading,
    error,
    refreshedAt,
    ready,
    load,
    reload,
    reset,
  };
});

