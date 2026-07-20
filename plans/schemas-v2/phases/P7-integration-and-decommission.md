# Phase 7 — Integration, Soak, Decommission, Final Cutover

> **Status: normative.** v2 successor to `plans/phases/P7-integration-and-decommission.md`,
> rewritten against `schemas-v2/`. The **source and target frameworks are parameters**
> (`RunRequest.source.framework` / `RunRequest.target.framework`), not assumptions; the worked
> example is **Angular 2+ → React** but nothing here depends on it. This phase runs per-unit
> throughout the program and ends with the program-level cutover: the **source framework runtime
> removed from the bundle**.

> **Roles:** integrator, decommissioner, drift-sentinel (role cards in `plans/03-AGENT-ROLES.md`;
> neutral role→artifact ownership in `ORCHESTRATOR.md §9`). Transitions T12–T21 in
> `ORCHESTRATOR.md §3`.

## 1. Human review lane (throughput governor)

Every `AUDITED → INTEGRATED` transition (gate **G6**) produces a **review packet** — the format is
designed around the published finding that reviewers abandon AI output they can't audit:

- **Plan-vs-actual delta:** the recipe steps as planned vs what was actually done, from the unit's
  `Patch`(es) (deviations highlighted with the converter's recorded reasons).
- **Numbered action log:** compact ledger extract for the unit (`ledger.query` by `unitId`:
  attempts, `Counterexample`s, repairs, `DecisionRecord`s).
- **Test delta:** tests/assertions added, and explicitly: any test/scenario removed or modified
  anywhere in the run (should be none without an approved `DecisionRecord` — the test-integrity
  ratchet).
- **One-command local repro:** `mx run <unitId>` → boots both twins + opens the parity report.
- **Parity evidence:** scenario list with links to `trace-diff` reports; screenshots only where
  the motif required visual checks.

Review batching: group by motif/failure cluster, not by time. Pattern-conforming diffs from
recipes with strong stats (first-pass parity > 85%, ≥10 applications) qualify for **expedited
review** (spot-check 1 in N per `RunRequest` policy); anomalies always get full review.

## 2. Flag flip & soak

1. Flip default-on in the target shell config (the flag stays overridable for rollback).
2. Full-app smoke + all scenarios touching the unit's routes (gate **G6**:
   `flag-flipped`, `full-app-smoke`, `ratchets-updated`).
3. Soak per `RunRequest.strategy.soakPolicy` (defaults: low = none; medium = 3 days; high =
   7 days; critical = 14 days + shadow comparison if `plans/EXTENSIONS-OOB.md §3` is enabled).
   `INTEGRATED → SOAKING` is T13; a low-risk unit may skip soak straight to `ACCEPTED` (T15).
4. Soak abort criteria (any → flag off + `SOAKING → DIVERGENT`, T20): new console-error signature
   on the unit's routes; error-budget burn (frontend error rate on those routes above baseline +
   threshold); user-reported defect traced to the unit; shadow-traffic `Counterexample`. A clean
   soak window (elapsed, error budget intact, no shadow counterexamples) passes gate **G7** →
   `ACCEPTED` (T14).
5. Rollback is ALWAYS flag-off, never revert-commit, until tombstone. That is why source code must
   remain untouched and bootable throughout (design principle P6, source is read-only).

## 3. Decommission (per unit)

Evidence required for **G8** (both, independently — `static-usage-zero` AND `runtime-usage-zero`):
- **Static zero:** re-run the P1 inventory scanner scoped to the source artifact — no inbound
  edges except from other tombstoned/dead nodes.
- **Runtime zero:** shim usage counters for the artifact = 0 across the soak window AND the nightly
  full parity runs (the source twin still runs nightly — its counters prove which source code is
  still exercised by remaining routes).

Then: delete source files, remove the unit's flag, and remove its conditional fork in the source
templates (this is the ONE permitted source edit class — template-fork removal — executed by the
decommissioner with a scoped diff + smoke run), remove seam/bridge registrations if the unit was
the last consumer. One unit per PR. The `tombstone` ledger event includes revert instructions.

> **Adapter notes (Angular 2+).** The "conditional template fork" removed here is the source
> framework's structural conditional guarding the coexistence branch (e.g. an `*ngIf`/`@if`
> wrapping the legacy element vs the bridged target element). Which construct it is comes from the
> unit's `sourceAdapter`; the permission (exactly one narrow class of source edit, at tombstone
> time only) is framework-neutral.

## 4. Event façade retirement

Per event name: when publishers = 0 and subscribers = 0 on the source side (façade counters),
delete the bridge entry; when the whole source side is gone, delete the façade↔source-event-bus
bridge, keeping the typed target event layer only where routes still need cross-cutting events —
then schedule its replacement by props/context (post-migration cleanup list, out of scope).

## 5. The shell flip (route-majority point)

Treated as its own critical-tier `infra` unit (planned in P4 §3). Scenarios must cover: every
remaining source route loads under the target shell; history back/forward across the framework
boundary; deep links (legacy URL forms redirect to new paths); auth/session continuity;
title/analytics events. Soak 14 days. This is the single riskiest day of the program — the
`RunRequest` should schedule it in a low-traffic window with the flag-off rollback rehearsed. The
seam direction and mechanism come from `RunRequest.strategy.shellDirection`; specifics of the
element/route bridge are a target adapter concern.

## 6. Final cutover checklist (program end)

- [ ] All units `TOMBSTONED` / `QUARANTINED` (quarantines have documented owners + plans via
      `DecisionRecord` type `quarantine`).
- [ ] `bridgeCount` ratchet = number of quarantined islands only (`RunResult.ratchets`).
- [ ] Source framework runtime + its modules (and any third-party DOM plugins unused by
      quarantines) out of the bundle; `legacyFileCount` ratchet at floor; bundle-size delta
      recorded.
- [ ] Shim retired; nightly source-twin runs stop; source checkout archived (not deleted — trace
      baselines reference it).
- [ ] All migration feature flags removed; the flag machinery deleted.
- [ ] `DecisionRecord`s reviewed: each `waiver` either becomes a documented product decision or a
      backlog item.
- [ ] Parity suite rebranded as the app's regression suite (`BehaviorScenario`s outlive the
      migration — they are the lasting asset).
- [ ] `migration/` archived; lessons + recipe stats exported to the org's next migration.

## 7. Drift-sentinel operations (continuous, if source development continues)

On every source commit: map changed files → `InventoryGraph` nodes → units/scenarios (T21).
- Unit `DISCOVERED..READY`: update inventory + risk, note in ledger (`drift-invalidation` / `note`).
- Unit in flight (`CONVERTING..PASSING`): invalidate (T21 → re-spec back below `SPECIFIED`); the
  scenario-author re-records baselines; conversion resumes with a drift note in the context pack.
- Unit `INTEGRATED+`: the source change must be REPLICATED in the target (it is now the live
  implementation) — the sentinel opens a `feature-drift` task with the source diff attached, and
  the scenario is updated first (oracle-first applies to drift too).
- Ratchet baselines adjust only through sentinel events (`ratchet-adjusted`), never silently.
