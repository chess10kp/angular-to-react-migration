/**
 * Angular `.component.ts` -> ComponentModel, using ts-morph.
 *
 * DI in this codebase is resolved by TypeScript type (`inject()` /
 * constructor), so every dependency edge is statically recoverable here — no
 * runtime reflection needed.
 */

import { Project, SyntaxKind, Node } from 'ts-morph';
import type {
  ComponentModel,
  ComputedField,
  Injected,
  InputProp,
  LifecycleHook,
  MethodDef,
  OutputProp,
  PlainField,
  SignalField,
  ThisRef,
  ViewChildRef,
} from '../ir/component.js';

const LIFECYCLE_HOOKS = new Set([
  'ngOnInit',
  'ngOnDestroy',
  'ngOnChanges',
  'ngAfterViewInit',
  'ngAfterContentInit',
  'ngAfterViewChecked',
  'ngAfterContentChecked',
  'ngDoCheck',
]);

export interface ComponentParseResult {
  model: ComponentModel | null;
  errors: string[];
}

/** Pull a string-literal property out of an object literal (e.g. selector). */
function readStringProp(obj: Node, name: string): string | null {
  const oe = obj.asKind(SyntaxKind.ObjectLiteralExpression);
  if (!oe) return null;
  const prop = oe.getProperty(name);
  if (!prop || !Node.isPropertyAssignment(prop)) return null;
  const init = prop.getInitializer();
  if (!init) return null;
  // Plain string literal, or a backtick template with no `${}` interpolation
  // (the common form for inline `template:`).
  if (Node.isStringLiteral(init) || Node.isNoSubstitutionTemplateLiteral(init)) {
    return init.getLiteralValue();
  }
  return null;
}

function readStringArrayOrString(obj: Node, ...names: string[]): string[] {
  const oe = obj.asKind(SyntaxKind.ObjectLiteralExpression);
  if (!oe) return [];
  const out: string[] = [];
  for (const name of names) {
    const prop = oe.getProperty(name);
    if (!prop || !Node.isPropertyAssignment(prop)) continue;
    const init = prop.getInitializer();
    if (!init) continue;
    if (Node.isStringLiteral(init)) out.push(init.getLiteralValue());
    else if (Node.isArrayLiteralExpression(init)) {
      for (const el of init.getElements()) {
        if (Node.isStringLiteral(el)) out.push(el.getLiteralValue());
      }
    }
  }
  return out;
}

export function parseAngularComponent(
  source: string,
  fileName = 'component.ts',
): ComponentParseResult {
  const project = new Project({ useInMemoryFileSystem: true, skipAddingFilesFromTsConfig: true });
  const sf = project.createSourceFile(fileName, source, { overwrite: true });
  const errors: string[] = [];
  const todos: string[] = [];

  const cls = sf.getClasses().find((c) => c.getDecorator('Component'));
  if (!cls) {
    return { model: null, errors: ['no @Component class found'] };
  }

  const decorator = cls.getDecorator('Component')!;
  const arg = decorator.getArguments()[0];
  const selector = arg ? readStringProp(arg, 'selector') : null;
  const templateUrl = arg ? readStringProp(arg, 'templateUrl') : null;
  const inlineTemplate = arg ? readStringProp(arg, 'template') : null;
  const styleUrls = arg ? readStringArrayOrString(arg, 'styleUrl', 'styleUrls') : [];

  const inputs: InputProp[] = [];
  const outputs: OutputProp[] = [];
  const injected: Injected[] = [];
  const viewChildren: ViewChildRef[] = [];
  const signals: SignalField[] = [];
  const computeds: ComputedField[] = [];
  const plainFields: PlainField[] = [];
  const methods: MethodDef[] = [];
  const lifecycle: LifecycleHook[] = [];

  for (const prop of cls.getProperties()) {
    const name = prop.getName();
    const init = prop.getInitializer();
    const typeNode = prop.getTypeNode();
    const typeText = typeNode?.getText() ?? null;

    // @Input()
    if (prop.getDecorator('Input')) {
      inputs.push({
        name,
        type: typeText ?? inferInitType(init?.getText()) ?? 'unknown',
        required: prop.hasExclamationToken() || inputDecoratorRequired(prop),
        default: init?.getText() ?? null,
      });
      continue;
    }
    // @Output()
    if (prop.getDecorator('Output')) {
      outputs.push({ name, payloadType: extractEmitterPayload(typeText, init?.getText()) });
      continue;
    }
    // @ViewChild(...) / @ViewChildren(...)
    const vcDec = prop.getDecorator('ViewChild') ?? prop.getDecorator('ViewChildren');
    if (vcDec) {
      const isList = vcDec.getName() === 'ViewChildren';
      const selArg = vcDec.getArguments()[0];
      viewChildren.push({
        propName: name,
        selector: selArg?.getText() ?? '',
        isList,
        type: typeText,
      });
      continue;
    }

    const initText = init?.getText() ?? '';
    // signal<T>(init)
    const sigMatch = initText.match(/^signal\s*(?:<([^>]*)>)?\s*\((.*)\)\s*$/s);
    if (sigMatch) {
      signals.push({ name, typeArg: sigMatch[1]?.trim() ?? null, init: sigMatch[2].trim() });
      continue;
    }
    // computed(() => …)
    if (/^computed\s*\(/.test(initText)) {
      const { text, blockBody, thisRefs } = extractArrowBody(init);
      computeds.push({ name, expr: text, blockBody, thisRefs });
      continue;
    }
    // inject(X)
    const injMatch = initText.match(/^inject\s*\(\s*([^)]*?)\s*\)/);
    if (injMatch) {
      injected.push({ propName: name, token: injMatch[1].trim(), via: 'inject' });
      continue;
    }
    plainFields.push({ name, type: typeText, init: init?.getText() ?? null });
  }

  // Get accessors -> derived values (like computed, block body).
  for (const getter of cls.getGetAccessors()) {
    const bodyNode = getter.getBody();
    const { text, refs } =
      bodyNode && Node.isBlock(bodyNode) ? blockBodyWithRefs(bodyNode) : { text: '', refs: [] };
    computeds.push({ name: getter.getName(), expr: text, blockBody: true, thisRefs: refs });
  }

  // Constructor-injected dependencies.
  const ctor = cls.getConstructors()[0];
  if (ctor) {
    for (const param of ctor.getParameters()) {
      const t = param.getTypeNode()?.getText();
      if (t) injected.push({ propName: param.getName(), token: t, via: 'constructor' });
    }
    if (ctor.getStatements().length > 0) {
      todos.push('constructor has statements — review for React init/effect placement');
    }
  }

  for (const method of cls.getMethods()) {
    const name = method.getName();
    const bodyNode = method.getBody();
    const { text: body, refs } =
      bodyNode && Node.isBlock(bodyNode) ? blockBodyWithRefs(bodyNode) : { text: '', refs: [] };
    const subscribeCount = bodyNode ? countSubscribes(bodyNode) : 0;
    if (LIFECYCLE_HOOKS.has(name)) {
      lifecycle.push({ name, body, isAsync: method.isAsync(), thisRefs: refs, subscribeCount });
      continue;
    }
    methods.push({
      name,
      params: method.getParameters().map((p) => p.getText()).join(', '),
      returnType: method.getReturnTypeNode()?.getText() ?? null,
      body,
      usesThis: refs.length > 0,
      thisRefs: refs,
      subscribeCount,
    });
  }

  const model: ComponentModel = {
    className: cls.getName() ?? 'AnonymousComponent',
    isDefaultExport: cls.isDefaultExport(),
    selector,
    templateUrl,
    inlineTemplate,
    styleUrls,
    inputs,
    outputs,
    injected,
    viewChildren,
    signals,
    computeds,
    plainFields,
    methods,
    lifecycle,
    todos,
  };
  return { model, errors };
}

function inputDecoratorRequired(prop: Node): boolean {
  const p = prop.asKind(SyntaxKind.PropertyDeclaration);
  const dec = p?.getDecorator('Input');
  const arg = dec?.getArguments()[0];
  return arg ? /required\s*:\s*true/.test(arg.getText()) : false;
}

function inferInitType(initText?: string): string | null {
  if (!initText) return null;
  if (/^['"`]/.test(initText)) return 'string';
  if (/^(true|false)$/.test(initText)) return 'boolean';
  if (/^-?\d/.test(initText)) return 'number';
  return null;
}

function extractEmitterPayload(typeText: string | null, initText?: string): string {
  const src = typeText ?? initText ?? '';
  const m = src.match(/EventEmitter\s*<\s*([^>]*)\s*>/);
  return m ? m[1].trim() : 'unknown';
}

function extractArrowBody(init?: Node): { text: string; blockBody: boolean; thisRefs: ThisRef[] } {
  if (!init) return { text: '', blockBody: false, thisRefs: [] };
  const call = init.asKind(SyntaxKind.CallExpression);
  const arrow = call?.getArguments()[0]?.asKind(SyntaxKind.ArrowFunction);
  if (!arrow) {
    const { text, refs } = exprBodyWithRefs(init);
    return { text, blockBody: false, thisRefs: refs };
  }
  const body = arrow.getBody();
  if (Node.isBlock(body)) {
    const { text, refs } = blockBodyWithRefs(body);
    return { text, blockBody: true, thisRefs: refs };
  }
  const { text, refs } = exprBodyWithRefs(body);
  return { text, blockBody: false, thisRefs: refs };
}

/** Strip the outer `{ … }` from a block's text and trim. */
function innerBlockText(blockText: string): string {
  const open = blockText.indexOf('{');
  const close = blockText.lastIndexOf('}');
  if (open === -1 || close === -1) return blockText.trim();
  return blockText.slice(open + 1, close).trim();
}

/**
 * Extract a block body's inner text (as `innerBlockText` does) together with
 * every `this.<member>` access, located via the AST so string/comment
 * occurrences are excluded. Ref offsets are relative to the returned text.
 */
function blockBodyWithRefs(bodyNode: Node): { text: string; refs: ThisRef[] } {
  const full = bodyNode.getText();
  const open = full.indexOf('{');
  const close = full.lastIndexOf('}');
  if (open === -1 || close === -1) {
    return { text: full.trim(), refs: collectThisRefs(bodyNode, bodyNode.getStart()) };
  }
  const inner = full.slice(open + 1, close);
  const leading = inner.length - inner.trimStart().length;
  const text = inner.trim();
  // Source offset that corresponds to index 0 of `text`.
  const baseStart = bodyNode.getStart() + open + 1 + leading;
  return { text, refs: collectThisRefs(bodyNode, baseStart, text.length) };
}

/** Same as `blockBodyWithRefs` but for an expression-bodied node (no braces). */
function exprBodyWithRefs(exprNode: Node): { text: string; refs: ThisRef[] } {
  const text = exprNode.getText();
  return { text, refs: collectThisRefs(exprNode, exprNode.getStart(), text.length) };
}

/**
 * Count `.subscribe(...)` call sites in a body via the AST (never regex), so a
 * `subscribe` inside a string literal or comment is never counted. Used to
 * surface RxJS teardown residue on methods/lifecycle hooks.
 */
function countSubscribes(container: Node): number {
  let n = 0;
  for (const call of container.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const callee = call.getExpression();
    if (Node.isPropertyAccessExpression(callee) && callee.getName() === 'subscribe') n++;
  }
  return n;
}

/**
 * Walk `container` for every `this.<member>` property access and record its
 * shape and position (offsets relative to a body string that begins at
 * `baseStart` in the source). Refs whose span escapes `[0, maxLen]` are
 * dropped as a safety guard. Because we key off real PropertyAccessExpression
 * nodes, `this.` inside a string literal or comment is never a ref.
 */
function collectThisRefs(container: Node, baseStart: number, maxLen = Infinity): ThisRef[] {
  const refs: ThisRef[] = [];
  for (const thisNode of container.getDescendantsOfKind(SyntaxKind.ThisKeyword)) {
    const pae = thisNode.getParent();
    if (!pae || !Node.isPropertyAccessExpression(pae) || pae.getExpression() !== thisNode) continue;
    const start = pae.getStart() - baseStart;
    const end = pae.getEnd() - baseStart;
    if (start < 0 || end > maxLen) continue;

    let directCall = false;
    let directCallArgCount = 0;
    let callEnd: number | null = null;
    let method: string | null = null;
    let methodEnd: number | null = null;

    const parent = pae.getParent();
    if (parent && Node.isCallExpression(parent) && parent.getExpression() === pae) {
      directCall = true;
      directCallArgCount = parent.getArguments().length;
      callEnd = parent.getEnd() - baseStart;
    } else if (parent && Node.isPropertyAccessExpression(parent) && parent.getExpression() === pae) {
      // this.<member>.m — a rewrite target only if `.m` is itself called.
      const gp = parent.getParent();
      if (gp && Node.isCallExpression(gp) && gp.getExpression() === parent) {
        method = parent.getName();
        methodEnd = parent.getEnd() - baseStart;
      }
    }

    refs.push({
      member: pae.getName(),
      start,
      end,
      directCall,
      directCallArgCount,
      callEnd,
      method,
      methodEnd,
    });
  }
  refs.sort((a, b) => a.start - b.start);
  return refs;
}
