import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { AngularAdapter } from '../src/adapters/angular.js'
import { ReactAdapter } from '../src/adapters/react.tsx'
import { runParityCase, type UnitDefinition } from '../src/runner.js'
import { BaselineStore, hashString } from '../src/baseline.js'
import { assertParityCase } from '../src/validate.js'
import { ItemCountComponent } from '../units/item-count/angular.js'
import { ItemCount } from '../units/item-count/react.tsx'

const here = new URL('.', import.meta.url).pathname
const caseJson = JSON.parse(readFileSync(join(here, '../units/item-count/case.last-page.json'), 'utf8'))

function makeUnit(): UnitDefinition {
  const componentHash = hashString(
    readFileSync(join(here, '../units/item-count/angular.ts'), 'utf8') +
      readFileSync(join(here, '../units/item-count/react.tsx'), 'utf8'),
  )
  return {
    angular: new AngularAdapter(ItemCountComponent),
    react: new ReactAdapter(ItemCount as never),
    keyParts: {
      sourceCommit: 'test',
      componentHash,
      caseHash: hashString(JSON.stringify(caseJson)),
      fixtureHash: 'none',
    },
  }
}

describe('ItemCount parity (real Angular vs real React)', () => {
  it('the case validates', () => {
    expect(() => assertParityCase(caseJson)).not.toThrow()
  })

  it('accepts the React port: contract green on both sides and zero divergence', async () => {
    const pcase = assertParityCase(caseJson)
    const store = new BaselineStore(mkdtempSync(join(tmpdir(), 'parity-')))

    const result = await runParityCase(pcase, makeUnit(), store)

    expect(result.angularContract).toEqual([])
    expect(result.reactContract).toEqual([])
    expect(result.divergences).toEqual([])
    expect(result.counterexample).toBeNull()
    expect(result.checkpoints).toEqual(['after-mount', 'first-page', 'empty', 'translated'])
    expect(result.baseline.reused).toBe(false)
    expect(result.accepted).toBe(true)

    // Second run against the same store reuses the recorded baseline with no drift.
    const rerun = await runParityCase(pcase, makeUnit(), store)
    expect(rerun.baseline.reused).toBe(true)
    expect(rerun.baselineDrift).toEqual([])
    expect(rerun.accepted).toBe(true)
  })

  it('catches a real regression: a broken React port diverges from the Angular baseline', async () => {
    const pcase = assertParityCase(caseJson)
    // Inject a bug: React uses inclusive end (off-by-one) — a classic migration slip.
    function BuggyItemCount(props: Record<string, unknown>) {
      const good = ItemCount as unknown as (p: Record<string, unknown>) => unknown
      return good({ ...props, total: (props.total as number) + 0, pageSize: (props.pageSize as number) + 1 })
    }
    const unit = makeUnit()
    unit.react = new ReactAdapter(BuggyItemCount as never)

    const result = await runParityCase(pcase, unit)
    expect(result.accepted).toBe(false)
    expect(result.counterexample).not.toBeNull()
    // First checkpoint where they disagree is the visible text range.
    expect(result.counterexample!.channel).toBe('aria')
    expect(result.reasons.join()).toMatch(/diverges from baseline/)
  })
})
