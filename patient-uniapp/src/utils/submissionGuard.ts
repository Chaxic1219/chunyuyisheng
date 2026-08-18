export interface SubmissionState {
  busy: boolean;
  completed: boolean;
}

export function createSubmissionGuard(
  onChange?: (state: SubmissionState) => void
) {
  const state: SubmissionState = {
    busy: false,
    completed: false,
  };

  function notify() {
    onChange?.({ ...state });
  }

  return {
    get state(): SubmissionState {
      return { ...state };
    },
    start(): boolean {
      if (state.busy || state.completed) return false;
      state.busy = true;
      notify();
      return true;
    },
    complete() {
      state.completed = true;
      state.busy = true;
      notify();
    },
    finish() {
      if (state.completed) return;
      state.busy = false;
      notify();
    },
  };
}
