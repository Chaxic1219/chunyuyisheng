interface TokenStorageDependencies {
  read: () => unknown;
  write: (value: string) => void;
  remove: () => void;
}

export class TokenStorageError extends Error {
  readonly code = "token_storage_failed";

  constructor() {
    super("登录状态保存失败");
    this.name = "TokenStorageError";
  }
}

export function createResilientTokenStorage(
  dependencies: TokenStorageDependencies
) {
  let override: string | undefined;

  function forceClear() {
    override = "";
    try {
      dependencies.remove();
    } catch {
      // 内存覆盖保持未登录，避免继续使用已被服务端撤销的旧 token。
    }
  }

  return {
    get(): string {
      if (override !== undefined) return override;
      try {
        return String(dependencies.read() || "");
      } catch {
        return "";
      }
    },
    set(value: string) {
      const token = String(value || "");
      try {
        if (token) dependencies.write(token);
        else dependencies.remove();
        override = token;
      } catch {
        forceClear();
        throw new TokenStorageError();
      }
    },
    forceClear,
  };
}
