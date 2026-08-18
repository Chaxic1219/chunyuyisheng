export interface MpAiIsolationOptions {
  resetMemory: (sessionId: string) => void;
  storageEffects?: ReadonlyArray<(sessionId: string) => void>;
}

export interface MpAiRuntimeIsolation {
  readonly currentOperationId: number;
  beginOperation: () => number;
  invalidateOperation: () => number;
  isOperationCurrent: (operationId: number) => boolean;
  isolate: (options: MpAiIsolationOptions) => string;
}

export function createMpAiRuntimeIsolation(
  createSessionId: () => string
): MpAiRuntimeIsolation {
  let operationId = 0;

  const invalidateOperation = () => {
    operationId += 1;
    return operationId;
  };

  return {
    get currentOperationId() {
      return operationId;
    },
    beginOperation: invalidateOperation,
    invalidateOperation,
    isOperationCurrent(candidate) {
      return candidate === operationId;
    },
    isolate(options) {
      invalidateOperation();
      const sessionId = createSessionId();
      options.resetMemory(sessionId);
      for (const effect of options.storageEffects || []) {
        try {
          effect(sessionId);
        } catch {
          // Memory isolation is already complete; continue remaining cleanup.
        }
      }
      return sessionId;
    },
  };
}
