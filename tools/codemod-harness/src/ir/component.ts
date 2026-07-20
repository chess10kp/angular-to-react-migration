/**
 * Component model — the structured, framework-neutral view of an Angular
 * `@Component` class that the `.tsx` emitter consumes.
 *
 * As with the template IR, this is the seam: ts-morph (Angular/TS parsing)
 * lives only in `src/parse/angular-component.ts`, and the emitter reads only
 * this model.
 */

export interface InputProp {
  name: string;
  /** Declared type text, e.g. `IFilterOptions`. `unknown` if unannotated. */
  type: string;
  /** `@Input({ required: true })` or a `!` definite-assignment marker. */
  required: boolean;
  /** Default value expression text, if any. */
  default: string | null;
}

export interface OutputProp {
  name: string;
  /** Payload type, e.g. `string` from `EventEmitter<string>`. */
  payloadType: string;
}

/** A dependency obtained via `inject(X)` or a constructor parameter. */
export interface Injected {
  /** Property name it is stored under, e.g. `router`. */
  propName: string;
  /** Injected type/token text, e.g. `Router`. */
  token: string;
  /** How it was declared — affects the residue note. */
  via: 'inject' | 'constructor';
}

/**
 * A `@ViewChild('ref')` / `@ViewChild(Cmp)` / `@ViewChildren(...)` property.
 * Becomes a `useRef` on the React side (semantics flagged).
 */
export interface ViewChildRef {
  /** Property name it is stored under, e.g. `input`. */
  propName: string;
  /** The selector argument text, e.g. `'myRef'` or `MyComponent`. */
  selector: string;
  /** True for `@ViewChildren` (a list of refs / callback-ref pattern). */
  isList: boolean;
  /** Declared property type text, if any (drives the useRef type arg). */
  type: string | null;
}

/** A `signal<T>(init)` field -> candidate React state. */
export interface SignalField {
  name: string;
  typeArg: string | null;
  init: string;
}

/**
 * One `this.<member>` property access found in a body, located via the TS AST
 * (so occurrences inside string/template literals or comments are never
 * recorded). Offsets are relative to the body string the IR carries, letting
 * the emitter rewrite by position rather than by regex.
 */
export interface ThisRef {
  /** The accessed member name, e.g. `router` in `this.router`. */
  member: string;
  /** Offset of `this` — start of the `this.<member>` access. */
  start: number;
  /** Offset just past `<member>` — end of the `this.<member>` access. */
  end: number;
  /** True if `this.<member>` is itself the callee of a call, e.g. `this.x()`. */
  directCall: boolean;
  /** Argument count of that direct call (a 0-arg call is a signal read). */
  directCallArgCount: number;
  /** End offset of the enclosing call expression, when `directCall`. */
  callEnd: number | null;
  /** Method name `m` when the shape is `this.<member>.m(…)` (else null). */
  method: string | null;
  /** End offset just past `.m` (end of the `this.<member>.m` access). */
  methodEnd: number | null;
}

export interface ComputedField {
  name: string;
  /** The `computed(() => …)` body — an expression, or statements if block. */
  expr: string;
  /** True when the body was a `{ … }` block (needs IIFE/function wrapping). */
  blockBody: boolean;
  /** AST-located `this.` accesses in `expr` (for position-based rewiring). */
  thisRefs: ThisRef[];
}

export interface MethodDef {
  name: string;
  /** Parameter list source, e.g. `filterName: string, value: string`. */
  params: string;
  returnType: string | null;
  /** Raw method body (statements between the braces). */
  body: string;
  /** True if the body references `this.` (needs rewiring in React). */
  usesThis: boolean;
  /** AST-located `this.` accesses in `body` (for position-based rewiring). */
  thisRefs: ThisRef[];
  /** Count of `.subscribe(...)` calls in the body (RxJS residue signal). */
  subscribeCount: number;
}

export interface LifecycleHook {
  /** e.g. `ngOnInit`, `ngOnDestroy`. */
  name: string;
  body: string;
  /** `async ngOnInit()` — the body must be wrapped (effects can't be async). */
  isAsync: boolean;
  /** AST-located `this.` accesses in `body` (for position-based rewiring). */
  thisRefs: ThisRef[];
  /** Count of `.subscribe(...)` calls in the body (RxJS residue signal). */
  subscribeCount: number;
}

export interface PlainField {
  name: string;
  type: string | null;
  init: string | null;
}

export interface ComponentModel {
  className: string;
  isDefaultExport: boolean;
  selector: string | null;
  /** Relative template URL, if external. */
  templateUrl: string | null;
  /** Inline template source, if `template:` was used. */
  inlineTemplate: string | null;
  styleUrls: string[];
  inputs: InputProp[];
  outputs: OutputProp[];
  injected: Injected[];
  viewChildren: ViewChildRef[];
  signals: SignalField[];
  computeds: ComputedField[];
  plainFields: PlainField[];
  methods: MethodDef[];
  lifecycle: LifecycleHook[];
  /** Non-fatal notes gathered while extracting. */
  todos: string[];
}
