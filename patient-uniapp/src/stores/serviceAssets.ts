import { defineStore } from "pinia";
import { ref } from "vue";
import { getServiceCenter } from "../api/v32";
import { useAppStore } from "./app";
import type { ServiceCenterData } from "../types/v32";

export const useServiceAssetsStore = defineStore("service-assets-v32", () => {
  const center = ref<ServiceCenterData | null>(null);
  const loading = ref(false);
  const error = ref("");
  const refreshedAt = ref("");
  const loadedForDoctorId = ref("");

  function resolveDoctorId() {
    const app = useAppStore();
    const fromDoctor = app.doctor?.id;
    if (fromDoctor != null && String(fromDoctor) !== "") return String(fromDoctor);
    return String(app.sourceDoctorId || "");
  }

  async function loadCenter(force = false) {
    const doctorId = resolveDoctorId();
    if (center.value && !force && loadedForDoctorId.value === doctorId) return;
    const hadData = !!center.value;
    if (!hadData) loading.value = true;
    error.value = "";
    try {
      const next = await getServiceCenter(doctorId || undefined);
      center.value = next;
      loadedForDoctorId.value = doctorId;
      refreshedAt.value = new Date().toISOString();
    } catch (e) {
      if (!hadData) error.value = "健康服务加载失败，请稍后重试";
      console.error(e);
    } finally {
      loading.value = false;
    }
  }

  async function reload() {
    await loadCenter(true);
  }

  return {
    center,
    loading,
    error,
    refreshedAt,
    loadCenter,
    reload,
  };
});

