// Legacy side: a real Angular 17 SlotGroup, structurally faithful to OneCX's
// SlotGroupComponent — ResizeObserver → BehaviorSubject → debounceTime(100) →
// emit a resized domain event; class/style inputs; ngOnDestroy teardown. The onecx
// ResizedEventsTopic is replaced by the harness event sink so the observable
// contract (a debounced "slotGroupResized" event) is preserved without the BFF dep.
import { Component, ElementRef, inject, Input, type OnDestroy, type OnInit } from '@angular/core'
import { BehaviorSubject, debounceTime, Subscription } from 'rxjs'
import { PARITY_EVENT_SINK } from '../../src/adapters/angular-token.js'
import { slotGroupClassName, type NgClassInput } from './classes.js'

@Component({
  selector: 'app-slot-group',
  standalone: true,
  template: `
    <div [class]="containerClass" [style.gap]="gap" data-region="container">
      <span data-slot="start">{{ name }}.start</span>
      <span data-slot="center">{{ name }}.center</span>
      <span data-slot="end">{{ name }}.end</span>
    </div>
  `,
})
export class SlotGroupComponent implements OnInit, OnDestroy {
  @Input() name = ''
  @Input() direction: 'row' | 'row-reverse' | 'column' | 'column-reverse' = 'row'
  @Input() slotGroupClasses: NgClassInput = ''
  @Input() gap = ''

  private sink = inject(PARITY_EVENT_SINK)
  private elementRef = inject(ElementRef)
  private observer?: ResizeObserver
  private readonly size$ = new BehaviorSubject<{ width: number; height: number }>({ width: -1, height: -1 })
  private subs: Subscription[] = []

  get containerClass(): string {
    return slotGroupClassName(this.direction, this.slotGroupClasses)
  }

  ngOnInit(): void {
    this.observer = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect
      if (rect) this.size$.next({ width: rect.width, height: rect.height })
    })
    this.subs.push(
      this.size$.pipe(debounceTime(100)).subscribe(({ width, height }) => {
        if (width < 0) return
        this.sink({ name: 'slotGroupResized', payload: { name: this.name, width, height } })
      }),
    )
    this.observer.observe(this.elementRef.nativeElement)
  }

  ngOnDestroy(): void {
    this.observer?.disconnect()
    this.subs.forEach((s) => s.unsubscribe())
    this.size$.complete()
  }
}
