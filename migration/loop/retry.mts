import type { ResidueItem, RetryPolicy, Verdict } from './contracts.ts';

export const SAME_FAILURE_CAP = 3;
export const DIVERGENCE_CHASE_CAP = 2;

function failureSignature(verdicts: Verdict[]): string {
  return verdicts
    .map((v) => `${v.kind}:${v.status}:${JSON.stringify(v.detail)}`)
    .join('|');
}

function isDivergenceShift(prev: string, next: string): boolean {
  return prev !== '' && prev !== next;
}

interface AttemptState {
  sameFailureCount: number;
  divergenceCount: number;
  lastSignature: string;
}

export class BudgetRetryPolicy implements RetryPolicy {
  private readonly attempts = new Map<string, AttemptState>();

  private state(itemId: string): AttemptState {
    let s = this.attempts.get(itemId);
    if (!s) {
      s = { sameFailureCount: 0, divergenceCount: 0, lastSignature: '' };
      this.attempts.set(itemId, s);
    }
    return s;
  }

  recordAttempt(item: ResidueItem, verdicts: Verdict[]): void {
    const sig = failureSignature(verdicts);
    const s = this.state(item.id);
    if (s.lastSignature && isDivergenceShift(s.lastSignature, sig)) {
      s.divergenceCount += 1;
      s.sameFailureCount = 0;
    } else if (s.lastSignature === sig) {
      s.sameFailureCount += 1;
    } else {
      s.sameFailureCount = 1;
    }
    s.lastSignature = sig;
  }

  shouldRetry(item: ResidueItem, _history: Verdict[]): boolean {
    const s = this.state(item.id);
    if (s.divergenceCount >= DIVERGENCE_CHASE_CAP) return false;
    if (s.sameFailureCount >= SAME_FAILURE_CAP) return false;
    return true;
  }

  reset(itemId: string): void {
    this.attempts.delete(itemId);
  }
}

/** Alias matching build-sheet name. */
export { BudgetRetryPolicy as DefaultRetryPolicy };
