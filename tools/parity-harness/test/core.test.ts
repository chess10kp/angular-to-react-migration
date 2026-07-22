import { describe, expect, it } from 'vitest'
import { validateParityCase } from '../src/validate.js'
import { diffObservations } from '../src/diff.js'
import { checkContract } from '../src/contract.js'
import { evaluateGate } from '../src/gate.js'
import { baselineKey } from '../src/baseline.js'
import type { Observation, ParityCase } from '../src/types.js'

const obs = (over: Partial<Observation> = {}): Observation => ({
  checkpoint: 'c',
  aria: [{ role: 'status', name: 'Showing 1–10 of 25' }],
  visibleText: 'Showing 1–10 of 25',
  focus: null,
  events: [{ name: 'itemCountRendered', payload: { start: 1, end: 10, total: 25 } }],
  network: [],
  styles: {},
  consoleErrors: [],
  ...over,
})

describe('validateParityCase', () => {
  it('accepts a well-formed case', () => {
    const c: ParityCase = {
      schemaVersion: '1.0.0',
      unitId: 'X',
      caseId: 'a',
      steps: [{ action: 'checkpoint', name: 'c1' }],
    }
    expect(validateParityCase(c).ok).toBe(true)
  })

  it('rejects a case with no checkpoint and a dangling expected key', () => {
    const r = validateParityCase({
      schemaVersion: '1.0.0',
      unitId: 'X',
      caseId: 'a',
      steps: [{ action: 'waitForSettle' }],
      expected: { ghost: { visibleText: ['x'] } },
    })
    expect(r.ok).toBe(false)
    expect(r.errors.join()).toMatch(/checkpoint/)
    expect(r.errors.join()).toMatch(/expected.ghost/)
  })
})

describe('diffObservations', () => {
  it('finds no divergence for identical observations', () => {
    expect(diffObservations(obs(), obs())).toEqual([])
  })

  it('surfaces the first divergent channel as a counterexample', () => {
    const d = diffObservations(obs(), obs({ visibleText: 'Showing 1–10 of 26' }))
    expect(d[0].channel).toBe('visibleText')
    expect(d[0].baseline).toBe('Showing 1–10 of 25')
    expect(d[0].candidate).toBe('Showing 1–10 of 26')
  })

  it('is order-insensitive for events by default', () => {
    const a = obs({ events: [{ name: 'a', payload: 1 }, { name: 'b', payload: 2 }] })
    const b = obs({ events: [{ name: 'b', payload: 2 }, { name: 'a', payload: 1 }] })
    expect(diffObservations(a, b)).toEqual([])
  })
})

describe('checkContract', () => {
  it('passes when text and event assertions hold', () => {
    expect(
      checkContract(obs(), {
        visibleText: ['Showing 1–10'],
        events: [{ name: 'itemCountRendered', payloadContains: { total: 25 } }],
      }),
    ).toEqual([])
  })
  it('reports a missing visible-text needle', () => {
    const v = checkContract(obs(), { visibleText: ['Zeige'] })
    expect(v).toHaveLength(1)
  })
})

describe('evaluateGate', () => {
  const inv = { unitId: 'X', inputs: ['page', 'total'], outputs: ['rendered'] }
  it('accepts when every member is covered', () => {
    const cases: ParityCase[] = [
      {
        schemaVersion: '1.0.0',
        unitId: 'X',
        caseId: 'a',
        initialInputs: { page: 1, total: 5 },
        steps: [{ action: 'checkpoint', name: 'c' }],
        expected: { c: { events: [{ name: 'rendered' }] } },
      },
    ]
    const r = evaluateGate({ inventory: inv, cases, residueClear: true, typechecks: true, mounts: true, allCasesAccepted: true })
    expect(r.accepted).toBe(true)
  })
  it('blocks on an unclassified input', () => {
    const cases: ParityCase[] = [
      { schemaVersion: '1.0.0', unitId: 'X', caseId: 'a', initialInputs: { page: 1 }, steps: [{ action: 'checkpoint', name: 'c' }] },
    ]
    const r = evaluateGate({ inventory: inv, cases })
    expect(r.accepted).toBe(false)
    expect(r.unclassified).toContain('total')
    expect(r.unclassified).toContain('rendered')
  })
})

describe('baselineKey', () => {
  it('changes when any part changes', () => {
    const base = { sourceCommit: 'a', componentHash: 'b', caseHash: 'c', fixtureHash: 'd' }
    const k1 = baselineKey(base)
    const k2 = baselineKey({ ...base, componentHash: 'CHANGED' })
    expect(k1).not.toBe(k2)
  })
})
