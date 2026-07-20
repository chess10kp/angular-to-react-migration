# Phase 5 — Recipe Induction

> **Role:** recipe-miner (strong model tier — this phase is where intelligence is spent so
> that P6 can run on cheaper agents). **Input:** inventory motifs, scaffold, oracle. **Output:**
> verified recipe per major motif; exemplar units migrated through G4. **Exit gate:** every
> motif covering >2% of units has a `status: verified` recipe. Continues during P6 (new motifs,
> revisions).

## 1. The sample → tune → sweep principle

Do not let cheap converters loose on 300 units with a generic prompt. For each motif cluster:
1. **Sample:** pick the exemplar — a unit that is *representative* of the cluster (median
   size/risk), not the easiest one.
2. **Tune:** migrate it end-to-end at high effort (strong model + human review if high-risk)
   until it passes G4. Record every wrong turn — each becomes a recipe `pitfalls[]` entry or
   codemod rule.
3. **Sweep:** distill the recipe; the orchestrator then routes the rest of the cluster to
   cheap/standard converters carrying that recipe. Monitor `recipes/stats.json`; a recipe whose
   first-pass parity rate is < 60% after 5 applications gets pulled (`status: revised` cycle).

## 2. Construct mapping table (normative baseline for every recipe)

| AngularJS construct | React target | Hard rules |
|---|---|---|
| `.component()` bindings `<` / `@` / `&` / `=` | props / string props / callback props / **state-up + callback** (never two-way emulation) | `&` calls become explicit typed callbacks; `=` requires redesigning ownership — flag in recipe |
| `controller` + template pair | Function component; logic into hooks | `$scope` NEVER maps to a mutable object; each `$scope.x` becomes state, derived value, or prop — recipe forces the classification step |
| `$scope.$watch` on local state | Derived value (compute in render / `useMemo`) | `useEffect` only for external effects; "watcher → useEffect" is the #1 slop pattern — critic checks |
| `$watch` deep / `$watchCollection` | Restructure to immutable updates + derived selectors | If legacy mutates deeply, convert the MUTATION sites, not the watcher |
| `$scope.$emit/$broadcast/$on` | Event façade (P4 §7) during coexistence; props/context/store once both ends are React | New bus events forbidden |
| Template-only directive | Plain component | The easy 40% |
| Directive with `link` (DOM manipulation) | `ref` + effect wrapper; or keep-as-island decision | Recipe includes the wrapper skeleton with mount/update/cleanup mapped from link-fn body |
| Directive with `compile` / terminal / priority | DO NOT auto-convert. Analyst task → bespoke plan (portal, custom element, or QUARANTINE) | |
| Transclusion single-slot | `children` | |
| Transclusion multi-slot / scoped | Named props (`slots` object) or compound components; render props when transclusion scope was used | Focus order assertions mandatory (known divergence source) |
| `ngRepeat` | `.map` with keys | Key = legacy `track by` expr if present; else stable domain id; NEVER index if legacy had `track by` |
| `ngRepeat` filters/orderBy pipes | Pure selector functions, unit-tested, `useMemo` | Extract to `selectors.ts` so tests hit them directly |
| `ngModel` + validators | RHF + Zod resolver | Match legacy validation TIMING (blur/change/submit + `ng-model-options.debounce`) in scenarios before simplifying |
| Custom ngModel directives (`$parsers`/`$formatters`) | RHF `Controller` with transform | |
| Filters (pure) | Utility functions | Convert once into `target/src/lib/filters/`; ban inline re-implementations |
| Filters (`$stateful`, i18n) | Context-driven hooks/formatters | |
| `$http` / `$resource` service | Typed client + TanStack Query hooks (P4 §6) | Cache/invalidations explicit; recipe maps every legacy call site to a hook or mutation |
| Interceptors | fetch-client middleware | |
| `$q` chains | async/await | `$q.all` → `Promise.all`; watch for legacy code relying on digest-synchronized resolution (analyst flag) |
| `$timeout`/`$interval` polling | TanStack Query `refetchInterval` or explicit effect timer | Scenario must pin timing via fixtures/clock |
| ui-bootstrap / ngMaterial widgets | Design-system primitive units (built once in P4/P5) | Per-widget decision record: rebuild vs library |
| Route + resolves | Route module + loader (or query prefetch) | Resolve order/error semantics matter — scenario per resolve failure mode |
| jQuery plugin directive | Island wrapper w/ `ref` + explicit lifecycle; replacement decision recorded (`keep-wrapped` / `replace-with-react-lib` / `rebuild`) | Cleanup on unmount asserted (leak probe) |

## 3. Recipe format

See `schemas/recipe.schema.json` + this body template:

```markdown
## When this applies      (mirror of frontmatter signature, human-readable)
## Preconditions          (checkable facts; converter aborts→escalates if any fail)
## Conversion steps       (numbered, imperative, each with "verify by:" micro-check)
## Target pattern         (ONE canonical, complete code example)
## Binding/API map        (table: legacy symbol → target symbol, per exemplar)
## Pitfalls               (each: symptom → cause → correction)
## Verification emphasis  (divergence kinds to expect; extra scenario suggestions)
## Worked exemplar        (before/after file pair paths + ledger ref of its G4 pass)
```

## 4. Codemod extraction (optional per recipe)

When the exemplar diff shows a mechanical prefix (e.g., `.component()` config → typed props
interface + skeleton), encode THAT as a deterministic codemod (`codemod.script`, ts-morph based)
that produces a **scaffold with TODO markers**; the converter agent fills semantics. Codemod
output must always compile (even if trivially stubbed) so G2 tooling gives signal immediately.
Never attempt full-fidelity codemods of behavior — that path (AST-only translation) is exactly
what this harness exists to avoid.

## 5. Priming the recipe set (write these first, in order)

r-001 `service-resthttp` → r-002 `filter-pure` → r-003 `component-bindings-simple` →
r-004 `ctrl-template-page` → r-005 `ngrepeat-table` → r-006 `form-ngmodel-basic` →
r-007 `dir-template-only` → r-008 `rootscope-bus-consumer` → r-009 `dir-jquery-plugin-wrap` →
r-010 `route-page-swap` (the route-shell replacement procedure itself) →
r-011 `modal-uib` → r-012 `dir-link-dom-wrapper`.
This order matches the unit-ordering default (P0 §4), so recipes are always ready before the
sweep reaches their cluster.
