/**
 * ComponentModel + template JSX -> a React `.tsx` module (as a string).
 *
 * SLICE 2 CONTRACT: the *structure* is deterministic (props interface, function
 * component, method stubs, inlined template). The *semantics* Angular expresses
 * through DI, signals, and lifecycle hooks are NOT fabricated into React
 * equivalents — that is the "assisted, reviewer-gated" work from the plan. We
 * emit them as `MIGRATION_TODO` residue with the original code preserved, so a
 * human (or a later agent pass) resolves them deliberately rather than trusting
 * a blind `useEffect`/`useState` guess.
 */

import type { ComponentModel, LifecycleHook, ThisRef } from '../ir/component.js';

export interface ComponentEmit {
  code: string;
  /** React named imports the module needs (useState, Fragment, …). */
  reactImports: Set<string>;
  todos: string[];
}

export interface EmitComponentOptions {
  /** Raw JSX expression for the template body (from the template transform). */
  jsxExpr: string;
  /** Fragment/etc. imports the template needs. */
  templateImports: string[];
  /** True if the template uses `t(...)` (from `| translate` / `jhiTranslate`). */
  usesTranslate?: boolean;
  /** `@angular/common`-pipe helper fns the template calls (e.g. `formatDate`). */
  helpers?: string[];
  /** Expressions bound through the `async` pipe (`x | async`) needing unwrap at component scope. */
  asyncBindings?: string[];
}

export function emitComponent(model: ComponentModel, opts: EmitComponentOptions): ComponentEmit {
  const todos: string[] = [...model.todos];
  const reactImports = new Set<string>();
  // Some template import hints belong to other modules, not React.
  const ROUTER = new Set(['Link', 'NavLink', 'Outlet']);
  const usesClsx = opts.templateImports.includes('clsx');
  const routerImports = opts.templateImports.filter((i) => ROUTER.has(i));
  // react-router-dom hooks pulled in by DI mappings (useNavigate, useParams…).
  const routerHookImports = new Set<string>();
  for (const imp of opts.templateImports) {
    if (imp !== 'clsx' && !ROUTER.has(imp)) reactImports.add(imp);
  }

  const lines: string[] = [];
  const { rewrite: rewriteThis, state: rewriteState } = buildThisRewriter(model);

  // --- Props interface (deterministic) ---
  const hasProps = model.inputs.length > 0 || model.outputs.length > 0;
  if (hasProps) {
    lines.push(`export interface ${model.className}Props {`);
    for (const inp of model.inputs) {
      const optional = inp.required ? '' : '?';
      lines.push(`  ${inp.name}${optional}: ${inp.type};`);
    }
    for (const out of model.outputs) {
      // @Output() foo: EventEmitter<T> -> onFoo?: (payload: T) => void
      const handler = 'on' + out.name.charAt(0).toUpperCase() + out.name.slice(1);
      lines.push(`  ${handler}?: (payload: ${out.payloadType}) => void;`);
    }
    lines.push('}');
    lines.push('');
  }

  // --- Component function signature ---
  const propParam = hasProps
    ? `{ ${[...model.inputs.map((i) => i.name), ...model.outputs.map((o) => 'on' + o.name.charAt(0).toUpperCase() + o.name.slice(1))].join(', ')} }: ${model.className}Props`
    : '';
  lines.push(`export function ${model.className}(${propParam}) {`);

  // --- Injected dependencies -> React hooks/context (known tokens mapped; rest flagged) ---
  const translateFromDi = emitInjected(model, lines, reactImports, routerHookImports, todos);

  // --- react-i18next hook (deterministic): `| translate` / jhiTranslate -> t() ---
  // Skip if an injected TranslateService already emitted the fuller destructure.
  if (opts.usesTranslate && !translateFromDi) {
    lines.push('  const { t } = useTranslation();');
  }
  const usesTranslate = opts.usesTranslate || translateFromDi;

  // --- @ViewChild/@ViewChildren -> useRef (structure emitted; semantics flagged) ---
  emitViewChildren(model, lines, reactImports, todos);

  // --- async pipe (`x | async`) -> component-scope unwrap hook stub (flagged) ---
  for (const expr of new Set(opts.asyncBindings ?? [])) {
    const name = asyncLocalName(expr);
    lines.push(
      `  // MIGRATION_TODO(async): template bound \`${expr} | async\`; unwrap the Observable/Promise at component scope,`,
    );
    lines.push(
      `  // e.g. \`const ${name} = useObservable(${expr});\` (or useState+useEffect+subscribe with teardown), then use \`${name}\` in JSX.`,
    );
    todos.push(`async pipe: unwrap \`${expr}\` at component scope (useObservable / useState+useEffect) and bind \`${name}\` in JSX`);
  }

  // --- Signals -> candidate useState (emitted, but flagged) ---
  for (const sig of model.signals) {
    reactImports.add('useState');
    const setter = 'set' + sig.name.charAt(0).toUpperCase() + sig.name.slice(1);
    const typeArg = sig.typeArg ? `<${sig.typeArg}>` : '';
    lines.push(
      `  const [${sig.name}, ${setter}] = useState${typeArg}(${sig.init});` +
        ` // MIGRATION_TODO(state): verify signal semantics; \`${sig.name}()\` reads -> \`${sig.name}\`, \`${sig.name}.set(x)\` -> \`${setter}(x)\``,
    );
    todos.push(`state: signal \`${sig.name}\` -> useState (verify read/write call sites)`);
  }

  // --- computed()/getter -> render-time derived value (this. rewired) ---
  for (const c of model.computeds) {
    const r = rewriteThis(c.expr, c.thisRefs);
    const value = c.blockBody ? `(() => {\n    ${r.code}\n  })()` : r.code;
    const note = thisResidueNote(r);
    lines.push(
      `  const ${c.name} = ${value}; // MIGRATION_TODO(derived): was computed()/getter; confirm no memo needed${note ? ` — ${note}` : ''}`,
    );
  }

  // --- Plain fields -> module/component constants (RxJS/forms fields flagged) ---
  for (const f of model.plainFields) {
    if (/\bObservable\s*</.test(f.type ?? '') || /\$$/.test(f.name)) {
      todos.push(`rxjs: field \`${f.name}\`${f.type ? `: ${f.type}` : ''} is an Observable — candidate useState+effect or a useObservable() hook`);
      lines.push(
        `  // MIGRATION_TODO(rxjs): \`${f.name}\`${f.type ? `: ${f.type}` : ''} is an Observable — subscribe in a useEffect (unsubscribe in teardown) into useState, or a useObservable() hook.`,
      );
      if (f.init) lines.push(...emitWasInit(f.name, f.init));
      continue;
    }
    if (/\b(FormGroup|FormControl|FormArray)\b/.test(f.type ?? '') || /\b(FormBuilder|FormGroup|FormControl|FormArray)\b/.test(f.init ?? '')) {
      todos.push(`forms: field \`${f.name}\`${f.type ? `: ${f.type}` : ''} is a reactive form — port to react-hook-form (useForm) or controlled state`);
      lines.push(
        `  // MIGRATION_TODO(forms): \`${f.name}\`${f.type ? `: ${f.type}` : ''} is an Angular reactive form — port to react-hook-form (useForm/register) or controlled component state; \`.get('x')\` -> the form's field/value.`,
      );
      if (f.init) lines.push(...emitWasInit(f.name, f.init));
      continue;
    }
    if (f.init) lines.push(`  const ${f.name} = ${f.init};`);
    else lines.push(`  // MIGRATION_TODO(field): \`${f.name}\`${f.type ? `: ${f.type}` : ''} had no initializer`);
  }

  // --- Methods -> inner functions (this. rewired to props/state/hooks) ---
  for (const m of model.methods) {
    const rt = m.returnType ? `: ${m.returnType}` : '';
    const safeName = safeIdentifier(m.name);
    if (safeName !== m.name) {
      todos.push(`method \`${m.name}\` is a JS reserved word — renamed to \`${safeName}\`; template call sites rewritten`);
      lines.push(`  // MIGRATION_TODO(rename): \`${m.name}\` is a reserved word -> \`${safeName}\``);
    }
    const r = rewriteThis(m.body, m.thisRefs);
    const note = thisResidueNote(r);
    if (note) {
      todos.push(`method \`${m.name}\`: ${note}`);
      lines.push(`  // MIGRATION_TODO(this): ${note}`);
    }
    if (m.subscribeCount > 0) {
      todos.push(`rxjs: method \`${m.name}\` has ${m.subscribeCount} .subscribe() call(s) — store the subscription and unsubscribe on teardown (or move into a useEffect)`);
      lines.push(`  // MIGRATION_TODO(rxjs): ${m.subscribeCount} .subscribe() call(s) below — capture the Subscription and unsubscribe (React has no ngOnDestroy; prefer a useEffect with cleanup).`);
    }
    if (/\bObservable\s*</.test(m.returnType ?? '')) {
      todos.push(`rxjs: method \`${m.name}\` returns ${m.returnType} — callers must subscribe/unwrap (candidate useObservable or async/await over a Promise)`);
      lines.push(`  // MIGRATION_TODO(rxjs): returns \`${m.returnType}\` — callers still need to subscribe/unwrap this Observable.`);
    }
    lines.push(`  function ${safeName}(${m.params})${rt} {`);
    for (const bodyLine of r.code.split('\n')) lines.push(bodyLine ? `    ${bodyLine}` : bodyLine);
    lines.push(`  }`);
  }

  // --- Lifecycle -> useEffect (structure deterministic; this. rewired in body) ---
  emitLifecycle(model, lines, reactImports, todos, rewriteThis);

  // --- Return the inlined template ---
  lines.push('');
  lines.push(`  return (${opts.jsxExpr});`);
  lines.push('}');

  // --- Assemble imports header ---
  const header: string[] = [];
  if (rewriteState.usesAxios) {
    header.push(`import axios from 'axios';`);
  }
  if (reactImports.size > 0) {
    header.push(`import { ${[...reactImports].sort().join(', ')} } from 'react';`);
  }
  if (usesTranslate) {
    header.push(`import { useTranslation } from 'react-i18next';`);
  }
  if (usesClsx) {
    header.push(`import clsx from 'clsx';`);
  }
  const allRouter = [...new Set([...routerImports, ...routerHookImports])].sort();
  if (allRouter.length > 0) {
    header.push(`import { ${allRouter.join(', ')} } from 'react-router-dom';`);
  }
  if (opts.helpers && opts.helpers.length > 0) {
    const list = [...new Set(opts.helpers)].sort();
    header.push(
      `// MIGRATION_TODO(helpers): provide ${list.join(', ')} ` +
        `(from '@angular/common' pipe equivalents — e.g. a date/number util or Intl).`,
    );
    todos.push(`pipe helpers referenced: ${list.join(', ')} — provide implementations`);
  }
  if (model.styleUrls.length > 0) {
    for (const s of model.styleUrls) header.push(`import '${s.replace(/\.scss$/, '.css')}';`);
  }
  if (header.length) header.push('');

  return { code: header.join('\n') + '\n' + lines.join('\n') + '\n', reactImports, todos };
}

/** Result of rewiring `this.` refs in one body. */
interface RewriteResult {
  code: string;
  /** `this.X` refs left unresolved (known-token API calls, unknown members). */
  remaining: string[];
  /** signal `.update()` sites rewritten to a setter (semantics need a glance). */
  updates: string[];
  /** HTTP verb methods rewritten `this.http.get(…)` -> `axios.get(…)`. */
  httpVerbs: string[];
}

/** Mutable side-effects accumulated across every `this.`-rewrite in a module. */
interface RewriteState {
  /** True once any `this.http.<verb>()` was lowered to `axios.<verb>()`. */
  usesAxios: boolean;
}

/** Axios HTTP verbs a `HttpClient` prop call maps onto 1:1. */
const HTTP_VERBS = new Set(['get', 'post', 'put', 'delete', 'patch', 'head', 'options', 'request']);

/**
 * Build a `this.`-rewiring function from the component's symbol table. It rewrites
 * by *position*, driven by the AST-located `ThisRef[]` the parser attached to each
 * body — never by regex over the source text, so a `this.foo` inside a string
 * literal or comment is never touched.
 *
 * Members whose React binding is a plain (or deterministically-named) identifier
 * are rewritten in place; members whose *API shape* changes on the React side
 * (injected framework tokens like Router/TranslateService) are deliberately left
 * as `this.X` and surfaced in `remaining`, so the flag points at exactly what
 * still needs a human — never a blind rewrite of semantics we can't prove.
 *
 *   this.<signal>()        -> <signal>          (read)
 *   this.<signal>.set(x)   -> set<Signal>(x)
 *   this.<signal>.update(f)-> set<Signal>(f)    (flagged: updater-fn semantics)
 *   this.<output>.emit(x)  -> on<Output>?.(x)
 *   this.<field|method|computed|input|appService> -> <same/renamed identifier>
 *   this.<Router|ActivatedRoute|…>  -> left as-is, listed in `remaining`
 */
function buildThisRewriter(
  model: ComponentModel,
): { rewrite: (body: string, refs: ThisRef[]) => RewriteResult; state: RewriteState } {
  const cap = (n: string) => n.charAt(0).toUpperCase() + n.slice(1);
  const setter = (n: string) => 'set' + cap(n);
  const handler = (n: string) => 'on' + cap(n);

  const state: RewriteState = { usesAxios: false };
  const signals = new Set(model.signals.map((s) => s.name));
  const outputs = new Set(model.outputs.map((o) => o.name));
  // HttpClient props are rewritten to axios calls (not left flagged like the
  // other framework tokens) — track them separately.
  const httpProps = new Set(
    model.injected.filter((d) => bare(d.token) === 'HttpClient').map((d) => d.propName),
  );
  // Injected framework tokens change API shape on the React side — leave flagged.
  // HttpClient is excluded: it becomes a real axios rewrite below.
  const knownTokenProps = new Set(
    model.injected
      .filter((d) => KNOWN_DI[bare(d.token)] && !httpProps.has(d.propName))
      .map((d) => d.propName),
  );
  // name -> output identifier for the plain `this.X -> X` strip.
  const identity = new Map<string, string>();
  for (const f of model.plainFields) identity.set(f.name, f.name);
  for (const c of model.computeds) identity.set(c.name, c.name);
  for (const i of model.inputs) identity.set(i.name, i.name);
  for (const d of model.injected) if (!knownTokenProps.has(d.propName)) identity.set(d.propName, d.propName);
  for (const m of model.methods) identity.set(m.name, safeIdentifier(m.name));
  // Signals/outputs have bespoke rewrites — never fall through to identity strip.
  for (const n of [...signals, ...outputs]) identity.delete(n);

  const rewrite = (body: string, refs: ThisRef[]): RewriteResult => {
    const updates: string[] = [];
    const httpVerbs: string[] = [];
    const remaining = new Set<string>();
    // One splice op per rewritable ref; `[start, end) -> text`.
    const ops: Array<{ start: number; end: number; text: string }> = [];

    for (const r of refs ?? []) {
      const n = r.member;
      if (httpProps.has(n)) {
        // this.http.get<T>(url, opts) -> axios.get<T>(url, opts) (Observable -> Promise).
        if (r.method && HTTP_VERBS.has(r.method)) {
          httpVerbs.push(r.method);
          state.usesAxios = true;
          ops.push({ start: r.start, end: r.methodEnd!, text: `axios.${r.method}` });
        } else {
          remaining.add(n); // http prop used in a shape axios doesn't mirror 1:1
        }
      } else if (signals.has(n)) {
        if (r.method === 'set') ops.push({ start: r.start, end: r.methodEnd!, text: setter(n) });
        else if (r.method === 'update') {
          updates.push(n);
          ops.push({ start: r.start, end: r.methodEnd!, text: setter(n) });
        } else if (r.method != null) remaining.add(n); // unknown signal method
        else if (r.directCall && r.directCallArgCount === 0) ops.push({ start: r.start, end: r.callEnd!, text: n });
        else remaining.add(n); // bare signal ref or call-with-args
      } else if (outputs.has(n)) {
        if (r.method === 'emit') ops.push({ start: r.start, end: r.methodEnd!, text: `${handler(n)}?.` });
        else remaining.add(n);
      } else if (knownTokenProps.has(n)) {
        remaining.add(n); // API shape changes — flag, don't rewrite
      } else if (identity.has(n)) {
        // Strip only the `this.X` head; any following `()`/`.m` stays intact.
        ops.push({ start: r.start, end: r.end, text: identity.get(n)! });
      } else {
        remaining.add(n); // unknown member
      }
    }

    // Apply right-to-left so earlier offsets stay valid; ops never overlap
    // (each derives from a distinct `this` token, and 0-arg-call spans hold no
    // nested `this.`).
    ops.sort((a, b) => b.start - a.start);
    let code = body;
    for (const op of ops) code = code.slice(0, op.start) + op.text + code.slice(op.end);
    return { code, remaining: [...remaining], updates: [...new Set(updates)], httpVerbs };
  };
  return { rewrite, state };
}

/**
 * A one-line review note for a rewritten body, or `''` if it fully rewired.
 * Distinguishes still-`this.` refs (need a human) from signal `.update()` sites
 * (mechanically rewritten, but the setter takes an updater fn — worth a glance).
 */
function thisResidueNote(r: RewriteResult): string {
  const parts: string[] = [];
  if (r.remaining.length) {
    parts.push(`unresolved ${r.remaining.map((n) => `\`this.${n}\``).join(', ')} (known-token API call or unknown member — rewire by hand)`);
  }
  if (r.updates.length) {
    parts.push(`signal ${r.updates.map((n) => `\`${n}.update()\``).join(', ')} -> setter now takes an updater fn — verify`);
  }
  if (r.httpVerbs.length) {
    const verbs = [...new Set(r.httpVerbs)].map((v) => `axios.${v}`).join(', ');
    parts.push(
      `HttpClient -> ${verbs}: Angular returned an Observable, axios returns a Promise whose payload is \`res.data\` — \`await …\` + \`.data\` (or \`.then(r => r.data)\`)`,
    );
  }
  return parts.join('; ');
}

/** What a known Angular DI token maps to on the React side. */
interface DiMapping {
  /** Lines to emit (already 2-space indented). `p` is the Angular prop name. */
  emit: (p: string) => string[];
  /** react named imports the mapping needs. */
  react?: string[];
  /** react-router-dom hooks the mapping needs. */
  router?: string[];
  /** True if the mapping supplies `useTranslation()` (suppresses the plain one). */
  translate?: boolean;
}

/**
 * Canonical Angular framework tokens -> their idiomatic React equivalents.
 * Keyed by the bare token name. These are real, compilable calls (flagged for
 * call-site rewiring); anything not in here is an app service and falls back to
 * a `use<Token>()` custom-hook hint.
 */
const KNOWN_DI: Record<string, DiMapping> = {
  Router: {
    emit: () => [
      `  const navigate = useNavigate(); // MIGRATION_TODO(di): was Router; \`this.router.navigate([...])\` -> \`navigate(...)\``,
    ],
    router: ['useNavigate'],
  },
  ActivatedRoute: {
    emit: () => [
      `  const params = useParams(); // MIGRATION_TODO(di): was ActivatedRoute; route params -> useParams()`,
      `  const location = useLocation(); // queryParams -> useSearchParams(); snapshot.data -> loader; verify each read`,
    ],
    router: ['useParams', 'useLocation'],
  },
  TranslateService: {
    emit: () => [
      `  const { t, i18n } = useTranslation(); // MIGRATION_TODO(di): was TranslateService; \`.instant()/.get()\` -> \`t()\`, \`.use(lang)\` -> \`i18n.changeLanguage(lang)\``,
    ],
    translate: true,
  },
  ElementRef: {
    emit: (p) => [
      `  const ${p}Ref = useRef<HTMLElement>(null); // MIGRATION_TODO(di): was ElementRef; attach \`ref={${p}Ref}\` and read \`${p}Ref.current\``,
    ],
    react: ['useRef'],
  },
  ChangeDetectorRef: {
    emit: (p) => [
      `  // MIGRATION_TODO(di): ${p} = inject(ChangeDetectorRef) dropped — React re-renders on state change; delete markForCheck()/detectChanges() calls.`,
    ],
  },
  NgZone: {
    emit: (p) => [
      `  // MIGRATION_TODO(di): ${p} = inject(NgZone) dropped — no React equivalent; run callbacks directly (drop runOutsideAngular/run wrappers).`,
    ],
  },
  HttpClient: {
    emit: (p) => [
      `  // MIGRATION_TODO(di): ${p} = inject(HttpClient) -> \`this.${p}.<verb>(url)\` calls are rewritten to \`axios.<verb>(url)\`; axios returns a Promise whose payload is \`res.data\` (Angular returned an Observable), so \`await …\` + \`.data\`.`,
    ],
  },
};

/**
 * Injected dependencies -> React. Known framework tokens (Router, TranslateService,
 * …) become their real idiomatic equivalent; unknown app services become a
 * `use<Token>()` custom-hook call (a hint you must back with a hook/provider).
 * Either way the semantics are flagged, never silently trusted.
 *
 * Returns true if a TranslateService mapping already emitted `useTranslation()`.
 */
function emitInjected(
  model: ComponentModel,
  lines: string[],
  reactImports: Set<string>,
  routerHookImports: Set<string>,
  todos: string[],
): boolean {
  let translateEmitted = false;
  for (const dep of model.injected) {
    const known = KNOWN_DI[bare(dep.token)];
    if (known) {
      todos.push(`DI: \`${dep.propName}: ${dep.token}\` -> ${known.translate ? 'useTranslation()' : 'React equivalent'} (verify call sites)`);
      lines.push(...known.emit(dep.propName));
      for (const r of known.react ?? []) reactImports.add(r);
      for (const r of known.router ?? []) routerHookImports.add(r);
      if (known.translate) translateEmitted = true;
      continue;
    }
    // Unknown app service -> custom-hook call site (must be provided).
    todos.push(`DI: \`${dep.propName} = inject(${dep.token})\` -> provide via a use${bare(dep.token)}() hook/context`);
    lines.push(
      `  const ${dep.propName} = use${bare(dep.token)}();` +
        ` // MIGRATION_TODO(di): was ${dep.via === 'inject' ? `inject(${dep.token})` : `constructor param ${dep.token}`}; create this hook (or a context provider) for the ported service.`,
    );
  }
  return translateEmitted;
}

/**
 * Angular lifecycle hooks -> React `useEffect`. The *shape* is deterministic
 * and idiomatic; the *body* is preserved verbatim and flagged for review
 * (it may still hold `this.` refs or `.subscribe()` teardown to rewire). We
 * emit real, compilable effects rather than a comment — but never claim the
 * semantics are settled.
 *
 *   ngOnInit + ngOnDestroy  -> one mount effect with a cleanup return
 *   ngOnInit (alone)        -> useEffect(() => { … }, [])
 *   ngOnDestroy (alone)     -> useEffect(() => () => { … }, [])
 *   ngAfterViewInit/Content -> own mount effect (post-paint note)
 *   ngOnChanges             -> useEffect(() => { … }, [<@Input deps>])
 *   ng*Checked / ngDoCheck  -> residue (runs every CD cycle; no safe effect)
 */
function emitLifecycle(
  model: ComponentModel,
  lines: string[],
  reactImports: Set<string>,
  todos: string[],
  rewriteThis: (body: string, refs: ThisRef[]) => RewriteResult,
): void {
  const hooks = new Map(model.lifecycle.map((h) => [h.name, h] as const));
  const take = (name: string): LifecycleHook | undefined => {
    const h = hooks.get(name);
    hooks.delete(name);
    return h;
  };
  const effect = () => reactImports.add('useEffect');
  // Emit a hook body at `pad` with `this.` rewired, wrapping `async` hooks in an
  // IIFE (effect callbacks can't be async). Pushes the rewrite result to `sink`
  // so the caller can fold any leftover `this.`/`.update()` into the flag note.
  const bodyLines = (hook: LifecycleHook, pad: string, sink: RewriteResult[]): string[] => {
    const r = rewriteThis(hook.body, hook.thisRefs);
    sink.push(r);
    if (!hook.isAsync) return r.code.split('\n').map((l) => (l ? pad + l : l));
    const out = [`${pad}// was \`async ${hook.name}\` — wrapped (an effect callback can't be async):`, `${pad}void (async () => {`];
    for (const l of r.code.split('\n')) out.push(l ? `${pad}  ${l}` : l);
    out.push(`${pad}})();`);
    return out;
  };
  // Merge per-body rewrite residue into one flag note (or '' if fully rewired).
  const mergedNote = (sink: RewriteResult[]): string =>
    thisResidueNote({
      code: '',
      remaining: [...new Set(sink.flatMap((r) => r.remaining))],
      updates: [...new Set(sink.flatMap((r) => r.updates))],
      httpVerbs: [...new Set(sink.flatMap((r) => r.httpVerbs))],
    });

  const onInit = take('ngOnInit');
  const onDestroy = take('ngOnDestroy');

  // ngOnInit (+ optional paired ngOnDestroy cleanup) -> one mount effect.
  if (onInit || onDestroy) {
    effect();
    const label = onDestroy ? 'ngOnInit + ngOnDestroy cleanup' : 'ngOnInit';
    const sink: RewriteResult[] = [];
    const body: string[] = [];
    if (onInit) body.push(...bodyLines(onInit, '    ', sink));
    if (onDestroy) {
      body.push('    return () => {');
      body.push(...bodyLines(onDestroy, '      ', sink));
      body.push('    };');
    }
    const note = mergedNote(sink);
    const subs = (onInit?.subscribeCount ?? 0) + (onDestroy?.subscribeCount ?? 0);
    todos.push(`lifecycle \`${label}\` -> useEffect (verify deps${note ? `; ${note}` : ''})`);
    lines.push(`  // MIGRATION_TODO(effect): ${label} -> mount effect; verify deps ([])${note ? `. ${note}` : ''}`);
    if (subs > 0) {
      todos.push(`rxjs: \`${label}\` has ${subs} .subscribe() call(s) — assign each Subscription and call .unsubscribe() in the effect's returned teardown`);
      lines.push(`  // MIGRATION_TODO(rxjs): ${subs} .subscribe() call(s) here — keep each Subscription and call .unsubscribe() in the returned cleanup (that IS the ngOnDestroy teardown).`);
    }
    lines.push('  useEffect(() => {');
    lines.push(...body);
    lines.push('  }, []);');
  }

  // Post-render mount hooks -> their own effect (timing differs: after paint).
  for (const name of ['ngAfterViewInit', 'ngAfterContentInit']) {
    const hook = take(name);
    if (!hook) continue;
    effect();
    const sink: RewriteResult[] = [];
    const body = bodyLines(hook, '    ', sink);
    const note = mergedNote(sink);
    todos.push(`lifecycle \`${name}\` -> useEffect (post-paint in Angular; verify timing${note ? `; ${note}` : ''})`);
    lines.push(`  // MIGRATION_TODO(effect): ${name} -> mount effect; Angular ran this after paint — verify timing.${note ? ` ${note}` : ''}`);
    if (hook.subscribeCount > 0) {
      todos.push(`rxjs: \`${name}\` has ${hook.subscribeCount} .subscribe() call(s) — unsubscribe in the effect's returned teardown`);
      lines.push(`  // MIGRATION_TODO(rxjs): ${hook.subscribeCount} .subscribe() call(s) — keep the Subscription and unsubscribe in a returned cleanup.`);
    }
    lines.push('  useEffect(() => {');
    lines.push(...body);
    lines.push('  }, []);');
  }

  // ngOnChanges -> effect keyed on the @Input props.
  const onChanges = take('ngOnChanges');
  if (onChanges) {
    effect();
    const deps = model.inputs.map((i) => i.name).join(', ');
    const sink: RewriteResult[] = [];
    const body = bodyLines(onChanges, '    ', sink);
    const note = mergedNote(sink);
    todos.push(`lifecycle \`ngOnChanges\` -> useEffect keyed on @Input props (verify per-input logic${note ? `; ${note}` : ''})`);
    lines.push(`  // MIGRATION_TODO(effect): ngOnChanges -> effect on input deps; the SimpleChanges map is gone — key off the props directly.${note ? ` ${note}` : ''}`);
    if (onChanges.subscribeCount > 0) {
      todos.push(`rxjs: \`ngOnChanges\` has ${onChanges.subscribeCount} .subscribe() call(s) — unsubscribe in the effect's returned teardown`);
      lines.push(`  // MIGRATION_TODO(rxjs): ${onChanges.subscribeCount} .subscribe() call(s) — keep the Subscription and unsubscribe in a returned cleanup.`);
    }
    lines.push('  useEffect(() => {');
    lines.push(...body);
    lines.push(`  }, [${deps}]);`);
  }

  // Change-detection hooks have no safe effect mapping -> keep as residue.
  for (const [name, hook] of hooks) {
    todos.push(`lifecycle \`${name}\` runs every change-detection cycle — no safe React effect`);
    lines.push(`  // MIGRATION_TODO(lifecycle): ${name} — ran every CD cycle; no direct React effect. Original body:`);
    for (const bodyLine of hook.body.split('\n')) lines.push(`  //   ${bodyLine}`);
  }
}

/**
 * `@ViewChild`/`@ViewChildren` -> `useRef` stubs. The structure is emitted
 * (a ref per decorated property, `useRef` imported) but the wiring is flagged:
 * you must attach `ref={<name>Ref}` in the template, and `@ViewChildren` needs
 * an array of refs / callback-ref pattern rather than a single element ref.
 */
function emitViewChildren(
  model: ComponentModel,
  lines: string[],
  reactImports: Set<string>,
  todos: string[],
): void {
  for (const vc of model.viewChildren) {
    reactImports.add('useRef');
    const refName = `${vc.propName}Ref`;
    if (vc.isList) {
      todos.push(`viewchild: @ViewChildren(${vc.selector}) \`${vc.propName}\` -> an array of refs / callback-ref pattern (attach in the template)`);
      lines.push(
        `  const ${refName} = useRef<HTMLElement[]>([]); // MIGRATION_TODO(viewchild): was @ViewChildren(${vc.selector}); no single-ref equivalent — collect refs via a callback ref per item (or map children), then attach in the template.`,
      );
    } else {
      const typeArg = vc.type ? `<${vc.type}>` : '<HTMLElement>';
      todos.push(`viewchild: @ViewChild(${vc.selector}) \`${vc.propName}\` -> useRef; attach \`ref={${refName}}\` in the template and read \`${refName}.current\``);
      lines.push(
        `  const ${refName} = useRef${typeArg}(null); // MIGRATION_TODO(viewchild): was @ViewChild(${vc.selector}); attach \`ref={${refName}}\` in the template and read \`${refName}.current\` (Angular's \`.nativeElement\` -> \`.current\`).`,
      );
    }
  }
}

/** Emit a fully line-commented snapshot of a skipped field initializer. */
function emitWasInit(name: string, init: string): string[] {
  const initLines = init.split('\n');
  const out: string[] = [`  // was: const ${name} = ${initLines[0]}`];
  for (let i = 1; i < initLines.length; i++) {
    out.push(`  //   ${initLines[i]}`);
  }
  const last = out[out.length - 1];
  if (!last.trimEnd().endsWith(';')) out[out.length - 1] = last + ';';
  return out;
}

/** A component-scope local name for an `x | async` binding (e.g. `user$` -> `user`). */
function asyncLocalName(expr: string): string {
  const m = expr.match(/([A-Za-z_$][A-Za-z0-9_$]*)\s*$/);
  const base = (m ? m[1] : 'value').replace(/\$+$/, '');
  return base.length ? base : 'value';
}

/** `AccountService` -> `AccountService` bare token for a `use…` hook name hint. */
function bare(token: string): string {
  return token.replace(/[^A-Za-z0-9]/g, '');
}

const RESERVED = new Set([
  'delete', 'new', 'class', 'function', 'return', 'default', 'switch', 'case',
  'typeof', 'instanceof', 'void', 'in', 'do', 'if', 'else', 'for', 'while',
  'var', 'let', 'const', 'export', 'import', 'this', 'super', 'try', 'catch',
]);

/** Make a JS-safe identifier from a method name (reserved words get a suffix). */
export function safeIdentifier(name: string): string {
  return RESERVED.has(name) ? `${name}Item` : name;
}

/**
 * Map of reserved-word method names -> their safe rewrite. Passed into the
 * template transform so `(click)="delete(x)"` emits `deleteItem(x)` matching
 * the function declaration the component emitter produces.
 */
export function methodRenameMap(methods: { name: string }[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const m of methods) {
    const safe = safeIdentifier(m.name);
    if (safe !== m.name) map.set(m.name, safe);
  }
  return map;
}
