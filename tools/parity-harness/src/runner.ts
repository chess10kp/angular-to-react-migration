// Drive one ParityCase against both workbenches in lockstep, capture observations at
// each checkpoint, check the authored contract on BOTH sides, and diff the target
// (React) against the baseline (Angular). Source-as-oracle + explicit contract.
import type { ParityAdapter } from './adapter.js'
import type { StyleProbe } from './observe.js'
import { findTarget } from './observe.js'
import { checkContract, type ContractViolation } from './contract.js'
import { diffObservations } from './diff.js'
import { triggerResize } from './dom-env.js'
import {
  BaselineStore,
  HARNESS_VERSION,
  baselineKey,
  hashString,
  type BaselineKeyParts,
  type BaselineRecord,
} from './baseline.js'
import type { Divergence, Observation, ParityCase, Step } from './types.js'

export interface UnitDefinition {
  angular: ParityAdapter
  react: ParityAdapter
  /** Style probes captured at every checkpoint. */
  styleProbes?: StyleProbe[]
  /** Hashes for baseline invalidation. */
  keyParts: BaselineKeyParts
}

export interface ParityResult {
  unitId: string
  caseId: string
  accepted: boolean
  checkpoints: string[]
  angularContract: ContractViolation[]
  reactContract: ContractViolation[]
  divergences: Divergence[]
  counterexample: Divergence | null
  baselineDrift: Divergence[]
  baseline: { key: string; path: string | null; reused: boolean }
  reasons: string[]
}

async function applyStep(adapter: ParityAdapter, step: Step): Promise<void> {
  const root = adapter.root()
  switch (step.action) {
    case 'setInputs':
      await adapter.setInputs(step.inputs)
      break
    case 'click': {
      const el = findTarget(root, step)
      if (el) (el as HTMLElement).dispatchEvent(new (root.ownerDocument.defaultView as any).MouseEvent('click', { bubbles: true }))
      await adapter.settle()
      break
    }
    case 'fill': {
      const el = findTarget(root, { selector: step.selector }) as HTMLInputElement | null
      if (el) {
        el.value = step.value
        el.dispatchEvent(new (root.ownerDocument.defaultView as any).Event('input', { bubbles: true }))
      }
      await adapter.settle()
      break
    }
    case 'press': {
      const el = (step.selector ? findTarget(root, { selector: step.selector }) : root.ownerDocument.activeElement) as HTMLElement | null
      el?.dispatchEvent(new (root.ownerDocument.defaultView as any).KeyboardEvent('keydown', { key: step.key, bubbles: true }))
      await adapter.settle()
      break
    }
    case 'resize':
      triggerResize(root, step.selector, step.width, step.height)
      await adapter.settle()
      break
    case 'advanceClock':
      await new Promise((r) => setTimeout(r, step.ms))
      await adapter.settle()
      break
    case 'waitForSettle':
      await adapter.settle()
      break
    case 'checkpoint':
      // handled by the runner (needs both adapters)
      break
  }
}

export async function runParityCase(pcase: ParityCase, unit: UnitDefinition, store?: BaselineStore): Promise<ParityResult> {
  const { angular, react, styleProbes } = unit
  const caseHash = hashString(JSON.stringify(pcase))
  const key = baselineKey(unit.keyParts)

  const angularObs: Observation[] = []
  const reactObs: Observation[] = []
  const angularContract: ContractViolation[] = []
  const reactContract: ContractViolation[] = []
  const divergences: Divergence[] = []
  const checkpoints: string[] = []

  await angular.mount(pcase.initialInputs ?? {})
  await react.mount(pcase.initialInputs ?? {})

  for (const step of pcase.steps) {
    if (step.action === 'checkpoint') {
      checkpoints.push(step.name)
      const a = angular.observe(step.name, styleProbes)
      const r = react.observe(step.name, styleProbes)
      angularObs.push(a)
      reactObs.push(r)
      const expected = pcase.expected?.[step.name]
      if (expected) {
        angularContract.push(...checkContract(a, expected))
        reactContract.push(...checkContract(r, expected))
      }
      divergences.push(...diffObservations(a, r, pcase.policy))
    } else {
      await applyStep(angular, step)
      await applyStep(react, step)
    }
  }

  await angular.dispose()
  await react.dispose()

  // Baseline persistence & drift check (source commit / hashes gate re-record).
  let baselinePath: string | null = null
  let reused = false
  const baselineDrift: Divergence[] = []
  if (store) {
    const existing = store.load(pcase.unitId, pcase.caseId, key)
    if (existing) {
      reused = true
      existing.observations.forEach((prev, i) => {
        if (angularObs[i]) baselineDrift.push(...diffObservations(prev, angularObs[i], pcase.policy))
      })
    } else {
      const record: BaselineRecord = {
        key,
        keyParts: { ...unit.keyParts, harnessVersion: HARNESS_VERSION },
        observations: angularObs,
      }
      baselinePath = store.save(pcase.unitId, pcase.caseId, record)
    }
  }

  const reasons: string[] = []
  if (angularContract.length) reasons.push(`baseline (Angular) violates contract: ${angularContract.length}`)
  if (reactContract.length) reasons.push(`target (React) violates contract: ${reactContract.length}`)
  if (divergences.length) reasons.push(`target diverges from baseline: ${divergences.length}`)
  if (baselineDrift.length) reasons.push(`baseline drift vs cached recording: ${baselineDrift.length}`)

  void caseHash
  const accepted = reasons.length === 0
  return {
    unitId: pcase.unitId,
    caseId: pcase.caseId,
    accepted,
    checkpoints,
    angularContract,
    reactContract,
    divergences,
    counterexample: divergences[0] ?? null,
    baselineDrift,
    baseline: { key, path: baselinePath, reused },
    reasons,
  }
}
