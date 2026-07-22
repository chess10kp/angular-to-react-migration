import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it, beforeEach } from 'vitest';
import { JsonlContextStore } from './store.mts';
import { LESSON_STATUS } from './contracts.ts';
import type { Lesson, ResidueItem } from './contracts.ts';

function sampleLesson(overrides: Partial<Lesson> = {}): Omit<Lesson, 'id'> {
  return {
    category: 'di',
    fix_shape: 'di-hook',
    before: 'before',
    after: 'after',
    which_oracle: 'type',
    commit: '',
    evidence: { counterexample: 'unit:di-hook', units_won: [], units_regressed: [] },
    ...overrides,
  };
}

describe('JsonlContextStore', () => {
  let dir: string;
  let store: JsonlContextStore;
  const item: ResidueItem = {
    id: 'r1',
    file: 'migration/app/x.tsx',
    span: { startLine: 1, endLine: 1 },
    category: 'di',
    fix_shape: 'di-hook',
  };

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'store-test-'));
    mkdirSync(join(dir, 'migration'), { recursive: true });
    store = new JsonlContextStore({ repoRoot: dir });
  });

  it('empty store → retrieve {champion:null,challengers:[]}', () => {
    const ctx = store.retrieve(item);
    expect(ctx.champion).toBeNull();
    expect(ctx.challengers).toEqual([]);
    expect(ctx.needsFirstReview).toBe(true);
  });

  it('append one → returned as unverified challenger, champion still null', () => {
    const id = store.appendLesson(sampleLesson());
    const ctx = store.retrieve(item);
    expect(ctx.champion).toBeNull();
    expect(ctx.challengers).toHaveLength(1);
    expect(ctx.challengers[0]!.id).toBe(id);
    expect(ctx.needsFirstReview).toBe(false);
  });

  it('sidecar promoted entry → returned as champion', () => {
    const id = store.appendLesson(sampleLesson());
    writeFileSync(
      join(dir, 'migration/lesson-status.jsonl'),
      `${JSON.stringify({ id, status: LESSON_STATUS.PROMOTED })}\n`,
    );
    const ctx = store.retrieve(item);
    expect(ctx.champion?.id).toBe(id);
    expect(ctx.challengers).toEqual([]);
  });

  it('two appends same key → both unverified challengers (newest first)', () => {
    store.appendLesson(sampleLesson({ after: 'a1' }));
    store.appendLesson(sampleLesson({ after: 'a2' }));
    const ctx = store.retrieve(item);
    expect(ctx.champion).toBeNull();
    expect(ctx.challengers).toHaveLength(2);
    expect(ctx.challengers[0]!.after).toBe('a2');
  });

  it('more than three challengers → returns newest three only', () => {
    for (let i = 1; i <= 4; i++) {
      store.appendLesson(sampleLesson({ after: `a${i}` }));
    }
    const ctx = store.retrieve(item);
    expect(ctx.challengers).toHaveLength(3);
    expect(ctx.challengers.map((l) => l.after)).toEqual(['a4', 'a3', 'a2']);
  });

  it('grep facts.md and facts-proposals.jsonl by category', () => {
    writeFileSync(join(dir, 'migration/facts.md'), '- di: use useAccount()\n');
    writeFileSync(
      join(dir, 'migration/facts-proposals.jsonl'),
      `${JSON.stringify({ category: 'di', text: 'proposal hook' })}\n`,
    );
    const ctx = store.retrieve(item);
    expect(ctx.facts.some((f) => f.includes('useAccount'))).toBe(true);
    expect(ctx.facts.some((f) => f.includes('[unverified]'))).toBe(true);
  });

  it('appendFactProposal writes proposals only', () => {
    store.appendFactProposal({ category: 'di', text: 'hook map' });
    const text = readFileSync(join(dir, 'migration/facts-proposals.jsonl'), 'utf8');
    expect(text).toContain('hook map');
    expect(() => readFileSync(join(dir, 'migration/facts.md'))).toThrow();
  });

  it('appendLesson throws on status field', () => {
    expect(() =>
      store.appendLesson({ ...sampleLesson(), status: 'promoted' } as never),
    ).toThrow(/status field forbidden/);
  });

  it('appendLesson throws on missing counterexample', () => {
    expect(() =>
      store.appendLesson({
        ...sampleLesson(),
        evidence: { counterexample: '', units_won: [], units_regressed: [] },
      }),
    ).toThrow(/counterexample is required/);
  });
});
