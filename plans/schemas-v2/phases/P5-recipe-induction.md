# Phase 5 — Recipe Induction (v2, framework-neutral)

> **Status: normative.** v2 successor to `plans/phases/P5-recipe-induction.md`, rewritten so the
> **source and target frameworks are parameters, not assumptions**
> (`RunRequest.source.framework` / `RunRequest.target.framework`). A `Recipe`
> (`recipe.schema.json`) carries a neutral `appliesTo.unitKinds` plus an explicit
> `appliesTo.sourceFramework`→`appliesTo.targetFramework` pairing, so the same library scopes per
> framework pair; framework-specific match signatures live in `appliesTo.sourceAdapter`. The
> construct-mapping table below is the **worked example (Angular 2+ → React)** — it teaches the
> induction method without asserting any framework in the neutral flow.
>
> **Role:** recipe-miner (strong model tier — this is where intelligence is spent so that P6 can
> run on cheaper agents, per `ORCHESTRATOR.md §10` model-tier routing). **Input:** inventory motifs
> (`migration/inventory/motifs.json`), the target scaffold (P4), the oracle (P3). **Output:** a
> `status: verified` `Recipe` per major motif; exemplar units migrated through G4. **Exit gate:**
> every motif cluster covering >2% of units has a verified recipe. Continues during P6 (new motifs,
> revisions).

---

## 1. The sample → tune → sweep principle

Do not let cheap converters loose on hundreds of units with a generic prompt (P4/P5 exist to
prevent exactly that). For each motif cluster:

1. **Sample:** pick the exemplar — a unit *representative* of the cluster (median size/risk), not
   the easiest one. Record it as `exemplar.unitId`.
2. **Tune:** migrate it end-to-end at high effort (strong model + human review if high-risk) until
   it passes G4 (parity, `ORCHESTRATOR.md §3.2` T7). Record every wrong turn — each becomes a
   recipe `pitfalls[]` entry or a codemod rule. Capture `exemplar.beforePaths`/`afterPaths` and the
   `exemplar.verifiedAtLedgerSeq` of its G4 pass.
3. **Sweep:** distill the `Recipe`; the orchestrator then routes the rest of the cluster to
   cheap/standard converters carrying that recipe (`RunManifest`, `ORCHESTRATOR.md §8`). Monitor
   `recipes/stats.json`; a recipe whose `stats.firstPassParity` rate is < 60% after 5 applications
   is pulled into a `status: revised` cycle (librarian, `escalationRate`-per-motif ratchet is the
   trigger, `ORCHESTRATOR.md §11`).

This mirrors the design principle P8 "knowledge compounds" (`ARCHITECTURE.md §2`): every exemplar
and counterexample improves the library.

## 2. Construct mapping table (worked example — Angular 2+ → React)

This table instantiates design principle **P5 "migrate by semantic class, not syntax"**
(`ARCHITECTURE.md §2`) for the worked pairing. For a different source/target pair the recipe-miner
produces the equivalent table for that pair; the discipline in the "Hard rules" column is
framework-independent. The neutral obligation is the **classification step**: every reactive
member of the source unit is classified as one of {prop, local state, derived, server state,
event} before any code is written.

| Source construct (Angular 2+) | Target (React) | Hard rules (framework-independent) |
|---|---|---|
| `@Input()` / `input()` / `model()` | props / string props / **state-up + callback** for two-way | Two-way (`model()`, `[(…)]`) requires redesigning ownership — never emulate two-way binding; flag in recipe |
| `@Output()` / `EventEmitter` / `output()` | explicit typed callback props | Output bindings become typed callbacks, not shared mutable state |
| component class + template | function component; logic into hooks | A component field NEVER maps to a mutable object; each field becomes state, derived value, or prop — the recipe forces the classification step |
| `computed()` / getter over local state | derived value (compute in render / memoize) | Effects only for *external* effects; "derived-state → effect" is the #1 slop pattern — the critic checks it |
| `effect()` on local state | restructure to derived selectors + immutable updates | If the source mutates deeply, convert the MUTATION sites, not the effect |
| shared `Subject`/store bus (`$emit`-style) | event façade (P4 §7) during coexistence; props/context/store once both ends are on the target | New bus events forbidden |
| template-only presentation | plain component | The easy 40% |
| structural/attribute directive doing DOM work | `ref` + effect wrapper; or a keep-embedded decision | Recipe includes the wrapper skeleton with mount/update/cleanup mapped from the directive lifecycle |
| directive with host-compilation / priority semantics | DO NOT auto-convert → analyst task → bespoke plan (portal, custom element, or QUARANTINE via `DecisionRecord`) | |
| single-slot `<ng-content>` | `children` | |
| multi-slot / scoped content projection | named props (`slots` object) or compound components; render props when projection scope was used | Focus-order assertions mandatory (`focus-order` divergence source) |
| `@for` / `*ngFor` | `.map` with keys | Key = the source `track`/trackBy expression if present; else a stable domain id; NEVER index if the source had a stable-key expression |
| iteration + filter/sort pipes | pure selector functions, unit-tested + memoized | Extract to `selectors.ts` so tests hit them directly |
| reactive forms + validators | form-library + schema resolver | Match source validation TIMING (blur/change/submit + `updateOn`/debounce) in scenarios before simplifying |
| custom value accessors (`ControlValueAccessor`) | form-library controller with transform | |
| pure pipes | utility functions | Convert once into `target/src/lib/…`; ban inline re-implementations |
| impure / i18n pipes | context-driven hooks/formatters | |
| `HttpClient` / resource service | typed client + query hooks (P4 §6) | Cache/invalidations explicit; recipe maps every call site to a hook or mutation |
| HTTP interceptors | fetch-client middleware | |
| RxJS chains | async/await + query library | `forkJoin`→`Promise.all`; watch for code relying on scheduler-synchronized resolution (analyst flag) |
| `interval`/timer polling | query `refetchInterval` or an explicit effect timer | Scenario must pin timing via fixtures/clock (P3 §2) |
| component-library widgets (modals, menus) | design-system primitive units (built once in P4/P5) | Per-widget `DecisionRecord`: rebuild vs library |
| route + resolvers/guards | route module + loader (or query prefetch) | Resolve order/error semantics matter — scenario per resolve-failure mode |
| directive wrapping a third-party DOM plugin | embedded (`element-bridge`) wrapper w/ `ref` + explicit lifecycle; replacement decision recorded (`keep-wrapped` / `replace-with-target-lib` / `rebuild`) | Cleanup on unmount asserted (leak probe) |

> **Adapter notes (Angular 2+).** Source-construct classification (`component` / `directive` /
> `pipe` / `injectable` / `ng-module` / `guard` / `resolver` / `interceptor`) and match signatures
> (e.g. "component with `@Input` + `OnPush`", "injectable `providedIn: 'root'`") live in
> `Recipe.appliesTo.sourceAdapter` (`angular2plus` adapter). Root-cause classes the miner should
> anticipate — `onpush-change-detection-miss`, `signal-glitch-ordering`, `rxjs-subscription-leak`,
> `rxjs-operator-timing`, `content-projection-mismatch` — are the `angular2plus.rootCauseClass`
> values that surface as `Counterexample` `analysis.sourceAdapter` during exemplar tuning.

## 3. Recipe format

See `recipe.schema.json` (YAML frontmatter: `id`, `status`, `motifs`, `appliesTo`, `exemplar`,
`version`, optional `codemod`/`pitfalls`/`verificationEmphasis`/`stats`) + this markdown body
template:

```markdown
## When this applies      (human-readable mirror of the frontmatter signature)
## Preconditions          (checkable facts; converter aborts→escalates if any fail)
## Conversion steps       (numbered, imperative, each with a "verify by:" micro-check)
## Target pattern         (ONE canonical, complete code example)
## Binding/API map        (table: source symbol → target symbol, per exemplar)
## Pitfalls               (each: symptom → cause → correction)
## Verification emphasis  (divergence kinds to expect; extra scenario suggestions)
## Worked exemplar        (before/after file-pair paths + ledger seq of its G4 pass)
```

Recipes are written to `migration/recipes/<id>.md`; `id` matches `^r-[0-9]{3}[a-z0-9-]*$`.

## 4. Codemod extraction (optional per recipe)

When the exemplar diff shows a mechanical prefix (e.g. a component-binding declaration → typed
props interface + skeleton), encode THAT as a deterministic codemod (`codemod.script`, AST-based,
`codemod.coverage: partial-scaffold`) that produces a **scaffold with TODO markers**; the converter
agent fills the semantics. Codemod output must always compile (even if trivially stubbed) so the G2
tooling (`tsc`/lint/tests, `ORCHESTRATOR.md §4`) gives signal immediately. Never attempt
full-fidelity codemods of behavior — AST-only translation of reactive mechanics is exactly what
this harness exists to avoid (P5, `ARCHITECTURE.md §2`).

## 5. Priming the recipe set (write these first, in order)

r-001 `service-server-state` → r-002 `pipe-pure` → r-003 `component-inputs-simple` →
r-004 `component-page` → r-005 `iteration-table` → r-006 `form-basic` →
r-007 `presentation-only` → r-008 `event-bus-consumer` → r-009 `third-party-dom-plugin-wrap` →
r-010 `route-page-swap` (the `route-shell` replacement procedure itself, P4 §3) →
r-011 `modal-widget` → r-012 `directive-dom-wrapper`.

This order matches the default unit ordering (`MigrationPlan.waves`, leaves/services first) so a
recipe is always `verified` before the sweep reaches its cluster. Each recipe's `appliesTo.motifs`
ties back to the motif ids in `migration/inventory/motifs.json`; the >2% coverage exit gate is
computed over that file.

---

### Provenance

Ports `plans/phases/P5-recipe-induction.md`. Cross-references: `ARCHITECTURE.md §2` (P5/P8),
`ORCHESTRATOR.md §3.2`/`§8`/`§10`/`§11` (G4, context packs, model-tier routing, ratchets), P4 §3/§6/§7
(seams, API layer, event façade), P3 §2 (scenario timing), and schemas `recipe.schema.json`,
`counterexample.schema.json`, `migration-plan.schema.json`.
