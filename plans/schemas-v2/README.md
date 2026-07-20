# schemas-v2 — Framework-neutral migration artifact schemas

Versioned, framework-neutral JSON Schemas for the migration harness. The **source framework
is a parameter, not an assumption**. Where framework-specific data is unavoidable, the core
schema carries a typed `sourceAdapter` / `targetAdapter` slot (an `AdapterRef`) that `$ref`s a
concrete adapter schema — no framework fields are inlined into the core.

Every schema declares `schemaVersion` (`"2.0.0"`) and a stable `$id` under `mx://schemas/v2/`.

## Design layer (framework-neutral, written against these schemas)

The v2 successors to the framework-specific `plans/` docs. Source and target frameworks are
**parameters**; Angular 2+ → React is the worked example only.

| Doc | Ports | Covers |
|---|---|---|
| `ARCHITECTURE.md` | `../00-ARCHITECTURE.md` | Theory, design principles P1–P10, phase map, workspace layout, glossary |
| `ORCHESTRATOR.md` | `../01-STATE-AND-ARTIFACTS.md` + operational half of `../03-AGENT-ROLES.md` | Unit state machine, evidence gates, ledger, leases, retries, context packs, ratchets |
| `TOOL-CONTRACTS.md` | `../02-TOOL-CONTRACTS.md` | The tool surface the orchestrator exposes; permission matrix |
| `phases/P0…P7` | `../phases/P0…P7` | Per-phase playbooks (intake → decommission) |
| `prompts/` | `../prompts/` | Instantiable templates: converter, scenario-author, counterexample-analyst, critic |
| `NEUTRALIZATION-GUIDE.md` | — | Internal: vocabulary map + method used to port the above |

Role cards themselves still live in `../03-AGENT-ROLES.md` (behavioral contract); only their
operational vocabulary is neutralized here. Not yet ported: `../EXTENSIONS-OOB.md`,
`../RISKS-AND-FAILURE-MODES.md`.

## Support files (not one of the 13 artifacts)

| File | Purpose |
|---|---|
| `common.schema.json` | Shared `$defs`: `frameworkDescriptor` (the source/target-as-parameter shape), `evidenceRef`, neutral `unitId`, `gateId`. |
| `adapter-ref.schema.json` | The neutral envelope (`adapterId` + `adapterVersion` + `data`) that fills every `sourceAdapter`/`targetAdapter` slot. |
| `adapters/angular2plus.schema.json` | Concrete Angular-2+ adapter payloads that plug into the neutral slots. |

## The 13 artifacts — old → new mapping

| # | New (schemas-v2) | Old (schemas) | Change |
|---|---|---|---|
| 1 | `run-request.schema.json` (RunRequest) | `charter.schema.json` | Source & target frameworks are parameters; framework app-facts moved to `source.adapter`. |
| 2 | `unit.schema.json` (Unit) | `unit.schema.json` | Neutral `kind` vocabulary + neutral id pattern; framework classification → `sourceAdapter`. |
| 3 | `inventory-graph.schema.json` (InventoryGraph) | `inventory-graph.schema.json` | Neutral node/edge kinds; all framework-specific node metadata & DI styles → `sourceAdapter`. |
| 4 | `migration-plan.schema.json` (MigrationPlan) | *(new)* | Explicit ordered waves + seam/bridge plan; was prose in `charter.strategy.unitOrdering`. |
| 5 | `decision-record.schema.json` (DecisionRecord) | `waiver.schema.json` | Generalizes waiver to also record deferral/quarantine/escalation-resolution. |
| 6 | `patch.schema.json` (Patch) | *(new)* | First-class code-change artifact; was implicit (`unit.artifacts` + ledger hashes). |
| 7 | `behavior-scenario.schema.json` (BehaviorScenario) | `behavior-ir.schema.json` | Already neutral; dropped "React" wording, generalized mock-network ref. |
| 8 | `semantic-trace.schema.json` (SemanticTrace) | `trace-event.schema.json` | All framework-internal event kinds collapsed into neutral `framework.event` + `frameworkEvent` adapter slot. |
| 9 | `evidence-bundle.schema.json` (EvidenceBundle) | *(new)* | Hash-verifiable gate evidence set + re-run check results; was inline `evidence[]` arrays. |
| 10 | `counterexample.schema.json` (Counterexample) | `counterexample.schema.json` | Neutral divergence kinds kept; framework-specific root-cause examples → free text + `analysis.sourceAdapter`. |
| 11 | `recipe.schema.json` (Recipe) | `recipe.schema.json` | Neutral `unitKinds`; explicit source→target framework applicability; framework match signature → `sourceAdapter`. |
| 12 | `run-manifest.schema.json` (RunManifest) | `context-pack.schema.json` | Already neutral; added `schemaVersion` + framework parameters for reproducibility. |
| 13 | `run-result.schema.json` (RunResult) | `ledger-event.schema.json` | Rollup + neutralized ledger event (`$defs/ledgerEvent`); ng-free event types. |

`ledger-event`, `waiver`, and `context-pack` were already close to neutral (as noted in the
task) and map with minimal change (#13, #5, #12).

## Framework-specific assumptions moved to the adapter layer

> **Provenance.** This schema set descends from an earlier AngularJS-era design, but the harness
> does not handle AngularJS. Everything the core once hardcoded about a single source framework is
> now either neutralized into a framework-agnostic vocabulary or pushed into the
> `sourceAdapter`/`targetAdapter` slots. Forward-looking, the source framework is **Angular 2+**
> (Angular 21) and the target is **React**; both are parameters, not assumptions.

The core schemas carry no framework-specific fields. The assumptions that were previously inlined
now live as follows:

1. **App/framework identity & version** → RunRequest `source.framework` / `target.framework`
   (`frameworkDescriptor`, `id`+`version`). Angular-2+ version detail in
   `angular2plus.appProfile.angularVersion`.
2. **App-level framework facts** — build system, router, state management, RxJS version, zoneful
   vs zoneless, etc. → removed from core; equivalents live in the adapter
   (`angular2plus.appProfile`: `buildSystem`, `router`, `stateManagement`, `rxjsVersion`,
   `zoneful`, …).
3. **Framework-specific inventory counts** → neutral counts only in RunRequest (`sourceFiles`,
   `components`, `services`, `routes`, `modules`); Angular-2+ counts in
   `angular2plus.appProfile.inventorySummary` (`ngModules`, `standaloneComponents`, `pipes`,
   `injectables`, `guards`, …).
4. **Target framework** — no longer hardcoded; target is a parameter
   (`RunRequest.target.framework`). behavior-scenario and unit seam wording are neutral.
5. **`unit.kind` and id pattern** → neutral kinds (`component`, `service`, `presentation`,
   `directive-like`, `pipe-like`, `module`, `store`, …) and neutral id pattern in
   `common.unitId`. Exact framework construct in `Unit.sourceAdapter`
   (`angular2plus.nodeDescriptor.construct`).
6. **InventoryGraph node kinds** → neutral kinds (`module`, `component`, `presentation`,
   `behavior`, `service`, `config`, `transform`, `route`, …); Angular-2+ construct in
   `angular2plus.nodeDescriptor` (`component`/`directive`/`pipe`/`injectable`/`ng-module`/…).
7. **Node construct metadata** → removed from core; lives in `angular2plus.nodeDescriptor`
   (`selector`, `standalone`, `changeDetection`, `inputs`, `outputs`, `template`, …).
8. **DI style** → neutral `dependencyInjection.injects` (token list only); Angular-2+ DI style in
   `angular2plus.nodeDescriptor.injectables.api` (`constructor-param`/`inject-function`).
9. **Reactive detail** (reactive members, effect/subscription counts) → removed from core;
   Angular-2+ reactive detail lives in the adapter (`signals`, `rxjsStreams`).
10. **InventoryGraph edge kinds** → neutral edge kinds (`depends-on`, `projects-into`,
    `controls`, `transforms-in`, `uses-external`, …); Angular-2+ detail in
    `angular2plus.edgeDescriptor` (`di-inject`, `content-projection`, `route-loads`, …).
11. **Framework-internal trace events** → single neutral `framework.event` kind; type/detail in
    `frameworkEvent`. Angular-2+ source events (`change-detection`, `zone-task`, `signal-write`,
    `rxjs-emit`, …) and React target events (`commit`, `error-boundary`) use the same slot with
    `side:'source'`/`side:'target'`.
12. **Counterexample `suspectedConstruct`** → free-text neutral hint; Angular-2+ classification in
    `analysis.sourceAdapter` (`angular2plus.rootCauseClass`: `onpush-change-detection-miss`,
    `signal-glitch-ordering`, `rxjs-subscription-leak`, …).
13. **Recipe `appliesTo.unitKinds`** → neutral unit kinds; framework pairing via
    `sourceFramework`/`targetFramework`; Angular-2+ match signature in `appliesTo.sourceAdapter`.
14. **`waiverId`/`waiver-granted` ledger type naming** → `decisionId` and neutral
    `decision-granted`/`decision-rejected` ledger event types (Counterexample now references a
    `decisionId`).

## Angular-2+ adapter coverage

`adapters/angular2plus.schema.json` provides typed payloads for each neutral slot
(`x-slot` annotations name the slot):

- **components** — `nodeDescriptor` (`selector`, `standalone`, `changeDetection`, `template`).
- **standalone / NgModules** — `bootstrapStyle`, `standalone`, `declaredInModule`,
  `moduleImports`/`moduleExports`, `construct: 'ng-module'`.
- **inputs/outputs** — `inputs[]` (`@Input`/`input()`/`model()`, `required`, two-way),
  `outputs[]` (`EventEmitter`/`output()`/`outputFromObservable`).
- **signals** — `signals[]` (`signal`/`computed`/`linkedSignal`/`toSignal`, effect counts).
- **injectables / providers** — `injectables[]` (`constructor-param`/`inject-function`, DI
  modifiers), `providers[]` (`providedIn`, strategy, `multi`).
- **app initializers** — `appInitializer` (`APP_INITIALIZER`/`ENVIRONMENT_INITIALIZER`/
  `provideAppInitializer`).
- **RxJS streams** — `rxjsStreams[]` (source kind, timing-sensitive operators, teardown).
- **routes** — `route` (`loadChildren`/`loadComponent` lazy kinds, guards, resolvers).
- **templates** — `template` (`*ngIf`/`@if` control-flow, content-projection slots, bindings).
- **Module Federation remotes** — `planningHints.moduleFederation.remotes[]` and
  `producedCode.moduleFederationExposedAs`.
