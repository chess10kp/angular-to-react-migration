/**
 * Service model — the structured view of an Angular `@Injectable` class.
 *
 * Unlike a component (which is restructured class -> function), a service stays
 * a plain TS class, so the transform is light *surgery* rather than a rebuild:
 * `this.` references, method bodies, types and generics are all preserved. The
 * model exists for reporting/coverage; the emit works in-place on the AST.
 */

/** A dependency obtained via `inject(X)` or a constructor parameter. */
export interface ServiceDep {
  /** Property name it is stored under, e.g. `appStateService`. */
  propName: string;
  /** Injected type/token text, e.g. `AppStateService`. */
  token: string;
  /** How it was declared — affects the residue note. */
  via: 'inject' | 'constructor';
}

export interface ServiceModel {
  className: string;
  /** `providedIn` value from `@Injectable({...})`, if any. */
  providedIn: string | null;
  /**
   * True for OpenAPI-generated API clients (banner or `generated/` path). These
   * are regenerated from the spec for the React app, never hand-migrated.
   */
  generated: boolean;
  /** DI edges (from `inject()` fields and constructor params). */
  deps: ServiceDep[];
  /** Angular lifecycle hooks present (e.g. `ngOnDestroy`). */
  lifecycle: string[];
  /** Non-fatal notes gathered while transforming. */
  todos: string[];
}
