# Phase 6 — The Conversion Loop (per unit)

> **Status: normative.** v2 successor to `plans/phases/P6-conversion-loop.md`, rewritten against
> `schemas-v2/`. The **source and target frameworks are parameters**
> (`RunRequest.source.framework` / `RunRequest.target.framework`), not assumptions; the worked
> example is **Angular 2+ → React** but no procedure here depends on that pairing. This is the
> steady-state factory: many units in flight, each walking the unit state machine
> (`ORCHESTRATOR.md §3`). This doc specifies each station's procedure. Weaker agents live here —
> precision in these procedures is what makes that safe.

> **Roles:** converter, verifier, counterexample-analyst, repairer, critic (role cards in
> `plans/03-AGENT-ROLES.md`; neutral role→artifact ownership in `ORCHESTRATOR.md §9`).

## 0. Scheduling (orchestrator)

- Claim order: the active `MigrationPlan.waves` order, filtered to `READY`, WIP-limited
  (`ORCHESTRATOR.md §10`). Agents pull work with `unit.claim`; they never pick units directly.
- **WIP cap is set by human review bandwidth, not compute.** Every published large-scale
  migration (Google JUnit4, Amazon Q) found reviewer throughput was the bottleneck; generate
  only what the review lane can absorb per week (`RunRequest.budgets.wipLimits`).
- Batch affinity: prefer giving one converter consecutive units of the SAME motif (prompt
  cache + recipe familiarity), but never two units with a dep between them concurrently.
- Model tier from `RunRequest.budgets.modelRouting`; on `high` tier with cross-check enabled,
  spawn two independent conversions (`plans/EXTENSIONS-OOB.md §7`).
- **Two kinds of retry, two budgets** (evidence: Airbnb's Enzyme→RTL run, where brute-force
  error-fed retries drove 75%→97% automation):
  - **In-gate mechanical retries** (making the typechecker / linter / unit tests pass inside
    `CONVERTING`): cheap, error-fed loops — re-prompt with the verbatim validator errors + the
    current file. Budget ~10 iterations per gate attempt. Keep an **error-memory file** per unit
    (`migration/units/<id>.errors.ndjson`: every error seen + what was tried) and include its
    tail in retry prompts so the agent doesn't repeat failed fixes. Batch ALL current errors
    into each retry, not one at a time. These iterations do NOT consume `attempts.convert`.
  - **Semantic repair loops** (parity counterexamples): expensive, capped by
    `Unit.budget.maxRepairAttempts` (`attempts.repair`), always routed through the analyst.
  - Infra failures (timeouts, crashes) REPLAY the cached step; only validation failures
    trigger regeneration. Never burn an attempt on an infra failure.
- **Rollback checkpoints:** the orchestrator snapshots (git commit on a work branch) at every
  green gate; when an in-gate retry sequence is diverging (error count non-decreasing 3
  iterations), roll back to the last green checkpoint instead of digging.
- **Re-discovery reconciliation:** nightly, re-run the P1 inventory scanner and diff against the
  unit list — units are "done" when the scanner stops finding their source constructs, not when
  a list says so. Discrepancies open ledger events (`drift-invalidation` / `note`).
- **Fleet floor check:** before the sweep begins, dry-run the 5 primed recipes with the WEAKEST
  model tier in the routing table on already-solved exemplars; a recipe the weak tier cannot
  re-execute on a solved unit must be revised (or its cluster re-routed) before unsolved units
  are attempted.

## 1. Converter procedure (state `CONVERTING` → gates G2, G3)

1. **Read the pack.** Verify recipe preconditions against the unit's source. Any precondition
   false → `escalate` (do NOT improvise a different approach).
2. **Classify state.** For any unit with reactive members, enumerate every reactive member of the
   source construct and classify each as one of: **{prop, local state, derived, server state,
   event}**. Write this table into the unit `notes` BEFORE writing code (it is the review anchor
   and the cheapest place to catch design errors). *(Angular 2+ → React example: enumerate the
   component's `@Input()`s/`input()`s, `signal()`/`computed()` members, injected-service state,
   `EventEmitter`/`output()`s, and template-local bindings, then map each to prop / local state /
   derived / server-state hook / callback-or-event.)*
3. **Run the codemod** if the recipe ships one; fill TODOs following recipe steps in order,
   performing each step's "verify by" micro-check.
4. **Write tests + component story:** unit-runner tests for the classified logic (selectors,
   reducers, validators get direct unit tests); one component story / render smoke per realized
   template shape (P2 §6) wired to the network fixture profile.
5. **Self-check (pre-flight):** typecheck, lint, unit tests, story/render smoke locally via
   `shell.run`; run the unit's scenarios against the hybrid app (`scenario.run`, allowed
   pre-flight only) — fix obvious failures now while context is warm.
6. **Submit G2.** Call `unit.submitGate(unitId, "G2", EvidenceBundle, leaseId)` with build/test
   reports as bundle items; register the produced code as a `Patch` (`patch.submit`,
   `intent.kind = initial-conversion`, `intent.appliedRecipe` set). Then wire the seam: element-
   bridge registration or route swap per the seam-wiring recipe, flag added, source fallback
   intact. **Submit G3** (EvidenceBundle: flag-off baseline unchanged + flag-on mount proof).
7. Budget rule: if you are on your final attempt (`attempts.convert == maxConvertAttempts - 1`),
   prefer a PARTIAL, honest `escalate` (what works, what doesn't, why) over a hail-mary
   submission. Best partial output is preserved (the last `Patch`/`EvidenceBundle` stays on disk)
   and becomes the starting point for the stronger tier or the human — never discard work on
   escalation.
8. **Test integrity is a hard rule:** you may not delete, skip, or weaken any existing test or
   scenario to get green. The orchestrator diffs test counts and assertion counts at every gate
   (reward-hacking screen, the test-integrity ratchet); a drop without an approved
   `DecisionRecord` auto-fails the gate.

> **Adapter notes (Angular 2+).** The source constructs a converter meets — standalone components
> vs `NgModule` declarations, `@Input`/`input()`/`model()` bindings, `signal`/`computed`/`toSignal`
> members, `EventEmitter`/`output()` emitters, `*ngIf`/`@if` control flow, injected services and
> their DI style — are classified in the unit's `sourceAdapter`
> (`adapters/angular2plus.schema.json`, `nodeDescriptor`). The concrete typechecker/linter/
> unit-runner/browser-driver binaries (e.g. tsc / eslint / a unit runner / a browser-driver) are
> resolved from the target adapter; the procedure above is written to the neutral tool roles.

## 2. Verifier procedure (`WIRED → VERIFYING → PASSING | DIVERGENT`) — deterministic

For each linked scenario: boot clean `source` (instrumented) and `hybrid` (flag on) with the
scenario's fixture profile → run 3× per side → normalize `SemanticTrace`s → `trace.diff` with the
unit's diff policy + active `DecisionRecord` waivers. All green ⇒ submit an `EvidenceBundle` at
**G4**. Any reproducible divergence (≥`RunRequest.oracle.flakeScreenRuns`-majority, default ≥2/3)
⇒ open `Counterexample`(s) with trace excerpts and set `DIVERGENT`. Flaky (sub-threshold, e.g.
1/3) ⇒ emit `flake-suspect` → scenario-author queue; the unit stays `VERIFYING` pending scenario
fix, and no counterexample opens and G4 does not fail (flake screen, `ORCHESTRATOR.md §6.4`). Also
record perf deltas (scenario wall time, JS heap after settle) — informational unless the
`RunRequest` sets budgets (see `plans/EXTENSIONS-OOB.md §6`).

Each opened `Counterexample` is schema-valid and carries a stable `fingerprint` =
`sha256(scenarioId | divergence.kind | firstDivergentSemanticKey)`, `status: open`, and
`reopenCount` (0 on first open). Divergence kinds are the neutral set from
`counterexample.schema.json` (`missing-event`, `extra-event`, `order`, `payload-mismatch`,
`aria-mismatch`, `dom-mismatch`, `url-mismatch`, `console-error`, `timing-semantic`, `focus-order`,
`visual`).

## 3. Counterexample-analyst procedure (`DIVERGENT` → repair directive)

1. `trace.bisect` to the minimal divergent step; pull both traces' raw layers around it — the
   framework-internal events (collapsed to the neutral `framework.event` kind + `frameworkEvent`
   adapter slot, side-tagged `source`/`target`) usually name the mechanism. *(Angular 2+ → React
   example: the source side emitted a façade event DURING a change-detection pass, before the XHR;
   the target dispatches it after the response resolves.)*
2. Set `analysis.suspectedConstruct` from the neutral root-cause vocabulary (free text, e.g.
   `derived-state-ordering`, `content-projection-slot`, `scheduler-vs-microtask-timing`); put any
   framework-specific classification in `analysis.sourceAdapter`. Consult recipe `pitfalls` and
   lessons — cite matches in the directive.
3. Write `analysis.repairDirective`: `targetArtifact` (the file/module to change), `fixDirection`,
   and **`expectedObservable`** (the expected observable change in the trace). Set the
   counterexample `status: directed`. If the divergence reveals the SCENARIO is wrong
   (over-specified timing, non-semantic assertion) → route to scenario-author instead (never
   "fix" the app to satisfy a bad test). If source behavior is a genuine bug → `decision.draft` a
   `waiver` (`type: waiver`, `status: pending-human`); a human decides.
4. If the same `fingerprint` has already reopened once (`reopenCount ≥ 1`): skip the directive,
   set `analysis.waiverRecommended` as appropriate, and recommend escalation with your analysis
   attached — the anti-loop rule will force T17 anyway when a fingerprint reaches `reopenCount ≥ 2`
   after a claimed fix (`ORCHESTRATOR.md §3.3`).

> **Adapter notes (Angular 2+).** The `analysis.sourceAdapter` may carry an Angular-2+ root-cause
> class (`adapters/angular2plus.schema.json` `rootCauseClass`), e.g. `onpush-change-detection-miss`,
> `signal-glitch-ordering`, `rxjs-subscription-leak`, `zone-vs-microtask-timing`. This is metadata
> for the librarian and for lesson tagging; the directive itself is written in neutral trace terms.

## 4. Repairer procedure (`REPAIRING` → G2 → … → G4 re-run)

Fix exactly what the directive's `targetArtifact` names; re-run pre-flight for the affected
scenario only; register the fix as a `Patch` with `intent.kind = repair` and
**`intent.targetsCounterexample = <ceId>`** (anti-loop tracking depends on this field), then
resubmit an `EvidenceBundle` at G2 (fast path: the orchestrator re-runs only the affected checks).
On a claimed fix the counterexample moves `status: fix-claimed`; if the verifier reopens it, it
returns to `status: reopened` and `reopenCount` increments. Forbidden: weakening tests, touching
the scenario, timing hacks such as arbitrary delays (timing divergences are design signals —
reread the directive), and edits outside the target artifact ± its imports without a directive
amendment from the analyst.

## 5. Critic procedure (`PASSING` → G5)

Checklist (each item → approve or file a finding with `file:line`):
- Conventions conformance (the target conventions doc, `target/CONVENTIONS.md`) and recipe
  conformance (or a justified, noted deviation).
- **No reactive-emulation smells:** grep-level heuristics for target code that mechanically
  re-implements the source framework's reactive machinery instead of adopting native target
  patterns — a target effect whose dependency list mirrors another piece of state purely to keep
  them in sync (the derived-state-should-be-computed smell); a mutable ref used as a general
  scope/state bag; effect/subscription chains more than 2 deep. *(Angular 2+ → React example: a
  `useEffect` with a state-setter whose deps mirror another state — the emulated `$watch`/
  effect-driven derivation; a `useRef` used as a mutable member bag standing in for
  component-instance state.)*
- Dead code, commented-out source, unused exports, escape-hatch typing (`any`), non-null
  assertions without cause.
- A11y floor: interactive elements have roles/names; forms have labels; focus management on
  modals (scenarios may not cover all of it).
- Test honesty: assertions actually assert (no snapshot-only tests for logic); selectors are
  user-facing.
- Seam hygiene (if element-bridge seam): events via `detail`, no function props across the
  boundary, light DOM.

Verdict `approve` → G5 (`critic-verdict`). `request-changes` → one bounded fix round by the same
converter, one re-review; further → `escalate`. Critic findings tagged `recipe-gap` go to the
librarian. Findings the team accepts as intentional are absorbed by a `DecisionRecord` rather than
silently ignored.

## 6. Post-acceptance knowledge loop (librarian, after every G4/G5/escalation)

- A counterexample closed `closed-fixed` with a generalizable cause → a lesson (≤10 lines, tagged
  by motif + `suspectedConstruct`) via `lessons.add`, or a recipe `pitfalls` amendment (prefer the
  recipe — it's always in-pack).
- Update `recipes/stats.json`; pull recipes below the success threshold.
- Escalation resolutions (human / strong-model, recorded as `DecisionRecord` type
  `escalation-resolution`) are the richest source — mine every one.

## 7. Worked example (Angular 2+ → React illustration)

`unit:component:invoiceTable` (motifs: list+filter-table, derived-reactive-state; risk tier high;
recipe r-005):

- **Converter** classifies state: `rows` → server state (a data-fetching hook); `filters` → local
  state; `filteredRows` → derived (a memoized selector); `sortState` → local state; the
  `filters:changed` broadcast → an event published through the event façade (the seam). The codemod
  emits typed props + a skeleton; selectors are extracted and unit-tested; one story per template
  shape (2 found in P2). Pre-flight catches a missing list-key mapping (the source's tracking
  identity → the target's list `key`, recipe pitfall #1). A `Patch`
  (`intent.kind = initial-conversion`, `appliedRecipe: r-005`) is registered; G2/G3 pass.
- **Verifier** replays scenario `invoice-list.filter-by-status` on both twins. Divergence
  (`kind: order`): the neutral `domain.event invoiceFilterChanged` fires AFTER the `net.request`
  on the target, but BEFORE it on the source (this unit runs a strict diff policy). A schema-valid
  `Counterexample` opens with `fingerprint = sha256(scenarioId | order | <firstDivergentSemanticKey>)`,
  `status: open`, `reopenCount: 0`.
- **Analyst** bisects to the minimal step: the source published the event synchronously during a
  reactive/change-detection pass; the target published it from the data hook's success path.
  `suspectedConstruct: "reactive-emission-timing"`; `repairDirective.targetArtifact` = the filter
  component; `fixDirection`: move the façade publish from the query `onSuccess` callback to the
  filter-change handler; `expectedObservable`: "event precedes request in the trace." Counterexample
  → `status: directed`.
- **Repairer** applies the one-file change, registers a `Patch`
  (`intent.kind = repair`, `targetsCounterexample: ce-000123`), resubmits G2; the counterexample
  goes `fix-claimed`, then `closed-fixed` when the verifier's G4 re-run is green.
- **Critic** files one finding (an unused import), fixed in-round; G5 `approve`.
- **Integrator** flips the flag (G6); the nightly parity suite stays green; the unit reaches
  `ACCEPTED` after a 1-week soak (G7).
- **Librarian** records the lesson "façade events fire at interaction time, not at server-state
  settlement," tagged `derived-reactive-state`.
