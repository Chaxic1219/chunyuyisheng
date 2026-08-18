interface SerialLatestOptions<TTarget, TResult> {
  key: (target: TTarget) => string;
  execute: (target: TTarget) => Promise<TResult>;
  accept: (target: TTarget, result: TResult) => void;
}

export function createSerialLatestExecutor<TTarget, TResult>(
  options: SerialLatestOptions<TTarget, TResult>
) {
  let desired: { key: string; target: TTarget } | null = null;
  let cycle: Promise<TResult> | null = null;

  async function run(): Promise<TResult> {
    while (desired) {
      const current = desired;
      let result: TResult;
      try {
        result = await options.execute(current.target);
      } catch (error) {
        if (desired && desired.key !== current.key) continue;
        throw error;
      }
      if (desired && desired.key === current.key) {
        desired = null;
        options.accept(current.target, result);
        return result;
      }
    }
    throw new Error("serial_latest_without_target");
  }

  return {
    request(target: TTarget): Promise<TResult> {
      const key = options.key(target);
      if (!desired || desired.key !== key) desired = { key, target };
      if (!cycle) {
        cycle = run().finally(() => {
          cycle = null;
        });
      }
      return cycle;
    },
  };
}
