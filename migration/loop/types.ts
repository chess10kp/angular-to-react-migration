/** Shared loop types (C-L2 contracts.ts will extend these). */

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
  kind: 'type';
  status: 'pass' | 'fail';
  detail: TscDiagnostic[];
}

export interface TypeRunSummary {
  kind: 'type';
  status: 'pass' | 'fail';
  totalErrors: number;
  baseline: number;
  unattributed: TscDiagnostic[];
}
