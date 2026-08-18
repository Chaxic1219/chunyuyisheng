export class AuthRecoveryError extends Error {
  readonly code = "auth_recovery_failed";

  constructor() {
    super("登录状态恢复失败，请重新进入页面");
    this.name = "AuthRecoveryError";
  }
}

interface RecoveryOptions<TResult, TContext = never> {
  invalidate: () => void;
  login: () => Promise<TResult>;
  isReady: () => boolean;
  captureContext?: () => TContext;
  isContextCurrent?: (context: TContext) => boolean;
  currentResult?: () => TResult | null;
}

export async function recoverAfterStorageFailure<TResult, TContext = never>(
  options: RecoveryOptions<TResult, TContext>
): Promise<TResult> {
  let context: TContext | undefined;
  let hasContext = false;

  const isSuperseded = () => {
    if (!hasContext || !options.isContextCurrent) return false;
    try {
      return !options.isContextCurrent(context as TContext);
    } catch {
      return true;
    }
  };

  const getCurrentResult = () => {
    try {
      return options.currentResult?.() ?? null;
    } catch {
      return null;
    }
  };

  try {
    options.invalidate();
    if (options.captureContext && options.isContextCurrent) {
      context = options.captureContext();
      hasContext = true;
    }
    const result = await options.login();
    if (!options.isReady()) {
      if (isSuperseded()) {
        const current = getCurrentResult();
        if (current) return current;
      }
      throw new AuthRecoveryError();
    }
    return result;
  } catch {
    if (isSuperseded()) {
      const current = getCurrentResult();
      if (current) return current;
      throw new AuthRecoveryError();
    }
    try {
      options.invalidate();
    } catch {
      // 清理失败也不能泄露底层存储错误。
    }
    throw new AuthRecoveryError();
  }
}
