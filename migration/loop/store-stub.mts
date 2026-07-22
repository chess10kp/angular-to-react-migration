import { appendFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname } from 'node:path';
import type {
  ContextStore,
  FactProposal,
  Lesson,
  ResidueItem,
  RetrievedContext,
} from './contracts.ts';

function lessonId(category: string, fixShape: string, after: string): string {
  return createHash('sha256')
    .update(`${category}${fixShape}${after}`)
    .digest('hex')
    .slice(0, 8);
}

export interface StubContextStoreOptions {
  lessonsPath?: string;
}

/** C-L2 stub — replaced by store.mts in C-L3. */
export class StubContextStore implements ContextStore {
  private lessons: Lesson[] = [];

  constructor(private readonly options: StubContextStoreOptions = {}) {}

  retrieve(_item: ResidueItem): RetrievedContext {
    return { champion: null, challengers: [], facts: [] };
  }

  appendLesson(l: Omit<Lesson, 'id'> & { id?: string }): string {
    const id = l.id ?? lessonId(l.category, l.fix_shape, l.after);
    const lesson: Lesson = { ...l, id };
    this.lessons.push(lesson);
    if (this.options.lessonsPath) {
      mkdirSync(dirname(this.options.lessonsPath), { recursive: true });
      appendFileSync(this.options.lessonsPath, `${JSON.stringify(lesson)}\n`);
    }
    return id;
  }

  appendFactProposal(_f: FactProposal): void {
    // no-op in stub
  }

  /** Test helper */
  allLessons(): Lesson[] {
    return [...this.lessons];
  }
}

/** Alias for tests and config. */
export { StubContextStore as StoreStub };
