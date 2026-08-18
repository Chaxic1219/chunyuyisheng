import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relativePath) => readFileSync(path.join(root, relativePath), "utf8");

async function importBundledTypeScript(relativePath) {
  const { build } = await import("vite");
  const fixtureRoot = mkdtempSync(path.join(tmpdir(), "patient-mp-task8-"));
  const outfile = path.join(fixtureRoot, "bundle.mjs");
  try {
    await build({
      configFile: false,
      logLevel: "silent",
      define: {
        "import.meta.env.MODE": JSON.stringify("development"),
        "import.meta.env.VITE_API_BASE": JSON.stringify("https://unit.test"),
        "import.meta.env.VITE_CONSULT_USE_REAL": "true",
        "import.meta.env.VITE_USE_MOCK": "false",
        "import.meta.env.VITE_PHONE_BIND_MODE": JSON.stringify("wechat"),
        "import.meta.env.VITE_V32_ALLOW_MOCK_FALLBACK": "false",
      },
      build: {
        emptyOutDir: false,
        minify: false,
        outDir: fixtureRoot,
        target: "node20",
        lib: {
          entry: path.join(root, relativePath),
          formats: ["es"],
          fileName: () => path.basename(outfile),
        },
        rollupOptions: {
          output: {
            entryFileNames: path.basename(outfile),
          },
        },
      },
    });
    return await import(`${pathToFileURL(outfile).href}?v=${Date.now()}-${Math.random()}`);
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
}

async function importConsultSetupScript(harness) {
  const source = read("src/pages/consult/index.vue");
  const script = source.match(/<script setup lang="ts">([\s\S]*?)<\/script>/)?.[1];
  assert.ok(script, "consult/index.vue 缺少 script setup");
  const withoutImports = script.replace(/^import[\s\S]*?;\r?\n/gm, "");
  const typescriptModule = await import("typescript");
  const ts = typescriptModule.default || typescriptModule;
  globalThis.__task8ConsultHarness = harness;
  const prelude = `
const harness = globalThis.__task8ConsultHarness;
class ApiError extends Error {
  constructor(status, code, message = code) {
    super(message);
    this.status = status;
    this.code = code;
  }
}
const ref = (value) => ({ value });
const computed = (getter) => ({ get value() { return getter(); } });
const watch = (_source, callback, options) => {
  harness.scopeWatcher = callback;
  harness.scopeWatchOptions = options;
};
const onMounted = (callback) => { harness.mounted = callback; };
const onShow = () => {};
const onHide = (callback) => { harness.hidden = callback; };
const onShareAppMessage = (callback) => { harness.share = callback; };
const onUnmounted = (callback) => { harness.unmounted = callback; };
const storeToRefs = (store) => ({
  role: { get value() { return store.role; } },
  roleMeta: { value: store.roleMeta },
  contextLine: { value: store.contextLine },
});
const V32_VISUAL_ASSETS = { assistantLife: "", assistantHealth: "", defaultUserAvatar: "" };
const safeLocalImageSrc = () => "";
const createMpVoiceInput = () => ({
  start: () => {},
  stop: () => {},
  cancel: () => {},
  dispose: () => {},
  onResult: () => {},
  isActive: () => false,
  isSupported: false,
});
const getLocalProfile = () => null;
const getMpToken = () => harness.token;
const postMpAiChat = (...args) => harness.postMpAiChat(...args);
const ensureLogin = (...args) => harness.ensureLogin(...args);
const ensureSessionId = () => "session-1";
const createMpAiSessionId = () => "session-new";
const persistSessionId = (_scope, sessionId) => harness.persistSession?.(sessionId);
const hasMpAiConsent = (...args) => harness.hasMpAiConsent(...args);
const saveMpAiConsent = (...args) => harness.saveMpAiConsent(...args);
const loadMpAiTranscript = (scope) => harness.loadMpAiTranscript?.(scope) || [];
const saveMpAiTranscript = (...args) => harness.saveMpAiTranscript?.(...args);
const clearMpAiTranscript = (...args) => harness.clearMpAiTranscript?.(...args);
const isOpaqueMpAiStorageScope = (scope) => String(scope || "").trim().startsWith("mps_");
const createMpAiIdentitySnapshot = (value) => Object.freeze({ ...value });
const isMpAiIdentitySnapshotCurrent = (snapshot, current) =>
  snapshot.scope === current.scope &&
  snapshot.authEpoch === current.authEpoch &&
  snapshot.operationId === current.operationId &&
  snapshot.doctorId === current.doctorId &&
  snapshot.patientId === current.patientId &&
  snapshot.personId === current.personId &&
  snapshot.token === current.token;
const createMpAiRuntimeIsolation = (createSessionId) => {
  let operationId = 0;
  const invalidateOperation = () => ++operationId;
  return {
    get currentOperationId() { return operationId; },
    beginOperation: invalidateOperation,
    invalidateOperation,
    isOperationCurrent: (candidate) => candidate === operationId,
    isolate: ({ resetMemory, storageEffects = [] }) => {
      invalidateOperation();
      const nextSessionId = createSessionId();
      resetMemory(nextSessionId);
      for (const effect of storageEffects) {
        try { effect(nextSessionId); } catch {}
      }
      return nextSessionId;
    },
  };
};
const AI_CONSENT_VERSION = "2026-07-31";
const CONTEXT_TURNS = 10;
const buildStorageScope = ({ doctorId, patientId, personId }) =>
  "d" + doctorId + ":p" + patientId + ":ps" + personId;
const scopedStorageKey = (base, scope) => base + ":" + scope;
const clearScopedStorage = (scope) => harness.clearScope(scope);
const useAppStore = () => harness.store;
const useAuthStore = () => harness.auth;
const useConsultationStore = () => harness.consultation;
const markAiSendStage = () => {};
const failAiSendStage = (_stage, title) => {
  uni.showToast({ title: String(title || ""), icon: "none" });
};
`;
  const output = ts.transpileModule(
    `${prelude}
${withoutImports}
export const __task8 = {
  onSend,
  onClearChat,
  ensureAiConsent: typeof ensureAiConsentByScope === "function" ? ensureAiConsentByScope : null,
  text,
  messages,
  failedPayload,
  sessionId,
};`,
    {
      compilerOptions: {
        module: ts.ModuleKind.ESNext,
        target: ts.ScriptTarget.ES2022,
      },
    }
  ).outputText;
  return import(
    `data:text/javascript;base64,${Buffer.from(output).toString("base64")}#v=${Date.now()}-${Math.random()}`
  );
}

async function importAuthStoreSetupScript(harness) {
  const source = read("src/stores/auth.ts");
  const withoutImports = source.replace(/^import[\s\S]*?;\r?\n/gm, "");
  const typescriptModule = await import("typescript");
  const ts = typescriptModule.default || typescriptModule;
  globalThis.__task8AuthHarness = harness;
  const prelude = `
const harness = globalThis.__task8AuthHarness;
const ref = (value) => ({ value });
const defineStore = (_id, setup) => () => setup();
class ApiError extends Error {
  constructor(status, code, message = code) {
    super(message);
    this.status = status;
    this.code = code;
  }
}
class TokenStorageError extends Error {
  constructor() {
    super("登录状态保存失败");
    this.code = "token_storage_failed";
  }
}
class AuthRecoveryError extends Error {
  constructor() {
    super("登录状态恢复失败，请重新进入页面");
    this.code = "auth_recovery_failed";
  }
}
const getMpToken = () => harness.token;
const setMpToken = (token) => harness.setToken(token);
const forceClearMpToken = () => { harness.token = ""; };
const mpLogin = async () => ({});
const mpLogout = async () => {};
const mpMe = async () => ({});
const useAppStore = () => ({ doctor: { id: harness.appDoctorId } });
const buildStorageScope = ({ doctorId, patientId, personId, token }) => {
  if (patientId) return "d" + doctorId + ":p" + patientId;
  if (personId) return "d" + doctorId + ":ps" + personId;
  return token ? "d" + doctorId + ":token" : "d" + doctorId + ":guest";
};
const clearScopedStorage = (scope) => harness.clearScope(scope);
const createAuthStateCoordinator = () => {
  let epoch = 0;
  let doctorId = null;
  return {
    get epoch() { return epoch; },
    get doctorId() { return doctorId; },
    capture: (token) => ({ token, epoch }),
    isCurrent: (snapshot, token) => snapshot.token === token && snapshot.epoch === epoch,
    transition: (next) => { epoch += 1; doctorId = Number(next) || null; },
    rememberDoctor: (next) => { doctorId = Number(next) || null; },
    contextKey: (next) => String(next) + ":" + epoch,
  };
};
const createKeyedSingleFlight = () => ({ run: (_key, task) => task() });
const createSerialLatestExecutor = ({ execute, accept }) => ({
  request: async (value) => {
    const result = await execute(value);
    accept(value, result);
    return result;
  },
});
const guardedAuthRefresh = async () => {};
const recoverAfterStorageFailure = async (options) => {
  options.invalidate();
  throw new AuthRecoveryError();
};
const clearExplicitSignedOut = () => {};
const setExplicitSignedOut = () => {};
`;
  const output = ts.transpileModule(`${prelude}\n${withoutImports}`, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  return import(
    `data:text/javascript;base64,${Buffer.from(output).toString("base64")}#v=${Date.now()}-${Math.random()}`
  );
}

async function importAppSetupScript(harness) {
  const source = read("src/App.vue");
  const script = source.match(/<script setup lang="ts">([\s\S]*?)<\/script>/)?.[1];
  assert.ok(script, "App.vue 缺少 script setup");
  const withoutImports = script.replace(/^import[\s\S]*?;\r?\n/gm, "");
  const typescriptModule = await import("typescript");
  const ts = typescriptModule.default || typescriptModule;
  globalThis.__task8AppHarness = harness;
  const prelude = `
const harness = globalThis.__task8AppHarness;
const onLaunch = (callback) => { harness.launch = callback; };
const useAppStore = () => ({ load: () => harness.load(), hydrateElderMode: () => {}, hydrateReducedMotion: () => {} });
const migrateLegacyAiStorage = () => harness.migrate();
`;
  const output = ts.transpileModule(`${prelude}\n${withoutImports}`, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  return import(
    `data:text/javascript;base64,${Buffer.from(output).toString("base64")}#v=${Date.now()}-${Math.random()}`
  );
}

function installStorageUni(initial = {}) {
  const storage = new Map(Object.entries(initial));
  const removed = [];
  globalThis.uni = {
    getStorageSync: (key) => storage.get(key) ?? "",
    getStorageInfoSync: () => ({ keys: [...storage.keys()] }),
    setStorageSync: (key, value) => storage.set(key, value),
    removeStorageSync: (key) => {
      removed.push(key);
      storage.delete(key);
    },
  };
  return { storage, removed };
}

test("Task 8 隐私契约按 opaque scope 落截断对话，禁止旧正文 API 与深监听", () => {
  const aiSession = read("src/utils/mpAiSession.ts");
  const consult = read("src/pages/consult/index.vue");
  const patient = read("src/api/patient.ts");
  assert.doesNotMatch(aiSession, /mpAiChatHistory|loadMpAiHistory|saveMpAiHistory/);
  assert.match(aiSession, /loadMpAiTranscript|saveMpAiTranscript|clearMpAiTranscript/);
  assert.match(aiSession, /mpAiChatTranscript/);
  assert.match(aiSession, /AI_CONSENT_VERSION\s*=\s*["']2026-07-31["']/);
  assert.doesNotMatch(consult, /loadMpAiHistory|saveMpAiHistory|deep:\s*true/);
  assert.match(consult, /loadMpAiTranscript|saveMpAiTranscript|hydrateMessagesForScope/);
  assert.match(consult, /ensureAiConsent/);
  assert.match(read("src/api/aiChat.ts"), /sensitiveDataConsent[\s\S]*consentVersion/);
  assert.doesNotMatch(patient, /idNumber:\s*String\(prefill\.idNumber/);
  assert.doesNotMatch(patient, /phone:\s*payload\[(?:"|')手机号(?:"|')\]/);
  assert.match(read("src/utils/storageScope.ts"), /mpAiChatTranscript:/);
});

test("AI 同意按账号和医生隔离，版本变化后必须重新同意", async () => {
  const { storage } = installStorageUni();
  const aiSession = await importBundledTypeScript("src/utils/mpAiSession.ts");
  const scopeA = "mps_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
  const scopeB = "mps_BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB";
  assert.equal(aiSession.hasMpAiConsent(scopeA), false);
  aiSession.saveMpAiConsent(scopeA);
  assert.equal(aiSession.hasMpAiConsent(scopeA), true);
  assert.equal(aiSession.hasMpAiConsent(scopeB), false);
  const entries = [...storage.entries()];
  assert.equal(entries.length, 1);
  assert.equal(entries[0][1], "2026-07-31");
  assert.equal(entries[0][0], `mpAiConsent:${scopeA}`);
  assert.doesNotMatch(entries[0][0], /d11|p101|person|patient|token|13800138000|openid/i);
  storage.set(entries[0][0], "2025-01-01");
  assert.equal(aiSession.hasMpAiConsent(scopeA), false);
});

test("对话记录按 opaque scope 落盘截断正文且账号间隔离", async () => {
  const { storage } = installStorageUni();
  const aiSession = await importBundledTypeScript("src/utils/mpAiSession.ts");
  const scopeA = "mps_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
  const scopeB = "mps_BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB";
  aiSession.saveMpAiTranscript(scopeA, [
    { id: "welcome", role: "assistant", text: "你好，我可以帮你处理健康问题" },
    { id: "u1", role: "user", text: "你好" },
    { id: "a1", role: "assistant", text: "你好，我是助手" },
  ]);
  assert.deepEqual(aiSession.loadMpAiTranscript(scopeA), [
    { id: "welcome", role: "assistant", text: "你好，我可以帮你处理健康问题" },
    { id: "u1", role: "user", text: "你好" },
    { id: "a1", role: "assistant", text: "你好，我是助手" },
  ]);
  assert.deepEqual(aiSession.loadMpAiTranscript(scopeB), []);
  const key = [...storage.keys()].find((item) => String(item).startsWith("mpAiChatTranscript:"));
  assert.equal(key, `mpAiChatTranscript:${scopeA}`);
  assert.doesNotMatch(String(key), /d11|p101|person|patient|token|openid/i);
  aiSession.clearMpAiTranscript(scopeA);
  assert.deepEqual(aiSession.loadMpAiTranscript(scopeA), []);
  aiSession.saveMpAiTranscript(scopeA, [{ id: "u1", role: "user", text: "keep" }]);
  aiSession.saveMpAiTranscript(scopeA, []);
  assert.deepEqual(aiSession.loadMpAiTranscript(scopeA), [
    { id: "u1", role: "user", text: "keep" },
  ]);
});

test("作用域使用安全摘要且只清理指定账号，包含同意和旧历史", async () => {
  const token = "secret-token-value-123456789";
  const accountA = `mps_${"A".repeat(43)}`;
  const accountB = `mps_${"B".repeat(43)}`;
  const { storage, removed } = installStorageUni({
    [`mpAiConsent:${accountA}`]: "2026-07-31",
    [`mpAiConsent:${accountB}`]: "2026-07-31",
    [`mpAiChatHistory:${accountA}`]: "sensitive",
    [`mpAiChatTranscript:${accountA}`]: JSON.stringify([{ id: "u1", role: "user", text: "hi" }]),
    [`mpAiChatTranscript:${accountB}`]: JSON.stringify([{ id: "u2", role: "user", text: "yo" }]),
  });
  const scopeModule = await importBundledTypeScript("src/utils/storageScope.ts");
  const tokenScope = scopeModule.buildStorageScope({ doctorId: 11, token });
  assert.doesNotMatch(tokenScope, new RegExp(token.slice(0, 16)));
  assert.doesNotMatch(read("src/utils/storageScope.ts"), /stableScopeHash|buildAiIdentityScope/);
  scopeModule.clearScopedStorage(accountA);
  assert.equal(storage.has(`mpAiConsent:${accountA}`), false);
  assert.equal(storage.has(`mpAiChatHistory:${accountA}`), false);
  assert.equal(storage.has(`mpAiChatTranscript:${accountA}`), false);
  assert.equal(storage.get(`mpAiConsent:${accountB}`), "2026-07-31");
  assert.ok(storage.get(`mpAiChatTranscript:${accountB}`));
  assert.ok(removed.includes(`mpAiConsent:${accountA}`));
  assert.ok(removed.includes(`mpAiChatHistory:${accountA}`));
  assert.ok(removed.includes(`mpAiChatTranscript:${accountA}`));
});

test("退出登录会精确清理当前账号医生的 AI 同意作用域", () => {
  const authStore = read("src/stores/auth.ts");
  assert.match(authStore, /storageScopeId/);
  assert.doesNotMatch(authStore, /buildAiIdentityScope/);
  assert.match(
    authStore,
    /function captureCurrentScopes[\s\S]*function clearCapturedScopes[\s\S]*invalidateLocalSession[\s\S]*clearCapturedScopes\(scopes\)/
  );
});

test("AI 同意弹窗等待期间身份变化时安全中止且不污染新身份", async () => {
  const calls = [];
  let modal;
  globalThis.uni = {
    showModal: (options) => {
      modal = options;
    },
    showToast: (options) => calls.push(`toast:${options.title}`),
    redirectTo: () => {},
    navigateTo: () => {},
  };
  const harness = {
    token: "token-a",
    store: { doctor: { id: 11 }, load: async () => {}, elderMode: false },
    auth: {
      authEpoch: 5,
      patientId: 101,
      personId: 201,
      storageScopeId: "mps_scope_a",
      phoneBound: true,
      clear: () => calls.push("clear"),
      refreshMe: async () => {},
    },
    consultation: {
      role: "health",
      roleMeta: { soft: "", title: "", sub: "", color: "", icon: "" },
      contextLine: "",
      quickTopics: [],
      classifyIntent: () => "health",
      selectRole: () => {},
      reset: () => {},
    },
    ensureLogin: async () => {
      calls.push("login");
      return true;
    },
    hasMpAiConsent: () => false,
    saveMpAiConsent: (scope) => calls.push(`consent:${scope}`),
    postMpAiChat: async () => {
      calls.push("api");
      return { reply: { id: "a1", role: "assistant", text: "reply" } };
    },
  };
  const mod = await importConsultSetupScript(harness);
  mod.__task8.text.value = "等待确认的问题";
  const pending = mod.__task8.onSend();
  for (let index = 0; index < 5 && !modal; index += 1) await Promise.resolve();
  assert.ok(modal, "同意弹窗应进入等待状态");

  harness.token = "token-b";
  harness.store.doctor = { id: 22 };
  harness.auth.authEpoch = 6;
  harness.auth.patientId = 102;
  harness.auth.personId = 202;
  harness.auth.storageScopeId = "mps_scope_b";
  modal.success({ confirm: true, cancel: false });
  await pending;

  assert.deepEqual(mod.__task8.messages.value, []);
  assert.deepEqual(calls.filter((item) => item.startsWith("consent:")), []);
  assert.equal(calls.includes("api"), false);
  assert.ok(calls.some((item) => item.includes("身份已变化")));
});

test("取消 AI 同意时确认前不追加消息也不请求接口", async () => {
  const calls = [];
  globalThis.uni = {
    showModal: ({ success }) => success({ confirm: false, cancel: true }),
    showToast: () => {},
    redirectTo: () => {},
    navigateTo: () => {},
  };
  const harness = {
    token: "token",
    store: { doctor: { id: 11 }, load: async () => {}, elderMode: false },
    auth: {
      authEpoch: 1,
      patientId: 101,
      personId: 201,
      storageScopeId: "mps_scope_a",
      phoneBound: true,
      clear: () => calls.push("clear"),
      refreshMe: async () => {},
    },
    consultation: {
      role: "health",
      roleMeta: { soft: "", title: "", sub: "", color: "", icon: "" },
      contextLine: "",
      quickTopics: [],
      classifyIntent: () => "health",
      selectRole: () => {},
      reset: () => {},
    },
    ensureLogin: async () => {
      calls.push("login");
      return true;
    },
    hasMpAiConsent: () => false,
    saveMpAiConsent: () => calls.push("consent"),
    postMpAiChat: async () => {
      calls.push("api");
      return { reply: { id: "a1", role: "assistant", text: "reply" } };
    },
  };
  const mod = await importConsultSetupScript(harness);
  mod.__task8.text.value = "我的健康问题";
  await mod.__task8.onSend();
  assert.deepEqual(calls, ["login"]);
  assert.deepEqual(mod.__task8.messages.value, []);
});

test("确认同意后才追加消息，同作用域后续发送不重复弹窗", async () => {
  const calls = [];
  let consent = false;
  let modalCount = 0;
  globalThis.uni = {
    showModal: ({ success }) => {
      modalCount += 1;
      success({ confirm: true, cancel: false });
    },
    showToast: () => {},
    redirectTo: () => {},
    navigateTo: () => {},
  };
  const harness = {
    token: "token",
    store: { doctor: { id: 11 }, load: async () => {}, elderMode: false },
    auth: {
      authEpoch: 1,
      patientId: 101,
      personId: 201,
      storageScopeId: "mps_scope_a",
      phoneBound: true,
      clear: () => {},
      refreshMe: async () => {},
    },
    consultation: {
      role: "health",
      roleMeta: { soft: "", title: "", sub: "", color: "", icon: "" },
      contextLine: "",
      quickTopics: [],
      classifyIntent: () => "health",
      selectRole: () => {},
      reset: () => {},
    },
    ensureLogin: async () => {
      calls.push("login");
      return true;
    },
    hasMpAiConsent: () => consent,
    saveMpAiConsent: () => {
      consent = true;
      calls.push("consent");
    },
    postMpAiChat: async () => {
      calls.push("api");
      return { reply: { id: `a${calls.length}`, role: "assistant", text: "reply" } };
    },
  };
  const mod = await importConsultSetupScript(harness);
  mod.__task8.text.value = "第一次";
  await mod.__task8.onSend();
  mod.__task8.text.value = "第二次";
  await mod.__task8.onSend();
  assert.equal(modalCount, 1);
  assert.deepEqual(calls, ["login", "consent", "api", "login", "api"]);
  assert.deepEqual(
    mod.__task8.messages.value.filter((item) => item.role === "user").map((item) => item.text),
    ["第一次", "第二次"]
  );
});

test("AI API 携带同意字段，401 与 429 都只发送一次并返回结构化错误", async () => {
  for (const status of [401, 429]) {
    let requestCount = 0;
    let sentBody;
    let sentHeader;
    globalThis.uni = {
      getStorageSync: (key) => (key === "mpToken" ? "new-dynamic-token" : ""),
      setStorageSync: () => {},
      removeStorageSync: () => {},
      request: (options) => {
        requestCount += 1;
        sentBody = options.data;
        sentHeader = options.header;
        queueMicrotask(() =>
          options.success({
            statusCode: status,
            data: { error: status === 401 ? "unauthorized" : "rate_limited" },
          })
        );
        return { abort: () => {} };
      },
    };
    const aiApi = await importBundledTypeScript("src/api/aiChat.ts");
    await assert.rejects(
      () =>
        aiApi.postMpAiChat({
          doctorId: "11",
          text: "question",
          sessionId: "session-1",
          authToken: "snapshot-token",
        }),
      (error) => error?.status === status
    );
    assert.equal(requestCount, 1);
    assert.equal(sentBody.sensitiveDataConsent, true);
    assert.equal(sentBody.consentVersion, "2026-07-31");
    assert.equal(sentHeader.Authorization, "Bearer snapshot-token");
  }
});

test("升级清理精确删除 AI 正文裸键且幂等，不删除无关缓存", async () => {
  const validScopeA = `mps_${"A".repeat(43)}`;
  const validScopeB = `mps_${"B".repeat(43)}`;
  const shortScope = `mps_${"S".repeat(42)}`;
  const longScope = `mps_${"L".repeat(44)}`;
  const fakeScope = `mps_${"F".repeat(42)}!`;
  const { storage, removed } = installStorageUni({
    mpAiChatHistory: "legacy-ai-history",
    consultMessages: "legacy-consult-history",
    patientProfile: "unrelated-profile",
    appPreference: "unrelated-preference",
    "mpAiChatHistory:d11:p1": "scoped-history-a",
    "mpAiChatHistory:d22:p2": "scoped-history-b",
    "mpAvatarPending:d11:p1": "data:image/png;base64,avatar-a",
    "mpAvatarPending:token-summary": "data:image/png;base64,avatar-b",
    "mpAiIdentity:d11:p1:ps9": "legacy-identity-a",
    "mpAiIdentity:token-hash": "legacy-identity-b",
    [`mpAiConsent:${validScopeA}`]: "2026-07-31",
    [`mpAiConsent:${shortScope}`]: "2026-07-31",
    [`mpAiConsent:${longScope}`]: "2026-07-31",
    [`mpAiConsent:${fakeScope}`]: "2026-07-31",
    "mpAiConsent:d11:p1:ps9": "2026-07-31",
    "mpAiConsent:mps_scope_a": "2026-07-31",
    [`mpAiSessionId:${validScopeA}`]: "valid-session-id",
    [`mpAiSessionId:${shortScope}`]: "short-session-id",
    "mpAiSessionId:d11:p1:ps9": "legacy-session-id",
    [`mpAiSession:${validScopeB}`]: "valid-session",
    [`mpAiSession:${longScope}`]: "long-session",
    "mpAiSession:token-hash": "legacy-session",
  });
  const scopeModule = await importBundledTypeScript("src/utils/storageScope.ts");
  scopeModule.migrateLegacyAiStorage();
  scopeModule.migrateLegacyAiStorage();
  assert.equal(storage.has("mpAiChatHistory"), false);
  assert.equal(storage.has("consultMessages"), false);
  assert.equal(storage.has("patientProfile"), false);
  assert.equal(storage.get("appPreference"), "unrelated-preference");
  for (const key of [
    "mpAiChatHistory:d11:p1",
    "mpAiChatHistory:d22:p2",
    "mpAvatarPending:d11:p1",
    "mpAvatarPending:token-summary",
    "mpAiIdentity:d11:p1:ps9",
    "mpAiIdentity:token-hash",
    `mpAiConsent:${shortScope}`,
    `mpAiConsent:${longScope}`,
    `mpAiConsent:${fakeScope}`,
    "mpAiConsent:d11:p1:ps9",
    "mpAiConsent:mps_scope_a",
    `mpAiSessionId:${shortScope}`,
    "mpAiSessionId:d11:p1:ps9",
    `mpAiSession:${longScope}`,
    "mpAiSession:token-hash",
  ]) {
    assert.equal(storage.has(key), false, `expected migrated key to be removed: ${key}`);
    assert.ok(removed.includes(key));
  }
  assert.equal(storage.get(`mpAiConsent:${validScopeA}`), "2026-07-31");
  assert.equal(storage.get(`mpAiSessionId:${validScopeA}`), "valid-session-id");
  assert.equal(storage.get(`mpAiSession:${validScopeB}`), "valid-session");
});

test("升级迁移单个 scoped 删除异常不阻断其余旧敏感键", async () => {
  const storage = new Map([
    ["mpAiChatHistory:first", "first"],
    ["mpAiChatHistory:second", "second"],
    ["mpAvatarPending:third", "data:image/png;base64,third"],
    ["unrelated:key", "keep"],
  ]);
  const attempts = [];
  globalThis.uni = {
    getStorageSync: (key) => storage.get(key) ?? "",
    getStorageInfoSync: () => ({ keys: [...storage.keys()] }),
    setStorageSync: (key, value) => storage.set(key, value),
    removeStorageSync: (key) => {
      attempts.push(key);
      if (key === "mpAiChatHistory:first") throw new Error("first removal failed");
      storage.delete(key);
    },
  };

  const scopeModule = await importBundledTypeScript("src/utils/storageScope.ts");
  assert.doesNotThrow(() => scopeModule.migrateLegacyAiStorage());
  assert.ok(attempts.includes("mpAiChatHistory:first"));
  assert.equal(storage.has("mpAiChatHistory:second"), false);
  assert.equal(storage.has("mpAvatarPending:third"), false);
  assert.equal(storage.get("unrelated:key"), "keep");
});

test("有效 session 身份不变时 App 启动仍迁移旧 AI 正文，迁移异常不阻断启动", async () => {
  const { storage } = installStorageUni({
    mpToken: "valid-session-token",
    mpAiChatHistory: "legacy-ai-history",
    consultMessages: "legacy-consult-history",
    appPreference: "keep-me",
    [`mpAiConsent:mps_${"A".repeat(43)}`]: "2026-07-31",
  });
  const scopeModule = await importBundledTypeScript("src/utils/storageScope.ts");
  let loadCount = 0;
  const harness = {
    launch: null,
    migrate: () => scopeModule.migrateLegacyAiStorage(),
    load: async () => {
      loadCount += 1;
    },
  };
  await importAppSetupScript(harness);
  assert.equal(typeof harness.launch, "function");
  assert.doesNotThrow(() => harness.launch());
  await Promise.resolve();
  assert.equal(storage.has("mpAiChatHistory"), false);
  assert.equal(storage.has("consultMessages"), false);
  assert.equal(storage.get("mpToken"), "valid-session-token");
  assert.equal(storage.get("appPreference"), "keep-me");
  assert.equal(
    storage.get(`mpAiConsent:mps_${"A".repeat(43)}`),
    "2026-07-31"
  );
  assert.equal(loadCount, 1);

  let failSafeLoadCount = 0;
  const failSafeHarness = {
    launch: null,
    migrate: () => {
      throw new Error("storage unavailable");
    },
    load: async () => {
      failSafeLoadCount += 1;
    },
  };
  await importAppSetupScript(failSafeHarness);
  assert.doesNotThrow(() => failSafeHarness.launch());
  await Promise.resolve();
  assert.equal(failSafeLoadCount, 1);

  const appSource = read("src/App.vue");
  assert.match(appSource, /onLaunch[\s\S]*migrateLegacyAiStorage\(\)[\s\S]*store\.load\(\)/);
});

test("真实 commitSession 成功换绑后清旧保新，落盘失败时旧作用域不清理", async () => {
  const oldScope = `mps_${"O".repeat(43)}`;
  const newScope = `mps_${"N".repeat(43)}`;
  const storage = new Map([
    [`mpAiConsent:${oldScope}`, "2026-07-31"],
    [`mpAiSessionId:${oldScope}`, "old-session"],
    ["mpAiChatHistory:d11:p101", "old-history"],
    [`mpAiConsent:${newScope}`, "2026-07-31"],
  ]);
  const cleared = [];
  const harness = {
    token: "token-a",
    appDoctorId: 11,
    setToken(token) {
      this.token = token;
    },
    clearScope(scope) {
      cleared.push(scope);
      for (const key of [...storage.keys()]) {
        if (key.endsWith(`:${scope}`)) storage.delete(key);
      }
    },
  };
  const authModule = await importAuthStoreSetupScript(harness);
  const auth = authModule.useAuthStore();
  auth.applyMe({
    doctorId: 11,
    patientId: 101,
    personId: 201,
    storageScopeId: oldScope,
    phoneBound: true,
  });
  auth.commitSession({
    mpToken: "token-b",
    doctorId: 11,
    patientId: 102,
    personId: 202,
    storageScopeId: newScope,
    phoneBound: true,
  });
  assert.equal(harness.token, "token-b");
  assert.ok(cleared.includes(oldScope));
  assert.ok(cleared.includes("d11:p101"));
  assert.equal(storage.has(`mpAiConsent:${oldScope}`), false);
  assert.equal(storage.has(`mpAiSessionId:${oldScope}`), false);
  assert.equal(storage.has("mpAiChatHistory:d11:p101"), false);
  assert.equal(storage.get(`mpAiConsent:${newScope}`), "2026-07-31");
  assert.equal(auth.storageScopeId?.value ?? auth.storageScopeId, newScope);

  const failureOldScope = `mps_${"F".repeat(43)}`;
  const failureNewScope = `mps_${"G".repeat(43)}`;
  const failureStorage = new Map([
    [`mpAiConsent:${failureOldScope}`, "2026-07-31"],
    ["mpAiChatHistory:d11:p301", "old-history"],
  ]);
  const failureCleared = [];
  const failureHarness = {
    token: "token-old",
    appDoctorId: 11,
    setToken() {
      throw new TokenStorageErrorForTest();
    },
    clearScope(scope) {
      failureCleared.push(scope);
      for (const key of [...failureStorage.keys()]) {
        if (key.endsWith(`:${scope}`)) failureStorage.delete(key);
      }
    },
  };
  class TokenStorageErrorForTest extends Error {
    constructor() {
      super("登录状态保存失败");
      this.code = "token_storage_failed";
    }
  }
  const failureModule = await importAuthStoreSetupScript(failureHarness);
  const failureAuth = failureModule.useAuthStore();
  failureAuth.applyMe({
    doctorId: 11,
    patientId: 301,
    personId: 401,
    storageScopeId: failureOldScope,
    phoneBound: true,
  });
  await assert.rejects(
    async () =>
      failureAuth.commitSessionWithRecovery({
        mpToken: "token-new",
        doctorId: 11,
        patientId: 302,
        personId: 402,
        storageScopeId: failureNewScope,
        phoneBound: true,
      }),
    (error) => error?.code === "auth_recovery_failed"
  );
  assert.deepEqual(failureCleared, []);
  assert.equal(failureStorage.get(`mpAiConsent:${failureOldScope}`), "2026-07-31");
  assert.equal(failureStorage.get("mpAiChatHistory:d11:p301"), "old-history");
});

test("本地档案只保存展示摘要，不落完整手机号、身份证和完整病史", async () => {
  const persisted = [];
  globalThis.uni = {
    getStorageSync: () => "",
    setStorageSync: (_key, value) => persisted.push(JSON.parse(value)),
    removeStorageSync: () => {},
  };
  const patientApi = await importBundledTypeScript("src/api/patient.ts");
  patientApi.saveLocalProfileFromPayload({
    姓名: "测试患者",
    手机号: "13800138000",
    身份证号: "110101199001011234",
    "食物、接触物过敏": "花生严重过敏",
    药物过敏: "青霉素过敏",
    疾病史: "高血压十年",
  });
  patientApi.saveLocalProfileFromPrefill({
    name: "测试患者",
    phone: "13800138000",
    idNumber: "110101199001011234",
    foodContactAllergies: { values: ["花生严重过敏"] },
    drugAllergies: { values: ["青霉素过敏"] },
    diseaseHistory: { values: ["高血压十年"] },
  });
  patientApi.saveLocalProfileFromPayload({
    姓名: "异常号码",
    手机号: "01012345678",
  });
  assert.equal(persisted.length, 3);
  for (const profile of persisted.slice(0, 2)) {
    assert.equal(profile.phone, "138****8000");
    assert.equal(profile.idNumber, "");
    assert.equal(profile.foodContactAllergies, "");
    assert.equal(profile.drugAllergies, "");
    assert.equal(profile.diseaseHistory, "");
    const serialized = JSON.stringify(profile);
    assert.doesNotMatch(serialized, /13800138000|110101199001011234|花生|青霉素|高血压/);
  }
  assert.equal(persisted[2].phone, "");
  assert.doesNotMatch(JSON.stringify(persisted[2]), /01012345678/);
});

test("真实运行时隔离先失效操作并清空内存、轮换会话，再执行存储副作用", async () => {
  const runtimeModule = await importBundledTypeScript("src/utils/mpAiRuntime.ts");
  const events = [];
  const runtime = runtimeModule.createMpAiRuntimeIsolation(() => "session-new");
  const pendingOperation = runtime.beginOperation();

  const nextSessionId = runtime.isolate({
    resetMemory: (sessionId) => {
      events.push(`memory:${sessionId}`);
    },
    storageEffects: [
      () => {
        events.push("storage:first");
        throw new Error("first storage operation failed");
      },
      () => {
        events.push("storage:second");
      },
    ],
  });

  assert.equal(nextSessionId, "session-new");
  assert.equal(runtime.isOperationCurrent(pendingOperation), false);
  assert.deepEqual(events, [
    "memory:session-new",
    "storage:first",
    "storage:second",
  ]);
});

test("clearScopedStorage 单键删除失败仍继续清理当前 scope 的其余键", async () => {
  const scope = `mps_${"A".repeat(43)}`;
  const otherScope = `mps_${"B".repeat(43)}`;
  const storage = new Map([
    [`patientProfile:${scope}`, "profile"],
    [`mpAiConsent:${scope}`, "2026-07-31"],
    [`mpAiSessionId:${scope}`, "old-session"],
    [`mpAvatarPending:${scope}`, "data:image/png;base64,sensitive"],
    [`mpAiConsent:${otherScope}`, "keep"],
    [`mpAvatarPending:${otherScope}`, "keep-avatar"],
  ]);
  const attempts = [];
  globalThis.uni = {
    getStorageSync: (key) => storage.get(key) ?? "",
    getStorageInfoSync: () => ({ keys: [...storage.keys()] }),
    setStorageSync: (key, value) => storage.set(key, value),
    removeStorageSync: (key) => {
      attempts.push(key);
      if (key === `patientProfile:${scope}`) {
        throw new Error("simulated first scoped removal failure");
      }
      storage.delete(key);
    },
  };

  const scopeModule = await importBundledTypeScript("src/utils/storageScope.ts");
  assert.doesNotThrow(() => scopeModule.clearScopedStorage(scope));
  assert.ok(attempts.includes(`patientProfile:${scope}`));
  assert.equal(storage.has(`mpAiConsent:${scope}`), false);
  assert.equal(storage.has(`mpAiSessionId:${scope}`), false);
  assert.equal(storage.has(`mpAvatarPending:${scope}`), false);
  assert.equal(storage.get(`mpAiConsent:${otherScope}`), "keep");
  assert.equal(storage.has(`mpAvatarPending:${otherScope}`), false);
});

test("启动隐私迁移删除裸档案并逐 scope 收敛为安全展示字段", async () => {
  const storage = new Map([
    ["patientProfile", JSON.stringify({ name: "裸键", phone: "13800138000" })],
    [
      "patientProfile:scope-a",
      JSON.stringify({
        name: "甲",
        phone: "13800138000",
        idNumber: "110101199001011234",
        disease: "高血压",
        foodContactAllergies: "花生",
        drugAllergies: "青霉素",
        diseaseHistory: "十年病史",
      }),
    ],
    [
      "patientProfile:scope-b",
      JSON.stringify({
        name: "乙",
        phone: "138****8000",
        idNumber: "secret-id",
        diseaseHistory: "secret-history",
      }),
    ],
    ["patientProfile:scope-long-phone", JSON.stringify({ name: "丙", phone: "138001380001234" })],
    ["patientProfile:scope-invalid", "{invalid-json"],
    ["unrelated:key", "keep"],
  ]);
  const removed = [];
  globalThis.uni = {
    getStorageSync: (key) => storage.get(key) ?? "",
    getStorageInfoSync: () => ({ keys: [...storage.keys()] }),
    setStorageSync: (key, value) => storage.set(key, value),
    removeStorageSync: (key) => {
      removed.push(key);
      storage.delete(key);
    },
  };

  const scopeModule = await importBundledTypeScript("src/utils/storageScope.ts");
  scopeModule.migrateLegacyAiStorage();

  assert.equal(storage.has("patientProfile"), false);
  assert.equal(storage.has("patientProfile:scope-invalid"), false);
  assert.equal(storage.get("unrelated:key"), "keep");
  const profileA = JSON.parse(storage.get("patientProfile:scope-a"));
  const profileB = JSON.parse(storage.get("patientProfile:scope-b"));
  const longPhone = JSON.parse(storage.get("patientProfile:scope-long-phone"));
  assert.deepEqual(
    { name: profileA.name, phone: profileA.phone },
    { name: "甲", phone: "138****8000" }
  );
  assert.equal(profileB.phone, "138****8000");
  assert.equal(longPhone.phone, "");
  for (const profile of [profileA, profileB, longPhone]) {
    assert.equal(profile.idNumber, "");
    assert.equal(profile.disease, "");
    assert.equal(profile.foodContactAllergies, "");
    assert.equal(profile.drugAllergies, "");
    assert.equal(profile.diseaseHistory, "");
  }
  assert.ok(removed.includes("patientProfile"));
});

test("启动隐私迁移的单键删除异常不阻断其他档案 scope", async () => {
  const storage = new Map([
    ["patientProfile", "legacy"],
    ["patientProfile:bad", "{invalid-json"],
    ["patientProfile:good", JSON.stringify({ name: "安全", phone: "13900139000", idNumber: "secret" })],
    ["unrelated:key", "keep"],
  ]);
  const attempts = [];
  globalThis.uni = {
    getStorageSync: (key) => storage.get(key) ?? "",
    getStorageInfoSync: () => ({ keys: [...storage.keys()] }),
    setStorageSync: (key, value) => storage.set(key, value),
    removeStorageSync: (key) => {
      attempts.push(key);
      if (key === "patientProfile") throw new Error("bare key remove failed");
      storage.delete(key);
    },
  };

  const scopeModule = await importBundledTypeScript("src/utils/storageScope.ts");
  assert.doesNotThrow(() => scopeModule.migrateLegacyAiStorage());
  assert.ok(attempts.includes("patientProfile:bad"));
  assert.equal(storage.has("patientProfile:bad"), false);
  assert.equal(JSON.parse(storage.get("patientProfile:good")).phone, "139****9000");
  assert.equal(storage.get("unrelated:key"), "keep");
});

test("AI 同意弹窗 pending 期间页面隐藏会直接失效操作", async () => {
  const calls = [];
  let consentModal;
  globalThis.uni = {
    showModal: (options) => {
      consentModal = options;
    },
    showToast: (options) => calls.push(`toast:${options.title}`),
    redirectTo: () => {},
    navigateTo: () => {},
  };
  const harness = {
    token: "snapshot-token",
    store: { doctor: { id: 11 }, load: async () => {}, elderMode: false },
    auth: {
      authEpoch: 1,
      patientId: 101,
      personId: 201,
      storageScopeId: "mps_scope_a",
      phoneBound: true,
      clear: () => {},
      refreshMe: async () => {},
    },
    consultation: {
      role: "health",
      roleMeta: { soft: "", title: "", sub: "", color: "", icon: "" },
      contextLine: "",
      quickTopics: [],
      classifyIntent: () => "health",
      selectRole: () => {},
      reset: () => {},
    },
    ensureLogin: async () => true,
    hasMpAiConsent: () => false,
    saveMpAiConsent: () => calls.push("consent"),
    postMpAiChat: async () => {
      calls.push("api");
      return { reply: { id: "a1", role: "assistant", text: "reply" } };
    },
    clearScope: () => {},
  };
  const mod = await importConsultSetupScript(harness);
  mod.__task8.text.value = "pending question";
  const pending = mod.__task8.onSend();
  for (let index = 0; index < 5 && !consentModal; index += 1) await Promise.resolve();

  assert.equal(typeof harness.hidden, "function");
  harness.hidden();
  consentModal.success({ confirm: true, cancel: false });
  await pending;

  assert.deepEqual(mod.__task8.messages.value, []);
  assert.equal(calls.includes("consent"), false);
  assert.equal(calls.includes("api"), false);
});

test("身份切换即使首个存储清理抛错也先隔离旧消息并轮换 session", async () => {
  let sentRequest;
  const storageEvents = [];
  globalThis.uni = {
    showModal: ({ success }) => success({ confirm: true, cancel: false }),
    showToast: () => {},
    redirectTo: () => {},
    navigateTo: () => {},
  };
  const harness = {
    token: "token-b",
    store: { doctor: { id: 11 }, load: async () => {}, elderMode: false },
    auth: {
      authEpoch: 2,
      patientId: 102,
      personId: 202,
      storageScopeId: "mps_scope_b",
      phoneBound: true,
      clear: () => {},
      refreshMe: async () => {},
    },
    consultation: {
      role: "health",
      roleMeta: { soft: "", title: "", sub: "", color: "", icon: "" },
      contextLine: "",
      quickTopics: [],
      classifyIntent: () => "health",
      selectRole: () => {},
      reset: () => {},
    },
    ensureLogin: async () => true,
    hasMpAiConsent: () => true,
    saveMpAiConsent: () => {},
    persistSession: (sessionId) => storageEvents.push(`persist:${sessionId}`),
    clearScope: () => {
      storageEvents.push("clear");
      throw new Error("first removeStorageSync failed");
    },
    postMpAiChat: async (request) => {
      sentRequest = request;
      return { reply: { id: "a1", role: "assistant", text: "reply" } };
    },
  };
  const mod = await importConsultSetupScript(harness);
  mod.__task8.messages.value = [
    { id: "old", role: "user", text: "old-sensitive-message" },
  ];

  assert.doesNotThrow(() => harness.scopeWatcher("mps_scope_b", "mps_scope_a"));
  assert.equal(mod.__task8.sessionId.value, "session-new");
  assert.equal(
    mod.__task8.messages.value.some((message) => message.text === "old-sensitive-message"),
    false
  );

  mod.__task8.text.value = "new question";
  await mod.__task8.onSend();
  assert.equal(sentRequest.sessionId, "session-new");
  assert.equal(
    (sentRequest.history || []).some((message) => message.text === "old-sensitive-message"),
    false
  );
  assert.deepEqual(storageEvents, ["persist:session-new", "clear"]);
});

test("AI session 生产 helper 拒绝任何含身份 ID 的非 opaque scope", async () => {
  const { storage } = installStorageUni();
  const aiSession = await importBundledTypeScript("src/utils/mpAiSession.ts");
  assert.equal(aiSession.hasMpAiConsent("d11:p101:ps201"), false);
  assert.throws(
    () => aiSession.saveMpAiConsent("d11:p101:ps201"),
    /invalid_ai_storage_scope/
  );
  assert.throws(
    () => aiSession.ensureSessionId("person-201-doctor-11"),
    /invalid_ai_storage_scope/
  );
  assert.equal(storage.size, 0);
});

test("登录 pending 期间组件卸载后不得保存同意、追加消息或请求 AI", async () => {
  let finishLogin;
  const calls = [];
  globalThis.uni = {
    showModal: () => calls.push("modal"),
    showToast: () => {},
    redirectTo: () => {},
    navigateTo: () => {},
  };
  const harness = {
    token: "snapshot-token",
    store: { doctor: { id: 11 }, load: async () => {}, elderMode: false },
    auth: {
      authEpoch: 1,
      patientId: 101,
      personId: 201,
      storageScopeId: "mps_scope_a",
      phoneBound: true,
      clear: () => {},
      refreshMe: async () => {},
    },
    consultation: {
      role: "health",
      roleMeta: { soft: "", title: "", sub: "", color: "", icon: "" },
      contextLine: "",
      quickTopics: [],
      classifyIntent: () => "health",
      selectRole: () => {},
      reset: () => {},
    },
    ensureLogin: () =>
      new Promise((resolve) => {
        finishLogin = resolve;
      }),
    hasMpAiConsent: () => false,
    saveMpAiConsent: () => calls.push("consent"),
    postMpAiChat: async () => {
      calls.push("api");
      return { reply: { id: "a1", role: "assistant", text: "reply" } };
    },
    clearScope: () => {},
  };
  const mod = await importConsultSetupScript(harness);
  mod.__task8.text.value = "pending login";
  const pending = mod.__task8.onSend();
  await Promise.resolve();
  assert.equal(typeof harness.unmounted, "function");
  harness.unmounted();
  finishLogin(true);
  await pending;

  assert.deepEqual(mod.__task8.messages.value, []);
  assert.deepEqual(calls, []);
});

test("同意弹窗 pending 期间清空页面后确认不得污染已清空会话", async () => {
  const modals = [];
  const calls = [];
  globalThis.uni = {
    showModal: (options) => modals.push(options),
    showToast: () => {},
    redirectTo: () => {},
    navigateTo: () => {},
  };
  const harness = {
    token: "snapshot-token",
    store: { doctor: { id: 11 }, load: async () => {}, elderMode: false },
    auth: {
      authEpoch: 1,
      patientId: 101,
      personId: 201,
      storageScopeId: "mps_scope_a",
      phoneBound: true,
      clear: () => {},
      refreshMe: async () => {},
    },
    consultation: {
      role: "health",
      roleMeta: { soft: "", title: "", sub: "", color: "", icon: "" },
      contextLine: "",
      quickTopics: [],
      classifyIntent: () => "health",
      selectRole: () => {},
      reset: () => {},
    },
    ensureLogin: async () => true,
    hasMpAiConsent: () => false,
    saveMpAiConsent: () => calls.push("consent"),
    postMpAiChat: async () => {
      calls.push("api");
      return { reply: { id: "a1", role: "assistant", text: "reply" } };
    },
    persistSession: () => {},
    clearScope: () => {},
  };
  const mod = await importConsultSetupScript(harness);
  mod.__task8.text.value = "pending consent";
  const pending = mod.__task8.onSend();
  for (let index = 0; index < 5 && modals.length < 1; index += 1) await Promise.resolve();
  mod.__task8.onClearChat();
  assert.equal(modals.length, 2);
  modals[1].success({ confirm: true, cancel: false });
  modals[0].success({ confirm: true, cancel: false });
  await pending;

  assert.equal(calls.includes("consent"), false);
  assert.equal(calls.includes("api"), false);
  assert.equal(
    mod.__task8.messages.value.some((message) => message.role === "user"),
    false
  );
});

test("AI scope watcher 同步处理空 scope 到绑定 scope 的身份切换", async () => {
  const harness = {
    token: "token",
    store: { doctor: { id: 11 }, load: async () => {}, elderMode: false },
    auth: {
      authEpoch: 1,
      patientId: 101,
      personId: 201,
      storageScopeId: `mps_${"S".repeat(43)}`,
      phoneBound: true,
      clear: () => {},
      refreshMe: async () => {},
    },
    consultation: {
      role: "health",
      roleMeta: { soft: "", title: "", sub: "", color: "", icon: "" },
      contextLine: "",
      quickTopics: [],
      classifyIntent: () => "health",
      selectRole: () => {},
      reset: () => {},
    },
    ensureLogin: async () => true,
    hasMpAiConsent: () => true,
    saveMpAiConsent: () => {},
    postMpAiChat: async () => ({ reply: { id: "a1", role: "assistant", text: "reply" } }),
    persistSession: () => {},
    clearScope: () => {},
  };
  const mod = await importConsultSetupScript(harness);
  mod.__task8.messages.value = [{ id: "old", role: "user", text: "old" }];
  harness.scopeWatcher(harness.auth.storageScopeId, "");

  assert.equal(harness.scopeWatchOptions?.flush, "sync");
  assert.equal(mod.__task8.sessionId.value, "session-new");
  assert.equal(mod.__task8.messages.value.some((message) => message.text === "old"), false);
});

test("发送过程中空 scope 首次绑定不会静默中止本次发送", async () => {
  const calls = [];
  let finishLogin;
  globalThis.uni = {
    showModal: ({ success }) => success({ confirm: true, cancel: false }),
    showToast: (options) => calls.push(`toast:${options.title}`),
    redirectTo: () => {},
    navigateTo: () => {},
  };
  const harness = {
    token: "token",
    store: { doctor: { id: 11 }, load: async () => {}, elderMode: false },
    auth: {
      authEpoch: 1,
      patientId: 101,
      personId: 201,
      storageScopeId: "",
      phoneBound: true,
      clear: () => {},
      refreshMe: async () => {},
    },
    consultation: {
      role: "health",
      roleMeta: { soft: "", title: "", sub: "", color: "", icon: "" },
      contextLine: "",
      quickTopics: [],
      classifyIntent: () => "health",
      selectRole: () => {},
      reset: () => {},
    },
    ensureLogin: () =>
      new Promise((resolve) => {
        finishLogin = () => {
          harness.auth.storageScopeId = "mps_scope_ready";
          harness.scopeWatcher("mps_scope_ready", "");
          resolve(true);
        };
      }),
    hasMpAiConsent: () => true,
    saveMpAiConsent: () => calls.push("consent"),
    postMpAiChat: async () => {
      calls.push("api");
      return { reply: { id: "a1", role: "assistant", text: "reply" } };
    },
    persistSession: () => {},
    clearScope: () => {},
  };
  const mod = await importConsultSetupScript(harness);
  mod.__task8.text.value = "你是谁";
  const pending = mod.__task8.onSend();
  await Promise.resolve();
  finishLogin();
  await pending;
  assert.equal(calls.includes("api"), true);
  assert.equal(
    mod.__task8.messages.value.some((message) => message.role === "user" && message.text === "你是谁"),
    true
  );
  assert.equal(calls.some((item) => item.includes("账号状态已更新")), false);
});
