# Phase 3 — Behavior Scenarios & the Oracle (v2, framework-neutral)

> **Status: normative.** v2 successor to `plans/phases/P3-behavior-ir-and-oracle.md` (note the
> filename drops the `-ir`: the artifact is now a `BehaviorScenario`, not "Behavior IR"). The
> **source and target frameworks are parameters, not assumptions** (`RunRequest.source.framework`
> / `RunRequest.target.framework`); Angular 2+ → React is only the worked example. Where a rule
> needs framework specifics it reads them from a `sourceAdapter`/`targetAdapter` slot
> (`adapter-ref.schema.json`) — never from an inlined field.
>
> **Roles:** scenario-author, oracle-calibrator. **Input:** `InventoryGraph`, recorded
> `SemanticTrace`s, network fixture profiles. **Output:** `BehaviorScenario`s + browser-driver
> acceptance specs, all **green against the source app** (gate G1); calibration reports for
> high/critical units; trace-diff policies configured. **Exit condition (program-level):** every
> unit scheduled for conversion in the next window is `SPECIFIED` (`ORCHESTRATOR.md §3`, T1). P3
> runs continuously, staying ahead of P6.

---

## 1. Scenario counts (defaults; `RunRequest.oracle` overrides)

Kill-rate thresholds are read from `RunRequest.oracle.minKillRate.{high,critical}`; the values
below are the defaults.

| Risk tier | Min scenarios | Must cover | Calibration |
|---|---|---|---|
| low | 1 | happy path | no |
| medium | 2 | happy path + 1 alternate (empty/error state) | no (yes if the source unit has no tests) |
| high | 3–5 | happy, error, edge (per motif `verificationEmphasis`) | yes, kill ≥ 0.7 |
| critical | 5+ | above + concurrency/timing flows | yes, kill ≥ 0.85 + human review of scenarios |

## 2. Authoring rules (scenario-author MUST follow)

1. **`BehaviorScenario` first, then the acceptance spec.** The browser-driver spec is a mechanical
   rendering of the scenario — a generator should produce 90% of it (write that generator in P4;
   specs may extend it, never contradict it).
2. **Locate by role+name** wherever the source app's DOM allows; CSS selectors are a fallback
   recorded with a `selector-debt` note. When a compatible hook is required, add it on the
   **target** side to match the assertion (e.g. a `data-test` attribute), **never** on the source
   app — the source is read-only (`ORCHESTRATOR.md §9`, U1).
3. **Assert at settle points.** Every step ends with a `waitForSettle` — network idle AND the
   source framework quiescent (no pending timers) on the source side; network idle AND no pending
   target updates on the target side. The concrete quiescence probe is resolved from the
   `sourceAdapter`/`targetAdapter` (see Adapter notes). **No fixed-duration waits, ever.** Polling
   UIs: freeze via the fixture profile (bounded intervals) or assert on quiescent windows.
4. **Determinism:** every scenario names a `preconditions.fixtureProfile`; time-sensitive flows set
   `preconditions.clock` (implemented with the browser-driver's virtual clock); randomness gets
   `preconditions.seed` (a randomness shim installed in the harness bootstrap for BOTH twins).
5. **Assertion floor per scenario:** ≥1 ARIA outcome (an ARIA-snapshot assertion or role/name
   assertions) under `expected.aria`, `expected.network` semantics if the flow hits the network,
   `expected.url` if navigation occurs, and `expected.consoleErrors: 0`.
6. **ARIA snapshots over DOM snapshots.** Full-DOM golden files fail for irrelevant reasons across
   frameworks (class names, comment nodes, wrapper elements). ARIA snapshots assert what users
   perceive and survive DOM-shape changes — they are the primary structural assertion and the
   reason `expected.aria` is the assertion floor.
7. Scenario IDs (`scenarioId`): `<route-or-feature>.<behavior>` kebab-case, e.g.
   `invoice-list.filter-by-status`. Written to `migration/behavior-ir/<scenarioId>.json`.

> **Adapter notes (Angular 2+ → React).** The source settle signal is "no pending
> `$timeout`/`$interval` and change detection quiescent" exposed by the tracer shim as a
> `window.__mxSettled()` predicate; the target settle signal is "network idle + no pending React
> updates" (double-`requestAnimationFrame` + microtask drain). Role+name location maps to the
> browser-driver's `getByRole`; ARIA snapshots use its `toMatchAriaSnapshot`. These specifics ride
> in the target adapter's tool resolution (`TOOL-CONTRACTS.md §1`) and never appear in a scenario.

## 3. Fixture profiles

Network fixtures are built once per API area and shared by ALL harness layers (browser-driver
e2e, component stories, unit-test runner):

1. `fixtures.captureHar` against the served **source** app (staging/live per `RunRequest`) while
   running the recorded flows.
2. `fixtures.deriveProfile`: HAR → mock handlers + an endpoint inventory (method, path pattern,
   params, response shape). This endpoint inventory later seeds the typed API client (P4 §6). Auth
   is a profile-level login stub or storage-state deltas.
3. Profiles are versioned files; each scenario pins one via `preconditions.fixtureProfile`.
   Changing a profile re-runs G1 for every scenario pinned to it (orchestrator-enforced).

The mock-handler mechanism (browser + node) is a harness detail resolved from the target adapter,
not a framework assumption (`behavior-scenario.schema.json` explicitly notes the mocking library is
not a framework fact).

## 4. Gate G1 mechanics

For each scenario the orchestrator boots
`app.start("source", {instrumented: true, fixtureProfile})`, runs the spec
`RunRequest.oracle.flakeScreenRuns`× (default 3, the flake screen — `ORCHESTRATOR.md §6.4`). PASS =
all runs green (default 3/3). A sub-threshold result (e.g. 2/3) emits a `flake-suspect` ledger
event and returns to the scenario-author to fix determinism — **never to loosen assertions**.
Store the passing run's normalized `SemanticTrace` as the scenario's **baseline trace**
(`status.greenOnLegacy = true`, `legacyTraceRefs[]`). G1 is transition T1
(`DISCOVERED → SPECIFIED`); its required re-run checks are `scenario-source-green` and, for
high/critical tiers, `mutation-kill ≥ min` (`ORCHESTRATOR.md §4`).

## 5. Trace-diff policies (used by `trace.diff` from P6 on; defined and frozen here)

A policy is a named JSON config referenced by `policyId` in `trace.diff`
(`TOOL-CONTRACTS.md §3`); the default is `RunRequest.oracle.diffPolicyDefaults`. Ship three. All
kinds below are the neutral event kinds from `semantic-trace.schema.json`.

**`strict`** (critical tier): align normalized events by `semanticKey` per `stepIndex`. Require
equal multisets AND equal order of: `domain.event`, `url.change`, `net.request` (when
`orderMatters`), `aria.milestone` at settle points, and `focus.change` sequence. Payload
comparison: deep-equal after normalizer scrubbing (ids, timestamps, hashes compared by an
equivalence table).

**`standard`** (default): as `strict`, except — `net.request` within one step compares as a
multiset (order-free unless `orderMatters`); `dom.mutation-burst` ignored; `focus.change` checked
only at step boundaries; numeric payloads within a configured epsilon.

**`relaxed`** (explicitly opt-in per unit + an approved `DecisionRecord`): additionally ignores
extra target-side `net.request` marked `prefetch`, and permits `aria.milestone` supersets (the
target may render MORE accessible structure). Never permits missing events.

Divergence output populates `Counterexample` drafts (`counterexample.schema.json`), using the
neutral `divergence.kind` vocabulary (`missing-event | extra-event | order | payload-mismatch |
aria-mismatch | dom-mismatch | url-mismatch | console-error | timing-semantic | focus-order |
visual`) and `firstDivergentSemanticKey`. Every ignored class MUST be listed in the policy file —
the diff engine has no built-in leniency.

**Normalizer rules (applied to both sides before diff):** drop `framework.event` internals (kept
for the analyst, excluded from parity), collapse duplicate consecutive `aria.milestone`s, scrub
volatile ids (uuid/date regexes → placeholders), map source/target host differences (port, base
path) to a canonical form, and assign `semanticKey`s. Because `trace.diff` aligns on
`semanticKey`, framework-internal events never leak into parity comparison unless a policy opts in.

`framework.event` records are **diagnostic channels**, not parity requirements — the target is
never asked to reproduce the source framework's internal lifecycle signals (change detection,
watch fires, digests). They matter again in the analyst's workflow (counterexample enrichment) and
in Watcher Differential Fingerprinting (`plans/EXTENSIONS-OOB.md §4`).

> **Adapter notes (Angular 2+ → React).** The source-internal signals dropped for parity are
> `frameworkEvent` records with `side: "source"` (e.g. `change-detection`, `zone-task`,
> `rxjs-emit`, `signal-write`); target-internal signals are `side: "target"` (e.g. `commit`,
> `error-boundary`). Both use the single neutral `framework.event` kind with detail in the
> `frameworkEvent` adapter slot (`semantic-trace.schema.json`).

## 6. Oracle calibration (fault injection on the source app — high/critical units)

Purpose: prove the scenarios would catch a wrong conversion. Mechanics — **serve-time mutation**,
never source edits: the instrumentation layer (`RunRequest.serving.instrumentationInjection`, P2)
applies a per-run text/AST patch to the unit's served source response. This preserves U1 (source
is read-only): the checkout is never modified.

Mutant catalog per motif (minimum set; extend). Motifs are neutral cluster names; the concrete
mutation operators are illustrated for the worked example.

| Motif (neutral) | Mutants |
|---|---|
| iteration-table (list + filter/sort) | drop the stable-key/track expression; swap sort direction; off-by-one slice/limit; remove one filter from the transform chain |
| form-with-validators | remove a validator; shift a validator boundary (`>=`→`>`); drop the model-update debounce; skip an error-message binding |
| server-state-service | swap HTTP method; drop a query param; return stale cache; reorder two calls |
| event-bus-node | rename an event on publish; drop one listener; swap emit-vs-broadcast semantics |
| content-projection (multi-slot) | drop one projected slot; reorder slots |
| derived-state | disconnect one derivation (register a no-op); make a deep observation shallow |
| third-party-DOM-plugin wrapper | skip plugin re-init on data change; skip destroy on teardown |

Procedure: for each mutant → run the unit's scenarios → record killed/survived, written to
`status.calibration` (`mutantsInjected`, `mutantsKilled`, `acceptedGaps[]`). Kill rate below the
tier threshold (`RunRequest.oracle.minKillRate`) → the author strengthens scenarios targeting each
survivor, or records an `acceptedGaps[]` entry with justification (human sign-off for critical
tier). The calibration report is a G1 re-run check (`mutation-kill ≥ min`) for high/critical units.

> **Adapter notes (Angular 2+ → React).** Motif mutation operators map to Angular 2+ constructs:
> iteration-table → `@for`/`*ngFor` `track`, `slice`/pagination, pipe chains; form-with-validators
> → reactive-forms validators + `updateOn`/debounce; server-state-service →
> `HttpClient`/interceptors; event-bus-node → a shared RxJS `Subject`/store; content-projection →
> `<ng-content select>` slots; derived-state → `computed()`/`OnPush` inputs; third-party-DOM-plugin
> → a directive-like wrapping a non-Angular DOM library. Root-cause classes for survivors live in
> `angular2plus.rootCauseClass` (e.g. `onpush-change-detection-miss`, `rxjs-subscription-leak`).

## 7. Divergence decisions at spec time (`DecisionRecord`, was: waivers)

When observed source behavior is plainly a bug (e.g. a validator that never fires), the
scenario-author does NOT silently encode the bug as expected behavior. Options:

(a) **Encode source behavior as-is** (default — parity first, fix later post-migration); or
(b) **Draft a `DecisionRecord`** of type `waiver` (`decision.draft`, `TOOL-CONTRACTS.md §5`)
describing the intended divergence, and write the scenario against the *intended* behavior, marked
blocked until a human approves the record (`status: pending-human` → `approved`).

`RunRequest.strategy` may set a blanket policy (`bug-for-bug` vs `fix-with-waiver`); the default is
**bug-for-bug**, because it keeps the oracle mechanical (P9, `ARCHITECTURE.md §2`). Only a human
moves a `DecisionRecord` to `approved`; agents may only draft.

---

### Provenance

Ports `plans/phases/P3-behavior-ir-and-oracle.md`. Cross-references: `ARCHITECTURE.md §2` (P1/P9),
`ORCHESTRATOR.md §3`/`§4`/`§6.4` (T1, gate authority, flake screen), `TOOL-CONTRACTS.md §2`/`§3`/`§5`
(`app.start`, `scenario.run`, `trace.diff`, `fixtures.*`, `decision.draft`), and schemas
`behavior-scenario.schema.json`, `semantic-trace.schema.json`, `counterexample.schema.json`,
`run-request.schema.json`.
