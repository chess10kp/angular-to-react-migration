// Framework-neutral parity-harness types.
// A ParityCase describes WHAT to do and WHAT to observe for one migration unit,
// never HOW Angular or React bootstraps. Framework setup lives in the adapters.

export type Inputs = Record<string, unknown>

/** One authored behavioral test recipe, scoped to a single migration unit. */
export interface ParityCase {
  schemaVersion: '1.0.0'
  /** Migration-unit id, e.g. "ItemCountComponent". */
  unitId: string
  /** Human label for this specific case, e.g. "last-page". */
  caseId: string
  title?: string
  /** Deterministic environment knobs. */
  env?: {
    viewport?: string // "WxH"
    locale?: string
    seed?: number
  }
  /** Network-mock profile id; responses are identical on both sides. */
  fixtureProfile?: string
  /** Inputs/props to start with. */
  initialInputs?: Inputs
  /** Ordered actions applied between checkpoints. */
  steps: Step[]
  /** Explicit assertions the observation must satisfy (the contract). */
  expected?: Partial<Record<string, ExpectedAtCheckpoint>>
  /** Diff tolerance policy vs the recorded baseline. */
  policy?: DiffPolicy
}

export type Step =
  | { action: 'setInputs'; inputs: Inputs }
  | { action: 'click'; role?: string; name?: string; selector?: string }
  | { action: 'fill'; selector: string; value: string }
  | { action: 'press'; key: string; selector?: string }
  | { action: 'resize'; selector?: string; width: number; height: number }
  | { action: 'advanceClock'; ms: number }
  | { action: 'waitForSettle' }
  | { action: 'checkpoint'; name: string }

/** Contract assertions available at a checkpoint. */
export interface ExpectedAtCheckpoint {
  /** Substrings that must appear in the accessible/visible text. */
  visibleText?: string[]
  /** Accessible-tree role/name assertions. */
  aria?: { role: string; name?: string; contains?: string; count?: number }[]
  /** Domain events emitted (order-independent unless orderMatters). */
  events?: { name: string; payloadContains?: Record<string, unknown> }[]
  /** No console errors allowed when true (default true). */
  noConsoleErrors?: boolean
  /** Selected computed-style assertions: selector -> {prop: value}. */
  styles?: { selector: string; prop: string; value: string }[]
}

/** What a user can observe at a checkpoint, framework-neutral & normalized-ready. */
export interface Observation {
  checkpoint: string
  /** Flattened accessible tree. */
  aria: AriaNode[]
  /** Whole-subtree visible text, collapsed whitespace. */
  visibleText: string
  /** role+name of the focused element, or null. */
  focus: string | null
  /** Domain events drained since the previous checkpoint. */
  events: DomainEvent[]
  /** Network requests observed since the previous checkpoint. */
  network: NetworkCall[]
  /** Selected computed styles: "selector|prop" -> value. */
  styles: Record<string, string>
  /** Console error/warn messages captured since previous checkpoint. */
  consoleErrors: string[]
}

export interface AriaNode {
  role: string
  name: string
}
export interface DomainEvent {
  name: string
  payload: unknown
}
export interface NetworkCall {
  method: string
  path: string
  query?: Record<string, string>
  status?: number
}

/** Controls which observation channels participate in the diff and how strict. */
export interface DiffPolicy {
  /** Channels to compare. Default: all except screenshot. */
  channels?: (keyof Observation)[]
  /** When true, event/network order must match. */
  orderMatters?: boolean
  /** Ignore these style keys ("selector|prop"). */
  ignoreStyleKeys?: string[]
  /** Treat text differing only by whitespace/case as equal. */
  looseText?: boolean
}

/** One point where baseline and candidate disagree — the counterexample. */
export interface Divergence {
  checkpoint: string
  channel: keyof Observation
  path: string
  baseline: unknown
  candidate: unknown
  message: string
}
