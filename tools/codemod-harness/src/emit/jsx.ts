/**
 * Internal Template IR -> React JSX, via a real Babel AST.
 *
 * We construct `@babel/types` JSX nodes (not strings), embedding translated
 * expressions parsed with `@babel/parser`. `@babel/generator` prints the AST
 * and Prettier normalizes formatting so snapshots are stable and idempotent.
 *
 * Every construct the deterministic path rejects is emitted as a JSX comment
 * `{/* MIGRATION_TODO: ... *\/}` — visible residue, never a silent drop.
 */

import { parseExpression } from '@babel/parser';
import _generate from '@babel/generator';
import * as t from '@babel/types';
import type {
  ElementNode,
  ForNode,
  IfNode,
  InterpolationNode,
  IRNode,
  TodoNode,
} from '../ir/types.js';

// @babel/generator ships a CJS default export; under NodeNext the callable is
// sometimes on `.default`. Normalize to a single callable.
const generate = ((_generate as any).default ?? _generate) as typeof import('@babel/generator').default;

export interface EmitResult {
  code: string;
  /** Import hints the emitter needs the caller to satisfy (e.g. Fragment). */
  imports: Set<string>;
  /** Residue discovered during emit (e.g. expressions that aren't valid JS). */
  todos: string[];
}

interface EmitCtx {
  imports: Set<string>;
  todos: string[];
  /** Bare identifiers renamed by the component emitter (reserved-word methods). */
  renames: ReadonlyMap<string, string>;
}

/**
 * Parse a translated expression string into a Babel expression node. Angular
 * binding expressions are mostly valid JS, but some (safe-navigation chains,
 * pipe residue, template-only syntax) are not. Rather than crash the whole
 * file, we record residue and substitute a visible sentinel identifier so the
 * emitted JSX still parses and the TODO is greppable.
 */
function expr(code: string, ctx: EmitCtx): t.Expression {
  try {
    return parseExpression(code, { plugins: ['typescript'] });
  } catch (e) {
    ctx.todos.push(`expression not translatable to JS: \`${code}\` (${(e as Error).message})`);
    const sentinel = t.identifier('MIGRATION_TODO');
    t.addComment(sentinel, 'trailing', ` was: ${code.replace(/\*\//g, '* /')} `, false);
    return sentinel;
  }
}

function jsxComment(text: string): t.JSXExpressionContainer {
  const container = t.jsxExpressionContainer(t.jsxEmptyExpression());
  t.addComment(container.expression, 'inner', ` MIGRATION_TODO: ${text} `, false);
  return container;
}

type JSXChild = t.JSXElement['children'][number];

/**
 * Emit a list of IR nodes as a flat array of JSX children. Interpolation runs
 * are spliced in segment-by-segment rather than wrapped in a Fragment, so
 * `{{ a }}: {{ b }}` renders as `{a}: {b}` inside its parent, not `<>{a}: {b}</>`.
 */
function emitChildrenFlat(children: IRNode[], ctx: EmitCtx): JSXChild[] {
  const out: JSXChild[] = [];
  for (const c of children) {
    if (c.type === 'interpolation') {
      for (const s of c.segments) {
        out.push(s.kind === 'text' ? t.jsxText(s.value) : t.jsxExpressionContainer(expr(s.expr, ctx)));
      }
      continue;
    }
    const node = emitChild(c, ctx);
    if (node) out.push(node);
  }
  return out;
}

/** Wrap a list of JSX children into a single expression node (Fragment if >1). */
function childrenToExpression(children: IRNode[], ctx: EmitCtx): t.Expression {
  const nodes = emitChildrenFlat(children, ctx);
  const meaningful = nodes.filter(
    (n) => !(t.isJSXText(n) && n.value.trim() === ''),
  );
  if (meaningful.length === 1) {
    const only = meaningful[0];
    if (t.isJSXElement(only) || t.isJSXFragment(only)) return only;
    if (t.isJSXExpressionContainer(only) && t.isExpression(only.expression)) {
      return only.expression;
    }
    if (t.isJSXText(only)) return t.stringLiteral(only.value.trim());
  }
  return t.jsxFragment(t.jsxOpeningFragment(), t.jsxClosingFragment(), nodes);
}

/** Emit a node as a JSX child (JSXText / element / expression container). */
function emitChild(node: IRNode, ctx: EmitCtx): t.JSXElement['children'][number] | null {
  switch (node.type) {
    case 'text': {
      const v = node.value;
      if (v.trim() === '') return t.jsxText(v);
      // JSXText cannot contain { } < > — route those through a string literal.
      if (/[{}<>]/.test(v)) {
        return t.jsxExpressionContainer(t.stringLiteral(v));
      }
      return t.jsxText(v);
    }
    case 'interpolation':
      return emitInterpolation(node, ctx);
    case 'element':
      return emitElement(node, ctx);
    case 'if':
      return t.jsxExpressionContainer(emitIf(node, ctx));
    case 'for':
      return t.jsxExpressionContainer(emitFor(node, ctx));
    case 'todo':
      return jsxComment((node as TodoNode).reason);
  }
}

function emitInterpolation(node: InterpolationNode, ctx: EmitCtx): t.JSXElement['children'][number] {
  // A single expr segment -> {expr}; a single text -> JSXText; mixed -> Fragment.
  if (node.segments.length === 1) {
    const s = node.segments[0];
    if (s.kind === 'text') return t.jsxText(s.value);
    return t.jsxExpressionContainer(expr(s.expr, ctx));
  }
  const kids = node.segments.map((s) =>
    s.kind === 'text' ? t.jsxText(s.value) : t.jsxExpressionContainer(expr(s.expr, ctx)),
  );
  return t.jsxFragment(t.jsxOpeningFragment(), t.jsxClosingFragment(), kids as any);
}

function jsxName(name: string): t.JSXIdentifier {
  return t.jsxIdentifier(name);
}

/**
 * Merge every class source on an element into ONE `className` — static `class`,
 * each `[class.x]="c"`, and `[ngClass]="e"`. Multiple/dynamic sources go through
 * `clsx(...)`; a lone static class stays a plain string. Returns null if none.
 */
function emitClassName(
  node: ElementNode,
  staticClass: string | null,
  ctx: EmitCtx,
): t.JSXAttribute | null {
  const classBindings = node.props.filter((p) => p.kind === 'class');
  const ngClasses = node.props.filter((p) => p.kind === 'ngclass');
  // `routerLinkActive` on a <NavLink> -> `isActive && 'class'` inside a fn form.
  const activeClasses = node.props.filter((p) => p.kind === 'activeclass');
  if (classBindings.length === 0 && ngClasses.length === 0 && activeClasses.length === 0) {
    return staticClass !== null
      ? t.jsxAttribute(jsxName('className'), t.stringLiteral(staticClass))
      : null;
  }
  const args: t.Expression[] = [];
  if (staticClass !== null) args.push(t.stringLiteral(staticClass));
  if (classBindings.length > 0) {
    // [class.on]="c" [class.off]="d" -> { on: c, off: d }
    args.push(
      t.objectExpression(
        classBindings.map((p) =>
          t.objectProperty(t.stringLiteral(p.unit ?? p.name), expr(p.expr, ctx)),
        ),
      ),
    );
  }
  for (const ng of ngClasses) args.push(expr(ng.expr, ctx));
  for (const a of activeClasses) {
    args.push(t.logicalExpression('&&', t.identifier('isActive'), expr(a.expr, ctx)));
  }
  ctx.imports.add('clsx');
  const clsxCall = t.callExpression(t.identifier('clsx'), args);
  // NavLink's className takes a render fn: `({ isActive }) => clsx(...)`.
  const value: t.Expression =
    activeClasses.length > 0
      ? t.arrowFunctionExpression(
          [t.objectPattern([t.objectProperty(t.identifier('isActive'), t.identifier('isActive'), false, true)])],
          clsxCall,
        )
      : clsxCall;
  return t.jsxAttribute(jsxName('className'), t.jsxExpressionContainer(value));
}

/**
 * Merge every style source into ONE `style` object — static `style`, each
 * `[style.p]="v"`, and `[ngStyle]="obj"` (spread first so explicit `[style.p]`
 * wins, matching Angular precedence). Returns null if none.
 */
function emitStyle(
  node: ElementNode,
  staticStyle: string | null,
  ctx: EmitCtx,
): t.JSXAttribute | null {
  const styleBindings = node.props.filter((p) => p.kind === 'style');
  const ngStyles = node.props.filter((p) => p.kind === 'ngstyle');
  const staticEntries = staticStyle ? parseInlineStyle(staticStyle, ctx) : [];
  if (styleBindings.length === 0 && ngStyles.length === 0 && staticEntries.length === 0) {
    return null;
  }
  const members: Array<t.ObjectProperty | t.SpreadElement> = [];
  for (const ng of ngStyles) members.push(t.spreadElement(expr(ng.expr, ctx)));
  for (const [k, v] of staticEntries) {
    members.push(t.objectProperty(t.identifier(camelCase(k)), t.stringLiteral(v)));
  }
  for (const p of styleBindings) {
    members.push(t.objectProperty(t.identifier(camelCase(p.unit ?? p.name)), expr(p.expr, ctx)));
  }
  return t.jsxAttribute(jsxName('style'), t.jsxExpressionContainer(t.objectExpression(members)));
}

/** Best-effort parse of an inline `style="a: 1; b: 2"` string into entries. */
function parseInlineStyle(src: string, ctx: EmitCtx): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  for (const decl of src.split(';')) {
    const trimmed = decl.trim();
    if (!trimmed) continue;
    const colon = trimmed.indexOf(':');
    if (colon === -1) {
      ctx.todos.push(`could not parse inline style declaration \`${trimmed}\``);
      continue;
    }
    out.push([trimmed.slice(0, colon).trim(), trimmed.slice(colon + 1).trim()]);
  }
  return out;
}

const ROUTER_TAGS = new Set(['Link', 'NavLink', 'Outlet']);

function emitElement(node: ElementNode, ctx: EmitCtx): t.JSXElement | t.JSXFragment {
  // <ng-container> is a grouping-only host with no DOM output -> a Fragment.
  if (node.tag === 'ng-container') {
    return t.jsxFragment(
      t.jsxOpeningFragment(),
      t.jsxClosingFragment(),
      emitChildrenFlat(node.children, ctx),
    );
  }
  if (ROUTER_TAGS.has(node.tag)) ctx.imports.add(node.tag);

  const attributes: Array<t.JSXAttribute | t.JSXSpreadAttribute> = [];

  // Static attrs, except class/style which are merged with their bindings below.
  const staticClass = node.attrs.find((a) => a.name === 'className')?.value ?? null;
  const staticStyle = node.attrs.find((a) => a.name === 'style')?.value ?? null;
  for (const a of node.attrs) {
    if (a.name === 'className' || a.name === 'style') continue;
    attributes.push(t.jsxAttribute(jsxName(a.name), t.stringLiteral(a.value)));
  }

  const classAttr = emitClassName(node, staticClass, ctx);
  if (classAttr) attributes.push(classAttr);
  const styleAttr = emitStyle(node, staticStyle, ctx);
  if (styleAttr) attributes.push(styleAttr);

  for (const p of node.props) {
    if (
      p.kind === 'class' || p.kind === 'ngclass' || p.kind === 'activeclass' ||
      p.kind === 'style' || p.kind === 'ngstyle'
    ) {
      continue; // folded into className/style above
    }
    if (p.kind === 'property') {
      attributes.push(
        t.jsxAttribute(jsxName(p.name), t.jsxExpressionContainer(expr(p.expr, ctx))),
      );
    } else {
      // attribute binding [attr.role]="r" -> role={r}
      attributes.push(
        t.jsxAttribute(jsxName(p.name), t.jsxExpressionContainer(expr(p.expr, ctx))),
      );
    }
  }

  for (const ev of node.events) {
    const { mapEventName, translateHandler } = eventHelpers;
    const mapped = mapEventName(ev.name);
    if (!mapped.reactProp) {
      ctx.todos.push(mapped.reason ?? `unmappable event \`(${ev.name})\``);
      attributes.push(
        t.jsxAttribute(
          jsxName('data-migration-todo'),
          t.stringLiteral(mapped.reason ?? `event (${ev.name})`),
        ),
      );
      continue;
    }
    const { code } = translateHandler(ev.handler, ctx.renames);
    const usesEvent = /\be\b/.test(code);
    const arrow = t.arrowFunctionExpression(
      usesEvent ? [t.identifier('e')] : [],
      expr(code, ctx),
    );
    attributes.push(t.jsxAttribute(jsxName(mapped.reactProp), t.jsxExpressionContainer(arrow)));
  }

  const children = emitChildrenFlat(node.children, ctx);
  const selfClosing = children.length === 0;
  return t.jsxElement(
    t.jsxOpeningElement(jsxName(node.tag), attributes, selfClosing),
    selfClosing ? null : t.jsxClosingElement(jsxName(node.tag)),
    children,
    selfClosing,
  );
}

function emitIf(node: IfNode, ctx: EmitCtx): t.Expression {
  const branches = node.branches;
  // No else + single branch -> `cond && <body>`.
  const hasElse = branches.length > 0 && branches[branches.length - 1].cond === null;
  if (branches.length === 1 && !hasElse) {
    return t.logicalExpression('&&', expr(branches[0].cond!, ctx), childrenToExpression(branches[0].children, ctx));
  }
  // Build a conditional chain from the tail up.
  let acc: t.Expression;
  let start: number;
  if (hasElse) {
    acc = childrenToExpression(branches[branches.length - 1].children, ctx);
    start = branches.length - 2;
  } else {
    acc = t.nullLiteral();
    start = branches.length - 1;
  }
  for (let i = start; i >= 0; i--) {
    const b = branches[i];
    acc = t.conditionalExpression(expr(b.cond!, ctx), childrenToExpression(b.children, ctx), acc);
  }
  return acc;
}

function emitFor(node: ForNode, ctx: EmitCtx): t.Expression {
  const params: t.Identifier[] = [t.identifier(node.item)];
  const indexAlias = node.contextAliases['$index'];
  // Warn on unsupported context aliases via a todo comment attribute is hard on
  // an expression; the parser already recorded these in ctx.todos.
  if (indexAlias) params.push(t.identifier(indexAlias));

  const body = childrenToExpression(node.children, ctx);

  // Attach key to the mapped root when it is a single element; otherwise wrap.
  let keyed: t.Expression = body;
  if (node.trackBy) {
    if (t.isJSXElement(body)) {
      body.openingElement.attributes.unshift(
        t.jsxAttribute(t.jsxIdentifier('key'), t.jsxExpressionContainer(expr(node.trackBy, ctx))),
      );
      keyed = body;
    } else {
      ctx.imports.add('Fragment');
      keyed = t.jsxElement(
        t.jsxOpeningElement(t.jsxIdentifier('Fragment'), [
          t.jsxAttribute(t.jsxIdentifier('key'), t.jsxExpressionContainer(expr(node.trackBy, ctx))),
        ]),
        t.jsxClosingElement(t.jsxIdentifier('Fragment')),
        t.isJSXFragment(body) ? body.children : [t.jsxExpressionContainer(body)],
      );
    }
  }

  const callback = t.arrowFunctionExpression(params, keyed);
  const mapCall = t.callExpression(
    t.memberExpression(expr(node.iterable, ctx), t.identifier('map')),
    [callback],
  );

  if (node.empty) {
    // items.length ? items.map(...) : <empty>
    const lengthGuard = t.memberExpression(expr(node.iterable, ctx), t.identifier('length'));
    return t.conditionalExpression(lengthGuard, mapCall, childrenToExpression(node.empty, ctx));
  }
  return mapCall;
}

function camelCase(s: string): string {
  return s.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
}

// Late import to avoid a cycle in module init order.
import * as eventHelpers from '../expr.js';

/**
 * Emit a full template (a list of root IR nodes) as a JSX expression string.
 * Multiple roots are wrapped in a Fragment (`<>...</>`).
 *
 * @param renames  optional bare-identifier renames (reserved-word methods) so
 *                 event handlers like `(click)="delete(x)"` emit `deleteItem(x)`
 *                 matching the component emitter's `safeIdentifier` rewrite.
 */
export function emitTemplate(
  nodes: IRNode[],
  renames: ReadonlyMap<string, string> = new Map(),
): EmitResult {
  const ctx: EmitCtx = { imports: new Set(), todos: [], renames };
  const rootExpr = childrenToExpression(nodes, ctx);
  const wrapped = t.parenthesizedExpression(rootExpr);
  const { code } = generate(wrapped, { jsescOption: { minimal: true }, retainLines: false });
  return { code, imports: ctx.imports, todos: ctx.todos };
}
