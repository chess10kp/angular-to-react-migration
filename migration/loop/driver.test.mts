import { execFileSync, execSync } from 'node:child_process';
import {
  mkdtempSync,
  writeFileSync,
  readFileSync,
  mkdirSync,
  existsSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it, beforeEach } from 'vitest';
import type { DriverDeps, Oracle, Verdict, ResidueItem } from './contracts.ts';
import { runDriver } from './driver.mts';
import { JsonlPicker } from './picker.mts';
import {
  GitCommitter,
  allowlistForItem,
  parseGitPorcelain,
  filterApplierTouches,
} from './committer.mts';
import { DefaultRetryPolicy } from './retry.mts';
import { StoreStub } from './store-stub.mts';
import { FixApplierV1 } from './fix-applier.mts';

function writeJsonl(path: string, rows: unknown[]): void {
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
}

function initTempRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'migration-loop-'));
  writeFileSync(join(dir, '.gitignore'), 'status.jsonl\nresidue.jsonl\n');
  execSync('git init', { cwd: dir, stdio: 'pipe' });
  execSync('git config user.email "test@test.com"', { cwd: dir, stdio: 'pipe' });
  execSync('git config user.name "Test"', { cwd: dir, stdio: 'pipe' });
  mkdirSync(join(dir, 'migration/app'), { recursive: true });
  writeFileSync(join(dir, 'migration/app/sample.tsx'), 'export const x = 1;\n');
  execSync('git add -A && git commit -m "init"', { cwd: dir, stdio: 'pipe' });
  return dir;
}

class StubOracle implements Oracle {
  readonly kind = 'type' as const;
  constructor(
    private readonly result: 'pass' | 'fail',
    private readonly coversItem = true,
  ) {}

  covers(): boolean {
    return this.coversItem;
  }

  verify(items: ResidueItem[]): Verdict[] {
    return items.map((item) => ({
      residueId: item.id,
      kind: 'type',
      status: this.result,
      detail: [],
    }));
  }
}

describe('JsonlPicker', () => {
  let dir: string;
  let residuePath: string;
  let statusPath: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'picker-'));
    residuePath = join(dir, 'residue.jsonl');
    statusPath = join(dir, 'status.jsonl');
  });

  it('(a) picks dependency before dependent (#2 deps-on #1 → #1 first)', () => {
    const items: ResidueItem[] = [
      {
        id: 'item-1',
        file: 'migration/app/a.tsx',
        span: { startLine: 1, endLine: 1 },
        priority: 2,
        deps: [],
      },
      {
        id: 'item-2',
        file: 'migration/app/b.tsx',
        span: { startLine: 1, endLine: 1 },
        priority: 1,
        deps: ['item-1'],
      },
    ];
    writeJsonl(residuePath, items);
    const picker = new JsonlPicker({ residuePath, statusPath });

    expect(picker.next()?.id).toBe('item-1');
    picker.setStatus('item-1', 'done:type');
    expect(picker.next()?.id).toBe('item-2');
  });
});

describe('GitCommitter allowlist', () => {
  it('(b) throws when facts.md is touched', () => {
    const item: ResidueItem = {
      id: 'x',
      file: 'migration/app/sample.tsx',
      span: { startLine: 1, endLine: 1 },
    };
    const repo = initTempRepo();
    const committer = new GitCommitter({ repoRoot: repo });
    const factsRel = ['migration', 'facts.md'].join('/');
    writeFileSync(join(repo, factsRel), '# facts\n');
    execSync(`git add ${factsRel}`, { cwd: repo, stdio: 'pipe' });

    expect(() =>
      committer.assertWithinAllowlist(item, committer.touchedFiles()),
    ).toThrow(/Allowlist violation/);
  });

  it('parseGitPorcelain reads modified paths', () => {
    const files = parseGitPorcelain(' M migration/app/sample.tsx\n?? migration/lessons.jsonl\n');
    expect(files).toEqual(['migration/app/sample.tsx', 'migration/lessons.jsonl']);
  });

  it('allowlistForItem includes target and lesson paths', () => {
    const item: ResidueItem = {
      id: 'a',
      file: 'migration/app/foo.tsx',
      span: { startLine: 1, endLine: 1 },
    };
    const allowed = allowlistForItem(item);
    expect(allowed.has('migration/app/foo.tsx')).toBe(true);
    expect(allowed.has('migration/lessons.jsonl')).toBe(true);
    expect(allowed.has('migration/facts-proposals.jsonl')).toBe(true);
  });
});

describe('runDriver', () => {
  it('(b) blocks item when applier touches facts.md', () => {
    const repo = initTempRepo();
    const residuePath = join(repo, 'migration/loop/residue.jsonl');
    const statusPath = join(repo, 'migration/loop/status.jsonl');
    const lessonsPath = join(repo, 'migration/lessons.jsonl');

    writeJsonl(residuePath, [
      {
        id: 'bad-touch',
        file: 'migration/app/sample.tsx',
        span: { startLine: 1, endLine: 1 },
        category: 'di',
        fix_shape: 'di-hook',
        priority: 1,
      },
    ]);

    const deps: DriverDeps = {
      picker: new JsonlPicker({ residuePath, statusPath }),
      store: new StoreStub({ lessonsPath }),
      applier: new FixApplierV1((_item, _ctx) => {
        const factsRel = ['migration', 'facts.md'].join('/');
        writeFileSync(join(repo, factsRel), 'poison\n');
        return { files: [factsRel] };
      }),
      oracles: [new StubOracle('pass')],
      committer: new GitCommitter({ repoRoot: repo }),
      retry: new DefaultRetryPolicy(),
      blockedDir: join(repo, 'migration'),
    };

    const result = runDriver(deps);
    expect(result.blocked).toEqual(['bad-touch']);
    expect(existsSync(join(repo, 'migration/BLOCKED-bad-touch.md'))).toBe(true);

    const status = readFileSync(statusPath, 'utf8');
    expect(status).toContain('"blocked"');
  });

  it('(c) green path: one commit with four trailers and lesson in same tree', () => {
    const repo = initTempRepo();
    const residuePath = join(repo, 'migration/loop/residue.jsonl');
    const statusPath = join(repo, 'migration/loop/status.jsonl');
    const lessonsPath = join(repo, 'migration/lessons.jsonl');
    const target = 'migration/app/sample.tsx';

    writeJsonl(residuePath, [
      {
        id: 'green-1',
        file: target,
        span: { startLine: 1, endLine: 1 },
        category: 'di',
        fix_shape: 'di-hook',
        priority: 1,
      },
    ]);

    const deps: DriverDeps = {
      picker: new JsonlPicker({ residuePath, statusPath }),
      store: new StoreStub({ lessonsPath }),
      applier: new FixApplierV1((_item, _ctx) => {
        writeFileSync(join(repo, target), 'export const x = 2;\n');
        return { files: [target], before: '1', after: '2' };
      }),
      oracles: [new StubOracle('pass')],
      committer: new GitCommitter({ repoRoot: repo }),
      retry: new DefaultRetryPolicy(),
      blockedDir: join(repo, 'migration'),
    };

    const result = runDriver(deps);
    expect(result.done).toEqual(['green-1']);
    expect(result.blocked).toEqual([]);

    const log = execFileSync('git', ['log', '-1', '--format=%B'], {
      cwd: repo,
      encoding: 'utf8',
    });
    expect(log).toContain('residue-id: green-1');
    expect(log).toContain('done-state: done:type');
    expect(log).toContain('oracle: type=pass parity=n/a');
    expect(log).toMatch(/applied-lesson: [0-9a-f]{8}/);

    expect(existsSync(lessonsPath)).toBe(true);
    const lessonLine = readFileSync(lessonsPath, 'utf8').trim();
    const lesson = JSON.parse(lessonLine) as { id: string; category: string };
    expect(lesson.category).toBe('di');
    expect(log).toContain(`applied-lesson: ${lesson.id}`);

    const treeFiles = execFileSync('git', ['show', '--name-only', '--format=', 'HEAD'], {
      cwd: repo,
      encoding: 'utf8',
    })
      .trim()
      .split('\n')
      .filter(Boolean);
    expect(treeFiles).toContain(target);
    expect(treeFiles).toContain('migration/lessons.jsonl');

    const porcelain = execFileSync('git', ['status', '--porcelain'], {
      cwd: repo,
      encoding: 'utf8',
    });
    expect(porcelain.trim()).toBe('');
  });
});

describe('DefaultRetryPolicy', () => {
  it('caps same-failure retries at 3', () => {
    const policy = new DefaultRetryPolicy();
    const item: ResidueItem = {
      id: 'r1',
      file: 'migration/app/x.tsx',
      span: { startLine: 1, endLine: 1 },
    };
    const verdict: Verdict[] = [
      { residueId: 'r1', kind: 'type', status: 'fail', detail: [] },
    ];
    policy.recordAttempt(item, verdict);
    expect(policy.shouldRetry(item, verdict)).toBe(true);
    policy.recordAttempt(item, verdict);
    expect(policy.shouldRetry(item, verdict)).toBe(true);
    policy.recordAttempt(item, verdict);
    expect(policy.shouldRetry(item, verdict)).toBe(false);
  });
});
