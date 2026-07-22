import { Directive, OnDestroy } from '@angular/core';
import { Subject } from 'rxjs';

/**
 * Base class the real target uses for auto-unsubscribe. Component inheritance
 * is the construct codemods struggle with — the migration must flatten this
 * into a `useEffect`/`useDestroy` hook rather than an `extends`.
 */
@Directive()
export abstract class DestroyableComponent implements OnDestroy {
  protected readonly destroy$ = new Subject<void>();

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }
}
