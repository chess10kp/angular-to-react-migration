// Zero-dependency structural validator for ParityCase, in the same spirit as
// migration/validate.mjs. Not a full JSON-Schema engine — just the invariants the
// runner relies on, with precise error paths.
import type { ParityCase, Step } from './types.js'

const STEP_ACTIONS = new Set([
  'setInputs',
  'click',
  'fill',
  'press',
  'resize',
  'advanceClock',
  'waitForSettle',
  'checkpoint',
])

export interface ValidationResult {
  ok: boolean
  errors: string[]
}

export function validateParityCase(value: unknown): ValidationResult {
  const errors: string[] = []
  const push = (p: string, m: string) => errors.push(`${p}: ${m}`)

  if (typeof value !== 'object' || value === null) {
    return { ok: false, errors: ['<root>: expected object'] }
  }
  const c = value as Record<string, unknown>

  if (c.schemaVersion !== '1.0.0') push('schemaVersion', 'must be "1.0.0"')
  if (typeof c.unitId !== 'string' || !c.unitId) push('unitId', 'required non-empty string')
  if (typeof c.caseId !== 'string' || !/^[a-z0-9][a-z0-9.-]*$/.test(c.caseId as string))
    push('caseId', 'required kebab/dot slug')

  if (!Array.isArray(c.steps) || c.steps.length === 0) {
    push('steps', 'required non-empty array')
  } else {
    const checkpoints = new Set<string>()
    c.steps.forEach((s, i) => {
      const step = s as Step & Record<string, unknown>
      if (!STEP_ACTIONS.has(step.action as string)) {
        push(`steps[${i}].action`, `unknown action "${step.action}"`)
        return
      }
      if (step.action === 'checkpoint') {
        if (typeof step.name !== 'string' || !step.name)
          push(`steps[${i}].name`, 'checkpoint requires a name')
        else checkpoints.add(step.name)
      }
      if (step.action === 'setInputs' && (typeof step.inputs !== 'object' || step.inputs === null))
        push(`steps[${i}].inputs`, 'setInputs requires inputs object')
      if (step.action === 'resize' && (typeof step.width !== 'number' || typeof step.height !== 'number'))
        push(`steps[${i}]`, 'resize requires numeric width and height')
    })
    if (checkpoints.size === 0) push('steps', 'at least one checkpoint step is required')

    // Every expected key must correspond to a declared checkpoint.
    if (c.expected && typeof c.expected === 'object') {
      for (const k of Object.keys(c.expected as object))
        if (!checkpoints.has(k)) push(`expected.${k}`, 'no matching checkpoint step')
    }
  }

  return { ok: errors.length === 0, errors }
}

export function assertParityCase(value: unknown): ParityCase {
  const { ok, errors } = validateParityCase(value)
  if (!ok) throw new Error('Invalid ParityCase:\n  ' + errors.join('\n  '))
  return value as ParityCase
}
