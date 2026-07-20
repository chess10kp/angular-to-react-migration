# Harness Module Boundary

> **Status.** Normative. This document is the contract that lets `harness-core` be a reusable
> product and OneCX (Angular 21) be merely "Pilot Profile 1." Its source framework is **Angular
> 2+** (the pilot app is Angular 21) and its target is **React**. It supersedes the implicit
> module coupling in `00-ARCHITECTURE.md` … `03-AGENT-ROLES.md`, `phases/`, `prompts/`, and
> `schemas/`. Those documents remain the source of the *mechanisms* (evidence gates, ledger,
> leases, budgets, context packs, recipe induction, oracle calibration); this document says
> **which module owns each mechanism** and **what each module is forbidden to know**.
>
> **Note on the prior corpus.** The `plans/` corpus this file audits was written in an
> AngularJS-1.x era and framed the source adapter around AngularJS specifics (`$scope`, digest,
> directives/filters, ngRoute/ui-router). That corpus is being superseded: we are **not**
> migrating AngularJS. Throughout this document the `source-angular` module means an **Angular
> 2+** analyzer (components, signals, RxJS, DI, Router, Module Federation). Where the older
> plans are cited, they are cited as the origin of a neutral *mechanism*, not as a live
> AngularJS concern.
>
> **Reading order.** Read after `00`–`03`. `PLAN.md §P0` mandated this file ("Define the
> harness module boundary"); this is that deliverable.

---

## 1. The boundary theory (one paragraph)

The existing `plans/` design is excellent but *monolithic*: it fuses three concerns that must
be separable — (a) the **framework-neutral migration engine** (a unit walks a state machine;
transitions are evidence-gated; loops are budgeted; knowledge compounds), (b) the **source
framework semantics** it happens to understand (Angular 2+ components/signals/RxJS/change
detection/DI), and (c) the **target language semantics** it happens to emit (React/TSX/hooks).
A reusable harness
requires that (a) know *nothing* about (b) or (c), that (b) and (c) be swappable adapters, and
that a *profile* (OneCX today, some other app tomorrow) inject only its own platform contracts.
We therefore split the system into **eight modules** with small, explicit interfaces. The
governing invariant (from `PLAN.md`): **no source-, target-, or OneCX-specific decision may
live in `harness-core`.**

## 2. The eight modules at a glance

| Module | One-line responsibility | Depends on |
|---|---|---|
| **harness-core** | Scheduling, unit state machine, evidence gates, retries, replay, learning loop, ledger | model-gateway, oracle, recipe-registry (by interface only) |
| **source-angular** | Analyze an Angular 2+ source app (compiler/template/DI/route/RxJS) into neutral artifacts | harness-core artifact schemas |
| **target-react** | Emit and validate React/TSX (routing, testing, build, seams) | harness-core artifact schemas |
| **profile-onecx** | Supply OneCX platform contracts: topics, preloaders, slots, style isolation, remotes | source-angular, target-react (extends both) |
| **model-gateway** | Provider-neutral structured agent calls (schema-validated in/out) | — |
| **oracle** | Scenario execution, trace normalization, semantic diff, calibration | source-angular + target-react probes (by interface) |
| **recipe-registry** | Codemods, exemplars, counterexamples, promotion/demotion, lessons | harness-core artifact schemas |
| **operator-control** | Human surface: inspect, approve, retry, waive, abort, replay | harness-core (read/command only) |

**Dependency rule (MUST):** arrows point *toward* neutral abstractions. `harness-core` may
depend only on interfaces (`SourceAdapter`, `TargetAdapter`, `OracleService`, `ModelGateway`,
`RecipeStore`) — never on a concrete module. `source-angular`, `target-react`, and
`profile-onecx` are loaded as **registered adapters** at run start (named in the charter /
`RunRequest`), never imported by name inside core.

---

## 3. Concept audit (every significant item in `plans/`, tagged)

Tag legend: **core** = harness-core; **src** = source-angular; **tgt** = target-react;
**onecx** = profile-onecx; **gw** = model-gateway; **orc** = oracle; **reg** = recipe-registry;
**ops** = operator-control; **X** = cross-cutting (owning module in parentheses).
"Leaks?" = currently hardcodes a source- (Angular 2+), target- (React), or OneCX-specific detail
and MUST be generalized or moved to an adapter before it can serve a reusable harness.

### 3.1 Principles, states, gates, ledger (`00`, `01`)

| Concept | Source | Tag | Leaks? | Note |
|---|---|---|---|---|
| Principles P1 (oracle before conversion), P2 (evidence-gated), P3 (budgeted loops), P4 (curated context), P7 (coexistence), P8 (knowledge compounds), P9 (divergence explicit), P10 (resumability) | 00 §2 | **core** | no | Framework-neutral; these ARE the product. |
| Principle P5 "migrate by semantic class not syntax" | 00 §2 | **core** | wording | Concept is core; its *table* (signals/RxJS→hooks) is **src+tgt**. |
| Principle P6 "legacy source is read-only" | 00 §2 | **core** | no | Generalize "Angular source" → "source app." |
| Unit state machine (18 states) | 01 §3.1 | **core** | no | States are neutral. |
| Transition table T1–T21 + gates G1–G8 | 01 §3.2 | **core** | mostly | Gate *definitions* are neutral; gate *evidence producers* (tsc/lint, zone-stability/`afterNextRender` settle) belong to tgt/src. See §5 leak L1. |
| Anti-loop invariants, fingerprinting, token/attempt caps | 01 §3.3 | **core** | no | |
| Ledger (append-only NDJSON), event types, `rev`/lease concurrency | 01 §1,§4 | **core** | no | Event type `recipe-*`/`lesson-*` shared with **reg**. |
| Unit record schema | 01 §2 | **core** | **yes** | `kind` enum (`component`,`pipe`), `risk.factors` (`manual-change-detection`,`imperative-dom`,`rxjs-teardown`), `seam.type` are Angular/React-specific → move to adapter-supplied vocabularies. See L2. |
| Artifact catalog | 01 §5 | **core** | no | Catalog is neutral; several *schemas* need generalizing (see 3.5). |
| Context packs (assembly, size budget, split-not-truncate) | 01 §6 | **core** | no | Pack *contents* (which source files) are adapter-driven. |
| Ratchets (`legacy-file-count`, `parity-suite-size`, `bridge-count`, `waiver-count`, `escalation-rate`) | 01 §7 | **core** | wording | Neutral counters; "legacy-file" → "source-file", "bridge" is a seam concept (tgt). |
| Workspace layout (`legacy/`,`target/`,`shim/`,`migration/`) | 00 §5 | **core** | wording | `legacy/`→`source/`; `shim/` is a src-adapter artifact dir. |

### 3.2 Tools (`02`)

| Tool | Tag | Leaks? | Note |
|---|---|---|---|
| `fs.*`, `shell.run` (allowlisted binaries) | **core** | binary list | Allowlist (`tsc`,`vitest`,`playwright`) is **tgt**-supplied; core owns sandboxing/path rules. |
| `unit.get/update/claim/submitGate`, `ledger.*` | **core** | no | The state API. |
| `app.start/stop/status` (`side: legacy|target|hybrid`, `flags`, `instrumented`) | **X (orc)** | **yes** | Serving *mechanism* is per-app; `instrumented` (tracer injection) is **src**; `hybrid`/`flags` (seams) is **tgt**. Core sees only the interface. |
| `scenario.run/runAll`, `browser.explore` | **orc** | no | Neutral (ARIA/Playwright). |
| `trace.diff`, `trace.bisect` | **orc** | no | Pure functions over neutral trace schema. |
| `fixtures.captureHar/deriveProfile/list` | **orc** | no | Network layer is framework-neutral. |
| `recipes.match/get`, `lessons.search/add`, `counterexample.open/close` | **reg** | no | |
| `waiver.draft`, `escalate` | **X (core)** | no | Escalation is core; waiver *content* references divergences (orc vocab). |
| Permission matrix (role→tool) | **core** | no | Roles are neutral; matrix stays. |
| Orchestrator-internal duties (gate runners, pack assembly, scheduling, budget meter, lease reaper, model-tier routing) | **core** | model routing→**gw** | Model-tier routing table is **gw** policy fed by core telemetry. |

### 3.3 Agent roles (`03`, `prompts/`)

| Role | Tag | Leaks? | Note |
|---|---|---|---|
| intake-analyst (P0 charter) | **X (core+src+onecx)** | **yes** | Version fingerprinting/showstoppers are src+onecx; charter *shape* is core. |
| inventory-cartographer (P1) | **src** | **yes** | Angular 2+ analyzer (`@angular/compiler` + ts-morph over components/DI/routes/RxJS); emits neutral `InventoryGraph`. |
| tracer (P2 probe) | **src** | **yes** | Angular 2+ probe: a change-detection/zone/RxJS tracer hooked after `bootstrapApplication`/`ApplicationRef`, using zone stability / `afterNextRender` as the settle point. |
| scenario-author (P3) | **orc** | wording | Behavior-IR authoring is neutral; "Angular unit" wording only. |
| oracle-calibrator (P3) | **orc** | mutant catalog | Calibration loop is neutral; the *mutant catalog* is src-motif-specific. |
| scaffolder (P4) | **tgt** | onecx bits | React stack + seams are tgt; OneCX packages/providers are onecx. |
| recipe-miner (P5) | **X (reg)** | mapping table | Induction *process* is reg; the construct-mapping table is src+tgt. |
| converter / repairer (P6) | **X (core drives, gw executes)** | prompt wording | Prompts say "Angular unit", "signal input", "effect/RxJS teardown" → generalize; construct knowledge comes from recipe (reg) not the role. |
| verifier (P6) | **orc** | no | Deterministic diff runner. |
| counterexample-analyst (P6) | **X (reg+orc)** | **yes** | `suspectedConstruct` taxonomy (`zone-vs-microtask`, `@for track` identity) is src-specific; the divergence *shape* is neutral. |
| critic (P6) | **X (tgt)** | **yes** | "effect-chain smell", "`any`-typed props", "manual-subscription-in-render" checks are tgt-antipattern-specific; core owns only "critic gate exists." |
| integrator, decommissioner (P7) | **core** | wording | Flag-flip/soak/tombstone neutral; "Angular runtime removed" → "source runtime removed" (onecx: Zone.js/Angular providers/preloaders). |
| drift-sentinel (cross) | **core** | no | Maps source-file changes → units; source-parsing delegated to **src**. |
| librarian (cross) | **reg** | no | Owns recipes/lessons/stats. |
| **orchestrator** (non-agent) | **core** | no | The core engine itself. |

### 3.4 Phases (`phases/`)

| Phase | Tag | Leaks? | Note |
|---|---|---|---|
| P0 Intake & Calibration | **X** | **yes** | Charter schema (**core**) + Angular 2+ probes (**src**) + serve strategy (**src/onecx**) + model routing (**gw**). |
| P1 Static Inventory | **src** | **yes** | Angular 2+ static analysis (`@angular/compiler`, ts-morph): components (standalone/NgModule), `@Input`/signal `input()`/`@Output`, signals/`computed`/`effect`, DI providers, Router `loadComponent`/`loadChildren`, MF remotes. |
| P2 Runtime Tracing | **src** | **yes** | The probe is an Angular 2+ change-detection/zone/RxJS hook. Trace *schema/transport* (**orc**) is neutral; the `ng.*` event kinds are **src** vocabulary. |
| P3 Behavior IR & Oracle | **orc** | mutant catalog | Behavior IR, diff policies, fixtures neutral; mutant catalog is src. |
| P4 Target Scaffold & Seams | **tgt** | onecx bits | React/Vite/Router/seams tgt; OneCX slots/topics/remotes/style-polyfill onecx. |
| P5 Recipe Induction | **X (reg)** | mapping table | Process reg; mapping table src+tgt; per-recipe codemods reg-stored, adapter-authored. |
| P6 Conversion Loop | **core** | prompt wording | The factory loop is the core product; construct knowledge is injected via recipes. |
| P7 Integration & Decommission | **core** | wording | Neutral, minus "Angular runtime out of bundle" (onecx specifics: Zone.js/providers/preloaders). |

### 3.5 Schemas (`schemas/`)

| Schema | Tag | Leaks? | Note |
|---|---|---|---|
| `unit.schema.json` | **core** | **yes** | `kind` enum + `risk.factors` + `seam.type` → adapter-extensible vocabularies. |
| `ledger-event.schema.json` | **core** | no | |
| `context-pack.schema.json` | **core** | no | |
| `waiver.schema.json` | **core** | no | |
| `charter.schema.json` | **X (core shell + src/onecx blocks)** | **yes** | `app.angularVersion`, `standaloneVsNgModule` mix, `buildTool: nx\|webpack\|vite`, `moduleFederation` are source-profile fields → move to `source.profile` sub-object supplied by the adapter. |
| `inventory-graph.schema.json` | **src** (neutral shape, core-owned envelope) | **yes** | Node kinds are Angular 2+ constructs → adapter vocabulary. |
| `behavior-ir.schema.json` | **orc** | no | Already "framework-neutral" by design — the model to emulate. |
| `trace-event.schema.json` | **orc** (envelope) + **src** (`ng.*`) + **tgt** (`react.*`) | **yes** | `kind` enum hardcodes `ng.*` and `react.*`; must become an open, adapter-registered namespace. See L3. |
| `counterexample.schema.json` | **X (orc+reg)** | **yes** | `divergence.kind` neutral; `analysis.suspectedConstruct` examples are src-specific (free-string, so soft leak). |
| `recipe.schema.json` | **reg** | **yes** | `appliesTo.unitKinds` enum (`route/component/service/pipe/guard`) is an Angular 2+ unit taxonomy → adapter vocabulary. |

### 3.6 Extensions (`EXTENSIONS-OOB.md`)

| Extension | Tag | Note |
|---|---|---|
| §1 Session-replay scenario mining | **orc** | Neutral. |
| §2 Source normalization pre-pass | **src** | Angular 2+ source normalization codemods; per-source-adapter. |
| §3 Dark-launch dual rendering | **orc+tgt** | Needs seam that serializes inputs (tgt); comparator is orc. |
| §4 Change-detection differential fingerprinting | **src** (diagnostic) | `ng.*` (change-detection/RxJS) diagnostics; never a parity requirement (stays out of core diff). |
| §5 Counterexample shrinking (bisect) | **orc** | Neutral. |
| §6 Perf-parity budgets | **orc** | Baseline source = src probe (Angular change-detection metrics ↔ React commits). |
| §7 N-version cross-check | **core** (gw routing) | Neutral routing policy. |
| §8 Contract-first API extraction | **orc** | Neutral. |
| §9 ARIA property-based fuzzing | **orc** | Neutral. |
| §10 Economics telemetry & adaptive routing | **gw** (fed by core ledger) | Neutral. |

---

## 4. Module specifications

Each spec states: **Responsibility**, **Public interface** (the ONLY surface other modules
may touch — operations and artifacts), **MUST NOT know**, and **Maps from `plans/`**.

### 4.1 harness-core

**Responsibility.** The reusable engine. Owns the unit state machine, evidence-gated
transitions, the append-only ledger, optimistic-concurrency + leases, retry/attempt/token
budgets and anti-loop invariants, context-pack assembly, scheduling/WIP, ratchets, escalation,
resumability, and the learning *loop control* (when to ask reg for a lesson; it does not author
lessons). It orchestrates the other modules purely through their interfaces.

**Public interface (exposed):**
- Artifacts (neutral, versioned): `RunRequest`, `Unit`, `LedgerEvent`, `ContextPack`,
  `RunManifest`, `RunResult`, `EvidenceBundle`, `Waiver`, `DecisionRecord`.
- Operations: `unit.claim/get/update/submitGate`, `ledger.append/query`, `escalate`,
  `waiver.draft`, `pack.assemble`, `schedule.next`, `gate.validate(gateId, EvidenceBundle)`,
  `ratchet.check`, `replay(unitId|runId)`.
- Adapter registration ports (consumed): `SourceAdapter`, `TargetAdapter`, `OracleService`,
  `ModelGateway`, `RecipeStore`, `OperatorSink`.
- Extension points (adapters extend these vocabularies): `UnitKindVocabulary`,
  `RiskFactorVocabulary`, `SeamVocabulary`, `GateEvidenceKinds`.

**MUST NOT know:** any word of Angular or React (no signals, RxJS, change detection, `inject()`,
`useEffect`, TSX, hooks), any OneCX concept (topics, slots, remotes, preloaders, Module
Federation), any concrete model provider, any concrete build/test binary, or any trace-event
namespace beyond "there is a set of registered event kinds." If a
`grep -riE 'angular|react|onecx|signal|rxjs|tsx|topic'` over harness-core hits a substantive
(non-comment) line, the boundary is violated.

**Maps from `plans/`:** 00 §2 (P1–P10), 00 §5 workspace, 01 (entire state machine, ledger,
context packs, ratchets), 02 (state tools + orchestrator-internal duties + permission matrix),
P6 §0 scheduling/retry/rollback, P7 integrate/decommission control flow, roles integrator &
decommissioner & drift-sentinel (control half), schemas `unit`/`ledger-event`/`context-pack`/
`waiver`/`charter`(envelope).

### 4.2 source-angular

**Responsibility.** Everything that requires understanding the *source* app. For Pilot Profile
1: Angular 2+ analysis — `@angular/compiler` + ts-morph inventory of components, inline/external
templates, `@Input`/signal `input()`/`@Output`/`EventEmitter`, `computed`/signals, lifecycle
hooks, `@Injectable`/`inject()`/providers/app-initializers, RxJS streams/subscriptions, routes,
generated API clients, custom elements, DOM/history patches, styles. Produces the neutral
`InventoryGraph`, runtime **probes** (a change-detection/RxJS/Zone tracer hooked after
`bootstrapApplication`/`ApplicationRef`, using zone stability / `afterNextRender` as the source
settle point), source-side risk factors, the motif taxonomy for this source framework, the
mutant catalog, and the source-side normalization codemods.

**Public interface (exposed to core/oracle/reg):**
- `analyze(sourceRoot) → InventoryGraph` (neutral node/edge schema with adapter-tagged kinds).
- `sliceUnits(InventoryGraph) → Unit[]` seeds + `riskFactors(node) → RiskFactor[]`.
- `probe.install(appInstance) → InstrumentationHandle` (the tracer) + `probe.emitsKinds() →
  TraceEventKind[]` (registers `ng.*` change-detection/RxJS/zone event kinds with the trace namespace).
- `serveDescriptor() → { howToServe, instrumentationInjection }` for `app.start("source", …)`.
- `mutantCatalog(motif) → Mutant[]` for oracle calibration.
- `normalizationCodemods() → Codemod[]` (OOB §2), each oracle-gated.

**MUST NOT know:** anything about React/TSX or the target stack; anything OneCX-specific
(OneCX contracts arrive via profile-onecx *extending* this adapter); the state machine internals
(it emits artifacts, core drives transitions).

**Maps from `plans/`:** P1 (scanner — now an Angular 2+ analyzer), P2 (probe — a CD/zone/RxJS
tracer), roles inventory-cartographer & tracer, `inventory-graph.schema.json` (node vocabulary),
`trace-event.schema.json` `ng.*` half, P0 version/risk probes, mutant catalog in P3 §6,
construct-mapping *left column* in P5 §2, RISKS §3 traps (become an Angular 2+ src pitfall library).

### 4.3 target-react

**Responsibility.** Everything that requires emitting and validating the *target*. React 19 /
TSX conventions, routing adapter (React Router), the testing adapter (Vitest/RTL, Playwright
runner glue), the build adapter (Vite/Nx, typecheck/lint/bundle budgets), and the **seam
library** (custom-element/island bridge + route shell + feature flags + event façade). Supplies
the gate-evidence producers for G2/G3 (tsc/lint/unit/story/mount) and the target-side settle
signal, plus the `react.*` trace event kinds and target-side critic antipatterns.

**Public interface (exposed):**
- `scaffold(charter) → targetApp` + `conventionsDoc()`.
- `buildGateRunner() → { g2(unit): EvidenceBundle, g3(unit): EvidenceBundle }` (tsc/lint/test/
  story + seam mount) — core calls these; core re-runs, never trusts.
- `seam.define(kind, spec) → SeamHandle`, `flags` API, `settleSignal(appInstance)`.
- `probe.emitsKinds() → TraceEventKind[]` (`react.*`).
- `criticChecks() → AntipatternRule[]` (effect chains, `any`-typed props, manual-subscription-in-render, unstable-callback deps).
- `binaryAllowlist() → string[]` (feeds core's `shell.run` sandbox).

**MUST NOT know:** anything about the source framework (it receives neutral `BehaviorIR`,
`Recipe` target-patterns, and unit classification — never signals, RxJS, or the Angular AST);
the state machine internals; OneCX packages (those arrive via profile-onecx extending it).

**Maps from `plans/`:** P4 (stack, seam A/B, flags, API layer, event façade, CSS, CONVENTIONS,
CI) minus OneCX bits, role scaffolder, gates G2/G3 evidence, construct-mapping *right column*
in P5 §2, critic checklist items 3–7, `trace-event.schema.json` `react.*` half.

### 4.4 profile-onecx

**Responsibility.** The pilot profile. Injects OneCX platform contracts that neither generic
adapter can know: **topics** (location/permission/parameter/theme/language publish-subscribe
protocols, RxJS-based), **preloaders** (Angular 18/19/20/21 generations + share scopes),
**slots** (`SlotGroupComponent` input/output + resize contracts), **style isolation** (the
~1,248-line scope-polyfill + PrimeNG/Angular Webpack style rewriting), and **remotes** (Module
Federation manifests/exposes/share scopes, the remote compatibility matrix, `WebcomponentLoader`
+ `data-mfe-element`/style-ID markers). It *extends* source-angular (extra inventory node kinds:
topic, remote, preloader, slot, style-marker) and target-react (OneCX React packages
`@onecx/react-*`, PrimeReact, the startup DAG, base-path/Docker/Nginx/Helm parity), and it ships
the OneCX conformance scenario set and OneCX-specific recipes/mapping rows.

**Public interface (exposed to the two adapters it extends and to oracle):**
- `sourceExtensions() → { extraNodeKinds, extraProbes(topics/remotes/history-patch), remoteCompatibilityMatrix() }`.
- `targetExtensions() → { packageStack, startupDAG(), seamContracts(slot/webcomponent/topic-bridge), stylePolicy() }`.
- `conformanceScenarios() → BehaviorScenario[]` (startup, auth, routes, remotes, slots, topics,
  style isolation, toast, preloader manifests, base-path).
- `recipes() → Recipe[]` (observable-topic service, slot component, route loader, exposed
  custom element, …).

**MUST NOT know:** the state machine, ledger, or scheduling (it is data + adapters, not engine);
it must be entirely removable — deleting profile-onecx must leave a working harness that can run
a non-OneCX Angular app (the `PLAN.md` conformance requirement).

**Maps from `plans/`:** nothing in today's `plans/` (they predate the OneCX pivot); it is
sourced from `PLAN.md` "Pilot Profile 1" tasks. Listed here so the boundary is complete and so
reviewers can see that **zero** OneCX material belongs in core/src/tgt.

### 4.5 model-gateway

**Responsibility.** Provider-neutral structured agent invocation. Wraps every LLM call so the
rest of the system speaks in typed request/response objects, not vendor SDKs. Owns: model-tier
routing table (risk-tier × role → tier), structured-output/schema validation of agent
responses, ret/idempotency at the transport layer, token metering feed to core, N-version
cross-check spawning, and adaptive re-pricing from ledger telemetry (OOB §10).

**Public interface (exposed):**
- `invoke(TaskSpec, ContextPack, ResponseSchema) → { structured, tokensIn, tokensOut }`.
- `routeTier(riskTier, role) → ModelTier` + `spawnN(TaskSpec, n) → results[]` (cross-check).
- `registerProvider(name, driver)`.

**MUST NOT know:** the domain of any prompt (it sees a `ContextPack` blob + a response schema,
not "Angular"); the state machine; which module authored the prompt.

**Maps from `plans/`:** 02 §8 model-tier routing, P0 §5 budgets/routing table, OOB §7
(N-version) and §10 (adaptive routing), token metering half of 01 §3.3.

### 4.6 oracle

**Responsibility.** The framework-neutral judge. Scenario execution (Playwright), trace capture
and **normalization** (raw→normalized, `semanticKey` assignment, scrubbing volatile ids,
dropping adapter-internal `*.` diagnostic channels), semantic **diff** under named policies
(`strict`/`standard`/`relaxed`) with waivers, `trace.bisect`, fixture pipeline (HAR→MSW +
endpoint inventory / OpenAPI), and calibration (mutation-kill scoring — running mutants the
*source adapter* supplies). It consumes source and target *probes* by interface but contains no
framework knowledge itself.

**Public interface (exposed):**
- `scenario.run/runAll`, `browser.explore`, `trace.diff(policy, waivers)`, `trace.bisect`.
- `fixtures.captureHar/deriveProfile/list`.
- `normalize(rawTrace) → normalizedTrace`, `calibrate(unit, mutants) → KillReport`.
- Artifacts: `BehaviorScenario`(IR), `SemanticTrace` (open event namespace), `Counterexample`
  (divergence half), `DiffPolicy`, `FixtureProfile`, `CalibrationReport`.

**MUST NOT know:** how to *produce* framework-specific events (probes register their own kinds);
which construct caused a divergence (that's reg/analyst enrichment); the target stack's build
commands. Its diff MUST treat all `<adapter>.*` diagnostic channels as non-parity by default.

**Maps from `plans/`:** P2 trace schema/transport (neutral half), P3 (Behavior IR, diff
policies, fixtures, calibration loop), 02 §3 scenario/trace/fixture tools, roles scenario-author,
oracle-calibrator, verifier, `behavior-ir`/`trace-event`(envelope)/`counterexample`(divergence)
schemas, OOB §1,§3,§5,§6,§8,§9.

### 4.7 recipe-registry

**Responsibility.** The compounding-knowledge store. Recipes (preconditions, codemod ref,
target pattern, pitfalls, verified exemplar), counterexample *analysis*, lessons, and the
promotion/demotion lifecycle (draft→verified→revised→deprecated) driven by `stats.json`
(first-pass parity, escalation rate per recipe×model-tier). Owns recipe *matching* and the
construct-mapping *table structure* (its rows are contributed by src+tgt+onecx adapters).

**Public interface (exposed):**
- `recipes.match(unit) → RankedRecipe[]`, `recipes.get(id)`, `recipes.register(Recipe)`.
- `lessons.search(tags,k)`, `lessons.add(...)` (librarian).
- `counterexample.open/close`, `analysis.enrich(ce)`.
- `promote/demote(recipeId, stats)`, `stats.update(...)`.
- Artifacts: `Recipe`, `Counterexample`(analysis half), `Lesson`, `RecipeStats`, `Codemod` ref.

**MUST NOT know:** the state machine transition logic (core asks it for a recipe; core drives
the unit); the concrete meaning of a construct (mapping rows are opaque adapter-supplied data);
model providers.

**Maps from `plans/`:** P5 (induction process, recipe format, codemod extraction, priming),
P6 §6 knowledge loop, role recipe-miner & librarian & counterexample-analyst (enrichment half),
`recipe`/`counterexample`(analysis) schemas, lessons file, OOB §2 codemod authorship interface.

### 4.8 operator-control

**Responsibility.** The human surface. Read-only inspection (dashboard, ledger, unit records,
parity reports, review packets) plus the bounded set of privileged human commands: **approve**
(gate G6 flip, waiver approval, charter approval), **retry** (reset budget, T18), **waive**
(grant a drafted waiver), **abort** (flag-off rollback, quarantine/defer), **replay** (re-run a
unit/run deterministically). Enforces that these are the ONLY ways a human mutates state, and
records each as a ledger event with attribution.

**Public interface (exposed):**
- `inspect(unitId|runId) → ReviewPacket`, `dashboard() → Rollup`.
- Commands (each → `LedgerEvent`): `approve(target)`, `retry(unitId, budgetReset)`,
  `waive(waiverId)`, `abort(unitId, mode)`, `replay(unitId|runId)`.

**MUST NOT know:** framework specifics beyond what the neutral review packet renders; it must
not contain source/target logic — it presents evidence and issues core commands.

**Maps from `plans/`:** P7 §1 review lane/packets, T18/T19 human transitions, `charter.approval`,
waiver approval flow, ratchet dashboard (01 §7), RISKS F12 (review-lane collapse defenses).

---

## 5. Where the current `plans/` design leaks (and the fix)

These are the concrete seams where Angular 2+ or OneCX specifics have bled into what MUST be
neutral. Each MUST be closed before `harness-core` can be called reusable. (Each leak's
*structural* lesson — core must not hardcode framework/target specifics — is general; only the
illustrations are Angular-2+.)

**L1 — Gate definitions bundle target-specific evidence producers (`01 §3.2`, G2/G4).**
G2 hardcodes `tsc`/lint/vitest/Storybook; G4 embeds "zone stable / `afterNextRender` fired
(source) / no pending React updates (target)" in the *settle-point* definition (00 §8 glossary,
P3 §2.3). *Fix:* core defines gates abstractly as `gate(id, requiredEvidenceKinds[])`;
`GateEvidenceKinds` and settle signals are supplied by target-react (build/settle) and
source-angular (zone stability / `afterNextRender`). Core re-runs whatever the adapter
registered; it never names a binary or a settle mechanism.

**L2 — Unit vocabulary is an Angular-2+/React taxonomy (`unit.schema.json`, 01 §2).**
`kind ∈ {route,component,service,pipe,guard,primitive,infra}`, `risk.factors` values
(`manual-change-detection`,`imperative-dom`,`rxjs-teardown`), and `seam.type: element-bridge` are
baked into the core schema. A different source framework has different kinds; OneCX adds
`topic`/`remote`/`slot`. *Fix:* core schema carries `kind: string`, `risk.factors: string[]`,
`seam: {type: string,…}` validated against **adapter-registered vocabularies**
(`UnitKindVocabulary`, etc.). The Angular-2+ enums move into a source-adapter manifest.

**L3 — Trace event kinds hardcode `ng.*` and `react.*` (`trace-event.schema.json`).**
The `kind` enum is closed and lists Angular/React internals. A new source/target can't emit
its events; and core/oracle "know" these namespaces exist.
*Fix:* make `kind` an open string constrained to a **registered namespace set**; neutral kinds
(`user.*`,`net.*`,`aria.*`,`domain.event`,`url.change`,`settle`,`focus.change`,`perf.*`) stay in
the oracle core; `ng.*` (src) and `react.*` (tgt) register at run start. The oracle's
normalizer drops any `<adapter>.*` channel from the parity diff automatically (generalizing the
"`ng.*` are diagnostic, never parity" rule in P3 §5 / OOB §4).

**L4 — Charter mixes engine config with the source fingerprint (`charter.schema.json`, P0).**
`app.angularVersion`, `standaloneVsNgModule` mix, `buildTool: nx|webpack|vite`, and
`moduleFederation` describe the *source app*, not the engine, yet sit in the core-owned charter.
*Fix:* split into `RunRequest` (core: budgets, oracle thresholds, WIP, model routing ref,
`sourceAdapter`/`targetAdapter`/`profile` names) plus an opaque `source.profile` block the
source adapter defines and validates. Angular 2+ populates it with `angularVersion`,
`standaloneVsNgModule`, `buildTool`, RxJS version, and `moduleFederation`; OneCX extends it with
topic/remote/preloader inventory.

**L5 — Construct-mapping table lives inside a phase doc as prose (`P5 §2`).**
It fuses Angular-left / React-right in one normative table the recipe-miner reads directly,
coupling recipe induction to both frameworks.
*Fix:* the table becomes **recipe-registry data** whose rows are contributed by adapters:
source-angular owns the left column (construct detection), target-react owns the right (target
pattern), profile-onecx contributes OneCX rows (topic-service→observable-hook, slot→compound
component). recipe-miner consumes rows opaquely.

**L6 — Roles carry framework knowledge in their cards/prompts (`03`, `prompts/`).**
converter/critic/analyst prompts hardcode `signal()`/`computed`, `effect`, `@for track`, RxJS
teardown, `inject()`. If these live in the *role* (core-scheduled), core leaks src/tgt knowledge.
*Fix:* role cards stay neutral ("convert one unit following its recipe"); all construct-specific
guidance is injected via the **recipe** (reg) and the **antipattern rules** (tgt) at pack-assembly
time. `suspectedConstruct` in the counterexample schema stays a free string, but its *taxonomy*
is an adapter-supplied enum, not a core constant.

**L7 — Serving/tracing/seam concepts assume specific mechanisms (`P2 §2-3`, `P4 §2-3`, 02 §2).**
The `bootstrapApplication`/`ApplicationRef` tracer hook, zone stability / `afterNextRender`
settle, the `@angular/elements` custom-element bridge, DI-provider injection, and Module
Federation seams are all Angular-2+/target-specific mechanisms — none may be hardcoded in core.
*Fix:* `app.start(side, {instrumented, flags})` stays in core as an interface; the *mechanism*
is `SourceAdapter.probe.install` (tracing, via the bootstrap/`ApplicationRef` hook) and
`TargetAdapter.seam` (coexistence, via the custom-element/MF bridge). The `side` value
generalizes `legacy→source`. profile-onecx supplies the MF/webcomponent seam contract on top of
target-react's generic bridge.

**L8 — Ratchet & workspace names encode the source story (`00 §5`, `01 §7`, P7 §6).**
`legacy-file-count`, `legacy/`, `shim/`, "Angular runtime removed from bundle."
*Fix:* rename to source-neutral (`source/`, `source-file-count`, "source runtime removed"); the
bundle-removal checklist item is a **profile-onecx** concern (Zone.js / Angular providers /
preloaders / MF remotes), not core.

---

## 6. Conformance test for the boundary (how we know it holds)

1. **Deletion test.** Removing `profile-onecx` MUST leave a harness that runs a non-OneCX
   Angular 2+ app end-to-end (this is `PLAN.md`'s held-out conformance app requirement).
2. **Swap test.** Replacing `source-angular` with a hypothetical `source-vue` adapter MUST
   require **zero** edits to harness-core, oracle, recipe-registry, model-gateway, or
   operator-control — only a new adapter + its vocabularies/recipes.
3. **Grep test.** `grep -riE 'angular|react|onecx|signal|rxjs|topic|slot|tsx' src/harness-core`
   returns no substantive hits — the core guard rejects **any** framework name
   (angular/react/onecx). Same for model-gateway and operator-control. The guard does **not**
   apply to `source-angular`: a substantive `angularjs`/`$scope` hit there is fine to drop from
   the guard (we do not handle AngularJS), and Angular-2+ tokens there are expected, not leaks.
4. **Schema test.** Every core-owned schema (`Unit`, `LedgerEvent`, `TraceEvent` envelope,
   `RunRequest`) validates an artifact from a second, synthetic source/target adapter without
   modification.
</content>
</invoke>
