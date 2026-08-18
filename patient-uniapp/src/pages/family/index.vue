<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import AppButton from "../../components/AppButton.vue";
import AppNotice from "../../components/AppNotice.vue";
import AppPageHeader from "../../components/AppPageHeader.vue";
import AppSectionHeader from "../../components/AppSectionHeader.vue";
import AppStatusBadge from "../../components/AppStatusBadge.vue";
import { useHealthAssetsStore } from "../../stores/healthAssets";
import { useAppStore } from "../../stores/app";
import type { FamilyMemberCard } from "../../types/v32";

const healthAssets = useHealthAssetsStore();
const appStore = useAppStore();
const data = computed(() => healthAssets.family);
const inviting = ref(false);
const revokingId = ref<number | null>(null);

const managed = computed(() => data.value?.managed || null);
const helpers = computed(() => data.value?.helpers || []);

onMounted(async () => {
  await healthAssets.loadFamily(true);
});

function toast(title: string) {
  uni.showToast({ title, icon: "none" });
}

function memberInitial(member: FamilyMemberCard) {
  const raw = String(member.initial || member.name || "").trim();
  return raw ? raw.slice(0, 1) : "亲";
}

async function inviteFamily(role: "helper" | "managed" = "helper") {
  if (inviting.value) return;
  uni.showModal({
    title: role === "managed" ? "添加被照护人" : "邀请协助人",
    editable: true,
    placeholderText: "请输入姓名",
    content: role === "managed" ? "添加后可代管其档案与计划" : "添加后可协助记录与咨询",
    success: async (res) => {
      if (!res.confirm) return;
      const name = String((res as { content?: string }).content || "").trim();
      if (!name) {
        toast("请输入姓名");
        return;
      }
      inviting.value = true;
      try {
        await healthAssets.inviteFamilyMember({ name, role });
        toast("已添加");
      } catch (err) {
        const message = err instanceof Error && err.message ? err.message : "添加失败";
        toast(message);
      } finally {
        inviting.value = false;
      }
    },
  });
}

function revokeMember(member: FamilyMemberCard) {
  if (!member?.id || revokingId.value) return;
  uni.showModal({
    title: "撤销授权",
    content: `确认撤销「${member.name}」？撤销后对方将无法继续访问新增数据。`,
    confirmText: "确认撤销",
    confirmColor: "#A33C33",
    success: async (res) => {
      if (!res.confirm) return;
      revokingId.value = member.id;
      try {
        await healthAssets.revokeFamilyMember(member.id);
        toast("已撤销");
      } catch (err) {
        const message = err instanceof Error && err.message ? err.message : "撤销失败";
        toast(message);
      } finally {
        revokingId.value = null;
      }
    },
  });
}
</script>

<template>
  <view class="page" :class="{ elder: appStore.elderMode }">
    <AppPageHeader title="家属管理" />

    <view v-if="!data" class="section">
      <text class="loading-copy">正在加载家属授权…</text>
    </view>

    <template v-else>
      <view class="section">
        <AppSectionHeader
          title="我管理的家属"
          action="添加"
          action-icon="member-add"
          @action="inviteFamily('managed')"
        />
        <view v-if="managed" class="family-card family-card--green">
          <view class="family-card__head">
            <view class="family-avatar">{{ memberInitial(managed) }}</view>
            <view class="family-card__copy">
              <text class="family-card__name">{{ managed.name }}</text>
              <text class="family-card__desc">{{ managed.desc }}</text>
            </view>
            <AppButton
              label="撤销"
              icon="action-close"
              variant="soft"
              size="sm"
              :disabled="revokingId === managed.id"
              @tap="revokeMember(managed)"
            />
          </view>
          <view v-if="managed.permissions?.length" class="permission-row">
            <AppStatusBadge
              v-for="item in managed.permissions"
              :key="item"
              :label="item"
              tone="green"
            />
          </view>
        </view>
        <view v-else class="empty-card">
          <text class="empty-card__title">暂无被照护人</text>
          <text class="empty-card__desc">添加后可代管其档案与健康计划</text>
          <AppButton
            class="empty-card__btn"
            label="添加被照护人"
            icon="member-add"
            variant="soft"
            size="sm"
            @tap="inviteFamily('managed')"
          />
        </view>
      </view>

      <view class="section">
        <AppSectionHeader
          title="谁可以协助我"
          action="邀请"
          action-icon="member-add"
          @action="inviteFamily('helper')"
        />
        <view
          v-for="helper in helpers"
          :key="helper.id"
          class="family-card family-card--blue"
        >
          <view class="family-card__head">
            <view class="family-avatar family-avatar--blue">{{ memberInitial(helper) }}</view>
            <view class="family-card__copy">
              <text class="family-card__name">{{ helper.name }}</text>
              <text class="family-card__desc">{{ helper.desc }}</text>
            </view>
            <AppButton
              label="撤销"
              icon="action-close"
              variant="soft"
              size="sm"
              :disabled="revokingId === helper.id"
              @tap="revokeMember(helper)"
            />
          </view>
          <view v-if="helper.permissions?.length" class="permission-row">
            <AppStatusBadge
              v-for="item in helper.permissions"
              :key="item"
              :label="item"
              tone="blue"
            />
          </view>
        </view>
        <view v-if="!helpers.length" class="empty-card">
          <text class="empty-card__title">暂无协助人</text>
          <text class="empty-card__desc">邀请家属协助记录与咨询</text>
          <AppButton
            class="empty-card__btn"
            label="邀请协助人"
            icon="member-add"
            variant="soft"
            size="sm"
            @tap="inviteFamily('helper')"
          />
        </view>
      </view>

      <AppNotice text="家属只可以在授权范围内查看或操作；医生服务、支付和敏感数据仍需本人确认。" />
    </template>
  </view>
</template>

<style scoped>
.page {
  min-height: 100vh;
  padding: 16px 14px calc(24px + env(safe-area-inset-bottom));
  background: #f0f3f5;
}
.loading-copy {
  color: #6a756f;
  font-size: var(--font-secondary, 16px);
}
.section {
  margin-bottom: 12px;
  padding: 14px;
  border: 1px solid #dce3dd;
  border-radius: 12px;
  background: #fff;
  box-shadow: 0 8px 24px rgba(16, 52, 40, 0.06);
}
.family-card {
  margin-top: 10px;
  padding: 12px;
  border-radius: 10px;
}
.family-card--green {
  background: #f3faf6;
}
.family-card--blue {
  background: #f3f7fb;
}
.family-card + .family-card {
  margin-top: 10px;
}
.family-card__head {
  display: flex;
  align-items: center;
  gap: 10px;
}
.family-avatar {
  display: flex;
  width: 42px;
  height: 42px;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  border-radius: 11px;
  background: #176b52;
  color: #fff;
  font-size: var(--font-subheading, 19px);
  font-weight: 900;
}
.family-avatar--blue {
  background: #2c638e;
}
.family-card__copy {
  min-width: 0;
  flex: 1;
}
.family-card__name,
.family-card__desc {
  display: block;
}
.family-card__name {
  color: #17201c;
  font-size: var(--font-body, 18px);
  font-weight: 900;
}
.family-card__desc {
  margin-top: 3px;
  color: #6a756f;
  font-size: var(--font-caption, 14px);
}
.permission-row {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 12px;
}
.empty-card {
  margin-top: 10px;
  padding: 16px 12px;
  border-radius: 10px;
  background: #f7f9f8;
  text-align: center;
}
.empty-card__title,
.empty-card__desc {
  display: block;
}
.empty-card__title {
  color: #17201c;
  font-size: var(--font-body, 18px);
  font-weight: 800;
}
.empty-card__desc {
  margin-top: 4px;
  color: #6a756f;
  font-size: var(--font-caption, 14px);
}
.empty-card__btn {
  margin-top: 12px;
}
</style>
