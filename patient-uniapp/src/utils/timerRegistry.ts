export type TimerHandle = ReturnType<typeof setTimeout>;

interface TimerDependencies {
  setTimeout: typeof setTimeout;
  clearTimeout: typeof clearTimeout;
  setInterval: typeof setInterval;
  clearInterval: typeof clearInterval;
}

const defaultDependencies: TimerDependencies = {
  setTimeout,
  clearTimeout,
  setInterval,
  clearInterval,
};

export function createTimerRegistry(
  dependencies: TimerDependencies = defaultDependencies
) {
  const timers = new Map<TimerHandle, "timeout" | "interval">();
  let disposed = false;

  function clear(handle: TimerHandle | null) {
    if (handle == null) return;
    const kind = timers.get(handle);
    if (kind === "timeout") dependencies.clearTimeout(handle);
    if (kind === "interval") dependencies.clearInterval(handle);
    timers.delete(handle);
  }

  return {
    timeout(callback: () => void, delay: number): TimerHandle | null {
      if (disposed) return null;
      const handle = dependencies.setTimeout(() => {
        timers.delete(handle);
        callback();
      }, delay);
      timers.set(handle, "timeout");
      return handle;
    },
    interval(callback: () => void, delay: number): TimerHandle | null {
      if (disposed) return null;
      const handle = dependencies.setInterval(callback, delay);
      timers.set(handle, "interval");
      return handle;
    },
    clear,
    dispose() {
      disposed = true;
      for (const handle of [...timers.keys()]) clear(handle);
    },
  };
}
