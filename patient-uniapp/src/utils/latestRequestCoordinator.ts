export interface LatestRequestOptions<T> {
  force: boolean;
  request: () => Promise<T>;
  onStart?: () => void;
  onSuccess: (value: T) => void;
  onError: (error: unknown) => void;
  onSettled: () => void;
}

export function createLatestRequestCoordinator() {
  let latestId = 0;
  let active: { id: number; promise: Promise<void> } | null = null;

  return {
    run<T>(options: LatestRequestOptions<T>): Promise<void> {
      if (active && !options.force) return active.promise;

      const id = ++latestId;
      options.onStart?.();
      let request: Promise<T>;
      try {
        request = Promise.resolve(options.request());
      } catch (error) {
        request = Promise.reject(error);
      }

      const promise = request
        .then((value) => {
          if (id === latestId) options.onSuccess(value);
        })
        .catch((error) => {
          if (id === latestId) options.onError(error);
        })
        .finally(() => {
          if (id === latestId) options.onSettled();
          if (active?.id === id) active = null;
        });
      active = { id, promise };
      return promise;
    },
  };
}
