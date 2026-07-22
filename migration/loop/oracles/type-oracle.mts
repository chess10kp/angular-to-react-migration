import { spawnSync } from 'node:child_process';
import { dirname } from 'node:path';
import { readFileSync } from 'node:fs';
import type {
  ResidueItem,
  TscDiagnostic,
  TypeRunSummary,
  Verdict,
} from '../types.ts';

const TSC_LINE_RE =
  /^(?<file>.+?)\((?<line>\d+),(?<col>\d+)\): error (?<code>TS\d+): (?<msg>.+)$/;

/** Strip workspace prefix and extension variants so residue ↔ tsc paths align. */
export function normalizeMigrationPath(
  filePath: string,
  workspacePrefix?: string,
): string {
  let p = filePath.replace(/\\/g, '/');
  if (workspacePrefix) {
    const prefix = workspacePrefix.endsWith('/')
      ? workspacePrefix
      : `${workspacePrefix}/`;
    if (p.startsWith(prefix)) {
      p = p.slice(prefix.length);
    }
  }
  p = p.replace(/^migration\/app\//, '');
  const slash = p.lastIndexOf('/');
  const dir = slash >= 0 ? p.slice(0, slash) : '';
  let base = slash >= 0 ? p.slice(slash + 1) : p;
  base = base.replace(/\.component\.ts$/, '');
  base = base.replace(/\.service\.react\.ts$/, '');
  base = base.replace(/\.(tsx|ts|jsx|js)$/, '');
  return dir ? `${dir}/${base}` : base;
}

export function parseTscStdout(stdout: string): TscDiagnostic[] {
  const diagnostics: TscDiagnostic[] = [];
  for (const line of stdout.split(/\r?\n/)) {
    const m = TSC_LINE_RE.exec(line.trim());
    if (!m?.groups) continue;
    diagnostics.push({
      file: m.groups.file,
      line: Number(m.groups.line),
      col: Number(m.groups.col),
      code: m.groups.code,
      message: m.groups.msg,
    });
  }
  return diagnostics;
}

export function runTsc(tsconfigPath: string): { stdout: string; stderr: string } {
  const cwd = dirname(tsconfigPath);
  const configFile = tsconfigPath.replace(/\\/g, '/').split('/').pop() ?? 'tsconfig.json';
  const result = spawnSync(
    'npx',
    ['tsc', '--noEmit', '--pretty', 'false', '-p', configFile],
    { cwd, encoding: 'utf8' },
  );
  return {
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  };
}

export function loadResidueJsonl(path: string): ResidueItem[] {
  const text = readFileSync(path, 'utf8').trim();
  if (!text) return [];
  return text.split(/\r?\n/).map((line) => JSON.parse(line) as ResidueItem);
}

export function loadBaseline(path: string): number {
  const data = JSON.parse(readFileSync(path, 'utf8')) as { tscErrorCount: number };
  return data.tscErrorCount;
}

function lineInSpan(line: number, startLine: number, endLine: number): boolean {
  return line >= startLine && line <= endLine;
}

export function attributeErrors(
  items: ResidueItem[],
  diagnostics: TscDiagnostic[],
  workspacePrefix?: string,
): { verdicts: Verdict[]; unattributed: TscDiagnostic[] } {
  const attributed = new Map<string, TscDiagnostic[]>();
  for (const item of items) {
    attributed.set(item.id, []);
  }

  const unattributed: TscDiagnostic[] = [];

  for (const diag of diagnostics) {
    const normDiag = normalizeMigrationPath(diag.file, workspacePrefix);
    let matched = false;
    for (const item of items) {
      const normItem = normalizeMigrationPath(item.file, workspacePrefix);
      if (
        normDiag === normItem &&
        lineInSpan(diag.line, item.span.startLine, item.span.endLine)
      ) {
        attributed.get(item.id)!.push(diag);
        matched = true;
        break;
      }
    }
    if (!matched) {
      unattributed.push(diag);
    }
  }

  const verdicts: Verdict[] = items.map((item) => {
    const detail = attributed.get(item.id) ?? [];
    return {
      residueId: item.id,
      kind: 'type',
      status: detail.length === 0 ? 'pass' : 'fail',
      detail,
    };
  });

  return { verdicts, unattributed };
}

export function evaluateRun(
  totalErrors: number,
  baseline: number,
): TypeRunSummary['status'] {
  return totalErrors <= baseline ? 'pass' : 'fail';
}

export interface TypeOracleOptions {
  tsconfigPath: string;
  baselinePath: string;
  /** Repo-relative workspace dir (e.g. migration/app) for residue path normalization. */
  workspaceRel: string;
}

export class TypeOracle {
  readonly kind = 'type' as const;
  private readonly workspacePrefix: string;

  constructor(private readonly options: TypeOracleOptions) {
    this.workspacePrefix = options.workspaceRel.replace(/\\/g, '/');
  }

  covers(_item: ResidueItem): boolean {
    return true;
  }

  verify(items: ResidueItem[]): Verdict[] {
    const { stdout } = runTsc(this.options.tsconfigPath);
    const diagnostics = parseTscStdout(stdout);
    const { verdicts } = attributeErrors(items, diagnostics, this.workspacePrefix);
    return verdicts;
  }

  run(items: ResidueItem[]): {
    verdicts: Verdict[];
    summary: TypeRunSummary;
  } {
    const { stdout } = runTsc(this.options.tsconfigPath);
    const diagnostics = parseTscStdout(stdout);
    const baseline = loadBaseline(this.options.baselinePath);
    const { verdicts, unattributed } = attributeErrors(
      items,
      diagnostics,
      this.workspacePrefix,
    );
    const summary: TypeRunSummary = {
      kind: 'type',
      status: evaluateRun(diagnostics.length, baseline),
      totalErrors: diagnostics.length,
      baseline,
      unattributed,
    };
    return { verdicts, summary };
  }
}
