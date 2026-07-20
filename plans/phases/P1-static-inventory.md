# Phase 1 — Static Inventory

> **Role:** inventory-cartographer. **Input:** charter. **Output:** `inventory/graph.json`
> (schema: `inventory-graph.schema.json`), unit records in `DISCOVERED`, `units.index.json`.
> **Exit gate:** `unaccounted[] == []`; every unit sliced; risk scored; human spot-check of 5
> random nodes passes.

## 1. Scanner implementation guidance

Build a small scanner (Node/TS) rather than relying on any off-the-shelf AngularJS analyzer —
none survive in 2026. Verified building blocks:

- **Parser:** `tree-sitter-javascript` (fast, error-tolerant — legacy code often won't parse
  cleanly as strict ES) or **ts-morph** when you need cross-file symbol resolution. Start
  tree-sitter; add ts-morph only if string-name DI resolution proves insufficient.
- **DI detection patterns:** port the visitor logic from `babel-plugin-angularjs-annotate`
  (github.com/schmod/babel-plugin-angularjs-annotate — dead but correct): it enumerates every
  injection site (`.controller/.service/.factory/.directive/.component/.config/.run`,
  `$routeProvider.when(...resolve)`, ui-router state `resolve`, `$provide.decorator`).
- **Hygiene lint (optional but cheap):** `eslint-plugin-angular` **5.0.0** (revived 2025;
  ESLint 9 flat config) — its `di`, `di-order`, deprecated-API rules generate useful risk
  signals. Do NOT use `angular-eslint` (`@angular-eslint/*`) — Angular 2+ only.
- **HTML templates:** `tree-sitter-html` + a micro-parser for `{{ expr }}` and `ng-*`
  attribute expressions (AngularJS expressions are not JS — handle filters `| name:arg`,
  one-time `::`, and `track by` clauses).

## 2. Extraction spec (what MUST be captured per construct)

| Construct | Detect via | Capture |
|---|---|---|
| Module | `angular.module("x", [deps])` (setter has deps array; getter doesn't) | name, deps, file |
| Controller | `.controller("Name", fn/array)` + `ng-controller` attrs + router refs | DI, `$scope` vs `controllerAs`, template association |
| Component | `.component("name", {...})` | bindings map (`<`,`@`,`&`,`=`), template/templateUrl, controller, transclude, require |
| Directive | `.directive("name", fn)` | full `directiveMeta` (schema): restrict, scope type, compile/link presence, transclude, priority/terminal, require, whether it touches `angular.element`/jQuery |
| Service/factory/provider/value/constant | respective registrars | DI, public surface (returned/`this`-assigned members), statefulness hints (module-level mutable vars) |
| Filter | `.filter("name", fn)` | purity hints (`$stateful`), usages in templates |
| Route | `$routeProvider.when/otherwise`, `$stateProvider.state` | url, template(-Url), controller, resolves, abstract/nested state tree, params |
| Template | `templateUrl`, `ng-include`, `<script type="text/ng-template">`, inline `template:` | directive/component usages (normalize dash-case ↔ camelCase!), filters used, `ng-model` targets, form names |
| Scope events | `$emit(` / `$broadcast(` / `$on(` | event name (string literal or `dynamic-unresolved`), direction, site |
| Watches | `$watch(`, `$watchGroup(`, `$watchCollection(`, `$observe(` | watched expr, site, deep flag |
| `$compile` use | `$compile(` outside framework code | input source (string literal / variable / url) — variable ⇒ node flag + high risk |
| jQuery plugin calls | `$(x).pluginName(`, `angular.element(x).pluginName(` against plugin census + unknown-method heuristic | plugin node + `plugin-used-by` edges |
| Third-party AngularJS modules | module deps not defined in repo (ui.bootstrap, ngMaterial, ngAnimate, ui.grid, …) | `vendored` nodes — each needs a replacement decision recorded later |

**Edge provenance is mandatory** (`foundBy`): downstream logic treats `static-ast` as reliable,
`string-match`/`inferred` as needing runtime confirmation in P2.

## 3. Completeness algorithm

1. Enumerate all files under source roots (from charter).
2. Classify each: produced ≥1 node | referenced by ≥1 node | `vendored` | `dead` (no inbound
   edges AND not in any script tag/bundle) | `asset` | else → `unaccounted[]`.
3. Iterate until `unaccounted[]` is empty. "Dead" requires evidence (not referenced in any
   built artifact) — when in doubt, make it a node; P2 runtime counters will confirm deadness.

## 4. Risk scoring rubric (per node → aggregated per unit)

Score = Σ weights, clamp 0–100. Tier: <25 low, <50 medium, <75 high, ≥75 critical.

| Factor | Weight |
|---|---|
| directive with `link` | +15 |
| directive with `compile` | +25 |
| transclusion (any) | +15 (+10 if multi-slot) |
| jQuery/`angular.element` DOM mutation inside | +15 |
| jQuery plugin dependency | +20 per distinct plugin |
| `$compile` with non-literal input | +25 |
| ≥3 watches / any deep watch | +10 / +15 |
| `$rootScope` event publisher | +5 per event (cap 15) |
| stateful service (module-level mutable state) | +10 |
| resolve-chain participation (router) | +5 |
| `dynamic-unresolved` DI/edges | +15 |
| form with custom ngModel directives ($parsers/$formatters/$validators) | +15 |
| third-party vendored UI module usage (ui.grid etc.) | +15 |
| template-only component, literal bindings | −10 |

## 5. Unit slicing rules (decision tree)

1. **Every route** (or ui-router leaf state) → one `route` unit. Abstract/parent states with
   own templates → their own units.
2. **Component/directive used by ≥2 routes** → its own `component`/`directive` unit
   (shared primitive). Used by exactly 1 route and <150 LOC → fold into the route unit.
3. **Every service** → `service` unit. Pure-utility micro-services (<40 LOC, no state, no DI
   besides `$q`/none) may be batched into one unit per module.
4. **Filters:** batch per module into one `filter` unit unless `$stateful` or >40 LOC.
5. **Each jQuery-plugin-wrapping directive** → own `directive` unit (they get wrapper recipes).
6. **Infra units** (created now, implemented in P4): seam library, event façade, fixture
   pipeline, shim.
7. Unit `deps` = union of node edges crossing unit boundaries (injects, template-uses,
   emits/listens pairs, routes-to).
8. Target size guardrail: a unit's legacy source should fit in ~½ of a converter context pack
   (charter budget). Bigger → split by sub-template or extract child components as units first.

## 6. Motif tagging (first pass — recipe-miner refines in P5)

Tag each unit with all matching motifs. Starter taxonomy (extend per codebase):
`ctrl-template-page`, `component-bindings-simple`, `ngrepeat-table`, `ngrepeat-track-by`,
`form-ngmodel-basic`, `form-custom-validators`, `service-resthttp`, `service-stateful-cache`,
`service-resource`, `filter-pure`, `filter-stateful`, `dir-template-only`, `dir-link-dom`,
`dir-compile`, `dir-transclude-single`, `dir-transclude-multi`, `dir-jquery-plugin`,
`rootscope-bus-node`, `route-resolve-chain`, `modal-uib`, `dynamic-compile-html`,
`watch-derived-state`, `interval-polling`.

## 7. Outputs & gate

- `inventory/graph.json`, `inventory/units.index.json`, one `units/<id>.json` per unit
  (`DISCOVERED`, deps, risk, motifs, legacyPaths filled).
- `reports/inventory-summary.md`: counts, risk histogram vs charter estimate (large deltas →
  update charter + notify human), top-20 riskiest units, proposed conversion ordering.
- Gate check by orchestrator: schema validity, `unaccounted[]` empty, every node with
  `unitId` or classified, dep graph acyclic at unit level (cycles → merge or split decisions
  recorded; cycles are common with event buses — break them by scheduling the event façade
  infra unit first).
