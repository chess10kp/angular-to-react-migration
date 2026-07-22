import { execSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import { quarantineOnRegression } from './quarantine.mts';
import { LESSON_STATUS } from './contracts.ts';

function initRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'quarantine-'));
  execSync('git init', { cwd: dir, stdio: 'pipe' });
  execSync('git config user.email "t@t.com"', { cwd: dir, stdio: 'pipe' });
  execSync('git config user.name "T"', { cwd: dir, stdio: 'pipe' });
  mkdirSync(join(dir, 'migration/app'), { recursive: true });
  writeFileSync(join(dir, 'migration/app/sample.tsx'), 'v1\n');
  execSync('git add -A && git commit -m "init"', { cwd: dir, stdio: 'pipe' });
  return dir;
}

describe('quarantineOnRegression', () => {
  it('flips touching lesson sidecar status to suspect on seeded regression', () => {
    const repo = initRepo();
    const target = 'migration/app/sample.tsx';
    const lessonId = 'abcd1234';
    const statusPath = join(repo, 'migration/lesson-status.jsonl');

    writeFileSync(
      join(repo, 'migration/lessons.jsonl'),
      `${JSON.stringify({
        id: lessonId,
        category: 'di',
        fix_shape: 'di-hook',
        before: 'v1',
        after: 'v2',
        which_oracle: 'type',
        commit: '',
        evidence: { counterexample: 'x', units_won: [], units_regressed: [] },
      })}\n`,
    );
    writeFileSync(join(repo, target), 'v2\n');
    execSync('git add -A', { cwd: repo, stdio: 'pipe' });
    execSync(
      `git commit -m "fix" -m "residue-id: seed-1" -m "done-state: done:type" -m "oracle: type=pass parity=n/a" -m "applied-lesson: ${lessonId}"`,
      { cwd: repo, stdio: 'pipe' },
    );

    writeFileSync(
      statusPath,
      `${JSON.stringify({ id: lessonId, status: LESSON_STATUS.PROMOTED })}\n`,
    );

    const quarantined = quarantineOnRegression(
      { repoRoot: repo, lessonStatusPath: statusPath },
      'regression-1',
      target,
    );

    expect(quarantined).toEqual([lessonId]);
    const sidecar = readFileSync(statusPath, 'utf8');
    expect(sidecar).toContain(LESSON_STATUS.SUSPECT);
    expect(sidecar).toContain('"demoted":true');
  });
});

describe('store.mts seam firewall', () => {
  it('does not write facts.md directly', () => {
    const src = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), 'store.mts'),
      'utf8',
    );
    expect(src).not.toMatch(
      /(writeFile|appendFile|createWriteStream)[^)]*facts\.md/,
    );
  });
});
