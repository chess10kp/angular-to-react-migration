# Phase 3 — Behavior IR & the Oracle

> **Roles:** scenario-author, oracle-calibrator. **Input:** inventory, traces, fixture
> profiles. **Output:** Behavior IR scenarios + Playwright specs, all **green against legacy**
> (gate G1); calibration reports for high/critical units; trace-diff policies configured.
> **Exit condition (program-level):** every unit scheduled for conversion in the next window is
> `SPECIFIED`. P3 runs continuously, staying ahead of P6.

## 1. Scenario counts (defaults; charter overrides)

| Risk tier | Min scenarios | Must cover | Calibration |
|---|---|---|---|
| low | 1 | happy path | no |
| medium | 2 | happy path + 1 alternate (empty/error state) | no (yes if no legacy tests exist) |
| high | 3–5 | happy, error, edge (per motif `verificationEmphasis`) | yes, kill ≥ 0.7 |
| critical | 5+ | above + concurrency/timing flows | yes, kill ≥ 0.85 + human review of scenarios |

## 2. Authoring rules (scenario-author MUST follow)

1. **Behavior IR first, then the Playwright spec.** The spec is a mechanical rendering of the
   IR — a generator should be able to produce 90% of it (write that generator in P4; specs may
   extend it, never contradict it).
2. **Locate by role+name** (`getByRole`) wherever the legacy DOM allows; CSS selectors are a
   fallback recorded with a `selector-debt` note (the React side must then keep a compatible
   hook — prefer adding `data-test` on the REACT side to match assertions, never on legacy).
3. **Assert at settle points.** Steps end with `waitForSettle` = network idle AND no pending
   `$timeout`/`$interval` (shim signal `window.__mxSettled()`) on legacy; network idle AND no
   pending React updates (double-`requestAnimationFrame` + queueMicrotask drain) on target.
   **No `waitForTimeout`, ever.** Polling UIs: freeze via fixture profile (bounded intervals)
   or assert on quiescent windows.
4. **Determinism:** every scenario names a `fixtureProfile` (MSW); time-sensitive flows set
   `preconditions.clock` (implement with Playwright's `page.clock`); randomness gets `seed`
   (Math.random shim in the harness bootstrap for BOTH twins).
5. **Assertion floor per scenario:** ≥1 ARIA outcome (`toMatchAriaSnapshot` — stable since
   Playwright 1.49 — or role/name assertions), network semantics if the flow hits the network,
   final URL if navigation occurs, `consoleErrors: 0`.
6. **ARIA snapshots over DOM snapshots.** Full-DOM golden files will fail for irrelevant
   reasons on React (class names, comment nodes, wrapper divs). ARIA snapshots assert what
   users perceive and survive DOM-shape changes — they are the primary structural assertion.
7. Scenario IDs: `<route-or-feature>.<behavior>` kebab-case, e.g. `invoice-list.filter-by-status`.

## 3. Fixture profiles

Built once per API area, shared by ALL layers (Playwright e2e, Storybook, Vitest):
1. `fixtures.captureHar` against the served legacy app (staging/live per charter) while
   running the recorded flows.
2. `fixtures.deriveProfile`: HAR → MSW 2.x handlers (`http.get(...)` etc.) + an endpoint
   inventory (method, path pattern, params, response shape) — this endpoint inventory later
   seeds the typed API client (P4 §6). Auth: profile-level login stub or storage-state deltas.
3. Profiles are versioned files; scenarios pin a profile id. Changing a profile re-runs G1 for
   every scenario pinned to it (orchestrator enforces).

## 4. Gate G1 mechanics

For each scenario: orchestrator boots `app.start("legacy", {instrumented: true, fixtureProfile})`,
runs the spec 3× (flake screen). PASS = 3/3 green. 2/3 → `flake-suspect` ledger event + back
to scenario-author (fix determinism, don't loosen assertions). Store the passing run's
normalized trace as the scenario's **baseline trace** (`legacyTraceRefs`).

## 5. Trace-diff policies (used by `trace.diff` from P6 on; defined and frozen here)

A policy is a named JSON config. Ship three:

**`strict`** (critical tier): align normalized events by `semanticKey` per `stepIndex`.
Require equal multisets AND equal order of: `domain.event`, `url.change`, `net.request`
(when `orderMatters`), ARIA milestones at settle points, focus.change sequence. Payload
comparison: deep-equal after normalizer scrubbing (ids, timestamps, hashes compared by
equivalence table).

**`standard`** (default): as strict, except — network requests within one step compare as a
multiset (order free unless `orderMatters`); `dom.mutation-burst` ignored; focus order checked
only at step boundaries; numeric payloads within configured epsilon.

**`relaxed`** (explicitly opt-in per unit + waiver): additionally ignores extra target-side
`net.request` marked `prefetch`, and permits ARIA milestone supersets (React may render MORE
accessible structure). Never permits missing events.

Divergence output = `DivergenceRecord` (feeds `counterexample.schema.json`). Every ignored
class must be listed in the policy file — the diff engine has no built-in leniency.

**Normalizer rules (applied to both sides before diff):** drop `ngjs.*`/`react.*` internals
(kept for the analyst, excluded from parity), collapse duplicate consecutive ARIA milestones,
scrub volatile ids (uuid/date regexes → placeholders), map legacy/target host differences
(port, base path) to canonical form, assign `semanticKey`s.

`ngjs.*` events are **diagnostic channels**, not parity requirements — React must never be
asked to reproduce digests or watch-fires. They matter again in the analyst's workflow
(counterexample enrichment) and in Watcher Differential Fingerprinting (EXTENSIONS-OOB §4).

## 6. Oracle calibration (fault injection on legacy — high/critical units)

Purpose: prove the scenarios would catch a wrong conversion. Mechanics — **serve-time mutation**,
never source edits: the Playwright injection layer (P2 §3) applies a per-run text/AST patch to
the unit's legacy JS/template response.

Mutant catalog per motif (minimum set; extend):

| Motif | Mutants |
|---|---|
| ngrepeat-table | drop `track by`; swap sort direction; off-by-one slice/limitTo; remove one filter from pipe chain |
| form-* | remove a validator; swap validator boundary (`>=`→`>`); drop `ng-model-options` debounce; skip error-message binding |
| service-resthttp | swap HTTP method; drop a query param; return stale cache; reorder two calls |
| rootscope-bus-node | rename event on publish; drop one listener; emit-vs-broadcast swap |
| dir-transclude-* | drop one transcluded slot; reorder slots |
| watch-derived-state | disconnect one watcher (register no-op); make deep watch shallow |
| dir-jquery-plugin | skip plugin re-init on data change; skip destroy on scope $destroy |

Procedure: for each mutant → run the unit's scenarios → record killed/survived. Kill rate <
threshold → author strengthens scenarios targeting each survivor (or records an
`acceptedGaps[]` entry with justification; human sign-off for critical tier). Store the
calibration report in the scenario `status.calibration`.

## 7. Waivers at spec time

When legacy behavior is plainly a bug (e.g., a validator that never fires), scenario-author
does NOT encode the bug as expected behavior silently. Options: (a) encode legacy behavior
as-is (default — parity first, fix later post-migration), or (b) draft a waiver
(`waiver.draft`) describing intended divergence and write the scenario against the *intended*
behavior, marked blocked until the waiver is approved. Charter may set a blanket policy
(`bug-for-bug` vs `fix-with-waiver`); default is bug-for-bug because it keeps the oracle
mechanical.
