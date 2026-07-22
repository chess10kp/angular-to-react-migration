// Unit acceptance gate. "Done" is more than one green happy path: every public
// input/output/state must be covered by a case, declared irrelevant, or waived with
// a reason. This catches the "one green test, three untested inputs" trap.
import type { ParityCase } from './types.js'

export interface IoInventory {
  unitId: string
  inputs: string[]
  outputs: string[]
  state?: string[]
}

export type Classification = 'covered' | 'irrelevant' | 'waived'

export interface Waiver {
  member: string
  reason: string
}

export interface GateInput {
  inventory: IoInventory
  cases: ParityCase[]
  irrelevant?: string[]
  waivers?: Waiver[]
  /** Prerequisite signals from the rest of the pipeline. */
  residueClear?: boolean
  typechecks?: boolean
  mounts?: boolean
  allCasesAccepted?: boolean
}

export interface GateResult {
  accepted: boolean
  classification: Record<string, Classification | 'UNCLASSIFIED'>
  unclassified: string[]
  reasons: string[]
}

/** A member is "covered" if any case touches it via initialInputs, a setInputs step,
 *  an expected event, or an aria/style assertion mentioning it. */
function coveredMembers(cases: ParityCase[]): Set<string> {
  const covered = new Set<string>()
  for (const c of cases) {
    for (const k of Object.keys(c.initialInputs ?? {})) covered.add(k)
    for (const s of c.steps) {
      if (s.action === 'setInputs') for (const k of Object.keys(s.inputs)) covered.add(k)
    }
    for (const exp of Object.values(c.expected ?? {})) {
      for (const e of exp?.events ?? []) covered.add(e.name)
    }
  }
  return covered
}

export function evaluateGate(input: GateInput): GateResult {
  const covered = coveredMembers(input.cases)
  const irrelevant = new Set(input.irrelevant ?? [])
  const waived = new Set((input.waivers ?? []).map((w) => w.member))
  const members = [...input.inventory.inputs, ...input.inventory.outputs, ...(input.inventory.state ?? [])]

  const classification: Record<string, Classification | 'UNCLASSIFIED'> = {}
  const unclassified: string[] = []
  for (const m of members) {
    if (covered.has(m)) classification[m] = 'covered'
    else if (waived.has(m)) classification[m] = 'waived'
    else if (irrelevant.has(m)) classification[m] = 'irrelevant'
    else {
      classification[m] = 'UNCLASSIFIED'
      unclassified.push(m)
    }
  }

  const reasons: string[] = []
  if (input.residueClear === false) reasons.push('migration residue remains')
  if (input.typechecks === false) reasons.push('does not typecheck in React scaffold')
  if (input.mounts === false) reasons.push('does not mount standalone')
  if (input.allCasesAccepted === false) reasons.push('not all parity cases accepted')
  if (unclassified.length) reasons.push(`unclassified I/O: ${unclassified.join(', ')}`)

  return { accepted: reasons.length === 0, classification, unclassified, reasons }
}
