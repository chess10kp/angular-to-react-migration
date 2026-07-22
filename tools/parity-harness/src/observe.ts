// Capture a framework-neutral Observation from a rendered DOM subtree.
// We deliberately read the accessibility tree + visible text + selected styles,
// NOT raw HTML — Angular's <app-item-count><span> and React's <div data-testid>
// are the same UX and must compare equal.
import type { AriaNode, DomainEvent, NetworkCall, Observation } from './types.js'

const ROLE_BY_TAG: Record<string, string> = {
  BUTTON: 'button',
  H1: 'heading',
  H2: 'heading',
  H3: 'heading',
  H4: 'heading',
  H5: 'heading',
  H6: 'heading',
  NAV: 'navigation',
  MAIN: 'main',
  UL: 'list',
  OL: 'list',
  LI: 'listitem',
  IMG: 'img',
}

export function roleOf(el: Element): string | null {
  const explicit = el.getAttribute('role')
  if (explicit) return explicit
  const tag = el.tagName
  if (tag === 'A' && el.hasAttribute('href')) return 'link'
  if (tag === 'INPUT') {
    const type = (el.getAttribute('type') || 'text').toLowerCase()
    if (type === 'checkbox') return 'checkbox'
    if (type === 'radio') return 'radio'
    if (type === 'button' || type === 'submit') return 'button'
    return 'textbox'
  }
  return ROLE_BY_TAG[tag] ?? null
}

export function accessibleName(el: Element): string {
  const label = el.getAttribute('aria-label')
  if (label) return label.trim()
  return collapse(el.textContent || '')
}

function collapse(s: string): string {
  return s.replace(/\s+/g, ' ').trim()
}

/** Flatten the subtree into (role, name) pairs for elements that carry a role. */
export function ariaTree(root: Element): AriaNode[] {
  const nodes: AriaNode[] = []
  const walk = (el: Element) => {
    const role = roleOf(el)
    if (role) nodes.push({ role, name: accessibleName(el) })
    for (const child of Array.from(el.children)) walk(child)
  }
  walk(root)
  return nodes
}

export interface StyleProbe {
  selector: string
  prop: string
}

/** Locate an interaction target by selector, or by accessible role/name. */
export function findTarget(
  root: Element,
  q: { role?: string; name?: string; selector?: string },
): Element | null {
  if (q.selector) return root.querySelector(q.selector)
  if (q.role) {
    for (const el of Array.from(root.querySelectorAll('*'))) {
      if (roleOf(el) === q.role && (q.name === undefined || accessibleName(el) === q.name)) return el
    }
  }
  return null
}

export function captureObservation(
  checkpoint: string,
  root: Element,
  opts: {
    events?: DomainEvent[]
    network?: NetworkCall[]
    consoleErrors?: string[]
    styleProbes?: StyleProbe[]
  } = {},
): Observation {
  const focusedEl = root.ownerDocument.activeElement
  let focus: string | null = null
  if (focusedEl && focusedEl !== root.ownerDocument.body && root.contains(focusedEl)) {
    focus = `${roleOf(focusedEl) ?? 'generic'}:${accessibleName(focusedEl)}`
  }

  const styles: Record<string, string> = {}
  for (const probe of opts.styleProbes ?? []) {
    const el = probe.selector === ':root' ? root : root.querySelector(probe.selector)
    if (el) {
      const cs = (globalThis as unknown as { getComputedStyle(e: Element): CSSStyleDeclaration }).getComputedStyle(el)
      styles[`${probe.selector}|${probe.prop}`] = collapse(cs.getPropertyValue(probe.prop) || '')
    }
  }

  return {
    checkpoint,
    aria: ariaTree(root),
    visibleText: collapse(root.textContent || ''),
    focus,
    events: opts.events ?? [],
    network: opts.network ?? [],
    styles,
    consoleErrors: opts.consoleErrors ?? [],
  }
}
