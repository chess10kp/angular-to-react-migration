// Maps a unitId to everything the runner needs: fresh adapters (Angular baseline +
// React target), the style probes to capture, its parity cases, and its I/O
// inventory for the acceptance gate. Adding a unit = adding one entry here.
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { ParityAdapter } from './adapter.js'
import type { StyleProbe } from './observe.js'
import type { ParityCase } from './types.js'
import type { IoInventory } from './gate.js'
import { AngularAdapter } from './adapters/angular.js'
import { ReactAdapter } from './adapters/react.tsx'

const unitsDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'units')

export interface UnitEntry {
  unitId: string
  dir: string
  makeAdapters(): { angular: ParityAdapter; react: ParityAdapter }
  styleProbes?: StyleProbe[]
  caseFiles: string[]
  ioFile: string
}

function loadJson<T>(p: string): T {
  return JSON.parse(readFileSync(p, 'utf8')) as T
}

export async function buildRegistry(): Promise<Record<string, UnitEntry>> {
  // Dynamic imports so @angular/core / react load only after the runtime is ready.
  const { ItemCountComponent } = await import('../units/item-count/angular.js')
  const { ItemCount } = await import('../units/item-count/react.tsx')
  const { SlotGroupComponent } = await import('../units/slot-group/angular.js')
  const { SlotGroup } = await import('../units/slot-group/react.tsx')

  const entries: UnitEntry[] = [
    {
      unitId: 'ItemCountComponent',
      dir: join(unitsDir, 'item-count'),
      makeAdapters: () => ({ angular: new AngularAdapter(ItemCountComponent), react: new ReactAdapter(ItemCount as never) }),
      caseFiles: ['case.last-page.json'],
      ioFile: 'io.json',
    },
    {
      unitId: 'SlotGroupComponent',
      dir: join(unitsDir, 'slot-group'),
      makeAdapters: () => ({ angular: new AngularAdapter(SlotGroupComponent), react: new ReactAdapter(SlotGroup as never) }),
      styleProbes: [{ selector: '[data-region="container"]', prop: 'gap' }],
      caseFiles: ['case.resize.json'],
      ioFile: 'io.json',
    },
  ]

  return Object.fromEntries(entries.map((e) => [e.unitId, e]))
}

export function unitCases(entry: UnitEntry): ParityCase[] {
  return entry.caseFiles.map((f) => loadJson<ParityCase>(join(entry.dir, f)))
}

export function unitInventory(entry: UnitEntry): IoInventory {
  return loadJson<IoInventory>(join(entry.dir, entry.ioFile))
}
