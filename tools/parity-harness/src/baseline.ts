// Content-addressed baseline store. The Angular run is recorded once and reused as
// React's reference. The key folds in everything whose change should invalidate the
// recording, so unrelated edits don't force a re-record.
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { Observation } from './types.js'

export const HARNESS_VERSION = '1.0.0'

export interface BaselineKeyParts {
  sourceCommit: string
  componentHash: string
  caseHash: string
  fixtureHash: string
}

export interface BaselineRecord {
  key: string
  keyParts: BaselineKeyParts & { harnessVersion: string }
  recordedAt?: string
  observations: Observation[]
}

export function hashString(s: string): string {
  return createHash('sha256').update(s).digest('hex').slice(0, 16)
}

export function baselineKey(parts: BaselineKeyParts): string {
  const material = [
    parts.sourceCommit,
    parts.componentHash,
    parts.caseHash,
    parts.fixtureHash,
    HARNESS_VERSION,
  ].join('|')
  return hashString(material)
}

export class BaselineStore {
  constructor(private dir: string) {}

  private path(unitId: string, caseId: string, key: string): string {
    return join(this.dir, unitId, `${caseId}.${key}.json`)
  }

  load(unitId: string, caseId: string, key: string): BaselineRecord | null {
    const p = this.path(unitId, caseId, key)
    if (!existsSync(p)) return null
    return JSON.parse(readFileSync(p, 'utf8')) as BaselineRecord
  }

  save(unitId: string, caseId: string, record: BaselineRecord): string {
    const p = this.path(unitId, caseId, record.key)
    mkdirSync(dirname(p), { recursive: true })
    writeFileSync(p, JSON.stringify(record, null, 2) + '\n')
    return p
  }
}
