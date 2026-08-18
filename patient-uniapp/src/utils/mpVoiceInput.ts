declare function requirePlugin(name: string): unknown;

export type VoiceInputHandlers = {
  onStart?: () => void;
  onPartial?: (text: string) => void;
  onResult?: (text: string) => void;
  onError?: (message: string) => void;
};

type RecordRecognitionResult = {
  result?: string;
  tempFilePath?: string;
  msg?: string;
  errMsg?: string;
  retcode?: number;
};

type RecordRecognitionManager = {
  onStart: ((res?: RecordRecognitionResult) => void) | null;
  onStop: ((res: RecordRecognitionResult) => void) | null;
  onRecognize: ((res: RecordRecognitionResult) => void) | null;
  onError: ((res: RecordRecognitionResult) => void) | null;
  start: (opts: { duration?: number; lang?: string }) => void;
  stop: () => void;
};

const VOICE_LANG = "zh_CN";
const VOICE_MAX_MS = 60_000;

let sharedManager: RecordRecognitionManager | null | undefined;

function isMpWeixinRuntime(): boolean {
  // #ifdef MP-WEIXIN
  return true;
  // #endif
  // #ifndef MP-WEIXIN
  return false;
  // #endif
}

function loadRecognitionManager(): RecordRecognitionManager | null {
  if (!isMpWeixinRuntime()) return null;
  if (sharedManager !== undefined) return sharedManager;
  try {
    const plugin = requirePlugin("WechatSI") as {
      getRecordRecognitionManager?: () => RecordRecognitionManager;
    };
    sharedManager = plugin.getRecordRecognitionManager?.() || null;
  } catch {
    sharedManager = null;
  }
  return sharedManager;
}

function mapVoiceError(res: RecordRecognitionResult): string {
  const msg = String(res.msg || res.errMsg || "").trim();
  if (msg) return msg;
  if (res.retcode === -30001) return "录音接口被占用，请稍后重试";
  if (res.retcode === -30002) return "请开启麦克风权限后重试";
  if (res.retcode === -30003) return "说话时间太短，请重试";
  if (res.retcode === -40001) return "语音识别失败，请重试";
  return "语音识别失败，请重试";
}

export function ensureRecordPermission(): Promise<boolean> {
  return new Promise((resolve) => {
    uni.getSetting({
      success: (setting) => {
        if (setting.authSetting?.["scope.record"]) {
          resolve(true);
          return;
        }
        uni.authorize({
          scope: "scope.record",
          success: () => resolve(true),
          fail: () => {
            uni.showModal({
              title: "需要麦克风权限",
              content: "请允许使用麦克风，以便语音描述健康问题",
              confirmText: "去设置",
              success: (modal) => {
                if (!modal.confirm) {
                  resolve(false);
                  return;
                }
                uni.openSetting({
                  success: (opened) => resolve(!!opened.authSetting?.["scope.record"]),
                  fail: () => resolve(false),
                });
              },
              fail: () => resolve(false),
            });
          },
        });
      },
      fail: () => resolve(false),
    });
  });
}

export function createMpVoiceInput(handlers: VoiceInputHandlers) {
  let active = false;
  let starting = false;
  let manager: RecordRecognitionManager | null = null;

  function bindManager(m: RecordRecognitionManager) {
    // ponytail: WechatSI 用属性赋值注册回调，manager.onStart(fn) 无效
    m.onStart = () => {
      starting = false;
      active = true;
      handlers.onStart?.();
    };
    m.onRecognize = (res) => {
      handlers.onPartial?.(String(res.result || "").trim());
    };
    m.onStop = (res) => {
      starting = false;
      active = false;
      handlers.onResult?.(String(res.result || "").trim());
    };
    m.onError = (res) => {
      starting = false;
      active = false;
      handlers.onError?.(mapVoiceError(res));
    };
  }

  return {
    isActive() {
      return active || starting;
    },
    async start(): Promise<boolean> {
      if (active || starting) return true;
      if (!isMpWeixinRuntime()) {
        handlers.onError?.("当前环境不支持语音输入");
        return false;
      }
      manager = loadRecognitionManager();
      if (!manager) {
        handlers.onError?.("语音插件未就绪，请确认已在小程序后台添加「同声传译」插件");
        return false;
      }
      bindManager(manager);
      const permitted = await ensureRecordPermission();
      if (!permitted) return false;
      starting = true;
      try {
        manager.start({ lang: VOICE_LANG, duration: VOICE_MAX_MS });
        return true;
      } catch {
        starting = false;
        handlers.onError?.("无法启动录音，请稍后重试");
        return false;
      }
    },
    stop() {
      if (!manager || (!active && !starting)) return;
      try {
        manager.stop();
      } catch {
        starting = false;
        active = false;
      }
    },
    cancel() {
      this.stop();
    },
  };
}

if (typeof createMpVoiceInput !== "function" || typeof ensureRecordPermission !== "function") {
  throw new Error("mpVoiceInput bootstrap failed");
}
