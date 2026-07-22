import { execFileSync, execSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import { JsonlPicker } from './picker.mts';
import { GitCommitter } from './committer.mts';
import { DefaultRetryPolicy } from './retry.mts';
import { JsonlContextStore } from './store.mts';
import { FixApplierV1 } from './fix-applier.mts';
import { runDriver } from './driver.mts';
import type { Oracle, ResidueItem, Verdict } from './contracts.ts';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');

function loadRealItems(indices: number[]): ResidueItem[] {
  const lines = readFileSync(join(REPO_ROOT, 'migration/residue.jsonl'), 'utf8')
    .trim()
    .split(/\r?\n/);
  return indices.map((i) => JSON.parse(lines[i]!) as ResidueItem);
}

class PassingOracle implements Oracle {
  readonly kind = 'type' as const;
  covers(): boolean {
    return true;
  }
  verify(items: ResidueItem[]): Verdict[] {
    return items.map((item) => ({
      residueId: item.id,
      kind: 'type',
      status: 'pass',
      detail: [],
    }));
  }
}

function initGateRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'gate5-'));
  execSync('git init', { cwd: dir, stdio: 'pipe' });
  execSync('git config user.email "gate5@test.com"', { cwd: dir, stdio: 'pipe' });
  execSync('git config user.name "GATE5"', { cwd: dir, stdio: 'pipe' });
  mkdirSync(join(dir, 'migration/app'), { recursive: true });
  mkdirSync(join(dir, 'migration/loop'), { recursive: true });
  writeFileSync(join(dir, 'migration/app/.gitkeep'), '');
  execSync('git add -A && git commit -m "init"', { cwd: dir, stdio: 'pipe' });
  return dir;
}

function seedLessonsForFirstReview(store: JsonlContextStore, items: ResidueItem[]): void {
  const seen = new Set<string>();
  for (const item of items) {
    const key = `${item.category}:${item.fix_shape}`;
    if (seen.has(key)) continue;
    seen.add(key);
    store.appendLesson({
      category: item.category ?? 'unknown',
      fix_shape: item.fix_shape ?? 'unknown',
      before: 'seed',
      after: `seed-${key}`,
      which_oracle: 'type',
      commit: '',
      evidence: {
        counterexample: `seed:${key}`,
        units_won: [],
        units_regressed: [],
      },
    });
  }
}

describe('GATE-5 audit chain', () => {
  it('runs loop on 3 real residue items with stub oracle — residue-id → commit → lesson greppable', () => {
    const items = loadRealItems([0, 1, 3]);
    const repo = initGateRepo();
    const residuePath = join(repo, 'migration/residue.jsonl');
    const statusPath = join(repo, 'migration/loop/status.jsonl');

    writeFileSync(residuePath, items.map((i) => JSON.stringify(i)).join('\n') + '\n');

    for (const item of items) {
      mkdirSync(join(repo, dirname(item.file)), { recursive: true });
      writeFileSync(join(repo, item.file), `// residue ${item.id}\n`);
    }

    const store = new JsonlContextStore({ repoRoot: repo });
    seedLessonsForFirstReview(store, items);

    execSync('git add -A && git commit -m "seed gate5 fixtures"', {
      cwd: repo,
      stdio: 'pipe',
    });

    const result = runDriver({
      picker: new JsonlPicker({ residuePath, statusPath }),
      store,
      applier: new FixApplierV1((item) => {
        writeFileSync(join(repo, item.file), `// fixed ${item.id}\n`);
        return { files: [item.file], before: 'before', after: 'after' };
      }),
      oracles: [new PassingOracle()],
      committer: new GitCommitter({ repoRoot: repo }),
      retry: new DefaultRetryPolicy(),
      blockedDir: join(repo, 'migration/loop/blocked'),
    });

    expect(result.done.length).toBe(3);
    expect(result.blocked).toEqual([]);

    const lessonsPath = join(repo, 'migration/lessons.jsonl');
    for (const item of items) {
      const log = execFileSync(
        'git',
        ['log', '--all', '--grep', `residue-id: ${item.id}`, '--format=%B'],
        { cwd: repo, encoding: 'utf8' },
      );
      expect(log).toContain(`residue-id: ${item.id}`);
      const lessonMatch = /applied-lesson: ([0-9a-f]{8})/.exec(log);
      expect(lessonMatch).toBeTruthy();
      const lessonId = lessonMatch![1]!;
      const lessons = readFileSync(lessonsPath, 'utf8');
      expect(lessons).toContain(`"id":"${lessonId}"`);
    }
  });
});
