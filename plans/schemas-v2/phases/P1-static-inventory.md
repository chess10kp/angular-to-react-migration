# Phase 1 — Static Inventory (v2, framework-neutral)

> **Status: normative.** v2 successor to `plans/phases/P1-static-inventory.md`, rewritten against
> `schemas-v2/`. The **source and target frameworks are parameters, not assumptions**. The scanner,
> extraction spec, and risk rubric below are stated in the neutral node/edge/unit vocabulary
> (`inventory-graph.schema.json`, `unit.schema.json`, `common.schema.json`); the concrete
> construct detection for the worked example (**Angular 2+ → React**) lives in the "Adapter notes
> (Angular 2+)" callouts and rides in each node/unit's `sourceAdapter`
> (`adapters/angular2plus.schema.json#/$defs/nodeDescriptor`). Provenance: ported from
> `plans/phases/P1`.

> **Role:** inventory-cartographer. **Input:** `RunRequest`. **Output:** `inventory/graph.json`
> (schema: `inventory-graph.schema.json`), `Unit` records in `DISCOVERED`, `units.index.json`.
> **Exit gate:** `unaccounted[] == []`; every unit sliced; risk scored; human spot-check of 5
> random nodes passes.

## 1. Scanner implementation guidance

Build a small scanner rather than relying on an off-the-shelf whole-app analyzer for the source
framework — none survive long, and the harness needs neutral output regardless. Neutral building
blocks:

- **Parser:** an error-tolerant grammar (e.g. `tree-sitter`) for the source language (legacy code
  often won't parse cleanly under a strict compiler), or a compiler-API/symbol-graph tool
  (e.g. `ts-morph` / the framework's own compiler) when you need cross-file symbol resolution.
  Start error-tolerant; add symbol resolution only if dependency-injection name resolution proves
  insufficient.
- **DI detection:** enumerate every injection site the source framework exposes (registration
  APIs, route/resolve declarations, provider decorators). Emit a neutral token list per node;
  the *style* of each injection is adapter metadata, not core.
- **Hygiene lint (optional but cheap):** a source-framework linter's DI-ordering and
  deprecated-API rules generate useful risk signals. Choose the linter that matches the *actual*
  source framework — a linter built for a different framework generation produces noise.
- **Templates:** parse the source framework's template dialect (its structural/control-flow
  constructs, bindings, and transform/pipe syntax are **not** plain host-language expressions —
  handle them explicitly), normalizing element-name casing so template usages resolve to the
  right nodes.

> **Adapter notes (Angular 2+).** Prefer the TypeScript compiler API / `ts-morph` plus the
> Angular compiler (`@angular/compiler`) to read decorator metadata and templates; use
> `angular-eslint` (`@angular-eslint/*`) for hygiene signals. DI sites: constructor params and
> `inject()` calls; providers via `@Injectable({providedIn})` / `providers[]`; route `resolve`,
> guards, and `APP_INITIALIZER`/`provideAppInitializer`. Template dialect: `*ngIf`/`*ngFor` vs
> `@if`/`@for`/`@switch`, pipes `| name:arg`, `ng-content` projection slots, `ngTemplateOutlet`.
> All of this is recorded as `nodeDescriptor` on the node's `sourceAdapter`, never in core fields.

## 2. Extraction spec (what MUST be captured per construct)

Classify every source construct into a **neutral node `kind`** (`inventory-graph.schema.json`:
`module`, `component`, `presentation`, `behavior`, `service`, `config`, `transform`, `template`,
`route`, `store`, `external`, `vendored`, `dead`, `asset`, `entrypoint`) and capture the neutral
facts below. The exact framework construct goes in the node's `sourceAdapter.data`.

| Neutral node | Capture (neutral) | Framework construct → `sourceAdapter` |
|---|---|---|
| `module` | name, dependency list, file | the source framework's module/registration unit |
| `component` | public surface (inputs/props, outputs/events), template association, state style (external state / local / derived) | modern component idiom |
| `presentation` | binding surface, template, projection/slots, whether it touches the DOM directly | template-driven view unit |
| `behavior` (`directive-like`) | attach target, lifecycle hooks present, DOM-mutation flag, whether it wraps a third-party DOM plugin | attribute/structural behavior attached to elements |
| `service` | DI surface, public members (returned/assigned), statefulness hints (module-level mutable state) | injectable/service/factory/provider |
| `transform` (`pipe-like`) | purity hints (stateful?), template usages | value transform used in templates |
| `route` | url, view association, resolves/guards, nested/abstract tree, params | router configuration entry |
| `template` | component/behavior usages (normalize casing!), transforms used, form/model targets | template/partial source |
| cross-unit events | event name (literal or `dynamic-unresolved`), direction, site | publish/subscribe on the app event bus |
| reactive subscriptions/watches | watched expression/stream, site, deep/timing flags | watchers / subscriptions / effects |
| runtime template compilation | input source (literal / variable / url) — variable ⇒ node flag + high risk | dynamic component / runtime-compiled template |
| third-party DOM-plugin calls | plugin node + `uses-external` edges | imperative DOM widget invocations |
| third-party framework modules | `vendored` nodes — each needs a replacement decision recorded later | vendored UI libraries not defined in repo |

**Edge kinds are neutral** (`depends-on`, `routes-to`, `renders`, `projects-into`, `emits`,
`listens`, `controls`, `transforms-in`, `uses-external`, `module-depends`, `dynamic-unresolved`);
framework relation detail rides in `edgeDescriptor`. **Edge provenance is mandatory** (`foundBy`):
downstream logic treats `static-ast`/`template-ref` as reliable and `string-match`/`inferred` as
needing runtime confirmation in P2 (`runtime-trace` upgrades them).

> **Adapter notes (Angular 2+).** Neutral → construct: `component` = `@Component` (with
> `selector`, `standalone`, `changeDetection`, `inputs`/`outputs`, `signals`, `template`);
> `behavior` = `@Directive`; `transform` = `@Pipe`; `service` = `@Injectable`; `module` =
> `@NgModule`; `route` = `Route`/`Routes` config (`loadComponent`/`loadChildren`, `guards`,
> `resolvers`). Cross-unit events = shared RxJS `Subject`s; watches/subscriptions = `rxjsStreams`
> + `effect()`s; runtime template compilation = `ngComponentOutlet`/`ViewContainerRef`. Edge
> relations map to `edgeDescriptor.relation` (`di-inject`, `template-uses-component`,
> `content-projection`, `route-loads`, `module-imports`, `pipe-in-template`, …).

## 3. Completeness algorithm

1. Enumerate all files under the source roots (from `InventoryGraph.sourceRoots`, seeded by the
   `RunRequest`).
2. Classify each: produced ≥1 node | referenced by ≥1 node | `vendored` | `dead` (no inbound edges
   AND not in any entrypoint/bundle) | `asset` | else → `unaccounted[]`.
3. Iterate until `unaccounted[]` is empty. "Dead" requires evidence (not referenced in any built
   artifact) — when in doubt, make it a node; P2 runtime counters (`node.usageCount.runtime`) will
   confirm deadness.

## 4. Risk scoring rubric (per node → aggregated per unit)

Score = Σ weights, clamp 0–100. Tier (`Unit.risk.tier`): <25 low, <50 medium, <75 high,
≥75 critical. Factors are stated neutrally; the concrete signal per factor resolves from the
`sourceAdapter`.

| Factor (neutral) | Weight |
|---|---|
| behavior unit with imperative lifecycle (link/attach-time DOM work) | +15 |
| behavior unit with compile-time template rewriting | +25 |
| content projection / transclusion (any) | +15 (+10 if multi-slot) |
| direct DOM mutation inside the unit | +15 |
| third-party DOM-plugin dependency | +20 per distinct plugin |
| runtime template compilation with non-literal input | +25 |
| ≥3 reactive subscriptions/watches / any deep or timing-sensitive one | +10 / +15 |
| app-event-bus publisher | +5 per event (cap 15) |
| stateful service (module-level mutable state) | +10 |
| resolve/guard-chain participation (router) | +5 |
| `dynamic-unresolved` DI/edges | +15 |
| form with custom value-accessor / parser / validator members | +15 |
| third-party vendored UI-library usage | +15 |
| presentation-only unit with literal bindings | −10 |

> **Adapter notes (Angular 2+).** Concrete high-weight signals: `@Directive` with heavy
> `Renderer2`/`ElementRef` host mutation; `ngComponentOutlet`/dynamic component with a computed
> type; OnPush components with imperative `markForCheck`; long-lived `rxjsStreams` with
> `subscriptionTeardown: none-detected` (leak risk); custom `ControlValueAccessor`s; `ui`-library
> vendored modules. These populate `nodeDescriptor` fields the rubric reads through the adapter.

## 5. Unit slicing rules (decision tree)

1. **Every route** (or router leaf) → one `route` unit. Abstract/parent routes with their own
   views → their own units.
2. **Component/behavior used by ≥2 routes** → its own `component`/`directive-like` unit (shared
   primitive). Used by exactly 1 route and <150 LOC → fold into the route unit.
3. **Every service** → `service` unit. Pure-utility micro-services (<40 LOC, no state, minimal DI)
   may be batched into one unit per module.
4. **Transforms (pipe-like):** batch per module into one `pipe-like` unit unless stateful or
   >40 LOC.
5. **Each third-party-DOM-plugin-wrapping behavior** → its own `directive-like` unit (they get
   wrapper recipes).
6. **Infra units** (created now, implemented in P4): seam library, event façade, fixture pipeline,
   shim.
7. Unit `deps` = union of node edges crossing unit boundaries (injects, template-uses,
   emit/listen pairs, routes-to).
8. Target size guardrail: a unit's source should fit in ~½ of a converter context pack
   (`RunRequest.budgets.contextPackTokenBudget`). Bigger → split by sub-template or extract child
   components as units first.

Unit ids follow `common.schema.json#/$defs/unitId` — `unit:<kind>:<canonical-name>`, e.g.
`unit:route:/invoices`, `unit:component:invoiceTable`, `unit:directive-like:datePicker`,
`unit:service:InvoiceService`, `unit:pipe-like:currencyShort`.

## 6. Motif tagging (first pass — recipe-miner refines in P5)

Tag each unit with all matching motifs (`Unit.motifs`). Starter neutral taxonomy (extend per
codebase): `controller-template-page`, `component-bindings-simple`, `list-filter-table`,
`keyed-list`, `form-model-basic`, `form-custom-validators`, `service-rest-http`,
`service-stateful-cache`, `service-resource`, `transform-pure`, `transform-stateful`,
`presentation-only`, `behavior-dom`, `behavior-compile`, `projection-single`, `projection-multi`,
`third-party-dom-plugin`, `event-bus-node`, `route-resolve-chain`, `modal`,
`dynamic-template`, `derived-state-watch`, `interval-polling`. The concrete match signature for a
motif (which framework construct/API pattern triggers it) lives in the unit's `sourceAdapter`, not
in the neutral motif tag.

## 7. Outputs & gate

- `inventory/graph.json`, `inventory/units.index.json`, one `units/<id>.json` per unit
  (`DISCOVERED`, `deps`, `risk`, `motifs`, `artifacts.legacyPaths` filled).
- `reports/inventory-summary.md`: counts, risk histogram vs the `RunRequest` estimate (large
  deltas → update `RunRequest` + notify human), top-20 riskiest units, proposed conversion
  ordering.
- Gate check by orchestrator: schema validity, `unaccounted[]` empty, every node carrying a
  `unitId` or an explicit classification, dep graph acyclic at unit level (cycles → merge/split
  decisions recorded; cycles are common with event buses — break them by scheduling the event
  façade `infra` unit first).
