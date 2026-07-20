# Phase 6 — The Conversion Loop (per unit)

> **Roles:** converter, verifier, counterexample-analyst, repairer, critic. This is the
> steady-state factory: many units in flight, each walking the state machine
> (`01-STATE-AND-ARTIFACTS.md §3`). This doc specifies each station's procedure. Weaker agents
> live here — precision in these procedures is what makes that safe.

## 0. Scheduling (orchestrator)

- Claim order: charter's `unitOrdering`, filtered to `READY`, WIP-limited.
- **WIP cap is set by human review bandwidth, not compute.** Every published large-scale
  migration (Google JUnit4, Amazon Q) found reviewer throughput was the bottleneck; generate
  only what the review lane can absorb per week.
- Batch affinity: prefer giving one converter consecutive units of the SAME motif (prompt
  cache + recipe familiarity), but never two units with a dep between them concurrently.
- Model tier from charter routing; on `high` tier with cross-check enabled, spawn two
  independent conversions (EXTENSIONS-OOB §7).
- **Two kinds of retry, two budgets** (evidence: Airbnb's Enzyme→RTL run, where brute-force
  error-fed retries drove 75%→97% automation):
  - **In-gate mechanical retries** (making `tsc`/lint/unit tests pass inside `CONVERTING`):
    cheap, error-fed loops — re-prompt with the verbatim validator errors + the current file.
    Budget ~10 iterations per gate attempt. Keep an **error-memory file** per unit
    (`migration/units/<id>.errors.ndjson`: every error seen + what was tried) and include its
    tail in retry prompts so the agent doesn't repeat failed fixes. Batch ALL current errors
    into each retry, not one at a time.
  - **Semantic repair loops** (parity counterexamples): expensive, capped by
    `attempts.repair`, always routed through the analyst.
  - Infra failures (timeouts, crashes) REPLAY the cached step; only validation failures
    trigger regeneration. Never burn an attempt on an infra failure.
- **Rollback checkpoints:** the orchestrator snapshots (git commit on a work branch) at every
  green gate; when an in-gate retry sequence is diverging (error count non-decreasing 3
  iterations), roll back to the last green checkpoint instead of digging.
- **Re-discovery reconciliation:** nightly, re-run the P1 scanner and diff against the unit
  list — units are "done" when the scanner stops finding their legacy constructs, not when a
  list says so. Discrepancies open ledger events.
- **Fleet floor check:** before the sweep begins, dry-run the 5 primed recipes with the
  WEAKEST model tier in the routing table on already-solved exemplars; a recipe the weak tier
  cannot re-execute on a solved unit must be revised (or its cluster re-routed) before
  unsolved units are attempted.

## 1. Converter procedure (state `CONVERTING` → gates G2, G3)

1. **Read the pack.** Verify recipe preconditions against the unit's legacy source. Any
   precondition false → `escalate` (do NOT improvise a different approach).
2. **Classify state** (for controller/component units): list every `$scope`/`this` member →
   {prop, local state, derived, server state, event}. Write this table into the unit `notes`
   BEFORE writing code (it is the review anchor and the cheapest place to catch design errors).
3. **Run the codemod** if the recipe ships one; fill TODOs following recipe steps in order,
   performing each step's "verify by" micro-check.
4. **Write tests + story:** RTL tests for the classified logic (selectors, reducers, validators
   get direct unit tests); one story per realized template shape (P2 §6) with MSW profile.
5. **Self-check (pre-flight):** `tsc`, lint, unit tests, story smoke locally via `shell.run`;
   run the unit's scenarios against the hybrid app (`scenario.run`, allowed pre-flight) —
   fix obvious failures now while context is warm.
6. **Submit G2** (`unit.submitGate`, evidence: build/test reports). Then wire the seam:
   island registration or route swap per recipe r-010, flag added, legacy fallback intact.
   **Submit G3** (evidence: flag-off baseline unchanged + flag-on mount proof).
7. Budget rule: if you are on your final attempt (`attempts.convert == max-1`), prefer a
   PARTIAL, honest escalation (what works, what doesn't, why) over a hail-mary submission.
   Best partial output is preserved and becomes the starting point for the stronger tier or
   the human — never discard work on escalation.
8. **Test integrity is a hard rule:** you may not delete, skip (`.skip`/`xit`), or weaken any
   existing test or scenario to get green. The orchestrator diffs test counts and assertion
   counts at every gate (reward-hacking screen); a drop without a waiver auto-fails the gate.

## 2. Verifier procedure (`WIRED → VERIFYING → PASSING | DIVERGENT`) — deterministic

For each linked scenario: boot clean `legacy` (instrumented) and `hybrid` (flag on) with the
scenario's fixture profile → run 3× per side → normalize traces → `trace.diff` with the
unit's policy + active waivers. All green ⇒ submit G4. Any reproducible divergence (≥2/3) ⇒
open counterexample(s) with trace excerpts, set `DIVERGENT`. Flaky (1/3) ⇒ `flake-suspect` →
scenario-author queue, unit stays `VERIFYING` pending scenario fix. Also record perf deltas
(scenario wall time, JS heap after settle) — informational unless charter sets budgets
(see EXTENSIONS-OOB §6).

## 3. Counterexample-analyst procedure (`DIVERGENT` → repair directive)

1. `trace.bisect` to the minimal divergent step; pull both traces' RAW layers around it —
   the `ngjs.*` channels (watch-fires, digest boundaries, scope events, compile calls) usually
   name the mechanism (e.g., legacy emitted `filters:changed` DURING digest before the XHR;
   target dispatches after response).
2. Classify `suspectedConstruct` from the divergence taxonomy (schema). Consult recipe
   `pitfalls` and lessons — cite matches in the directive.
3. Write the repair directive: target artifact, fix direction, **expected observable change in
   the trace**. If the divergence reveals the SCENARIO is wrong (over-specified timing,
   non-semantic assertion) → route to scenario-author instead (never "fix" the app to satisfy
   a bad test). If legacy behavior is a bug → draft waiver (human decides).
4. If the same fingerprint has already reopened once: skip directive, recommend escalation
   with your analysis attached (the anti-loop rule will enforce it anyway).

## 4. Repairer procedure (`REPAIRING` → G2 → … → G4 re-run)

Fix exactly what the directive targets; re-run pre-flight for the affected scenario only;
resubmit G2 (fast path: orchestrator re-runs affected checks). Forbidden: weakening tests,
touching the scenario, `setTimeout`-style timing hacks (timing divergences are design signals
— reread the directive), edits outside the target artifact ± its imports without a directive
amendment from the analyst.

## 5. Critic procedure (`PASSING` → G5)

Checklist (each item → approve or file finding with file:line):
- Conventions conformance (CONVENTIONS.md) and recipe conformance (or justified, noted deviation)
- No watcher emulation: grep-level heuristics — `useEffect` with a state-setter whose deps
  mirror another state (the `$watch` smell); `useRef` used as mutable `$scope` bag; effect
  chains >2 deep
- Dead code, commented-out legacy, unused exports, `any`, non-null assertions without cause
- A11y floor: interactive elements have roles/names; forms have labels; focus management on
  modals (scenarios may not cover all of it)
- Test honesty: assertions actually assert (no snapshot-only tests for logic); selectors user-facing
- Island hygiene (if seam A): events via `detail`, no function props across the boundary, light DOM
Verdict `approve` → G5. `request-changes` → one bounded fix round by the same converter, one
re-review; further → escalate. Critic findings tagged `recipe-gap` go to the librarian.

## 6. Post-acceptance knowledge loop (librarian, after every G4/G5/escalation)

- CE closed-fixed with a generalizable cause → lesson (≤10 lines, tagged by motif +
  suspectedConstruct) or recipe `pitfalls` amendment (prefer the recipe — it's always in-pack).
- Update `recipes/stats.json`; pull recipes below the success threshold.
- Escalation resolutions (human/strong-model) are the richest source — mine every one.

## 7. Worked example (compressed walkthrough)

`unit:cmp:invoiceTable` (motifs: ngrepeat-table, watch-derived-state; tier high; recipe r-005):
converter classifies state (`rows`→server state via `useInvoices`; `filters`→local;
`filteredRows`→derived selector; `sortState`→local; `$broadcast('filters:changed')`→façade
event); codemod emits typed props + skeleton; selectors extracted + unit-tested; story per
template shape (2 found in P2); pre-flight catches missing `track by`→`key` mapping (recipe
pitfall #1); G2/G3 pass. Verifier: scenario `invoice-list.filter-by-status` diverges —
`domain.event invoiceFilterChanged` fires AFTER `net.request` on target, before on legacy
(strict policy unit). Analyst bisects: legacy watcher fired the event synchronously in digest;
directive: move façade publish from query `onSuccess` to the filter-change handler; expected
observable: event precedes request in trace. Repairer applies (1 file), G4 green. Critic files
one finding (unused import), fixed in-round. G5 → integrator flips flag → nightly suite green
→ ACCEPTED after 1-week soak; librarian records lesson "façade events fire at interaction
time, not at server-state settlement" tagged `watch-derived-state`.
