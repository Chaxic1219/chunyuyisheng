export class StaleAuthResult extends Error {
  readonly code = "stale_auth_result";

  constructor() {
    super("认证状态已更新");
    this.name = "StaleAuthResult";
  }
}

export function isStaleAuthResult(error: unknown): error is StaleAuthResult {
  return error instanceof StaleAuthResult;
}

interface GuardedAuthRefreshOptions<TSnapshot, TResult> {
  snapshot: TSnapshot;
  request: () => Promise<TResult>;
  isCurrent: (snapshot: TSnapshot) => boolean;
  apply: (result: TResult) => void;
  clearOnUnauthorized: () => void;
  isUnauthorized: (error: unknown) => boolean;
}

export async function guardedAuthRefresh<TSnapshot, TResult>(
  options: GuardedAuthRefreshOptions<TSnapshot, TResult>
): Promise<TResult> {
  try {
    const result = await options.request();
    if (!options.isCurrent(options.snapshot)) throw new StaleAuthResult();
    options.apply(result);
    return result;
  } catch (error) {
    if (isStaleAuthResult(error)) throw error;
    if (!options.isCurrent(options.snapshot)) throw new StaleAuthResult();
    if (options.isUnauthorized(error)) options.clearOnUnauthorized();
    throw error;
  }
}
