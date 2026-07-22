# codemod-harness

Reusable Angular 17 → React codemod harness. **Slices 1–9 are implemented** (templates through
`this.` rewiring); see [Still out of scope](#still-out-of-scope) for the next catalog rows.
Jac driver: `--scaffold` (type oracle), `--ledger`, `--recipes`/`--learn`. Grounded status:
[`../../TODO.md`](../../TODO.md). Plan context: `../../PLAN.md`.

## Slice 1 — template control-flow → JSX

The first catalog row ("Template basics") plus enough of the binding rows to
make it real. Pipeline:

```
.html ──parseTemplate──▶ Angular template AST ──lower──▶ Template IR ──emit──▶ Babel JSX AST ──generate+prettier──▶ .jsx
        (@angular/compiler 17.3.9)                (src/ir)              (@babel/types)
```

The **Template IR** (`src/ir/types.ts`) is the stable seam: Angular's parser is
touched in exactly one file (`src/parse/angular-template.ts`) and Babel in
exactly one (`src/emit/jsx.ts`), so upgrading either is localized.

### What it translates (deterministic)

| Angular | React JSX |
|---|---|
| `@if / @else if / @else` | `cond && (…)` or a `?:` chain |
| `@for (x of xs; track k)` | `xs.map(x => <… key={k}>)` |
| `@for … @empty` | `xs.length ? xs.map(…) : (…)` |
| `@for (… let i = $index)` | `.map((x, i) => …)` |
| `{{ expr }}` | `{expr}` (spliced into parent) |
| `[prop]="e"` | `prop={e}` |
| `[class.on]="c"` | `className={c ? 'on' : ''}` |
| `[style.color]="c"` | `style={{ color: c }}` |
| `(click)="h($event)"` | `onClick={(e) => h(e)}` |
| `*ngIf="c"` | `c && (…)` |
| `*ngFor="let x of xs; trackBy: f"` | `xs.map((x, i) => <… key={f(i, x)}>)` |
| `[ngSwitch]` + `*ngSwitchCase` | `s === v ? (…) : …` chain |
| `[ngClass]` / `[class.x]` / `class` | one merged `className={clsx(…)}` |
| `[ngStyle]` / `[style.x]` / `style` | one merged `style={{ … }}` |
| `[(ngModel)]="v"` | `value={v}` + `onChange` (write side flagged) |
| `routerLink="/x"` / `[routerLink]="['/u', id]"` | `<Link to="/x">` / `to={[…].join('/')}` |
| `routerLinkActive="on"` | `<NavLink className={({isActive}) => …}>` |
| `<router-outlet>` / `<ng-container>` | `<Outlet />` / `<>…</>` |
| `[innerHTML]="h"` | `dangerouslySetInnerHTML={{ __html: h }}` |
| `x \| json/uppercase/lowercase/slice` | exact JS (`JSON.stringify`, `.toUpperCase()`, …) |
| `x \| date/number/currency/percent` | helper call (`formatDate(x, …)`, flagged) |
| `x \| translate` | `t(x)` |
| `jhiTranslate="k"` | `{t('k')}` (element content) |
| `jhiTranslate="k" [translateValues]="{…}"` | `{t('k', {…})}` |
| `[jhiTranslate]="e"` | `{t(e)}` |
| `class`/`for`/`tabindex`/… | `className`/`htmlFor`/`tabIndex`/… |

### Residue — never a silent drop

Anything the deterministic path can't prove safe becomes **visible** residue:

- unsupported node (`@switch`, `@defer`, `<ng-template>`, `<ng-content>`) →
  `{/* MIGRATION_TODO: … */}`
- unmappable event (`(keydown.enter)`, component `@Output`s) →
  `data-migration-todo="…"` attribute
- non-`translate` pipes (`number`, `date`, `keyvalue`, …) and expressions that
  aren't valid JS → recorded in the coverage report

Every residue reason is counted in `coverage.todoReasons`, so nothing is hidden.

## Slice 2 — component skeleton (`.component.ts` + template → `.tsx`)

The "Component inventory/skeleton" catalog row, wired to slice 1 so a component
and its paired template come out as one `.tsx`. ts-morph extracts the class
(`src/parse/angular-component.ts` → `ComponentModel` in `src/ir/component.ts`);
`src/emit/component.ts` assembles the module.

**Deterministic** (structure): props interface from `@Input`/`@Output`, the
function-component signature, `computed()`/getters as derived values, methods as
inner functions (bodies preserved), and the inlined template.

**Assisted → residue** (semantics, never fabricated): `inject()`/constructor DI,
`signal()` → `useState` (emitted *with* a verify-note, not trusted), and every
lifecycle hook (`ngOnInit`, …). Lifecycle bodies are preserved verbatim in a
`MIGRATION_TODO(lifecycle)` block — the harness never emits a blind `useEffect`.
Reserved-word methods (`delete`) are renamed and flagged.

Verified on the fixture: **all 54 components → valid `.tsx`**, 0 parse failures,
categorized residue (DI, `this.` rewires, signals, lifecycle, pipes).

## Slice 3 — translate service (`jhiTranslate` / `| translate` → react-i18next)

The "translate service" catalog row. The `jhiTranslate` directive (378 uses in the
fixture vs. 17 `| translate`) becomes a real `t(key, values?)` call:

- `jhiTranslate="a.b"` → `{t('a.b')}` as the element's content (the fallback text
  Angular shows before load is dropped — it lives in the i18n JSON, not the JSX).
- `[translateValues]="{ n: x }"` → the second `t` argument: `{t('a.b', { n: x })}`.
- `[jhiTranslate]="'a.' + k"` → `{t('a.' + k)}` (bound key).

Whenever a template uses translation (either form), the **component** emitter wires
it deterministically: `import { useTranslation } from 'react-i18next'` plus
`const { t } = useTranslation();` at the top of the function.

**Residue:** when a `jhiTranslate` element also has child *markup* (not just text),
the directive overwrites it at runtime, so the harness drops it but records a
`jhiTranslate on <tag> dropped fallback markup` note — visible, never silent.
`translate:params` pipe usage is still flagged (only the bare pipe is mechanical).

## Slice 4 — services (`@Injectable` → plain TS module)

The "services & DI" catalog row, driven by the real OneCX shell (12 services;
service/RxJS-heavy, unlike the jHipster template fixture). A service is **not**
restructured the way a component is: it stays a class, so this is light *in-place
surgery* (ts-morph) rather than a rebuild — method bodies, `this.` references,
types and generics are preserved verbatim.

**Deterministic:**

- `@Injectable` decorator → removed; Angular lifecycle interfaces dropped from
  `implements`; Angular DI/lifecycle names pruned from `@angular/core` imports.
- `inject(X)` fields → explicit **constructor parameters** (manual DI), preserving
  access modifiers, with a single `MIGRATION_TODO(di)` note listing what to wire.
- Because the class is kept, every `this.dep` / `this.method()` stays valid — no
  rewiring, unlike the component pass.

**Assisted → residue (never fabricated):**

- Lifecycle hooks (`ngOnInit`/`ngOnDestroy`/…) are kept but flagged
  `MIGRATION_TODO(lifecycle)` — React won't auto-invoke them; the reviewer decides
  where they run (init call / teardown / context cleanup).
- **OpenAPI-generated** API clients (`generated/` path or the generator banner) are
  **not** hand-migrated: they're flagged `MIGRATION_TODO(openapi)` to regenerate
  from the spec as an axios client, and the source is preserved untouched.

Verified on the OneCX shell: **all 12 services handled** (6 generated → flagged,
6 hand-written → migrated), 0 parse failures.

## Slice 5 — universal template layer

The goal here is **breadth over any Angular app**, not tuning to one codebase:
cover the framework-level template constructs (`@angular/common`/`forms`) that
show up almost everywhere, so an unknown app migrates fast.

- **Classic structural directives** `*ngIf` / `*ngFor` / `*ngSwitch` — reuse the
  same IfNode/ForNode the v17 `@if`/`@for` path uses. Classic `trackBy` is a
  *function*, so the key becomes `f(i, item)` (index synthesized if unaliased);
  no-`trackBy` falls back to an index key with a note.
- **`[ngClass]` / `[ngStyle]`** — folded together with static `class`/`style` and
  `[class.x]`/`[style.x]` into a **single** `className={clsx(…)}` / `style={{…}}`
  (this also fixes the old duplicate-`className` emission).
- **Built-in pipes** — exact JS where it exists (`json`→`JSON.stringify`,
  `uppercase`/`lowercase`, `slice`), a conventional helper call for the
  locale/format ones (`date`→`formatDate`, `number`, `currency`, `percent`,
  `titlecase`) with a `MIGRATION_TODO(helpers)` note, and `keyvalue`→`Object.entries`.
- **`[(ngModel)]`** → a controlled `value` + `onChange` pair; the write side is
  flagged (`v` must become React state for the setter to take effect).

**Residue:** the `async` pipe unwraps to its base expression with a note (it needs
a subscription/`useObservable` at component scope); `*ngIf ... else #ref`,
custom structural directives, and non-index `*ngFor` context vars stay visible TODOs.

Verified across both fixtures: OneCX 10/10 templates (1 residue node), jHipster
51/51 (0 parse failures); built-in pipe residue fell from 76 to 5.

## Slice 6 — router template directives (+ trivial completions)

The template-side "easy wins" of the router row, plus two long-standing template
bugs fixed. All deterministic; import hints (`Link`/`NavLink`/`Outlet` →
`react-router-dom`, `clsx`) are threaded to the component emitter.

- `routerLink` (static or `[routerLink]` incl. the `['/u', id]` segment-array
  form) → `<Link to=…>`; `routerLinkActive` promotes it to `<NavLink>` with an
  `({ isActive }) => clsx(…, isActive && 'active')` className that merges cleanly
  with any static/`[class.x]`/`[ngClass]` classes.
- `<router-outlet>` → `<Outlet />`.
- `<ng-container>` → a Fragment (previously emitted the literal, invalid-JSX tag).
- `[innerHTML]="h"` → `dangerouslySetInnerHTML={{ __html: h }}` (children dropped
  with a note, since it overwrites content).

**Residue:** router `[queryParams]`/`fragment` are flagged to fold into a React
Router `to` object (they have no 1:1 attribute form). The TS-side router
(`ActivatedRoute`, guards, programmatic `Router.navigate`) is a later row.

## Slice 7 — lifecycle → `useEffect`

The lifecycle row. Slice 2 parked every hook as a comment (`MIGRATION_TODO(lifecycle)`);
this converts the ones with a *safe, idiomatic* React shape into real, compilable
`useEffect` calls. The **structure** is deterministic; the **body is preserved
verbatim** and flagged for review (it may still hold `this.` refs or `.subscribe()`
teardown), so this stays honest — a real effect scaffold, never a claim the
semantics are settled.

- `ngOnInit` + `ngOnDestroy` → **one** mount effect with a `return () => { … }`
  cleanup (the canonical React pairing).
- `ngOnInit` alone → `useEffect(() => { … }, [])`; `ngOnDestroy` alone →
  `useEffect(() => () => { … }, [])`.
- `ngAfterViewInit` / `ngAfterContentInit` → their own mount effect, with a
  note that Angular ran them *after paint* (verify timing).
- `ngOnChanges` → `useEffect(() => { … }, [<@Input deps>])` — the `SimpleChanges`
  map is gone, so it keys off the input props directly.
- `async` hooks are wrapped in a `void (async () => { … })()` IIFE, since an
  effect callback can't be `async`.

**Residue:** `ngDoCheck` / `ngAfterViewChecked` / `ngAfterContentChecked` ran on
*every* change-detection cycle — there's no safe effect equivalent, so they stay
`MIGRATION_TODO(lifecycle)` with the body preserved. Effect **deps** (`[]`) and
any `this.`/subscription rewiring inside the body remain flagged for review.

Verified across both fixtures: jHipster 54/54, OneCX 13/13 components, 0 parse
failures (incl. an `async ngAfterContentInit` that would otherwise emit invalid
top-level `await`).

## Slice 8 — dependency injection → React hooks/context

The DI row. Slice 2 parked every injected dependency as a bare comment; this
converts them into real, idiomatic React. **Known framework tokens** map to their
canonical equivalent; **unknown app services** become a `use<Token>()` custom-hook
call — a hint you must back with a hook/provider. Either way the call sites stay
flagged (`MIGRATION_TODO(di)`), never silently trusted.

- `Router` → `const navigate = useNavigate();` (`react-router-dom`)
- `ActivatedRoute` → `useParams()` + `useLocation()` (queryParams → `useSearchParams`,
  `snapshot.data` → loader — each read flagged)
- `TranslateService` → `const { t, i18n } = useTranslation();` — and it **suppresses**
  the plain `useTranslation()` the template-side `| translate` would otherwise add,
  so there's exactly one hook call.
- `ElementRef` → `const xRef = useRef<HTMLElement>(null);` (attach `ref={xRef}`)
- `ChangeDetectorRef` / `NgZone` → **dropped** with an explanatory TODO (React
  re-renders on state change; no zone) — no call is emitted.
- `HttpClient` → TODO pointing at axios (`.get<T>(url)` returns `res.data`, not an
  Observable).
- anything else (`AccountService`, `FooFormService`, …) → `const svc = useFooService();`
  with a note to create the hook/context.

Both `inject(X)` and constructor-parameter injection map identically (the parser
records `via`, the emitter treats them the same).

Verified across both fixtures: jHipster 54/54, OneCX 13/13 components, 0 parse
failures; OneCX resolves 7 DI edges to real React idioms (Router/ActivatedRoute/
ElementRef/TranslateService) with the rest as flagged hook hints.

## Slice 9 — `this.` rewiring

The rewiring row. Earlier slices preserved method/effect/computed bodies verbatim
with `this.X` intact and a blanket `MIGRATION_TODO(this)`. This resolves those refs
against the component's own symbol table — deterministically, since every member
name is known — and **drops the flag from any body that fully rewires**. What's
left flagged is exactly (and only) what still needs a human.

- `this.<signal>()` → `<signal>` (read); `this.<signal>.set(x)` → `set<Signal>(x)`;
  `this.<signal>.update(f)` → `set<Signal>(f)` (flagged — the setter takes an updater fn).
- `this.<output>.emit(x)` → `on<Output>?.(x)` (the handler prop).
- `this.<field | method | computed | input | app-service>` → the bare (or reserved-word-
  renamed) identifier. Handles `$`-suffixed RxJS names (`this.destroy$` → `destroy$`).
- `this.<Router | ActivatedRoute | TranslateService | …>` → **left as-is** and listed in
  the note, because the token's *API shape* changes on the React side (e.g.
  `this.router.navigate([...])` isn't `navigate.navigate(...)`). Rewriting the identifier
  alone would be wrong, so we don't — we point at it.

Applied to method bodies, `computed()`/getter bodies, and every `useEffect` body from
slice 7. A method/effect that only touched safe members comes out as clean, flag-free
React; the residue note now enumerates the specific unresolved `this.X` refs instead of a
generic "uses this.".

**Rewiring is AST-driven, not regex.** The parser (`src/parse/`) walks the ts-morph AST
of each body and records every real `this.<member>` access as a `ThisRef` — its member
name, its call/method shape, and its exact offset span. The emitter (`src/emit/`) then
rewrites by *position* (a set of non-overlapping splices), never by pattern-matching the
source text. The seam holds: ts-morph stays in `parse/`, the emitter reads only the IR.
This closes the false-positive class the earlier regex had — a `this.label` inside a
string literal or comment is not a `PropertyAccessExpression`, so it is never a `ThisRef`
and is left verbatim — and it gets member nesting and name boundaries right for free (no
more `$`-suffix `\b` special-casing).

Verified across both fixtures: jHipster 54/54, OneCX 13/13, 0 parse failures; residue
dropped **393 → 292** nodes on jHipster (−101) as `this.` refs resolved to real bindings.
Moving from regex to AST splices changed neither fixture's output — behavior-preserving on
real code, strictly safer on the pathological string-literal case (covered by test).

## Use

```bash
npm install
npm test                              # vitest: unit + golden snapshot + idempotence
npx tsx src/cli.ts --report <dir>     # template coverage over a tree of .html
npx tsx src/cli.ts <file|dir>         # write sibling .jsx next to each .html

npx tsx src/cli.ts --components --report <dir>   # component coverage over *.component.ts
npx tsx src/cli.ts --components <dir>            # write sibling .tsx per component

npx tsx src/cli.ts --services --report <dir>     # service coverage over *.service.ts
npx tsx src/cli.ts --services <dir>              # write sibling .service.react.ts
```

## Still out of scope

Router *call-site* rewiring (`Router.navigate([...])` → `navigate(...)` is flagged,
not rewritten) and route guards; RxJS beyond the `async` pipe (`.subscribe()`
teardown inside effects is preserved but not rewired), `HttpClient` call sites →
axios (the injection is flagged, individual `.get()`/`.post()` calls are not
rewritten), reactive forms (`FormGroup`/`FormControl`),
signals/`computed` semantics, `@ViewChild`/template refs, `ng-content`/`ng-template`
projection, `ngb-*`/PrimeNG component mapping, OpenAPI client regen, `@switch`/`@defer`. These
are later catalog rows; the harness shape (IR seam, dry-run, residue accounting,
idempotence, fixture snapshots) is built to carry them.
