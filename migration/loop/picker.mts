import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { mkdirSync } from 'node:fs';
import type { ItemStatus, Picker, ResidueItem } from './contracts.ts';

export interface JsonlPickerOptions {
  residuePath: string;
  statusPath: string;
}

function loadResidue(path: string): ResidueItem[] {
  const text = readFileSync(path, 'utf8').trim();
  if (!text) return [];
  return text.split(/\r?\n/).map((line) => JSON.parse(line) as ResidueItem);
}

function loadStatusMap(path: string): Map<string, string> {
  const map = new Map<string, string>();
  try {
    const text = readFileSync(path, 'utf8').trim();
    if (!text) return map;
    for (const line of text.split(/\r?\n/)) {
      const entry = JSON.parse(line) as { id: string; status: string };
      map.set(entry.id, entry.status);
    }
  } catch {
    // no sidecar yet
  }
  return map;
}

function isDoneStatus(status: string): boolean {
  return status.startsWith('done');
}

export class JsonlPicker implements Picker {
  private readonly items: ResidueItem[];
  private statusMap: Map<string, string>;

  constructor(private readonly options: JsonlPickerOptions) {
    this.items = loadResidue(options.residuePath);
    this.statusMap = loadStatusMap(options.statusPath);
  }

  getStatus(id: string): string {
    return this.statusMap.get(id) ?? 'open';
  }

  setStatus(id: string, s: ItemStatus): void {
    this.statusMap.set(id, s);
    mkdirSync(dirname(this.options.statusPath), { recursive: true });
    appendFileSync(
      this.options.statusPath,
      `${JSON.stringify({ id, status: s, at: new Date().toISOString() })}\n`,
    );
  }

  next(): ResidueItem | null {
    this.statusMap = loadStatusMap(this.options.statusPath);
    const open = this.items
      .filter((item) => this.getStatus(item.id) === 'open')
      .filter((item) =>
        (item.deps ?? []).every((depId) => isDoneStatus(this.getStatus(depId))),
      )
      .sort((a, b) => {
        const pa = a.priority ?? Number.MAX_SAFE_INTEGER;
        const pb = b.priority ?? Number.MAX_SAFE_INTEGER;
        if (pa !== pb) return pa - pb;
        return a.id.localeCompare(b.id);
      });
    return open[0] ?? null;
  }

  /** Test helper: reset sidecar. */
  resetStatus(): void {
    this.statusMap = new Map();
    writeFileSync(this.options.statusPath, '');
  }
}
