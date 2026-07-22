/**
 * Angular binding-expression handling.
 *
 * We parse the expression with Angular's own expression parser and walk the
 * resulting AST (`src/expr-ast.ts`) to emit JS — no regex on the source string.
 * That makes pipes correct at any nesting depth, treats `$event` as a node we
 * rewrite rather than a substring, and lets precedence (not a heuristic) place
 * parentheses. Anything the parser rejects is surfaced as a `todo` so it
 * becomes visible residue rather than a silent, possibly-wrong translation.
 */

import { printAction, printBinding } from './expr-ast.js';

export interface ExprResult {
  /** Translated JS expression text. */
  code: string;
  /** Non-fatal notes about what could not be handled deterministically. */
  todos: string[];
  /** True if a `translate` pipe was lowered to a `t(...)` call. */
  usesTranslate?: boolean;
  /** Names of `@angular/common`-pipe helper fns the output relies on (e.g. `formatDate`). */
  helpers?: string[];
  /**
   * Expressions bound through the `async` pipe (`x | async`). Lowered to a bare
   * `x` in the JSX; the component emitter unwraps each at component scope. The
   * template layer (owned elsewhere) does not aggregate this field, so the
   * component transform recovers these from the structured `async pipe: unwrap`
   * todo marker instead — this field documents the contract.
   */
  asyncBindings?: string[];
}

/**
 * Translate a single Angular binding/interpolation expression to a JS
 * expression string. Pipes are lowered from `BindingPipe` AST nodes; the only
 * deterministic mappings (`translate`, `json`, `uppercase`, …) are applied and
 * every other pipe is flagged as residue.
 */
export function translateExpr(
  src: string,
  renames?: ReadonlyMap<string, string>,
  signalReads?: ReadonlySet<string>,
): ExprResult {
  const out: ExprResult = { code: '', todos: [] };
  const trimmed = src.trim();
  if (trimmed === '') return out;
  const code = printBinding(trimmed, out, renames, signalReads);
  // On a parse failure `printBinding` records residue; keep the raw source so
  // downstream emit can still surface it (and flag it a second time if invalid).
  out.code = code ?? trimmed;
  return out;
}

/**
 * Map an Angular event name to a React prop name.
 * Returns null if the event has modifiers / is not in the deterministic map,
 * so the caller can emit residue.
 */
const DOM_EVENT_MAP: Record<string, string> = {
  click: 'onClick',
  dblclick: 'onDoubleClick',
  input: 'onInput',
  change: 'onChange',
  submit: 'onSubmit',
  focus: 'onFocus',
  blur: 'onBlur',
  keydown: 'onKeyDown',
  keyup: 'onKeyUp',
  keypress: 'onKeyPress',
  mousedown: 'onMouseDown',
  mouseup: 'onMouseUp',
  mouseenter: 'onMouseEnter',
  mouseleave: 'onMouseLeave',
  mouseover: 'onMouseOver',
  mouseout: 'onMouseOut',
  scroll: 'onScroll',
};

export interface EventMapResult {
  reactProp: string | null;
  /** Reason it could not be mapped, if reactProp is null. */
  reason?: string;
}

export function mapEventName(name: string): EventMapResult {
  if (name.includes('.')) {
    // e.g. keydown.enter — key filtering has no 1:1 JSX form.
    return {
      reactProp: null,
      reason: `event modifier not deterministically mappable: \`(${name})\``,
    };
  }
  const mapped = DOM_EVENT_MAP[name];
  if (mapped) return { reactProp: mapped };
  return {
    reactProp: null,
    reason: `unknown/custom event \`(${name})\` (likely a component @Output — needs skeleton pass)`,
  };
}

/**
 * Translate an event handler body to an arrow-body expression. Parsed as an
 * Angular *action* (assignments and statement chains allowed), with the
 * implicit `$event` variable lowered to `e` — an AST rewrite, so a `$event`
 * substring inside a string literal is left untouched.
 */
export function translateHandler(
  src: string,
  renames?: ReadonlyMap<string, string>,
  signalReads?: ReadonlySet<string>,
): ExprResult {
  const out: ExprResult = { code: '', todos: [] };
  const trimmed = src.trim();
  if (trimmed === '') return out;
  const code = printAction(trimmed, out, 'e', renames, signalReads);
  // Fall back to the raw source (with a literal `$event` rename) if unparseable.
  out.code = code ?? trimmed.replace(/\$event\b/g, 'e');
  return out;
}

/** Static HTML attribute name -> JSX attribute name. */
export function mapAttrName(name: string): string {
  const lower = name.toLowerCase();
  if (lower === 'class') return 'className';
  if (lower === 'for') return 'htmlFor';
  if (lower === 'tabindex') return 'tabIndex';
  if (lower === 'readonly') return 'readOnly';
  if (lower === 'maxlength') return 'maxLength';
  if (lower === 'colspan') return 'colSpan';
  if (lower === 'rowspan') return 'rowSpan';
  if (lower === 'autocomplete') return 'autoComplete';
  // data-* and aria-* stay as-is in JSX.
  return name;
}
