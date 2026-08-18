export function createSingleFlight<T>(
  onChange?: (current: Promise<T> | null) => void
) {
  let current: Promise<T> | null = null;

  return (task: () => Promise<T>): Promise<T> => {
    if (current) return current;
    current = Promise.resolve()
      .then(task)
      .finally(() => {
        current = null;
        onChange?.(null);
      });
    onChange?.(current);
    return current;
  };
}

export function createKeyedSingleFlight<T = unknown>() {
  const active = new Map<string, Promise<T>>();

  return {
    run(key: string, task: () => Promise<T>): Promise<T> {
      const existing = active.get(key);
      if (existing) return existing;

      let started: Promise<T>;
      try {
        started = Promise.resolve(task());
      } catch (error) {
        started = Promise.reject(error);
      }
      const promise = started.finally(() => {
        if (active.get(key) === promise) active.delete(key);
      });
      active.set(key, promise);
      return promise;
    },
  };
}
