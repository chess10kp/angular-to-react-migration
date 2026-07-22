/**
 * Internal Template IR.
 *
 * A stable, framework-neutral intermediate representation sitting between the
 * version-pinned Angular template AST (`@angular/compiler`) and the React JSX
 * emitter. Keeping this layer explicit is what lets the harness be tested and
 * versioned independently of both Angular's parser internals and Babel's AST.
 *
 * Anything the deterministic path cannot safely translate becomes a `Todo`
 * node so the emitter can leave a `MIGRATION_TODO` marker instead of silently
 * dropping or guessing.
 */

export type IRNode =
  | ElementNode
  | TextNode
  | InterpolationNode
  | IfNode
  | ForNode
  | TodoNode;

export interface SourceLoc {
  /** 1-based line in the source template, when known. */
  line: number | null;
  /** 1-based column in the source template, when known. */
  col: number | null;
}

/** A literal static attribute: `class="c"` -> { name: 'class', value: 'c' }. */
export interface StaticAttr {
  name: string;
  value: string;
}

/** A property binding: `[id]="pid"` -> { name: 'id', expr: 'pid' }. */
export interface BoundProp {
  name: string;
  /** Already-translated JS-ish expression text. */
  expr: string;
  /**
   * Kind, so the emitter can route class/style/attr specially.
   * `ngclass`/`ngstyle` are the whole-object `[ngClass]`/`[ngStyle]` directives,
   * merged with any static `class`/`style` and `[class.x]`/`[style.x]` bindings.
   */
  kind:
    | 'property'
    | 'attribute'
    | 'class'
    | 'style'
    | 'ngclass'
    | 'ngstyle'
    | 'activeclass'
    | 'formcontrol';
  /**
   * For class/style bindings, the sub-target (e.g. `on` in `[class.on]`).
   * For `formcontrol`, the react-hook-form handle to `.register()` against.
   */
  unit?: string;
}

/** An event binding: `(click)="go(x)"` -> onClick. */
export interface EventBinding {
  /** Original Angular event name, e.g. `click`, `keydown.enter`. */
  name: string;
  /** Handler body expression source (Angular), e.g. `go(x)`. */
  handler: string;
}

export interface ElementNode {
  type: 'element';
  tag: string;
  attrs: StaticAttr[];
  props: BoundProp[];
  events: EventBinding[];
  children: IRNode[];
  loc: SourceLoc;
}

export interface TextNode {
  type: 'text';
  value: string;
}

/** A run of interpolation, e.g. `Hello {{ name }}!` -> segments. */
export interface InterpolationNode {
  type: 'interpolation';
  segments: Array<{ kind: 'text'; value: string } | { kind: 'expr'; expr: string }>;
}

export interface IfBranch {
  /** null for the trailing `@else` branch. */
  cond: string | null;
  children: IRNode[];
}

export interface IfNode {
  type: 'if';
  branches: IfBranch[];
  loc: SourceLoc;
}

export interface ForNode {
  type: 'for';
  /** Loop variable name, e.g. `item`. */
  item: string;
  /** Iterable expression source, e.g. `items`. */
  iterable: string;
  /** track expression source, e.g. `item.id`; null if untracked. */
  trackBy: string | null;
  /** Aliases used in the body, e.g. { '$index': 'i' }. Only aliased ones. */
  contextAliases: Record<string, string>;
  children: IRNode[];
  /** `@empty { ... }` body, if present. */
  empty: IRNode[] | null;
  loc: SourceLoc;
}

/** An untranslatable construct — emitted as a MIGRATION_TODO marker. */
export interface TodoNode {
  type: 'todo';
  reason: string;
  /** Original template source for the construct, if recoverable. */
  original: string;
  loc: SourceLoc;
}
