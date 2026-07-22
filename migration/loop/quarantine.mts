import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { execFileSync } from 'node:child_process';
import { LESSON_STATUS } from './contracts.ts';

export interface QuarantineOptions {
  repoRoot: string;
  lessonStatusPath?: string;
}

function runGit(repoRoot: string, args: string[]): string {
  return execFileSync('git', args, { cwd: repoRoot, encoding: 'utf8' });
}

/** Find lesson ids whose commits touched a file (via applied-lesson trailer). */
export function lessonsTouchingFile(repoRoot: string, filePath: string): string[] {
  const log = runGit(repoRoot, [
    'log',
    '--all',
    '--grep=applied-lesson:',
    '--format=%H',
  ]);
  const ids = new Set<string>();
  for (const hash of log.split(/\r?\n/)) {
    if (!hash.trim()) continue;
    const show = runGit(repoRoot, ['show', '--name-only', '--format=', hash]);
    if (!show.split(/\r?\n/).includes(filePath)) continue;
    const body = runGit(repoRoot, ['log', '-1', '--format=%B', hash]);
    const m = /applied-lesson: ([0-9a-f]{8}|none)/.exec(body);
    if (m && m[1] !== 'none') ids.add(m[1]!);
  }
  return [...ids];
}

export function writeLessonStatus(
  path: string,
  id: string,
  status: string | null,
): void {
  mkdirSync(dirname(path), { recursive: true });
  if (status === null) {
    appendFileSync(path, `${JSON.stringify({ id, status: null, demoted: true })}\n`);
  } else {
    appendFileSync(path, `${JSON.stringify({ id, status })}\n`);
  }
}

/** On regression: mark touching lessons suspect; demote promoted champions. */
export function quarantineOnRegression(
  options: QuarantineOptions,
  residueId: string,
  touchedFile: string,
): string[] {
  const statusPath =
    options.lessonStatusPath ??
    `${options.repoRoot}/migration/lesson-status.jsonl`;
  const lessonIds = lessonsTouchingFile(options.repoRoot, touchedFile);
  const quarantined: string[] = [];

  for (const id of lessonIds) {
    writeLessonStatus(statusPath, id, LESSON_STATUS.SUSPECT);
    writeLessonStatus(statusPath, id, null);
    quarantined.push(id);
  }

  if (lessonIds.length === 0) {
    console.error(`[quarantine] no lessons found for regression on ${residueId} (${touchedFile})`);
  }

  return quarantined;
}
