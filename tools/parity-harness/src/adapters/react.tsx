// React workbench adapter. Mounts a real React component into the shared jsdom DOM
// with createRoot and re-renders on input changes. The unit receives an `onEvent`
// prop it calls to emit domain events — the React-side analogue of the Angular sink.
import * as React from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { ParityAdapter } from '../adapter.js'
import type { DomainEvent, Inputs, Observation } from '../types.js'
import type { StyleProbe } from '../observe.js'
import { captureObservation } from '../observe.js'
import { captureConsole, microSettle } from '../dom-env.js'

export type ReactUnit = React.ComponentType<Record<string, unknown> & { onEvent?: (e: DomainEvent) => void }>

export class ReactAdapter implements ParityAdapter {
  readonly framework = 'react' as const
  private host!: HTMLElement
  private reactRoot!: Root
  private props: Inputs = {}
  private events: DomainEvent[] = []
  private console = { errors: [] as string[], restore() {} }
  private consoleCursor = 0

  constructor(private Component: ReactUnit) {}

  private async render(): Promise<void> {
    const onEvent = (e: DomainEvent) => this.events.push(e)
    const element = React.createElement(this.Component, { ...this.props, onEvent })
    // act() flushes render + passive effects synchronously; without it a component
    // whose effect never triggers a re-render (e.g. sets up a ResizeObserver) would
    // never have its effect run under jsdom.
    await React.act(() => {
      this.reactRoot.render(element)
    })
  }

  async mount(inputs: Inputs): Promise<void> {
    this.host = document.createElement('div')
    this.host.setAttribute('data-parity-host', 'react')
    document.body.appendChild(this.host)
    this.console = captureConsole()
    this.reactRoot = createRoot(this.host)
    this.props = { ...inputs }
    await this.render()
    await this.settle()
  }

  async setInputs(inputs: Inputs): Promise<void> {
    this.props = { ...this.props, ...inputs }
    await this.render()
    await this.settle()
  }

  async settle(): Promise<void> {
    // Passive effects already flushed inside render()'s act(); here we only give
    // real timers (debounce) a chance to run. Domain events are plain array pushes,
    // so they need no act() wrapper.
    await microSettle(3)
  }

  drainEvents(): DomainEvent[] {
    const out = this.events
    this.events = []
    return out
  }

  root(): Element {
    return this.host
  }

  observe(checkpoint: string, styleProbes?: StyleProbe[]): Observation {
    const newErrors = this.console.errors.slice(this.consoleCursor)
    this.consoleCursor = this.console.errors.length
    return captureObservation(checkpoint, this.host, {
      events: this.drainEvents(),
      network: [],
      consoleErrors: newErrors,
      styleProbes,
    })
  }

  async dispose(): Promise<void> {
    await React.act(() => {
      this.reactRoot?.unmount()
    })
    await microSettle(1)
    this.host?.remove()
    this.console.restore()
  }
}
