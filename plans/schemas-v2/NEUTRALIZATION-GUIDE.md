# v2 Neutralization Guide (internal — how to port `plans/*` into `schemas-v2/`)

This guide governs how the framework-specific `plans/` docs are ported into the framework-neutral
v2 doc set under `schemas-v2/`. Read the three already-ported docs first for tone and vocabulary:
`ARCHITECTURE.md`, `ORCHESTRATOR.md`, `TOOL-CONTRACTS.md`. Match them exactly.

## Core rule

**The source and target frameworks are parameters, not assumptions.** The core prose must read
correctly for *any* source→target component-framework pair. Angular 2+ → React is the **worked
example** only. Never write a sentence whose truth depends on the source being AngularJS/Angular
or the target being React — unless it is explicitly flagged as an example.

## The three moves

1. **Neutralize** — replace framework nouns with neutral ones (table below). Keep the procedure,
   drop the framework assumption.
2. **Exemplify** — where a concrete illustration helps, phrase it as "e.g. (Angular 2+ → React):
   …". Keep these short and clearly marked as examples.
3. **Push to adapter** — framework-specific classification/metadata/probes go to a
   `sourceAdapter`/`targetAdapter` reference (`adapters/angular2plus.schema.json`) or a short
   "Adapter notes (Angular 2+)" callout at the end of a section — never inlined into the neutral flow.

## Vocabulary map (source term → neutral term)

| Framework-specific (drop from core) | Neutral (use) |
|---|---|
| AngularJS / Angular / React (as the assumed framework) | source app / target app; "the source framework" / "the target framework" (parameters from `RunRequest.source/target`) |
| `legacy/` app / "legacy" as a synonym for source | source app (dir stays `legacy/` but means "the source checkout") |
| charter (`charter.json`) | `RunRequest` (`run-request.json`) |
| waiver | `DecisionRecord` (a waiver is one `type`) |
| Behavior IR | `BehaviorScenario` |
| trace event / ng internal events (`$digest`, `$watch`, `ngjs.*`) | `SemanticTrace` neutral events; framework-internal events → single `framework.event` kind + `frameworkEvent` adapter slot |
| context pack manifest | `RunManifest` |
| ledger event | `RunResult#/$defs/ledgerEvent` (LedgerEvent) |
| `$scope`/controller members, digest, watchers, two-way `=` binding | "reactive members / derived state / dataflow"; classify as {prop, local state, derived, server state, event}. Concrete `$scope`/signals detail → example or adapter note |
| directive / filter / service / component / NgModule (as `kind`) | neutral `Unit.kind`: `directive-like`, `pipe-like`, `service`, `component`, `module`, `store`, … (construct → `sourceAdapter`) |
| jQuery plugin / third-party DOM plugin | "third-party DOM plugin" (a wrapped `infra`/`primitive` unit) |
| react2angular / single-spa / `ng-prop-*` / custom-element bridge specifics | "the seam" (`route-shell` / `element-bridge`); concrete mechanism → target adapter note |
| RTL / Vitest / Playwright / tsc / eslint | neutral: "unit-test runner / typechecker / linter / browser-driver"; concrete tools resolved from the target adapter |
| MSW / msw-storybook-addon | "network fixture layer / mock handlers" |
| Storybook story | "component story / render smoke" |
| CONVENTIONS.md | "the target conventions doc" (still `target/CONVENTIONS.md`) |
| `NG_DEFER_BOOTSTRAP!` / `angular.bootstrap` / `ng-app` | "the source app's bootstrap"; zero-touch instrumentation via proxy/driver interception (`RunRequest.serving.instrumentationInjection`); specifics → adapter note |
| gate letters G1..G8 | keep as-is (neutral `gateId`, pattern `^G[0-9]+$`) |
| unit id `unit:cmp:` / `unit:flt:` | neutral `unit:component:` / `unit:pipe-like:` (`common.schema.json#/$defs/unitId`) |
| `charter.evidence[]`, `charter.strategy.*`, `charter.budgets.*` | `RunRequest.evidence[]`, `RunRequest.strategy.*`, `RunRequest.budgets.*` |
| error-memory `units/<id>.errors.ndjson` | keep (neutral); it's an orchestrator convenience file |

## Artifact/field name updates (v1 → v2) — always use the v2 name

RunRequest, MigrationPlan, Unit, InventoryGraph, BehaviorScenario, SemanticTrace, Patch,
EvidenceBundle, Counterexample (+ `fingerprint`, `reopenCount`, statuses
`open/analyzing/directed/fix-claimed/closed-*/reopened`), Recipe, DecisionRecord, RunManifest,
RunResult/LedgerEvent. Gate submissions carry an `EvidenceBundle`; code changes are a `Patch`.
Neutral ledger event types only (`decision-granted`, `escalation-resolved`, `patch-submitted`,
`pack-overflow`, `flake-suspect`, `ratchet-adjusted`, …). See `ORCHESTRATOR.md §5,§7` and the
crosswalk appendix.

## What to KEEP verbatim (do not neutralize)

- The engineering discipline and rationale (green-on-source first, budgeted retries, evidence
  gating, test-integrity ratchet, review-bandwidth WIP cap, error-memory retries, rollback
  checkpoints, flake screen). These are framework-independent and are the whole point.
- Citations to published migrations (Google, Airbnb, Amazon Q, ZoomInfo, Slack) — keep; they are
  evidence for the mechanism, not framework claims.
- Numeric defaults (attempt caps, 60k pack budget, kill-rate thresholds, K=5 lessons) — keep.
- Gate identities and the transition table semantics (from `ORCHESTRATOR.md §3`).

## Format

- Same header/callout style as the three finished docs: a normative blockquote at the top stating
  "v2 successor to `plans/<n>`" and that frameworks are parameters.
- Cross-reference the v2 docs (`ARCHITECTURE.md`, `ORCHESTRATOR.md`, `TOOL-CONTRACTS.md`) and v2
  artifact schemas, NOT the v1 `plans/00–03` docs (except a one-line provenance note).
- Where the source doc referenced an EXTENSIONS-OOB section, keep the reference as
  `plans/EXTENSIONS-OOB.md §n` (that doc is not being ported now) but describe the mechanism neutrally.
- Preserve section numbering and worked examples; rewrite the worked example's specifics as
  "(Angular 2+ → React)" illustrations so they still teach without asserting the framework.
