/**
 * Angular template AST -> internal Template IR.
 *
 * The Angular parser is version-pinned (17.3.9, matching the fixture/target).
 * We touch its node shapes in exactly one place — here — so that an Angular
 * upgrade is a localized change rather than a scattered one.
 */

import { parseTemplate } from '@angular/compiler';
import {
  EventBinding,
  ForNode,
  IfBranch,
  IfNode,
  IRNode,
  SourceLoc,
  StaticAttr,
  TodoNode,
} from '../ir/types.js';
import { mapAttrName, translateExpr } from '../expr.js';

/** Angular `BindingType` numeric values (enum not reliably re-exported). */
const BINDING_PROPERTY = 0;
const BINDING_ATTRIBUTE = 1;
const BINDING_CLASS = 2;
const BINDING_STYLE = 3;

export interface ParseResult {
  nodes: IRNode[];
  /** Fatal Angular parse errors, if any (transform should abort). */
  errors: string[];
  /** Accumulated non-fatal residue reasons discovered while lowering. */
  todos: string[];
  /** True if the template uses translation (`| translate` or `jhiTranslate`). */
  usesTranslate: boolean;
  /** `@angular/common`-pipe helper fns the JSX relies on (e.g. `formatDate`). */
  helpers: string[];
}

export function parseAngularTemplate(
  source: string,
  fileName = 'template.html',
  renames: ReadonlyMap<string, string> = new Map(),
): ParseResult {
  const parsed = parseTemplate(source, fileName, {
    preserveWhitespaces: false,
  });
  const errors = (parsed.errors ?? []).map((e) => e.toString());
  const ctx: Ctx = {
    todos: [],
    usesTranslate: false,
    helpers: new Set(),
    refMap: new Map(),
    consumedRefs: new Set(),
    renames,
  };
  // Pre-pass: template reference variables (`<ng-template #x>`) have
  // component-wide scope and may be referenced (via *ngIf else/then) from a
  // sibling that lowers *before* their own node. Collect the ref -> node map and
  // the set of refs an *ngIf consumes up front, so lowering order can't matter.
  if (!errors.length) collectRefs(parsed.nodes, ctx);
  const nodes = errors.length ? [] : parsed.nodes.map((n) => lower(n, ctx)).filter(Boolean) as IRNode[];
  return {
    nodes,
    errors,
    todos: ctx.todos,
    usesTranslate: ctx.usesTranslate,
    helpers: [...ctx.helpers],
  };
}

interface Ctx {
  todos: string[];
  usesTranslate: boolean;
  helpers: Set<string>;
  /** `<ng-template #name>` ref -> its Angular Template node (whole-template scope). */
  refMap: Map<string, any>;
  /** Ref names consumed by an *ngIf else/then (so the standalone node is dropped). */
  consumedRefs: Set<string>;
  /** Bare identifiers renamed by the component emitter (reserved-word methods). */
  renames: ReadonlyMap<string, string>;
}

/**
 * Walk the raw Angular tree recording every `<ng-template #ref>` and every ref
 * an `*ngIf` else/then binding points at. Runs once before lowering so
 * forward/backward references resolve identically.
 */
function collectRefs(nodes: any[], ctx: Ctx): void {
  for (const node of nodes ?? []) {
    const kind = ctor(node);
    if (kind === 'Template') {
      if (node.tagName === 'ng-template') {
        for (const ref of node.references ?? []) {
          if (ref?.name) ctx.refMap.set(ref.name, node);
        }
      }
      const tAttrs: any[] = node.templateAttrs ?? [];
      for (const name of ['ngIfElse', 'ngIfThen']) {
        const a = tAttrs.find((x) => x.name === name);
        if (a) {
          const refName = tAttrSource(a).trim();
          if (refName) ctx.consumedRefs.add(refName);
        }
      }
    }
    collectRefs(node.children ?? [], ctx);
  }
}

/** Translate an Angular expression, folding todos/translate/helpers into ctx. */
function foldExpr(src: string, ctx: Ctx): string {
  const { code, todos, usesTranslate, helpers } = translateExpr(src, ctx.renames);
  ctx.todos.push(...todos);
  if (usesTranslate) ctx.usesTranslate = true;
  for (const h of helpers ?? []) ctx.helpers.add(h);
  return code;
}

/** `foo()` -> `foo`; anything else -> null (plain property / expression). */
function signalReadName(expr: string): string | null {
  const m = expr.trim().match(/^([A-Za-z_$][\w$]*)\(\)$/);
  return m ? m[1] : null;
}

/**
 * Build the React onChange handler for an ngModel binding.
 * Angular's `(ngModelChange)` emits the new *value* as `$event`; React's
 * `onChange` passes the DOM event — map `$event` -> `$event.target.value`.
 * For `[(ngModel)]="v"` without an explicit change handler, assign to `v`;
 * for `[ngModel]="sig()"` (signal read) never assign to a call — use `.set()`.
 */
function ngModelChangeHandler(explicit: string, readExpr: string): string {
  const trimmed = explicit.trim();
  // Banana-in-a-box desugars to `(ngModelChange)="v"` (bare lvalue, no `$event`).
  if (!trimmed || trimmed === readExpr.trim()) {
    const signal = signalReadName(readExpr);
    if (signal) return `${signal}.set($event.target.value)`;
    return `${readExpr} = $event.target.value`;
  }
  // Explicit handler: ngModelChange emits the value as `$event`; React onChange passes the DOM event.
  return trimmed.replace(/\$event\b/g, '$event.target.value');
}

function locOf(node: any): SourceLoc {
  const span = node?.sourceSpan ?? node?.startSourceSpan;
  const start = span?.start;
  return {
    line: start ? start.line + 1 : null,
    col: start ? start.col + 1 : null,
  };
}

function todo(node: any, reason: string, ctx: Ctx): TodoNode {
  ctx.todos.push(reason);
  let original = '';
  try {
    original = node?.sourceSpan?.toString?.() ?? '';
  } catch {
    original = '';
  }
  return { type: 'todo', reason, original, loc: locOf(node) };
}

/** Render a raw attribute value as a single-quoted JS string literal. */
function jsString(v: string): string {
  return "'" + v.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\r?\n/g, '\\n') + "'";
}

/**
 * A `[routerLink]` expression -> a React Router `to` value. Angular's array form
 * `['/user', id]` is a list of path segments, joined with `/` at runtime; any
 * other expression (a plain string binding) is passed through unchanged.
 */
function routerToExpr(expr: string): string {
  const trimmed = expr.trim();
  return /^\[.*\]$/.test(trimmed) ? `(${trimmed}).join('/')` : trimmed;
}

function ctor(node: any): string {
  // Angular minifies class names with a numeric suffix (Element$1); strip it.
  return (node?.constructor?.name ?? '').replace(/\$\d+$/, '');
}

function lowerChildren(children: any[], ctx: Ctx): IRNode[] {
  return (children ?? []).map((c) => lower(c, ctx)).filter(Boolean) as IRNode[];
}

function lower(node: any, ctx: Ctx): IRNode | null {
  const kind = ctor(node);
  switch (kind) {
    case 'Text':
      return lowerText(node);
    case 'BoundText':
      return lowerBoundText(node, ctx);
    case 'Element':
      return lowerElement(node, ctx);
    case 'IfBlock':
      return lowerIf(node, ctx);
    case 'ForLoopBlock':
      return lowerFor(node, ctx);
    case 'Template':
      return lowerTemplate(node, ctx);
    case 'SwitchBlock':
      return todo(node, '@switch not supported in slice 1', ctx);
    case 'DeferredBlock':
      return todo(node, '@defer not supported in slice 1', ctx);
    case 'Content':
      return lowerContent(node, ctx);
    default:
      return todo(node, `unhandled template node: ${kind || 'unknown'}`, ctx);
  }
}

function lowerText(node: any): IRNode {
  return { type: 'text', value: node.value ?? '' };
}

/**
 * `<ng-content>` -> React's `{children}`. Bare projection maps cleanly. A
 * `select="…"` variant can't: React has no selector-based multi-slot projection,
 * so we still surface `{children}` (never drop it) but flag that the author must
 * split it into named props by hand.
 */
function lowerContent(node: any, ctx: Ctx): IRNode {
  const selector: string = node?.selector ?? '*';
  if (selector && selector !== '*') {
    ctx.todos.push(
      `<ng-content select="${selector}"> -> {children}: React has no selector-based projection; split into a named prop by hand`,
    );
  }
  return { type: 'interpolation', segments: [{ kind: 'expr', expr: 'children' }] };
}

/**
 * Keep an ambiguous structural construct visible: a MIGRATION_TODO marker
 * followed by its (lowered) children, grouped in an <ng-container> that the
 * emitter renders as a Fragment. Never drops content.
 */
function preserveWithTodo(node: any, reason: string, children: IRNode[], ctx: Ctx): IRNode {
  const marker = todo(node, reason, ctx);
  return {
    type: 'element',
    tag: 'ng-container',
    attrs: [],
    props: [],
    events: [],
    children: [marker, ...children],
    loc: locOf(node),
  };
}

/** Split an interpolation source string `a {{ x }} b` into text/expr segments. */
export function parseInterpolationString(
  src: string,
  ctx: Ctx,
): Array<{ kind: 'text'; value: string } | { kind: 'expr'; expr: string }> {
  const segments: Array<{ kind: 'text'; value: string } | { kind: 'expr'; expr: string }> = [];
  let i = 0;
  while (i < src.length) {
    const open = src.indexOf('{{', i);
    if (open === -1) {
      if (i < src.length) segments.push({ kind: 'text', value: src.slice(i) });
      break;
    }
    if (open > i) segments.push({ kind: 'text', value: src.slice(i, open) });
    const close = src.indexOf('}}', open + 2);
    if (close === -1) {
      // Unbalanced — record and treat rest as text.
      ctx.todos.push('unbalanced interpolation braces in template text');
      segments.push({ kind: 'text', value: src.slice(open) });
      break;
    }
    const exprSrc = src.slice(open + 2, close);
    segments.push({ kind: 'expr', expr: foldExpr(exprSrc, ctx) });
    i = close + 2;
  }
  return segments;
}

function lowerBoundText(node: any, ctx: Ctx): IRNode {
  const src: string = node?.value?.source ?? '';
  return { type: 'interpolation', segments: parseInterpolationString(src, ctx) };
}

function lowerElement(node: any, ctx: Ctx): IRNode {
  const attrs = (node.attributes ?? []).map((a: any) => ({
    name: mapAttrName(a.name),
    value: a.value ?? '',
  }));

  const props: any[] = [];
  for (const input of node.inputs ?? []) {
    const srcRaw: string = input?.value?.source ?? '';
    // Attribute-interpolation like title="{{ 'k' | translate }}" arrives as a
    // Property binding whose source still carries {{ }}.
    const isInterp = srcRaw.includes('{{');
    let exprText: string;
    if (isInterp) {
      const segs = parseInterpolationString(srcRaw, ctx);
      if (segs.length === 1 && segs[0].kind === 'expr') {
        exprText = segs[0].expr;
      } else {
        // Mixed text+expr in an attribute -> template literal.
        exprText = '`' + segs.map((s) => (s.kind === 'text' ? s.value.replace(/`/g, '\\`') : '${' + s.expr + '}')).join('') + '`';
      }
    } else {
      exprText = foldExpr(srcRaw, ctx);
    }

    // Two-way `[(ngModel)]` arrives as an input whose binding type varies by
    // Angular version; capture it by name so it never hits the default branch.
    if (input.name === 'ngModel') {
      props.push({ name: 'ngModel', expr: exprText, kind: 'property' });
      continue;
    }

    switch (input.type) {
      case BINDING_PROPERTY:
        if (input.name === 'ngClass') {
          props.push({ name: 'ngClass', expr: exprText, kind: 'ngclass' });
        } else if (input.name === 'ngStyle') {
          props.push({ name: 'ngStyle', expr: exprText, kind: 'ngstyle' });
        } else {
          props.push({ name: mapAttrName(input.name), expr: exprText, kind: 'property' });
        }
        break;
      case BINDING_CLASS:
        props.push({ name: input.name, expr: exprText, kind: 'class', unit: input.name });
        break;
      case BINDING_STYLE:
        props.push({ name: input.name, expr: exprText, kind: 'style', unit: input.name });
        break;
      case BINDING_ATTRIBUTE:
        props.push({ name: input.name, expr: exprText, kind: 'attribute' });
        break;
      default:
        ctx.todos.push(`unsupported binding type on <${node.name} [${input.name}]>`);
        props.push({ name: input.name, expr: exprText, kind: 'attribute' });
    }
  }

  const ngModelChange = (node.outputs ?? []).find((o: any) => o.name === 'ngModelChange');
  const events = (node.outputs ?? [])
    .map((o: any) => ({ name: o.name, handler: o?.handler?.source ?? '' }))
    // `ngModelChange` is the desugared write half of [(ngModel)]; we synthesize
    // our own onChange below, so drop the original to avoid a duplicate.
    .filter((e: EventBinding) => e.name !== 'ngModelChange');

  // --- [(ngModel)]="v" / [ngModel]="v()" + (ngModelChange) -> value + onChange ---
  // React has no two-way form, so we emit a controlled-input pair. Angular 17
  // signal templates use `[ngModel]="sig()" (ngModelChange)="sig.set($event)"`;
  // synthesizing `sig() = …` is invalid JS — detect the signal read / explicit
  // ngModelChange and wire a valid setter instead.
  const ngModel = props.find((p) => p.name === 'ngModel');
  if (ngModel) {
    const target = ngModel.expr;
    props.push({ name: 'value', expr: target, kind: 'property' });
    const handler = ngModelChangeHandler(ngModelChange?.handler?.source ?? '', target);
    events.push({ name: 'change', handler });
    const signalName = signalReadName(target);
    if (signalName) {
      const setter = 'set' + signalName.charAt(0).toUpperCase() + signalName.slice(1);
      ctx.todos.push(
        `[(ngModel)] on signal \`${signalName}\` -> value/onChange; \`${signalName}()\` reads -> \`${signalName}\`, \`${signalName}.set(x)\` -> \`${setter}(x)\``,
      );
    } else {
      ctx.todos.push(
        `[(ngModel)]="${target}" -> value/onChange; make \`${target}\` React state so the setter updates it`,
      );
    }
  }

  // --- [ngSwitch] host -> a conditional chain over its *ngSwitchCase children ---
  const ngSwitch = props.find((p) => p.name === 'ngSwitch');
  let switchChildren: IRNode[] | null = null;
  if (ngSwitch) {
    switchChildren = [lowerSwitch(node, ngSwitch.expr, ctx)];
  }

  // --- Router directives -> react-router-dom (<Link>/<NavLink>/<Outlet>) ---
  let tagOverride: string | null = null;
  if (node.name === 'router-outlet') {
    tagOverride = 'Outlet';
  }
  const staticLink = attrs.find((a: StaticAttr) => a.name === 'routerLink');
  const boundLink = props.find((p) => p.name === 'routerLink');
  if (staticLink || boundLink) {
    const activeAttr = attrs.find((a: StaticAttr) => a.name === 'routerLinkActive');
    tagOverride = activeAttr ? 'NavLink' : 'Link';
    if (boundLink) {
      props.push({ name: 'to', expr: routerToExpr(boundLink.expr), kind: 'property' });
    } else {
      // Static path -> a plain string attribute `to="/x"` (cleaner than `to={'/x'}`).
      attrs.push({ name: 'to', value: staticLink!.value });
    }
    if (activeAttr) props.push({ name: 'routerActiveClass', expr: jsString(activeAttr.value), kind: 'activeclass' });
    if (props.some((p) => p.name === 'queryParams'))
      ctx.todos.push('routerLink [queryParams] -> fold into a React Router `to` object (search) or useSearchParams');
    if (props.some((p) => p.name === 'fragment') || attrs.some((a: StaticAttr) => a.name === 'fragment'))
      ctx.todos.push('routerLink fragment -> fold into a React Router `to` object (hash)');
  }

  // --- [ngTemplateOutlet]="tpl" -> no deterministic React form ---
  // React renders a projected template by calling a render-prop or rendering a
  // child component; which one is the author's design call. Flag it, and keep
  // any host children visible (added to `children` at the end).
  const tplOutlet = props.find((p) => p.name === 'ngTemplateOutlet');
  let outletMarker: IRNode | null = null;
  if (tplOutlet) {
    outletMarker = todo(
      node,
      `[ngTemplateOutlet]="${tplOutlet.expr}" has no deterministic React form; render \`${tplOutlet.expr}\` as a render-prop/child component by hand`,
      ctx,
    );
  }

  // --- [innerHTML]="x" -> dangerouslySetInnerHTML={{ __html: x }} ---
  const innerHtml = props.find((p) => p.name === 'innerHTML' || p.name === 'innerHtml');
  if (innerHtml) {
    props.push({ name: 'dangerouslySetInnerHTML', expr: `{ __html: ${innerHtml.expr} }`, kind: 'property' });
  }

  // --- jhiTranslate directive -> {t(key, values?)} content (react-i18next) ---
  // Forms: static `jhiTranslate="a.b"`, bound `[jhiTranslate]="expr"`, plus an
  // optional `[translateValues]="{…}"`. The directive replaces the element's
  // text content with the translation, so the fallback children are dropped.
  const staticKey = attrs.find((a: StaticAttr) => a.name === 'jhiTranslate');
  const boundKey = props.find((p) => p.name === 'jhiTranslate');
  const valuesProp = props.find((p) => p.name === 'translateValues');
  let translateKey: string | null = null;
  if (boundKey) translateKey = boundKey.expr;
  else if (staticKey) translateKey = jsString(staticKey.value);

  const DROP_ATTRS = new Set(['jhiTranslate', 'routerLink', 'routerLinkActive', 'fragment']);
  const cleanAttrs = attrs.filter((a: StaticAttr) => !DROP_ATTRS.has(a.name));
  const DROP_PROPS = new Set([
    'jhiTranslate', 'translateValues', 'ngModel', 'ngSwitch',
    'routerLink', 'routerLinkActiveOptions', 'queryParams', 'fragment', 'innerHTML', 'innerHtml',
    'ngTemplateOutlet', 'ngTemplateOutletContext',
  ]);
  const cleanProps = props.filter((p) => !DROP_PROPS.has(p.name));

  let children: IRNode[];
  if (translateKey !== null) {
    ctx.usesTranslate = true;
    const values = valuesProp ? valuesProp.expr : null;
    const tCall = values ? `t(${translateKey}, ${values})` : `t(${translateKey})`;
    const hasMarkupChildren = (node.children ?? []).some((c: any) => {
      const k = ctor(c);
      return k === 'Element' || k === 'IfBlock' || k === 'ForLoopBlock' || k === 'Template' || k === 'SwitchBlock';
    });
    if (hasMarkupChildren) {
      ctx.todos.push(`jhiTranslate on <${node.name}> dropped fallback markup (directive overwrites content)`);
    }
    children = [{ type: 'interpolation', segments: [{ kind: 'expr', expr: tCall }] }];
  } else if (switchChildren) {
    children = switchChildren;
  } else if (innerHtml) {
    // dangerouslySetInnerHTML replaces the element's content; drop any children.
    if ((node.children ?? []).length > 0) {
      ctx.todos.push(`[innerHTML] on <${node.name}> dropped existing children (it overwrites content)`);
    }
    children = [];
  } else {
    children = lowerChildren(node.children, ctx);
  }

  // Prepend the ngTemplateOutlet marker so it stays visible even on grouping
  // hosts (`<ng-container>` renders as a Fragment and drops props).
  if (outletMarker) children = [outletMarker, ...children];

  return {
    type: 'element',
    tag: tagOverride ?? node.name,
    attrs: cleanAttrs,
    props: cleanProps,
    events,
    children,
    loc: locOf(node),
  };
}

function lowerIf(node: any, ctx: Ctx): IfNode {
  const branches: IfBranch[] = (node.branches ?? []).map((b: any) => {
    const exprSrc: string | null = b?.expression?.source ?? null;
    if (exprSrc && b.expressionAlias) {
      ctx.todos.push('@if alias (`as`) not supported in slice 1');
    }
    let cond: string | null = null;
    if (exprSrc !== null) {
      cond = foldExpr(exprSrc, ctx);
    }
    return { cond, children: lowerChildren(b.children, ctx) };
  });
  return { type: 'if', branches, loc: locOf(node) };
}

/** Read a template attr's source: BoundAttribute -> value.source; TextAttribute -> ''. */
function tAttrSource(a: any): string {
  return a?.value?.source ?? (typeof a?.value === 'string' ? a.value : '');
}

/**
 * Lower a `Template` node — Angular's desugaring of a classic structural
 * directive (`*ngIf`, `*ngFor`, …). We route by the directive present in
 * `templateAttrs` and reuse the same IfNode/ForNode the new control flow uses.
 */
function lowerTemplate(node: any, ctx: Ctx): IRNode | null {
  const tAttrs: any[] = node.templateAttrs ?? [];
  const names = tAttrs.map((a) => a.name);
  const get = (n: string): string | undefined => {
    const a = tAttrs.find((x) => x.name === n);
    return a ? tAttrSource(a) : undefined;
  };

  // A literal `<ng-template #ref>` (not a desugared `*`-directive host, whose
  // tagName is the host element). If an *ngIf consumed the ref we drop the node
  // — its content is inlined into that conditional's else/then branch. Otherwise
  // there is no deterministic React form (render-prop vs child component is the
  // human's call), so flag it but keep the content visible.
  if (node.tagName === 'ng-template') {
    const refNames: string[] = (node.references ?? []).map((r: any) => r.name).filter(Boolean);
    if (refNames.some((n) => ctx.consumedRefs.has(n))) return null;
    const label = refNames.length ? refNames.map((n) => `#${n}`).join(' ') : '(anonymous)';
    return preserveWithTodo(
      node,
      `<ng-template ${label}> has no deterministic React form (render-prop or child component); content preserved`,
      lowerChildren(node.children, ctx),
      ctx,
    );
  }

  if (names.includes('ngIf')) {
    const cond = foldExpr(get('ngIf') ?? '', ctx);
    return lowerNgIfWithRefs(node, cond, get, ctx);
  }

  if (names.includes('ngFor') || names.includes('ngForOf')) {
    return lowerNgFor(node, ctx, get);
  }

  if (names.includes('ngSwitchCase') || names.includes('ngSwitchDefault')) {
    return todo(node, '*ngSwitchCase/*ngSwitchDefault outside a [ngSwitch] host', ctx);
  }

  if (names.includes('ngTemplateOutlet')) {
    const ref = get('ngTemplateOutlet') ?? '';
    return preserveWithTodo(
      node,
      `*ngTemplateOutlet="${ref}" has no deterministic React form; render \`${foldExpr(ref, ctx)}\` as a render-prop/child component by hand`,
      lowerChildren(node.children, ctx),
      ctx,
    );
  }

  const dir = names[0] ? `*${names[0]}` : '<ng-template>';
  return todo(node, `structural directive/${dir} not deterministically supported`, ctx);
}

/**
 * `*ngIf="cond; then a else b"` / `*ngIf="cond; else b"` -> an IfNode whose
 * then/else branches inline the referenced `<ng-template>` bodies. A bare
 * `*ngIf` (no refs) keeps the host's own children as the then-branch.
 */
function lowerNgIfWithRefs(
  node: any,
  cond: string,
  get: (n: string) => string | undefined,
  ctx: Ctx,
): IfNode {
  const thenRef = get('ngIfThen');
  const elseRef = get('ngIfElse');

  const resolve = (raw: string | undefined, role: string): IRNode[] | null => {
    if (raw === undefined) return null;
    const name = raw.trim();
    const tpl = ctx.refMap.get(name);
    if (!tpl) {
      ctx.todos.push(`*ngIf ${role} references unknown template #${name}; wire it manually`);
      return null;
    }
    return lowerChildren(tpl.children, ctx);
  };

  const thenChildren = resolve(thenRef, 'then') ?? lowerChildren(node.children, ctx);
  const branches: IfBranch[] = [{ cond, children: thenChildren }];
  const elseChildren = resolve(elseRef, 'else');
  if (elseChildren) branches.push({ cond: null, children: elseChildren });

  return { type: 'if', branches, loc: locOf(node) };
}

/** Lower classic `*ngFor="let x of xs; let i = index; trackBy: fn"` -> ForNode. */
function lowerNgFor(node: any, ctx: Ctx, get: (n: string) => string | undefined): ForNode {
  const iterable = foldExpr(get('ngForOf') ?? '', ctx);
  const vars: any[] = node.variables ?? [];
  const implicit = vars.find((v) => v.value === '$implicit' || v.value === '');
  const item = implicit?.name ?? '_item';

  const contextAliases: Record<string, string> = {};
  for (const v of vars) {
    if (v.value === 'index') contextAliases['$index'] = v.name;
    else if (['first', 'last', 'even', 'odd', 'count'].includes(v.value)) {
      ctx.todos.push(`*ngFor context var \`${v.value}\` (as \`${v.name}\`) has no built-in JSX form — provide manually`);
    }
  }

  // Classic trackBy is a *function* `fn(index, item)`, not a key expression;
  // synthesize an index if the author didn't alias one.
  let trackBy: string | null;
  const tb = get('ngForTrackBy');
  if (tb) {
    if (!contextAliases['$index']) contextAliases['$index'] = 'i';
    trackBy = `${foldExpr(tb, ctx)}(${contextAliases['$index']}, ${item})`;
  } else {
    if (!contextAliases['$index']) contextAliases['$index'] = 'i';
    trackBy = contextAliases['$index'];
    ctx.todos.push('*ngFor without trackBy — using the index as React key; supply a stable key if items reorder');
  }

  return {
    type: 'for',
    item,
    iterable,
    trackBy,
    contextAliases,
    children: lowerChildren(node.children, ctx),
    empty: null,
    loc: locOf(node),
  };
}

/**
 * Lower a `[ngSwitch]` host's children (each a `*ngSwitchCase`/`*ngSwitchDefault`
 * Template) into an IfNode: `case v` -> `switchExpr === v`, `default` -> else.
 */
function lowerSwitch(node: any, switchExpr: string, ctx: Ctx): IfNode {
  const branches: IfBranch[] = [];
  for (const child of node.children ?? []) {
    if (ctor(child) !== 'Template') continue;
    const tAttrs: any[] = child.templateAttrs ?? [];
    const caseAttr = tAttrs.find((a) => a.name === 'ngSwitchCase');
    const isDefault = tAttrs.some((a) => a.name === 'ngSwitchDefault');
    if (caseAttr) {
      const caseVal = foldExpr(tAttrSource(caseAttr), ctx);
      branches.push({ cond: `${switchExpr} === ${caseVal}`, children: lowerChildren(child.children, ctx) });
    } else if (isDefault) {
      branches.push({ cond: null, children: lowerChildren(child.children, ctx) });
    }
  }
  return { type: 'if', branches, loc: locOf(node) };
}

function lowerFor(node: any, ctx: Ctx): ForNode {
  const item: string = node?.item?.name ?? '_item';
  const iterSrc: string = node?.expression?.source ?? '';
  const iterable = foldExpr(iterSrc, ctx);

  const trackBy: string | null = node?.trackBy?.source ?? null;

  const contextAliases: Record<string, string> = {};
  const cvs = node?.contextVariables ?? {};
  for (const key of Object.keys(cvs)) {
    const v = cvs[key];
    // Only record aliases the author actually renamed (name !== canonical).
    if (v && v.name && v.name !== key) contextAliases[key] = v.name;
  }

  return {
    type: 'for',
    item,
    iterable,
    trackBy,
    contextAliases,
    children: lowerChildren(node.children, ctx),
    empty: node.empty ? lowerChildren(node.empty.children, ctx) : null,
    loc: locOf(node),
  };
}
