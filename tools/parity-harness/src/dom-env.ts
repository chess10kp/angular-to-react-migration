// Shared jsdom + framework-runtime bootstrap. Both workbenches (Angular, React) run
// against ONE real DOM in Node, so no browser binary is required for the vertical
// slice. The same adapter contract can later be re-hosted on Playwright + real
// dev servers with zero changes to the runner/diff/baseline layers.
import { JSDOM } from 'jsdom'

let installed = false

/** Elements → their ResizeObserver callbacks, so the harness can drive `resize`. */
const resizeRegistry = new Map<Element, Set<(rect: DOMRectReadOnly) => void>>()

export interface ConsoleCapture {
  errors: string[]
  restore(): void
}

/** Install jsdom globals + a controllable ResizeObserver. Idempotent. */
export function installDomEnv(): void {
  if (installed) return
  const dom = new JSDOM('<!doctype html><html><body></body></html>', {
    url: 'http://localhost/',
    pretendToBeVisual: true,
  })
  const w = dom.window as unknown as Record<string, unknown>
  const g = globalThis as unknown as Record<string, unknown>
  g.window = w
  const defineFromWindow = (key: string) =>
    Object.defineProperty(globalThis, key, { value: w[key], configurable: true })
  for (const key of [
    'document',
    'navigator',
    'HTMLElement',
    'Element',
    'Node',
    'Text',
    'Event',
    'CustomEvent',
    'MutationObserver',
    'DOMRectReadOnly',
  ]) {
    if (w[key] !== undefined) defineFromWindow(key)
  }
  g.getComputedStyle = (dom.window.getComputedStyle as (...a: unknown[]) => unknown).bind(dom.window)
  // Opt into React's act() testing environment so effect flushing is deterministic.
  g.IS_REACT_ACT_ENVIRONMENT = true

  // Controllable ResizeObserver — jsdom ships none. Each instance tracks the exact
  // callbacks it registered so disconnect()/unobserve() detach cleanly (teardown
  // must be observable: a destroyed component stops receiving resizes).
  class HarnessResizeObserver {
    private mine: { el: Element; cb: (rect: DOMRectReadOnly) => void }[] = []
    constructor(private cb: (entries: { target: Element; contentRect: DOMRectReadOnly }[]) => void) {}
    observe(el: Element) {
      const fn = (rect: DOMRectReadOnly) => this.cb([{ target: el, contentRect: rect }])
      const set = resizeRegistry.get(el) ?? new Set()
      set.add(fn)
      resizeRegistry.set(el, set)
      this.mine.push({ el, cb: fn })
    }
    unobserve(el: Element) {
      for (const m of this.mine.filter((m) => m.el === el)) resizeRegistry.get(el)?.delete(m.cb)
      this.mine = this.mine.filter((m) => m.el !== el)
    }
    disconnect() {
      for (const m of this.mine) resizeRegistry.get(m.el)?.delete(m.cb)
      this.mine = []
    }
  }
  g.ResizeObserver = HarnessResizeObserver as unknown

  installed = true
}

/** Fire a resize on the first element matching `selector` (or the root). */
export function triggerResize(root: Element, selector: string | undefined, width: number, height: number): void {
  const el = selector ? root.querySelector(selector) ?? root : root
  const target = el as Element
  const rect = { width, height, top: 0, left: 0, right: width, bottom: height, x: 0, y: 0 } as DOMRectReadOnly
  // element itself may be observed, or an ancestor host
  for (const [observed, cbs] of resizeRegistry) {
    if (observed === target || observed.contains(target) || target.contains(observed)) {
      for (const cb of cbs) cb(rect)
    }
  }
}

/** Load zone.js + the Angular JIT compiler exactly once, in the right order. */
export async function ensureAngularRuntime(): Promise<void> {
  installDomEnv()
  await import('reflect-metadata')
  await import('zone.js')
  await import('@angular/compiler')
}

// Node/loader infrastructure noise that is not an application console error.
const INFRA_NOISE = /DeprecationWarning|ExperimentalWarning|module\.register|--trace-deprecation/

/** Capture console.error/console.warn into a buffer for the current checkpoint window. */
export function captureConsole(): ConsoleCapture {
  const errors: string[] = []
  const origErr = console.error
  const origWarn = console.warn
  console.error = (...a: unknown[]) => {
    const msg = a.map(String).join(' ')
    if (INFRA_NOISE.test(msg)) return origErr(...a)
    errors.push('error: ' + msg)
  }
  console.warn = (...a: unknown[]) => {
    const msg = a.map(String).join(' ')
    if (INFRA_NOISE.test(msg)) return origWarn(...a)
    errors.push('warn: ' + msg)
  }
  return {
    errors,
    restore() {
      console.error = origErr
      console.warn = origWarn
    },
  }
}

/** Small real-time settle: drain microtasks + a couple of macro ticks. */
export async function microSettle(ticks = 2): Promise<void> {
  for (let i = 0; i < ticks; i++) await new Promise((r) => setTimeout(r, 0))
}
