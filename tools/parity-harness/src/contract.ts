// Check one Observation against the authored contract (ExpectedAtCheckpoint).
// This is the "did the author's explicit assertions hold" gate, run on BOTH sides.
import type { ExpectedAtCheckpoint, Observation } from './types.js'

export interface ContractViolation {
  checkpoint: string
  message: string
}

function payloadContains(actual: unknown, expected: Record<string, unknown>): boolean {
  if (typeof actual !== 'object' || actual === null) return false
  const a = actual as Record<string, unknown>
  return Object.entries(expected).every(([k, v]) => JSON.stringify(a[k]) === JSON.stringify(v))
}

export function checkContract(obs: Observation, expected: ExpectedAtCheckpoint): ContractViolation[] {
  const v: ContractViolation[] = []
  const fail = (m: string) => v.push({ checkpoint: obs.checkpoint, message: m })

  for (const needle of expected.visibleText ?? []) {
    if (!obs.visibleText.includes(needle))
      fail(`visibleText missing "${needle}" (got "${obs.visibleText}")`)
  }

  for (const a of expected.aria ?? []) {
    const matches = obs.aria.filter(
      (n) =>
        n.role === a.role &&
        (a.name === undefined || n.name === a.name) &&
        (a.contains === undefined || n.name.includes(a.contains)),
    )
    if (a.count !== undefined) {
      if (matches.length !== a.count)
        fail(`aria role=${a.role} expected count ${a.count}, got ${matches.length}`)
    } else if (matches.length === 0) {
      fail(`aria role=${a.role}${a.name ? ` name="${a.name}"` : ''} not found`)
    }
  }

  for (const e of expected.events ?? []) {
    const match = obs.events.find(
      (ev) => ev.name === e.name && (!e.payloadContains || payloadContains(ev.payload, e.payloadContains)),
    )
    if (!match) fail(`event "${e.name}" not emitted`)
  }

  for (const s of expected.styles ?? []) {
    const key = `${s.selector}|${s.prop}`
    if (obs.styles[key] !== s.value)
      fail(`style ${key} expected "${s.value}", got "${obs.styles[key] ?? '<none>'}"`)
  }

  if (expected.noConsoleErrors !== false && obs.consoleErrors.length > 0)
    fail(`console errors: ${obs.consoleErrors.join(' | ')}`)

  return v
}
