// Angular workbench adapter. Mounts a real standalone Angular 17 component into the
// shared jsdom DOM via the dynamic component API and drives change detection.
import type { ApplicationRef, ComponentRef, Type } from '@angular/core'
import type { ParityAdapter } from '../adapter.js'
import type { DomainEvent, Inputs, Observation } from '../types.js'
import type { StyleProbe } from '../observe.js'
import { captureObservation } from '../observe.js'
import { captureConsole, ensureAngularRuntime, microSettle } from '../dom-env.js'

export class AngularAdapter implements ParityAdapter {
  readonly framework = 'angular' as const
  private appRef!: ApplicationRef
  private cref!: ComponentRef<unknown>
  private host!: HTMLElement
  private events: DomainEvent[] = []
  private console = { errors: [] as string[], restore() {} }
  private consoleCursor = 0

  constructor(private componentType: Type<unknown>) {}

  async mount(inputs: Inputs): Promise<void> {
    await ensureAngularRuntime()
    const { createApplication } = await import('@angular/platform-browser')
    const { createComponent } = await import('@angular/core')
    const { PARITY_EVENT_SINK: token } = await import('./angular-token.js')

    this.host = document.createElement('div')
    this.host.setAttribute('data-parity-host', 'angular')
    document.body.appendChild(this.host)

    this.console = captureConsole()
    this.appRef = await createApplication({
      providers: [{ provide: token, useValue: (e: DomainEvent) => this.events.push(e) }],
    })
    this.cref = createComponent(this.componentType, {
      environmentInjector: this.appRef.injector,
      hostElement: this.host,
    })
    this.appRef.attachView(this.cref.hostView)
    this.applyInputs(inputs)
    await this.settle()
  }

  private applyInputs(inputs: Inputs) {
    for (const [k, v] of Object.entries(inputs)) this.cref.setInput(k, v)
  }

  async setInputs(inputs: Inputs): Promise<void> {
    this.applyInputs(inputs)
    await this.settle()
  }

  async settle(): Promise<void> {
    this.appRef.tick()
    // Wait for zone stability (covers debounced rxjs timers) with a hard cap.
    await new Promise<void>((resolve) => {
      let done = false
      let sub: { unsubscribe(): void } | undefined
      const finish = () => {
        if (done) return
        done = true
        sub?.unsubscribe()
        resolve()
      }
      // BehaviorSubject may emit synchronously during subscribe(), before `sub`
      // is assigned — so unsubscribe from finish(), not from inside the callback.
      sub = this.appRef.isStable.subscribe((stable: boolean) => {
        if (stable) finish()
      })
      if (done) return
      setTimeout(finish, 400)
    })
    this.appRef.tick()
    await microSettle()
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
    this.cref?.destroy()
    this.appRef?.destroy()
    this.host?.remove()
    this.console.restore()
  }
}
