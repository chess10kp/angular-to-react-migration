// Legacy side: a real standalone Angular 17 component. Uses classic @Input() +
// ngOnChanges (the runtime JIT compiler used to render under Node cannot detect
// signal input()/computed() — those need ahead-of-time/partial compilation). The
// observable contract (rendered text, role, domain event) is identical either way.
import { Component, inject, Input, type OnChanges } from '@angular/core'
import { PARITY_EVENT_SINK } from '../../src/adapters/angular-token.js'
import { itemCountLabel, itemRange } from './i18n.js'

@Component({
  selector: 'app-item-count',
  standalone: true,
  template: `<span role="status">{{ label }}</span>`,
})
export class ItemCountComponent implements OnChanges {
  @Input() page?: number
  @Input() pageSize = 10
  @Input() total = 0
  @Input() locale = 'en'

  private sink = inject(PARITY_EVENT_SINK)

  get label(): string {
    return itemCountLabel(this.page, this.pageSize, this.total, this.locale)
  }

  ngOnChanges(): void {
    this.sink({ name: 'itemCountRendered', payload: itemRange(this.page, this.pageSize, this.total) })
  }
}
