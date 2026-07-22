/** migration/loop/contracts.ts — the only thing the loop driver imports (§C.1.5). */

export interface ResidueSpan {
  startLine: number;
  endLine: number;
}

export interface ResidueItem {
  id: string;
  file: string;
  span: ResidueSpan;
  category?: string;
  fix_shape?: string;
  status?: string;
  deps?: string[];
  priority?: number;
}

export interface TscDiagnostic {
  file: string;
  line: number;
  col: number;
  code: string;
  message: string;
}

export interface Verdict {
  residueId: string;
  kind: 'type' | 'parity';
  status: 'pass' | 'fail';
  detail: TscDiagnostic[] | unknown;
}

export interface LessonEvidence {
  counterexample: string;
  units_won: string[];
  units_regressed: string[];
}

export interface Lesson {
  id: string;
  category: string;
  fix_shape: string;
  before: string;
  after: string;
  which_oracle: 'type' | 'parity';
  commit: string;
  evidence: LessonEvidence;
}

export interface FactProposal {
  category: string;
  text: string;
  source?: string;
}

export interface RetrievedContext {
  champion: Lesson | null;
  challengers: Lesson[];
  facts: string[];
  needsFirstReview?: boolean;
}

export interface FixResult {
  files: string[];
  before?: string;
  after?: string;
}

export interface UnitScore {
  unitId: string;
  score: number;
}

export const LESSON_STATUS = {
  PROMOTED: 'promoted',
  SUSPECT: 'suspect',
} as const;

export type ItemStatus = 'open' | 'doing' | 'done:type' | 'done:parity' | 'blocked';

export interface Picker {
  next(): ResidueItem | null;
  setStatus(id: string, s: ItemStatus): void;
  getStatus(id: string): string;
}

export interface ContextStore {
  retrieve(item: ResidueItem): RetrievedContext;
  appendLesson(l: Omit<Lesson, 'id'> & { id?: string }): string;
  appendFactProposal(f: FactProposal): void;
}

export interface FixApplier {
  apply(item: ResidueItem, ctx: RetrievedContext): FixResult;
}

export interface Oracle {
  readonly kind: 'type' | 'parity';
  covers(item: ResidueItem): boolean;
  verify(items: ResidueItem[]): Verdict[];
}

export interface Committer {
  touchedFiles(): string[];
  assertWithinAllowlist(item: ResidueItem, touched: string[]): void;
  commit(item: ResidueItem, verdicts: Verdict[], lessonId: string | null): void;
}

export interface RetryPolicy {
  shouldRetry(item: ResidueItem, history: Verdict[]): boolean;
  recordAttempt(item: ResidueItem, verdicts: Verdict[]): void;
  reset(itemId: string): void;
}

export interface PromoteGate {
  evaluate(candidate: Lesson): {
    promote: boolean;
    scoreVector: UnitScore[];
    regressions: string[];
  };
}

export interface DriverDeps {
  picker: Picker;
  store: ContextStore;
  applier: FixApplier;
  oracles: Oracle[];
  committer: Committer;
  retry: RetryPolicy;
  blockedDir?: string;
}

export interface DriverResult {
  done: string[];
  blocked: string[];
}
