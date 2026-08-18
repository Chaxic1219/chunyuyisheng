export interface AuthSnapshot {
  token: string;
  epoch: number;
}

function positiveInteger(value: unknown): number | null {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : null;
}

export function createAuthStateCoordinator() {
  let epoch = 0;
  let doctorId: number | null = null;

  return {
    get epoch() {
      return epoch;
    },
    get doctorId() {
      return doctorId;
    },
    capture(token: string): AuthSnapshot {
      return { token, epoch };
    },
    isCurrent(snapshot: AuthSnapshot, currentToken: string): boolean {
      return snapshot.epoch === epoch && snapshot.token === currentToken;
    },
    runIfCurrent(
      snapshot: AuthSnapshot,
      currentToken: string,
      effect: () => void
    ): boolean {
      if (snapshot.epoch !== epoch || snapshot.token !== currentToken) return false;
      effect();
      return true;
    },
    transition(nextDoctorId: unknown): number {
      epoch += 1;
      doctorId = positiveInteger(nextDoctorId);
      return epoch;
    },
    rememberDoctor(nextDoctorId: unknown) {
      doctorId = positiveInteger(nextDoctorId);
    },
    contextKey(nextDoctorId: unknown): string {
      return `${positiveInteger(nextDoctorId) || 0}:${epoch}`;
    },
  };
}
