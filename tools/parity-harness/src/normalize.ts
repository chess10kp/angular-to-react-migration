// Normalize observations under a DiffPolicy so semantically-equal runs compare equal
// regardless of framework-specific structure or incidental ordering.
import type { DiffPolicy, DomainEvent, NetworkCall, Observation } from './types.js'

export const DEFAULT_CHANNELS: (keyof Observation)[] = [
  'aria',
  'visibleText',
  'focus',
  'events',
  'network',
  'styles',
  'consoleErrors',
]

function stableEventKey(e: DomainEvent): string {
  return `${e.name}:${JSON.stringify(e.payload ?? null)}`
}
function stableNetKey(n: NetworkCall): string {
  return `${n.method} ${n.path}?${JSON.stringify(n.query ?? {})}`
}

export function normalize(obs: Observation, policy: DiffPolicy = {}): Observation {
  const out: Observation = {
    ...obs,
    events: [...obs.events],
    network: [...obs.network],
    aria: [...obs.aria],
    styles: { ...obs.styles },
  }

  if (policy.looseText) {
    out.visibleText = out.visibleText.toLowerCase()
    out.aria = out.aria.map((n) => ({ role: n.role, name: n.name.toLowerCase() }))
  }

  if (!policy.orderMatters) {
    out.events.sort((a, b) => stableEventKey(a).localeCompare(stableEventKey(b)))
    out.network.sort((a, b) => stableNetKey(a).localeCompare(stableNetKey(b)))
  }

  if (policy.ignoreStyleKeys?.length) {
    for (const k of policy.ignoreStyleKeys) delete out.styles[k]
  }

  return out
}
