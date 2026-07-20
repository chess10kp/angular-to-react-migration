# Phase 0 — Intake & Calibration (v2, framework-neutral)

> **Status: normative.** v2 successor to `plans/phases/P0-intake-calibration.md`, rewritten
> against `schemas-v2/`. The **source and target frameworks are parameters, not assumptions**
> (`RunRequest.source.framework` / `RunRequest.target.framework`). Every probe below is described
> by the *fact it establishes*, not by the framework it assumes; the concrete commands for the
> worked example (**Angular 2+ → React**) live in the "Adapter notes (Angular 2+)" callouts and
> resolve from `sourceAdapter`/`targetAdapter` (`adapters/angular2plus.schema.json`). Provenance:
> ported from `plans/phases/P0`.

> **Role:** intake-analyst. **Input:** `legacy/` checkout (the SOURCE app, whatever its framework)
> + whatever serving knowledge exists. **Output:** `migration/run-request.json` (schema:
> `run-request.schema.json`) + `run-request-summary.md`, human-approved. **Exit gate:** `RunRequest`
> schema-valid, every field evidence-backed (`RunRequest.evidence[]`), approval recorded
> (`RunRequest.approval`).

The `RunRequest` is the calibration layer that makes this harness generic: every later phase reads
its decisions instead of hardcoding them. It fixes the source/target framework parameters, the
serving strategy, budgets, and oracle policy. Do not skip probes because the answer "seems obvious."

## 1. Source-framework identity & version fingerprinting

The purpose of this section is to establish, with evidence, **which framework the source app is,
which version, how it boots, how it wires dependencies, and how it routes** — and to trip the
showstopper flags that mean this harness is the wrong tool. Run each probe and record command +
output path in `RunRequest.evidence[]` (`{claim, probe, artifactPath}`).

| Probe (purpose) | What it establishes | Field |
|---|---|---|
| **Framework identity & version** | Confirm the source framework and pin its exact version; the definitive source is a running instance (serve, read the framework's own version at runtime), not a manifest guess | `source.framework` (`{id, version}`); detail → `source.adapter` |
| **Wrong-harness / mismatch check** | Detect that the app is actually a *different* framework (or generation) than assumed. If the detected framework ≠ `RunRequest.source.framework` → **STOP, escalate** | `app.showstoppers` |
| **Third-party DOM-plugin adoption** | Detect imperative DOM widget libraries the source framework has adopted and whether they run before/after framework boot — each becomes a wrapped `infra`/`primitive` unit | `app.sizeMetrics`, feeds P1 census |
| **DI strictness / style** | Establish how dependencies are declared and resolved (strict vs lax, string-token vs typed), which governs how safely the scanner can rewrite injection sites | detail → `source.adapter` |
| **Router** | Identify the routing library and version — matters for seam teardown (some router versions expose an explicit dispose/cleanup hook, some do not) | detail → `source.adapter`; feeds `strategy` |
| **Bootstrap style** | Establish how and where the app bootstraps (single vs multiple roots; declarative vs manual). **More than one app root per page = showstopper flag**; also feeds the P2 instrumentation-injection design | `app.showstoppers`, feeds P2 |
| **Build era / module system** | Classify the toolchain (bundled vs concatenated scripts, package manager, build tool) so the serve probe and P2 injection know what they are dealing with | detail → `source.adapter` |
| **Component-era usage** | Gauge how much of the app uses the source framework's *modern* component idiom vs legacy imperative idioms — a modern-idiom-heavy app is much cheaper to migrate | `app.sizeMetrics` |

> **Adapter notes (Angular 2+).** For the worked example the concrete probes fill
> `source.adapter` = `angular2plus.appProfile`:
> - *Identity & version* — read `@angular/core` from `package.json`, confirm at runtime via the
>   `ng-version` attribute on the root host / `window.ng.getComponent`; record
>   `appProfile.angularVersion`.
> - *Mismatch check* — a source that is actually **AngularJS** (`angular.module`, `ng-app`,
>   `angular.version.full`) or a non-Angular framework ⇒ wrong harness → `app.showstoppers`.
> - *Bootstrap style* — `bootstrapModule(AppModule)` vs `bootstrapApplication(AppComponent)` →
>   `appProfile.bootstrapStyle ∈ {ngModule, standalone, mixed}`; zoneful vs zoneless
>   (`provideExperimentalZonelessChangeDetection`) → `appProfile.zoneful`.
> - *DI style* — constructor-param vs `inject()` → recorded per node later as
>   `nodeDescriptor.injectables[].api`.
> - *Router* — `appProfile.router ∈ {angular-router, custom, none}`; note lazy `loadChildren`/
>   `loadComponent` usage.
> - *Build era* — `appProfile.buildSystem` (angular-cli-esbuild/webpack, nx, bazel, …),
>   `moduleFederation`, `rxjsVersion`, `stateManagement`.
> - *Component-era usage* — standalone-component share vs NgModule-declared →
>   `appProfile.inventorySummary` (`standaloneComponents`, `ngModules`, `pipes`, `injectables`, …).

## 2. Serve probe (hard requirement)

Goal: a repeatable command that serves the source app locally against deterministic data, such
that `app.start("source")` (`TOOL-CONTRACTS.md §2`) can be implemented from `serving.howToServe`
alone.

1. Try the documented dev workflow (README, package scripts, framework CLI `serve`).
2. If the build tooling is bit-rotted (common: runtime-version-locked build tools, dead package
   registries) do **NOT** fix the source toolchain. Fallback ladder:
   a. Serve a previously built distribution directory with any static server;
   b. Static-serve the source tree if it is script-tag style;
   c. Ask the human for a staging URL (record `serving.baseUrl` as remote).
3. Backend: decide `serving.backendStrategy` — `record-replay-mock` (preferred: capture HAR
   against staging once, replay forever — deterministic) vs `live-staging` (only if the API is
   stable and side-effect-safe) vs `hybrid`.
4. Record exact steps in `serving.howToServe`.

**Definition of done:** the app boots, a human-nameable core flow works, and the boot is
repeatable from a clean checkout by following only what the `RunRequest` says.

## 3. Size & risk census

Count with the P1 scanner in "cheap mode" (regex/AST-lite is acceptable at this phase). Capture,
per the source framework's construct vocabulary: components, presentation/behavior units,
services, routes, templates, reactive-subscription/watch sites, cross-unit event
publish/subscribe sites, runtime-template-compilation sites, and third-party DOM-plugin
invocations (census against a known-plugin list + unknowns). Neutral totals go to
`RunRequest.app.sizeMetrics`; framework-specific breakdowns go to `source.adapter`
(`appProfile.inventorySummary`).

Produce the **risk histogram** (counts per factor) — this drives calibration:

| Factor observed | Calibration consequence |
|---|---|
| >30% of behavior/presentation units do imperative DOM work (custom compile/link-style lifecycle) | Raise oracle thresholds; plan wrapper-first recipes; budget more analyst time |
| Heavy cross-unit event-bus use (>50 distinct event names) | Schedule the typed event façade (P4) as an early `infra` unit |
| Third-party DOM plugins > 5 distinct | Each becomes its own `infra`/wrapper unit; check for target-framework-native replacements per plugin |
| Runtime template compilation with dynamic/non-literal input | Enable the dynamic-template enumerator (P2 §6); mark owning units high-risk |
| No existing e2e tests | Increase `oracle.minScenariosPerUnit`; enable mutation calibration for `medium` tier too |
| Modern-component-idiom-dominant, current framework version, router with explicit teardown | Best case: consider more aggressive per-route ordering and cheaper model tiers |

> **Adapter notes (Angular 2+).** Concrete census signals map to `angular2plus.nodeDescriptor`:
> imperative DOM work = directives with heavy `ElementRef`/`Renderer2`/host-DOM mutation;
> event-bus use = shared `Subject`/`BehaviorSubject` services (`rxjsStreams`); runtime template
> compilation = `ngComponentOutlet` / `ViewContainerRef.createComponent` / dynamic component
> loading; third-party DOM plugins = directives wrapping non-Angular widgets. OnPush ratio,
> signal adoption, and RxJS teardown style (`takeUntilDestroyed`/`async` pipe/manual) are all
> risk signals recorded per node.

## 4. Strategy decisions (write reasoning into `run-request-summary.md`)

**Default seam** (`RunRequest.strategy.defaultSeam`) — decision rule:
- App has ≤ ~15 routes with low cross-route shared UI → `route-shell`.
- Rich shared chrome (nav, modals, notifications used everywhere) → `element-bridge` for
  primitives + `route-shell` for pages (both; `strategy.defaultSeam` = the majority choice).

**Shell direction** (`RunRequest.strategy.shellDirection`) — start `legacy-hosts-target`
(target-framework islands embedded inside the source app's page). Plan the **flip point**: when
>50% of routes are migrated, invert to `target-hosts-legacy` (the target router owns the URL;
remaining source routes mount inside a target wrapper via the seam). Record the intended flip
trigger in the summary.

**Unit ordering default** (`RunRequest.strategy.unitOrdering`): leaf services → shared
primitives/design-system → pure transforms (pipe-like) → low-risk presentation-only components →
routes by ascending risk × descending traffic → directive-like plugin islands last unless they
block routes.

**Normalization pre-pass** (`RunRequest.strategy.normalizationPrepass`,
`plans/EXTENSIONS-OOB.md §2`): enable when a legacy imperative idiom dominates (>60% of behavior
units) AND the team accepts source-side commits gated by the same oracle. Otherwise skip.

> **Adapter notes (Angular 2+).** The seam is realized with a custom-element/`ng-prop-*` bridge
> or a route-shell; concrete bridge mechanism → `targetAdapter`. Which router owns the URL after
> the flip is still `shellDirection`; the target-side router specifics resolve from the target
> adapter, not from this doc.

## 5. Budgets & model routing

Fill `RunRequest.budgets.modelRouting` (risk tier × role → model tier). Suggested defaults:

| | converter | repairer | scenario-author | analyst | critic |
|---|---|---|---|---|---|
| low | cheap | cheap | standard | standard | cheap |
| medium | standard | standard | standard | standard | standard |
| high | standard (+cross-check, `plans/EXTENSIONS-OOB.md §7`) | strong | strong | strong | standard |
| critical | strong | strong | strong | strong | strong + human |

Attempt caps (`RunRequest.budgets.attemptCapsByTier`, `low/med/high/critical`): convert 3/3/4/2,
repair 5/6/8/4 (critical escalates early by design). Context pack budget
(`RunRequest.budgets.contextPackTokenBudget`): 60k tokens, standard tier. These feed the
orchestrator's anti-loop invariants (`ORCHESTRATOR.md §3.3, §6`).

## 6. Showstopper checklist (each found → `RunRequest.app.showstoppers` + human decision before P1)

Framework-neutral blockers:

- Multiple app roots or multiple bootstraps per page.
- Server-rendered pages that inline source-framework templates (template source not in repo).
- CSP or bundle checksums that block script injection (breaks the P2 shim → need build-hook
  injection, `serving.instrumentationInjection = build-hook`).
- Source-framework version too old for the modern component idiom (harness works but recipes
  shift — flag).
- Frames/iframes hosting separate apps.
- Legacy binary islands (Flash/applet/ActiveX — yes, still real in legacy fleets).
- Authentication that can't be fixtured (hardware tokens, SSO redirects that can't be stubbed).

> **Adapter notes (Angular 2+).** The version-too-old flag corresponds to pre-standalone / very
> old Angular-2+ majors where recipe applicability shifts; record `appProfile.angularVersion` and
> `appProfile.bootstrapStyle`. A source that is actually AngularJS is a *wrong-harness*
> escalation, not a showstopper waiver.

## 7. Human approval

Present `run-request-summary.md`: profile, risk histogram, chosen strategy + why, budgets, list of
showstoppers + proposed handling, and the first 10 units you'd migrate. Approval is recorded in
`RunRequest.approval` and as a ledger `note` event (`RunResult#/$defs/ledgerEvent`). **No P1 work
before approval.**
