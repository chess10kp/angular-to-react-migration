import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type {
  DriverDeps,
  DriverResult,
  FixResult,
  ResidueItem,
  RetrievedContext,
  Verdict,
} from './contracts.ts';

export function makeLesson(
  item: ResidueItem,
  fix: FixResult,
  verdicts: Verdict[],
): Omit<import('./contracts.ts').Lesson, 'id'> {
  const hasParity = verdicts.some((v) => v.kind === 'parity' && v.status === 'pass');
  return {
    category: item.category ?? 'unknown',
    fix_shape: item.fix_shape ?? 'unknown',
    before: fix.before ?? '',
    after: fix.after ?? '',
    which_oracle: hasParity ? 'parity' : 'type',
    commit: '',
    evidence: {
      counterexample: `${item.id}:${item.file}:${item.span.startLine}`,
      units_won: [],
      units_regressed: [],
    },
  };
}

function diagnoseFirst(verdicts: Verdict[]): void {
  const fail = verdicts.find((v) => v.status === 'fail');
  if (fail) {
    console.error(
      `[driver] first failure: ${fail.kind} on ${fail.residueId}`,
      fail.detail,
    );
  }
}

function writeBlocked(
  item: ResidueItem,
  verdicts: Verdict[],
  blockedDir: string,
): void {
  mkdirSync(blockedDir, { recursive: true });
  const path = join(blockedDir, `BLOCKED-${item.id}.md`);
  const body = [
    `# BLOCKED ${item.id}`,
    '',
    `File: ${item.file}`,
    `Category: ${item.category ?? 'n/a'}`,
    `Fix shape: ${item.fix_shape ?? 'n/a'}`,
    '',
    '## Verdicts',
    '```json',
    JSON.stringify(verdicts, null, 2),
    '```',
  ].join('\n');
  writeFileSync(path, body);
}

export function runDriver(deps: DriverDeps): DriverResult {
  const blocked: string[] = [];
  const done: string[] = [];
  const blockedDir = deps.blockedDir ?? 'migration/loop/blocked';

  while (true) {
    const item = deps.picker.next();
    if (!item) break;

    deps.picker.setStatus(item.id, 'doing');
    const ctx: RetrievedContext = deps.store.retrieve(item);

    if (ctx.needsFirstReview) {
      writeBlocked(item, [], blockedDir);
      deps.picker.setStatus(item.id, 'blocked');
      blocked.push(item.id);
      continue;
    }

    const fix = deps.applier.apply(item, ctx);

    try {
      const touched = deps.committer.touchedFiles();
      deps.committer.assertWithinAllowlist(item, touched);
    } catch (err) {
      console.error(`[driver] allowlist blocked ${item.id}:`, err);
      writeBlocked(item, [], blockedDir);
      deps.picker.setStatus(item.id, 'blocked');
      blocked.push(item.id);
      continue;
    }

    const covered = deps.oracles.filter((o) => o.covers(item));
    const verdicts = covered.flatMap((o) => o.verify([item]));
    const green = verdicts.length > 0 && verdicts.every((v) => v.status === 'pass');

    if (green) {
      const lessonDraft = makeLesson(item, fix, verdicts);
      const lessonId = deps.store.appendLesson(lessonDraft);
      deps.committer.commit(item, verdicts, lessonId);
      const doneState = verdicts.some((v) => v.kind === 'parity' && v.status === 'pass')
        ? 'done:parity'
        : 'done:type';
      deps.picker.setStatus(item.id, doneState);
      deps.retry.reset(item.id);
      done.push(item.id);
    } else {
      diagnoseFirst(verdicts);
      deps.retry.recordAttempt(item, verdicts);
      if (deps.retry.shouldRetry(item, verdicts)) {
        deps.picker.setStatus(item.id, 'open');
        continue;
      }
      writeBlocked(item, verdicts, blockedDir);
      deps.picker.setStatus(item.id, 'blocked');
      blocked.push(item.id);
    }
  }

  return { done, blocked };
}
