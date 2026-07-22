import { appendFileSync, mkdirSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import type {
  ContextStore,
  FactProposal,
  Lesson,
  ResidueItem,
  RetrievedContext,
} from './contracts.ts';
import { LESSON_STATUS } from './contracts.ts';

export interface ContextStoreOptions {
  repoRoot: string;
  lessonsPath?: string;
  lessonStatusPath?: string;
  factsPath?: string;
  factsProposalsPath?: string;
}

function lessonId(category: string, fixShape: string, after: string): string {
  return createHash('sha256')
    .update(`${category}${fixShape}${after}`)
    .digest('hex')
    .slice(0, 8);
}

function loadJsonl<T>(path: string): T[] {
  try {
    const text = readFileSync(path, 'utf8').trim();
    if (!text) return [];
    return text.split(/\r?\n/).map((line) => JSON.parse(line) as T);
  } catch {
    return [];
  }
}

function loadStatusMap(path: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const row of loadJsonl<{ id: string; status: string }>(path)) {
    map.set(row.id, row.status);
  }
  return map;
}

function grepFacts(category: string | undefined, factsMd: string, proposalsPath: string): string[] {
  if (!category) return [];
  const hits: string[] = [];
  const needle = category.toLowerCase();
  for (const line of factsMd.split(/\r?\n/)) {
    if (line.toLowerCase().includes(needle)) hits.push(line.trim());
  }
  for (const row of loadJsonl<{ category?: string; text: string }>(proposalsPath)) {
    if (row.category === category || row.text.toLowerCase().includes(needle)) {
      hits.push(`[unverified] ${row.text}`);
    }
  }
  return hits;
}

export class JsonlContextStore implements ContextStore {
  private readonly lessonsPath: string;
  private readonly lessonStatusPath: string;
  private readonly factsPath: string;
  private readonly factsProposalsPath: string;

  constructor(options: ContextStoreOptions) {
    const root = options.repoRoot;
    this.lessonsPath = join(root, options.lessonsPath ?? 'migration/lessons.jsonl');
    this.lessonStatusPath = join(
      root,
      options.lessonStatusPath ?? 'migration/lesson-status.jsonl',
    );
    this.factsPath = join(root, options.factsPath ?? 'migration/facts.md');
    this.factsProposalsPath = join(
      root,
      options.factsProposalsPath ?? 'migration/facts-proposals.jsonl',
    );
  }

  private readLessons(): Lesson[] {
    return loadJsonl<Lesson>(this.lessonsPath);
  }

  retrieve(item: ResidueItem): RetrievedContext {
    const category = item.category ?? '';
    const fixShape = item.fix_shape ?? '';
    const statusMap = loadStatusMap(this.lessonStatusPath);

    const matching = this.readLessons().filter(
      (l) => l.category === category && l.fix_shape === fixShape,
    );

    let champion: Lesson | null = null;
    const challengers: Lesson[] = [];

    for (const lesson of matching) {
      const status = statusMap.get(lesson.id);
      if (status === LESSON_STATUS.PROMOTED) {
        champion = lesson;
      } else {
        challengers.push(lesson);
      }
    }

    const newestChallengers = challengers.slice(-3).reverse();

    let factsMd = '';
    try {
      factsMd = readFileSync(this.factsPath, 'utf8');
    } catch {
      factsMd = '';
    }

    const facts = grepFacts(category, factsMd, this.factsProposalsPath);

    const hasPromotedForShape = matching.some(
      (l) => statusMap.get(l.id) === LESSON_STATUS.PROMOTED,
    );
    const needsFirstReview = !hasPromotedForShape && matching.length === 0;

    return {
      champion,
      challengers: newestChallengers,
      facts,
      needsFirstReview,
    };
  }

  appendLesson(l: Omit<Lesson, 'id'> & { id?: string; status?: string }): string {
    if ('status' in l && (l as { status?: string }).status !== undefined) {
      throw new Error('appendLesson: status field forbidden (sidecar-only)');
    }
    if (!l.evidence?.counterexample?.trim()) {
      throw new Error('appendLesson: evidence.counterexample is required');
    }

    const id = l.id ?? lessonId(l.category, l.fix_shape, l.after);
    const lesson: Lesson = { ...l, id };
    mkdirSync(dirname(this.lessonsPath), { recursive: true });
    appendFileSync(this.lessonsPath, `${JSON.stringify(lesson)}\n`);
    return id;
  }

  appendFactProposal(f: FactProposal): void {
    mkdirSync(dirname(this.factsProposalsPath), { recursive: true });
    appendFileSync(
      this.factsProposalsPath,
      `${JSON.stringify({ ...f, label: 'unverified', at: new Date().toISOString() })}\n`,
    );
  }
}
