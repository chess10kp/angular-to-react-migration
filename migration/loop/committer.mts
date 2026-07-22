import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import type { Committer, ResidueItem, Verdict } from './contracts.ts';

export interface GitCommitterOptions {
  repoRoot: string;
}

function runGit(repoRoot: string, args: string[]): { stdout: string; status: number } {
  const result = spawnSync('git', args, { cwd: repoRoot, encoding: 'utf8' });
  return { stdout: result.stdout ?? '', status: result.status ?? 1 };
}

/** Parse `git status --porcelain` into repo-relative paths. */
export function parseGitPorcelain(output: string): string[] {
  const files: string[] = [];
  for (const raw of output.split(/\r?\n/)) {
    const line = raw.trimEnd();
    if (!line) continue;
    const rename = /^..\s+(.+?)\s+->\s+(.+)$/.exec(line);
    if (rename) {
      files.push(normalizePath(rename[2]!));
      continue;
    }
    const match = /^..(?:\s+)(.+)$/.exec(line);
    if (!match) continue;
    let path = match[1]!.trim();
    if (path.startsWith('"') && path.endsWith('"')) {
      path = path.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, '\\');
    }
    files.push(normalizePath(path));
  }
  return files;
}

export function normalizePath(p: string): string {
  return p.replace(/\\/g, '/').replace(/^\.\//, '');
}

/** Loop metadata the picker/driver writes — not applier output. */
const LOOP_META_PATHS = new Set([
  'migration/loop/status.jsonl',
  'migration/residue.jsonl',
]);

export function filterApplierTouches(touched: string[]): string[] {
  return touched.filter((p) => {
    const norm = normalizePath(p);
    if (!norm || norm.endsWith('/') || norm === 'migration/loop') return false;
    if (LOOP_META_PATHS.has(norm)) return false;
    if (norm.startsWith('migration/loop/') && norm !== 'migration/loop/status.jsonl') {
      return false;
    }
    if (norm.includes('BLOCKED-') && norm.endsWith('.md')) return false;
    return true;
  });
}

export function allowlistForItem(item: ResidueItem): Set<string> {
  const allowed = new Set<string>();
  allowed.add(normalizePath(item.file));
  allowed.add('migration/lessons.jsonl');
  allowed.add('migration/facts-proposals.jsonl');
  return allowed;
}

function oracleTrailer(verdicts: Verdict[]): string {
  const typeV = verdicts.find((v) => v.kind === 'type');
  const parityV = verdicts.find((v) => v.kind === 'parity');
  const typePart = typeV ? typeV.status : 'n/a';
  const parityPart = parityV ? parityV.status : 'n/a';
  return `oracle: type=${typePart} parity=${parityPart}`;
}

export function bestDoneState(verdicts: Verdict[]): 'done:parity' | 'done:type' {
  if (verdicts.some((v) => v.kind === 'parity' && v.status === 'pass')) {
    return 'done:parity';
  }
  return 'done:type';
}

export class GitCommitter implements Committer {
  constructor(private readonly options: GitCommitterOptions) {}

  touchedFiles(): string[] {
    const { stdout } = runGit(this.options.repoRoot, ['status', '--porcelain']);
    return parseGitPorcelain(stdout);
  }

  assertWithinAllowlist(item: ResidueItem, touched: string[]): void {
    const allowed = allowlistForItem(item);
    const violations = filterApplierTouches(touched).filter(
      (p) => !allowed.has(normalizePath(p)),
    );
    if (violations.length > 0) {
      throw new Error(
        `Allowlist violation: touched paths outside permitted set: ${violations.join(', ')}`,
      );
    }
  }

  commit(item: ResidueItem, verdicts: Verdict[], lessonId: string | null): void {
    const doneState = bestDoneState(verdicts);
    const raw = this.touchedFiles();
    this.assertWithinAllowlist(item, raw);
    const touched = filterApplierTouches(raw);

    if (touched.length > 0) {
      const add = runGit(this.options.repoRoot, ['add', '--', ...touched]);
      if (add.status !== 0) {
        throw new Error(`git add failed: ${add.stdout}`);
      }
    }

    const lessonTrailer = `applied-lesson: ${lessonId ?? 'none'}`;
    const trailers = [
      `residue-id: ${item.id}`,
      `done-state: ${doneState}`,
      oracleTrailer(verdicts),
      lessonTrailer,
    ];

    const commit = runGit(this.options.repoRoot, [
      'commit',
      '-m',
      `fix(migration): resolve residue ${item.id}`,
      ...trailers.flatMap((t) => ['-m', t]),
    ]);
    if (commit.status !== 0) {
      throw new Error(`git commit failed: ${commit.stdout}`);
    }
  }
}

export function createGitCommitter(repoRoot: string): GitCommitter {
  return new GitCommitter({ repoRoot: resolve(repoRoot) });
}
