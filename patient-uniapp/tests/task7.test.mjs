import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relativePath) => readFileSync(path.join(root, relativePath), "utf8");

async function importBundledTypeScript(relativePath, define = {}) {
  const { build } = await import("vite");
  const fixtureRoot = mkdtempSync(path.join(tmpdir(), "patient-mp-task7-"));
  const outfile = path.join(fixtureRoot, "bundle.mjs");
  try {
    await build({
      configFile: false,
      logLevel: "silent",
      define: {
        "import.meta.env.MODE": JSON.stringify("development"),
        "import.meta.env.VITE_PHONE_BIND_MODE": "undefined",
        "import.meta.env.VITE_API_BASE": "undefined",
        "import.meta.env.VITE_V32_ALLOW_MOCK_FALLBACK": "undefined",
        ...define,
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

async function importVueSetupScript(relativePath, prelude) {
  const source = read(relativePath);
  const script = source.match(/<script setup lang="ts">([\s\S]*?)<\/script>/)?.[1];
  assert.ok(script, `${relativePath} 缺少 script setup`);
  const withoutImports = script.replace(/^import\s+.*?;\r?\n/gm, "");
  const typescriptModule = await import("typescript");
  const ts = typescriptModule.default || typescriptModule;
  const output = ts.transpileModule(
    `${prelude}
${withoutImports}
export const __task7 = {
  onToggleReminders: typeof onToggleReminders === "function" ? onToggleReminders : null,
  remindersOn: typeof remindersOn === "undefined" ? null : remindersOn,
  onLogout: typeof onLogout === "function" ? onLogout : null,
  onUnbindWechat: typeof onUnbindWechat === "function" ? onUnbindWechat : null,
  onRebindPhone: typeof onRebindPhone === "function" ? onRebindPhone : null,
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

async function importBindSetupScript() {
  const source = read("src/pages/auth/bind.vue");
  const script = source.match(/<script setup lang="ts">([\s\S]*?)<\/script>/)?.[1];
  assert.ok(script, "bind.vue 缺少 script setup");
  const withoutImports = script.replace(/^import\s+.*?;\r?\n/gm, "");
  const typescriptModule = await import("typescript");
  const ts = typescriptModule.default || typescriptModule;
  const prelude = `
const harness = globalThis.__task7BindHarness;
const ref = (value) => ({ value });
const computed = (getter) => ({ get value() { return getter(); } });
const onMounted = (callback) => { harness.mounted = callback; };
const onUnmounted = () => {};
const onLoad = () => {};
const getMpToken = () => "existing-token";
const mpBindPhone = async () => ({});
const useAuthStore = () => harness.auth;
const useAppStore = () => harness.app;
const resolveDoctorAffiliation = async () => "ok";
const isExplicitSignedOut = () => false;
const createSubmissionGuard = (update) => ({
  start: () => true,
  finish: () => {},
  complete: () => {},
});
const createTimerRegistry = () => ({
  timeout: () => 1,
  interval: () => 1,
  clear: () => {},
  dispose: () => {},
});
`;
  const output = ts.transpileModule(
    `${prelude}
${withoutImports}
export const __bindTask7 = {
  onWxPhone: typeof onWxPhone === "function" ? onWxPhone : null,
  onResumeLogin: typeof onResumeLogin === "function" ? onResumeLogin : null,
  agreed: typeof agreed === "undefined" ? null : agreed,
  busy: typeof busy === "undefined" ? null : busy,
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

async function importInviteSetupScript() {
  const source = read("src/pages/invite/form.vue");
  const script = source.match(/<script setup lang="ts">([\s\S]*?)<\/script>/)?.[1];
  assert.ok(script, "invite/form.vue 缺少 script setup");
  const withoutImports = script.replace(/^import\s+.*?;\r?\n/gm, "");
  const typescriptModule = await import("typescript");
  const ts = typescriptModule.default || typescriptModule;
  const prelude = `
const harness = globalThis.__task7InviteHarness;
const ref = (value) => ({ value });
const computed = (getter) => ({ get value() { return getter(); } });
const onMounted = (callback) => { harness.mounted = callback; };
const onLoad = (callback) => { harness.loaded = callback; };
const onShow = () => {};
const fetchInviteMeta = (...args) => harness.fetchInviteMeta(...args);
const saveLocalProfileFromPayload = () => {};
const buildInviteReturnUrl = (token) =>
  token ? "/pages/invite/form?t=" + encodeURIComponent(token) : "/pages/invite/form";
const getMpToken = () => "invite-account-token";
const allowsSmsVerification = () => false;
const useAppStore = () => harness.app;
const useAuthStore = () => harness.auth;
const ensureLogin = (...args) => harness.ensureLogin(...args);
const buildStorageScope = (value) => value;
const scopedStorageKey = () => "profile";
`;
  const output = ts.transpileModule(
    `${prelude}
${withoutImports}
export const __inviteTask7 = {
  config,
  inviteToken,
  inviteDoctorId:
    typeof inviteDoctorId === "undefined" ? null : inviteDoctorId,
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

async function importPatientFormSetupScript() {
  const source = read("src/components/PatientForm.vue");
  const script = source.match(/<script setup lang="ts">([\s\S]*?)<\/script>/)?.[1];
  assert.ok(script, "PatientForm.vue 缺少 script setup");
  const withoutImports = script.replace(/^import\s+.*?;\r?\n/gm, "");
  const typescriptModule = await import("typescript");
  const ts = typescriptModule.default || typescriptModule;
  const prelude = `
const harness = globalThis.__task7PatientFormHarness;
const ref = (value) => ({ value });
const reactive = (value) => value;
const computed = (getter) => ({ get value() { return getter(); } });
const onMounted = (callback) => { harness.mounted.push(callback); };
const onUnmounted = (callback) => { harness.unmounted.push(callback); };
const watch = (source, callback, options) => {
  if (options && options.immediate) {
    callback(typeof source === "function" ? source() : source);
  }
};
const defineProps = () => harness.props;
const withDefaults = (value, defaults) => Object.assign({}, defaults, value);
const defineEmits = () => (...args) => harness.emits.push(args);
const fetchPatientSession = async () => ({ phoneBound: false, smsAvailable: false });
const sendSmsCode = (...args) => harness.sendSmsCode(...args);
const submitForm = (...args) => harness.submitForm(...args);
const submitInviteForm = (...args) => harness.submitInviteForm(...args);
const uploadVoucher = (...args) => harness.uploadVoucher(...args);
const ApiError = class ApiError extends Error {
  constructor(status, code, message = code) {
    super(message);
    this.status = status;
    this.code = code;
  }
};
const buildInviteReturnUrl = (token) =>
  token ? "/pages/invite/form?t=" + encodeURIComponent(token) : "/pages/invite/form";
const allowsSmsVerification = (available) => available === true;
const useAppStore = () => harness.app;
const useAuthStore = () => harness.auth;
const ensureLogin = (...args) => harness.ensureLogin(...args);
`;
  const output = ts.transpileModule(
    `${prelude}
${withoutImports}
export const __patientFormTask7 = {
  uploadLocalFile,
  submitInvite,
  form,
  verificationProof:
    typeof verificationProof === "undefined" ? null : verificationProof,
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

function createPatientFormHarness(overrides = {}) {
  return {
    props: {
      config: {
        title: "邀请建档",
        fields: [
          { key: "phone", label: "手机号", type: "tel", required: true },
          {
            key: "outpatientVoucher",
            label: "门诊凭证",
            type: "file",
            required: false,
            accept: ["application/pdf"],
          },
        ],
      },
      type: "邀请建档",
      archiveMode: "invite",
      inviteToken: "invite-b",
      smsAvailable: false,
      doctorId: 202,
      navigateBackOnSuccess: false,
    },
    app: {
      doctor: { id: 101 },
    },
    auth: {
      phoneBound: true,
    },
    mounted: [],
    unmounted: [],
    emits: [],
    sendSmsCode: async () => ({ ok: true }),
    submitForm: async () => ({ ok: true, message: "ok" }),
    submitInviteForm: async () => ({ ok: true, message: "ok" }),
    uploadVoucher: async () => ({ url: "/api/patient/voucher/b" }),
    ensureLogin: async () => true,
    ...overrides,
  };
}

async function runBindWxScenario({ bootstrap, loadError = null }) {
  const previousUni = globalThis.uni;
  const previousHarness = globalThis.__task7BindHarness;
  const calls = [];
  const harness = {
    mounted: null,
    auth: {
      hasProfile: true,
      silentLogin: async () => {},
      commitSessionWithRecovery: async () => {},
    },
    app: {
      bootstrap,
      doctor: bootstrap?.doctor || null,
      load: async () => {
        if (loadError) throw loadError;
      },
    },
  };
  globalThis.__task7BindHarness = harness;
  globalThis.uni = {
    showToast: () => {},
    redirectTo: () => {},
    navigateTo: () => {},
    switchTab: () => {},
    navigateBack: () => {},
    reLaunch: () => {},
  };
  try {
    const page = await importBindSetupScript();
    assert.equal(typeof harness.mounted, "function");
    await harness.mounted();
    return {
      onWxPhone: page.__bindTask7.onWxPhone,
      onResumeLogin: page.__bindTask7.onResumeLogin,
      agreed: page.__bindTask7.agreed?.value,
      calls,
    };
  } finally {
    globalThis.uni = previousUni;
    globalThis.__task7BindHarness = previousHarness;
  }
}

test("生产环境绑定固定为微信一键取号，短信能力恒禁用（产品决策）", async () => {
  const productionConfig = await importBundledTypeScript("src/api/config.ts", {
    "import.meta.env.MODE": JSON.stringify("production"),
    "import.meta.env.VITE_PHONE_BIND_MODE": JSON.stringify("sms"),
  });
  assert.equal(productionConfig.PHONE_BIND_MODE, "wechat");
  assert.equal(typeof productionConfig.allowsSmsVerification, "function");
  assert.equal(productionConfig.allowsSmsVerification(true), false);
  assert.equal(productionConfig.allowsSmsVerification(false), false);

  const developmentConfig = await importBundledTypeScript("src/api/config.ts", {
    "import.meta.env.MODE": JSON.stringify("development"),
    "import.meta.env.VITE_PHONE_BIND_MODE": JSON.stringify("auto"),
  });
  // 产品决策：已放弃短信验证码绑定，仅微信官方一键取号，任何环境均禁用短信
  assert.equal(developmentConfig.PHONE_BIND_MODE, "wechat");
  assert.equal(developmentConfig.allowsSmsVerification(true), false);
  assert.equal(developmentConfig.allowsSmsVerification(false), false);
});

test("短信接口不向界面回填 demo code 或虚假验证码", async () => {
  const previousUni = globalThis.uni;
  globalThis.uni = {
    request: async () => ({
      statusCode: 200,
      data: { ok: true, demo: true, code: "123456" },
    }),
    getStorageSync: () => "",
    setStorageSync: () => {},
    removeStorageSync: () => {},
  };
  try {
    const patientApi = await importBundledTypeScript("src/api/patient.ts");
    const result = await patientApi.sendSmsCode("13800138000", 7);
    assert.deepEqual(result, { ok: true });
  } finally {
    globalThis.uni = previousUni;
  }
});

test("多医生邀请从 metadata 锁定医生 B，登录、上传和提交均不得回落默认医生 A", async () => {
  const previousUni = globalThis.uni;
  const previousInviteHarness = globalThis.__task7InviteHarness;
  const previousPatientHarness = globalThis.__task7PatientFormHarness;
  const contextCalls = [];
  const loginCalls = [];
  const uploadDoctors = [];
  const submitBodies = [];
  const inviteHarness = {
    mounted: null,
    loaded: null,
    app: {
      doctor: { id: 101 },
      loading: false,
      error: "",
      elderMode: false,
      load: async (_force, doctorId) => {
        contextCalls.push(doctorId);
        if (doctorId === 202) inviteHarness.app.doctor = { id: 202 };
      },
      rememberDoctorId: (doctorId) => {
        inviteHarness.app.doctor = { id: doctorId };
      },
    },
    auth: {
      patientId: 1,
      personId: 2,
      refreshMe: async () => {},
    },
    fetchInviteMeta: async () => ({
      ok: true,
      doctorId: 202,
      doctorName: "医生 B",
      smsAvailable: false,
    }),
    ensureLogin: async (returnUrl) => {
      loginCalls.push({
        returnUrl,
        doctorId: inviteHarness.app.doctor?.id,
      });
      return true;
    },
  };
  globalThis.__task7InviteHarness = inviteHarness;
  globalThis.uni = {
    getStorageSync: () => "",
    setStorageSync: () => {},
    redirectTo: () => {},
    navigateTo: () => {},
    showToast: () => {},
    getFileSystemManager: () => ({
      readFile: (options) => options.success?.({ data: "JVBERi0xLjcKJSVFT0Y=" }),
    }),
  };
  try {
    const invitePage = await importInviteSetupScript();
    inviteHarness.loaded({ t: "invite-b" });
    await inviteHarness.mounted();
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(invitePage.__inviteTask7.inviteDoctorId?.value, 202);
    assert.deepEqual(contextCalls, [202]);
    assert.deepEqual(loginCalls, [
      { returnUrl: "/pages/invite/form?t=invite-b", doctorId: 202 },
    ]);
    assert.equal(invitePage.__inviteTask7.config.value !== null, true);

    const patientHarness = createPatientFormHarness({
      uploadVoucher: async (doctorId) => {
        uploadDoctors.push(doctorId);
        return { url: "/api/patient/voucher/b" };
      },
      submitInviteForm: async (_token, body) => {
        submitBodies.push(body);
        return { ok: true, message: "ok" };
      },
    });
    globalThis.__task7PatientFormHarness = patientHarness;
    const patientForm = await importPatientFormSetupScript();
    patientForm.__patientFormTask7.form.phone = "13800138000";
    await patientForm.__patientFormTask7.uploadLocalFile(
      patientHarness.props.config.fields[1],
      "/tmp/b.pdf",
      "b.pdf",
      "application/pdf",
      100
    );
    await patientForm.__patientFormTask7.submitInvite();
    assert.deepEqual(uploadDoctors.map(String), ["202"]);
    assert.deepEqual(submitBodies.map((body) => String(body.doctorId)), ["202"]);
  } finally {
    globalThis.uni = previousUni;
    globalThis.__task7InviteHarness = previousInviteHarness;
    globalThis.__task7PatientFormHarness = previousPatientHarness;
  }
});

test("邀请短信并档 verificationProof 仅驻留内存并只用于紧接的一次确认提交", async () => {
  const previousUni = globalThis.uni;
  const previousHarness = globalThis.__task7PatientFormHarness;
  for (const choice of ["merge", "create-new"]) {
    const submittedBodies = [];
    const persisted = [];
    const harness = createPatientFormHarness({
      auth: { phoneBound: false },
      props: {
        ...createPatientFormHarness().props,
        smsAvailable: true,
      },
      submitInviteForm: async (_token, body) => {
        submittedBodies.push(body);
        if (submittedBodies.length === 1) {
          return {
            ok: false,
            needsMergeConfirm: true,
            message: "confirm",
            verificationProof: `proof-${choice}`,
            candidates: [
              {
                id: 33,
                displayNameMasked: "张*",
                phoneMasked: "138****8000",
              },
            ],
          };
        }
        return { ok: true, message: "ok" };
      },
    });
    globalThis.__task7PatientFormHarness = harness;
    globalThis.uni = {
      setStorageSync: (...args) => persisted.push(args),
      showToast: () => {},
      navigateBack: () => {},
      showModal: (options) => {
        options.success?.(
          choice === "merge"
            ? { confirm: true, cancel: false }
            : { confirm: false, cancel: true }
        );
      },
    };
    try {
      const patientForm = await importPatientFormSetupScript();
      patientForm.__patientFormTask7.form.phone = "13800138000";
      await patientForm.__patientFormTask7.submitInvite();
      await new Promise((resolve) => setTimeout(resolve, 0));
      assert.equal(submittedBodies.length, 2);
      assert.equal("verificationProof" in submittedBodies[0], false);
      assert.equal(submittedBodies[1].verificationProof, `proof-${choice}`);
      if (choice === "merge") {
        assert.equal(submittedBodies[1].confirmMergePatientId, 33);
      } else {
        assert.equal(submittedBodies[1].forceCreate, true);
      }
      assert.equal(patientForm.__patientFormTask7.verificationProof.value, "");
      assert.equal(
        persisted.some((args) => JSON.stringify(args).includes(`proof-${choice}`)),
        false
      );

      await patientForm.__patientFormTask7.submitInvite();
      assert.equal(
        "verificationProof" in submittedBodies.at(-1),
        false,
        "proof 不得串到下一次独立提交"
      );
    } finally {
      globalThis.uni = previousUni;
      globalThis.__task7PatientFormHarness = previousHarness;
    }
  }
});

test("verificationProof 在确认失败、弹窗关闭和组件卸载后清空", async () => {
  const previousUni = globalThis.uni;
  const previousHarness = globalThis.__task7PatientFormHarness;
  for (const ending of ["request-failure", "modal-failure", "unmount"]) {
    let modalOptions;
    let requestCount = 0;
    const harness = createPatientFormHarness({
      auth: { phoneBound: false },
      props: {
        ...createPatientFormHarness().props,
        smsAvailable: true,
      },
      submitInviteForm: async () => {
        requestCount += 1;
        if (requestCount === 1) {
          return {
            ok: false,
            needsMergeConfirm: true,
            message: "confirm",
            verificationProof: `proof-${ending}`,
            candidates: [
              {
                id: 34,
                displayNameMasked: "李*",
                phoneMasked: "138****8000",
              },
            ],
          };
        }
        throw new Error("forced failure");
      },
    });
    globalThis.__task7PatientFormHarness = harness;
    globalThis.uni = {
      showToast: () => {},
      showModal: (options) => {
        modalOptions = options;
      },
    };
    try {
      const patientForm = await importPatientFormSetupScript();
      patientForm.__patientFormTask7.form.phone = "13800138000";
      await patientForm.__patientFormTask7.submitInvite();
      assert.equal(
        patientForm.__patientFormTask7.verificationProof.value,
        `proof-${ending}`
      );
      if (ending === "request-failure") {
        modalOptions.success?.({ confirm: true, cancel: false });
        await new Promise((resolve) => setTimeout(resolve, 0));
      } else if (ending === "modal-failure") {
        modalOptions.fail?.(new Error("dismissed"));
      } else {
        harness.unmounted.forEach((callback) => callback());
      }
      assert.equal(patientForm.__patientFormTask7.verificationProof.value, "");
    } finally {
      globalThis.uni = previousUni;
      globalThis.__task7PatientFormHarness = previousHarness;
    }
  }
});

test("原始文件超过 4MB 或无法确认大小时，在 readFile 前 fail closed", async () => {
  const previousUni = globalThis.uni;
  const previousHarness = globalThis.__task7PatientFormHarness;
  for (const scenario of [
    { size: 4 * 1024 * 1024 + 1, statFails: false },
    { size: undefined, statFails: true },
  ]) {
    let reads = 0;
    let uploads = 0;
    const harness = createPatientFormHarness({
      uploadVoucher: async () => {
        uploads += 1;
        return { url: "/api/patient/voucher/should-not-upload" };
      },
    });
    globalThis.__task7PatientFormHarness = harness;
    globalThis.uni = {
      showToast: () => {},
      getFileInfo: (options) => {
        if (scenario.statFails) options.fail?.(new Error("stat failed"));
        else options.success?.({ size: scenario.size });
      },
      getFileSystemManager: () => ({
        readFile: (options) => {
          reads += 1;
          options.success?.({ data: "JVBERi0xLjcKJSVFT0Y=" });
        },
      }),
    };
    try {
      const patientForm = await importPatientFormSetupScript();
      await patientForm.__patientFormTask7.uploadLocalFile(
        harness.props.config.fields[1],
        "/tmp/large.pdf",
        "large.pdf",
        "application/pdf",
        scenario.size
      );
      assert.equal(reads, 0);
      assert.equal(uploads, 0);
    } finally {
      globalThis.uni = previousUni;
      globalThis.__task7PatientFormHarness = previousHarness;
    }
  }
});

test("短信 provider 恶意错误不会进入客户端 UI", async () => {
  const previousUni = globalThis.uni;
  const malicious = "<script>secret-provider-message-13800138000</script>";
  globalThis.uni = {
    request: async () => ({
      statusCode: 502,
      data: { error: "sms_send_failed", message: malicious },
    }),
    getStorageSync: () => "",
    setStorageSync: () => {},
    removeStorageSync: () => {},
  };
  try {
    const patientApi = await importBundledTypeScript("src/api/patient.ts");
    await assert.rejects(
      patientApi.sendSmsCode("13800138000", 7),
      (error) =>
        error?.code === "sms_send_failed" &&
        !String(error?.message || "").includes(malicious)
    );
  } finally {
    globalThis.uni = previousUni;
  }
});

test("凭证上传使用最新 Bearer，401 受控恢复且最多重试一次", async () => {
  const previousUni = globalThis.uni;
  let token = "stale-token";
  let requestCount = 0;
  let recoveryCount = 0;
  const headers = [];
  const persisted = [];
  globalThis.uni = {
    getStorageSync: () => token,
    setStorageSync: (_key, value) => persisted.push(value),
    removeStorageSync: () => {},
    request: async (options) => {
      requestCount += 1;
      headers.push(options.header);
      if (requestCount === 1) {
        return { statusCode: 401, data: { error: "unauthorized" } };
      }
      return {
        statusCode: 200,
        data: { ok: true, url: "/api/patient/voucher/file-1" },
      };
    },
  };
  try {
    const patientApi = await importBundledTypeScript("src/api/patient.ts");
    const dataUrl = "data:image/png;base64,iVBORw0KGgo=";
    const result = await patientApi.uploadVoucher("7", dataUrl, async () => {
      recoveryCount += 1;
      token = "fresh-token";
      return true;
    });
    assert.equal(result.url, "/api/patient/voucher/file-1");
    assert.equal(requestCount, 2);
    assert.equal(recoveryCount, 1);
    assert.equal(headers[0].Authorization, "Bearer stale-token");
    assert.equal(headers[1].Authorization, "Bearer fresh-token");
    assert.equal(persisted.some((value) => String(value).includes(dataUrl)), false);
  } finally {
    globalThis.uni = previousUni;
  }
});

test("凭证上传遇到 403 或 429 不循环登录，并保留结构化错误", async () => {
  const previousUni = globalThis.uni;
  try {
    for (const scenario of [
      { status: 403, code: "forbidden" },
      { status: 429, code: "rate_limited" },
    ]) {
      let requests = 0;
      let recoveries = 0;
      globalThis.uni = {
        getStorageSync: () => "current-token",
        setStorageSync: () => {},
        removeStorageSync: () => {},
        request: async () => {
          requests += 1;
          return { statusCode: scenario.status, data: { error: scenario.code } };
        },
      };
      const patientApi = await importBundledTypeScript("src/api/patient.ts");
      await assert.rejects(
        patientApi.uploadVoucher(
          "7",
          "data:image/png;base64,iVBORw0KGgo=",
          async () => {
            recoveries += 1;
            return true;
          }
        ),
        (error) => error?.status === scenario.status && error?.code === scenario.code
      );
      assert.equal(requests, 1);
      assert.equal(recoveries, 0);
    }
  } finally {
    globalThis.uni = previousUni;
  }
});

test("邀请返回地址固定为应用内页面并编码令牌，阻止参数注入", async () => {
  const previousUni = globalThis.uni;
  globalThis.uni = {
    getStorageSync: () => "",
    setStorageSync: () => {},
    removeStorageSync: () => {},
  };
  try {
    const authApi = await importBundledTypeScript("src/api/auth.ts");
    assert.equal(typeof authApi.buildInviteReturnUrl, "function");
    assert.equal(
      authApi.buildInviteReturnUrl("abc&returnUrl=https://evil.example/#x"),
      "/pages/invite/form?t=abc%26returnUrl%3Dhttps%3A%2F%2Fevil.example%2F%23x"
    );
    assert.equal(authApi.buildInviteReturnUrl(""), "/pages/invite/form");
  } finally {
    globalThis.uni = previousUni;
  }
});

test("邀请提交保留 phone_mismatch 结构化错误供界面安全提示", async () => {
  const previousUni = globalThis.uni;
  globalThis.uni = {
    getStorageSync: () => "bound-token",
    setStorageSync: () => {},
    removeStorageSync: () => {},
    request: async () => ({
      statusCode: 403,
      data: { error: "phone_mismatch" },
    }),
  };
  try {
    const patientApi = await importBundledTypeScript("src/api/patient.ts");
    await assert.rejects(
      patientApi.submitInviteForm("invite-1", {
        doctorId: 7,
        phone: "13800138000",
        consent: true,
        payload: {},
      }),
      (error) =>
        error?.status === 403 &&
        error?.code === "phone_mismatch" &&
        /手机号/.test(error?.message || "")
    );
  } finally {
    globalThis.uni = previousUni;
  }
});

test("数据权利 API 使用认证请求并发送准确的 export/delete 类型", async () => {
  const previousUni = globalThis.uni;
  const requests = [];
  globalThis.uni = {
    getStorageSync: () => "data-token",
    setStorageSync: () => {},
    removeStorageSync: () => {},
    request: async (options) => {
      requests.push(options);
      if (options.method === "GET") {
        return { statusCode: 200, data: { ok: true, items: [] } };
      }
      return {
        statusCode: 201,
        data: {
          ok: true,
          request: { id: 42, requestType: options.data.requestType, status: "pending" },
        },
      };
    },
  };
  try {
    const authApi = await importBundledTypeScript("src/api/auth.ts");
    assert.equal(typeof authApi.createMpDataRequest, "function");
    assert.equal(typeof authApi.getMyMpDataRequests, "function");
    await authApi.createMpDataRequest("export");
    await authApi.createMpDataRequest("delete");
    await authApi.getMyMpDataRequests();
    assert.deepEqual(
      requests.map((item) => [item.method, item.data?.requestType, item.header.Authorization]),
      [
        ["POST", "export", "Bearer data-token"],
        ["POST", "delete", "Bearer data-token"],
        ["GET", undefined, "Bearer data-token"],
      ]
    );
  } finally {
    globalThis.uni = previousUni;
  }
});

const settingsPrelude = `
const harness = globalThis.__task7SettingsHarness || {};
const ref = (value) => ({ value });
const reactive = (value) => value;
const computed = (getter) => ({ get value() { return getter(); } });
const onMounted = () => {};
const getMpToken = () => "data-token";
const useAuthStore = () => ({
  phoneMasked: "138****8000",
  refreshMe: async () => {},
  logout: async () => {},
  clear: () => {},
});
const useAppStore = () => ({ elderMode: false, toggleElder: () => true, setElderMode: () => true });
const resolveIconSrc = () => "";
const ensureLogin = (...args) => (harness.ensureLogin ? harness.ensureLogin(...args) : true);
const mpUnbindPhone = async () => {};
const setExplicitSignedOut = () => {};
const ApiError = class ApiError extends Error {};
`;

test("设置页合并提醒开关：写入三项本机偏好", async () => {
  const previousUni = globalThis.uni;
  const stored = [];
  globalThis.uni = {
    showModal: () => {},
    showToast: () => {},
    getSystemInfoSync: () => ({ statusBarHeight: 20 }),
    getStorageSync: () => "",
    setStorageSync: (key, value) => stored.push([key, value]),
    navigateBack: () => {},
    switchTab: () => {},
    navigateTo: () => {},
    redirectTo: () => {},
  };
  try {
    const page = await importVueSetupScript("src/pages/settings/index.vue", settingsPrelude);
    assert.equal(typeof page.__task7.onToggleReminders, "function");
    page.__task7.onToggleReminders({ detail: { value: false } });
    assert.equal(page.__task7.remindersOn.value, false);
    assert.deepEqual(stored.at(-1), [
      "mpV32SettingsReminders",
      { medication: false, service: false, followup: false },
    ]);
    page.__task7.onToggleReminders({ detail: { value: true } });
    assert.equal(page.__task7.remindersOn.value, true);
    assert.deepEqual(stored.at(-1), [
      "mpV32SettingsReminders",
      { medication: true, service: true, followup: true },
    ]);
  } finally {
    globalThis.uni = previousUni;
  }
});

test("设置页保留换绑、退出与解绑入口", () => {
  const settings = read("src/pages/settings/index.vue");
  assert.match(settings, /onRebindPhone|更换绑定手机号/);
  assert.match(settings, /onLogout|退出登录/);
  assert.match(settings, /onUnbindWechat|解除微信绑定/);
  assert.doesNotMatch(settings, /createMpDataRequest|getMyMpDataRequests|onDeleteData|onExportData/);
});
test("绑定页为微信一键取号：无短信 UI，服务端加载失败不阻断微信取号", async () => {
  const result = await runBindWxScenario({
    bootstrap: {
      doctor: { id: "7" },
      capabilities: { smsAvailable: false },
    },
  });
  assert.equal(typeof result.onWxPhone, "function");
  assert.equal(result.agreed, true);
  assert.deepEqual(result.calls, []);
});

test("绑定页加载失败时 fail closed 且不发送任何验证码", async () => {
  const result = await runBindWxScenario({
    bootstrap: null,
    loadError: new Error("bootstrap_failed"),
  });
  assert.equal(typeof result.onWxPhone, "function");
  assert.deepEqual(result.calls, []);
});

test("绑定页恒为微信一键取号：任何模式都不展示短信表单", async () => {
  const development = await runBindWxScenario({
    bootstrap: {
      doctor: { id: "7" },
      capabilities: { smsAvailable: true },
    },
  });
  assert.equal(typeof development.onWxPhone, "function");

  const production = await runBindWxScenario({
    bootstrap: {
      doctor: { id: "7" },
      capabilities: { smsAvailable: true },
    },
  });
  assert.equal(typeof production.onWxPhone, "function");
  assert.deepEqual(production.calls, []);
});

test("Task 7 页面契约接入微信一键取号绑定、邀请恢复；设置页已精简", () => {
  const patientForm = read("src/components/PatientForm.vue");
  const invitePage = read("src/pages/invite/form.vue");
  const bindPage = read("src/pages/auth/bind.vue");
  const patientPublic = read("../app/routes/patient-public.js");
  const settings = read("src/pages/settings/index.vue");
  assert.match(patientForm, /allowsSmsVerification|smsAvailable/);
  assert.match(patientForm, /ensureLogin/);
  assert.match(patientForm, /phone_verification_required/);
  assert.match(patientForm, /phone_mismatch/);
  assert.match(invitePage, /smsAvailable/);
  assert.match(invitePage, /buildInviteReturnUrl/);
  assert.match(settings, /消息与任务提醒|onToggleReminders/);
  assert.match(settings, /更换绑定手机号|退出登录|解除微信绑定/);
  assert.doesNotMatch(settings, /createMpDataRequest|getMyMpDataRequests/);
  assert.doesNotMatch(settings, /入口维护中/);
  assert.doesNotMatch(patientForm, /smsCode\.value\s*=\s*result\.code/);
  assert.doesNotMatch(bindPage, /smsCode\.value\s*=\s*result\.code/);
  assert.match(bindPage, /getPhoneNumber|onWxPhone|open-type="getPhoneNumber"/);
  assert.doesNotMatch(bindPage, /showSmsForm/);
  assert.match(
    patientPublic,
    /capabilities\s*:\s*\{\s*smsAvailable\s*:\s*smsProvider\.isConfigured\(\)/
  );
  assert.doesNotMatch(patientForm, /setStorageSync\([^)]*dataUrl/);
});
