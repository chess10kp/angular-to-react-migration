// The workbench contract. In this Node slice each adapter mounts a real component
// into one shared jsdom DOM; in a browser deployment the identical shape is what
// `window.__parity` would expose per framework. The runner only ever talks to this.
import type { DomainEvent, Inputs, Observation } from './types.js'
import type { StyleProbe } from './observe.js'

export type EventSink = (event: DomainEvent) => void

export interface ParityAdapter {
  readonly framework: 'angular' | 'react'
  /** Mount the unit with its initial inputs. */
  mount(inputs: Inputs): Promise<void>
  /** Change inputs/props. */
  setInputs(inputs: Inputs): Promise<void>
  /** Block until the framework has finished all pending work. */
  settle(): Promise<void>
  /** Flush and clear domain events emitted since the last drain. */
  drainEvents(): DomainEvent[]
  /** The mounted subtree root, for observation. */
  root(): Element
  /** Capture an observation at a named checkpoint. */
  observe(checkpoint: string, styleProbes?: StyleProbe[]): Observation
  /** Teardown; must run cleanup/lifecycle-destroy hooks. */
  dispose(): Promise<void>
}
