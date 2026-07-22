// Compare a candidate (React) observation against a baseline (Angular) observation,
// channel by channel, returning every divergence. The runner treats the FIRST
// divergence as the counterexample handed back for repair.
import { DEFAULT_CHANNELS, normalize } from './normalize.js'
import type { DiffPolicy, Divergence, Observation } from './types.js'

function eq(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

export function diffObservations(
  baseline: Observation,
  candidate: Observation,
  policy: DiffPolicy = {},
): Divergence[] {
  const nb = normalize(baseline, policy)
  const nc = normalize(candidate, policy)
  const channels = policy.channels ?? DEFAULT_CHANNELS
  const checkpoint = baseline.checkpoint
  const out: Divergence[] = []

  const record = (channel: keyof Observation, path: string, b: unknown, c: unknown, message: string) =>
    out.push({ checkpoint, channel, path, baseline: b, candidate: c, message })

  for (const channel of channels) {
    if (channel === 'checkpoint') continue
    if (channel === 'visibleText' || channel === 'focus') {
      if (!eq(nb[channel], nc[channel]))
        record(channel, channel, nb[channel], nc[channel], `${channel} differs`)
      continue
    }
    if (channel === 'aria') {
      const bl = nb.aria
      const cl = nc.aria
      const max = Math.max(bl.length, cl.length)
      for (let i = 0; i < max; i++) {
        if (!eq(bl[i], cl[i])) {
          record('aria', `aria[${i}]`, bl[i] ?? null, cl[i] ?? null, `accessible node ${i} differs`)
          break
        }
      }
      continue
    }
    if (channel === 'events' || channel === 'network' || channel === 'consoleErrors') {
      const bl = nb[channel] as unknown[]
      const cl = nc[channel] as unknown[]
      const max = Math.max(bl.length, cl.length)
      for (let i = 0; i < max; i++) {
        if (!eq(bl[i], cl[i])) {
          record(channel, `${channel}[${i}]`, bl[i] ?? null, cl[i] ?? null, `${channel} item ${i} differs`)
          break
        }
      }
      continue
    }
    if (channel === 'styles') {
      const keys = new Set([...Object.keys(nb.styles), ...Object.keys(nc.styles)])
      for (const k of keys) {
        if (nb.styles[k] !== nc.styles[k])
          record('styles', `styles.${k}`, nb.styles[k], nc.styles[k], `computed style ${k} differs`)
      }
      continue
    }
  }
  return out
}
