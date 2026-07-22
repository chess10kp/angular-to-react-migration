// DI token an Angular unit injects to emit domain events without depending on the
// harness. Kept in its own module so both the adapter and units import one instance.
// Only touches @angular/core (no compiler); safe once jsdom globals are installed.
import { InjectionToken } from '@angular/core'
import type { DomainEvent } from '../types.js'

export const PARITY_EVENT_SINK = new InjectionToken<(e: DomainEvent) => void>('PARITY_EVENT_SINK')
