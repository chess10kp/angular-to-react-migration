# Phase 7 — Integration, Soak, Decommission, Final Cutover

> **Roles:** integrator, decommissioner, drift-sentinel. This phase runs per-unit throughout
> the program and ends with the program-level cutover: AngularJS removed from the bundle.

## 1. Human review lane (throughput governor)

Every `AUDITED → INTEGRATED` transition produces a **review packet** — the format is designed
around the published finding that reviewers abandon AI output they can't audit:

- **Plan-vs-actual delta:** the recipe steps as planned vs what was actually done (deviations
  highlighted with the converter's recorded reasons).
- **Numbered action log:** compact ledger extract for the unit (attempts, counterexamples,
  repairs, waivers).
- **Test delta:** tests/assertions added, and explicitly: any test/scenario removed or
  modified anywhere in the run (should be none without waiver).
- **One-command local repro:** `mx run <unitId>` → boots both twins + opens the parity report.
- **Parity evidence:** scenario list with links to trace-diff reports; screenshots only where
  the motif required visual checks.

Review batching: group by motif/failure cluster, not by time. Pattern-conforming diffs from
recipes with strong stats (first-pass parity > 85%, ≥10 applications) qualify for
**expedited review** (spot-check 1 in N per charter policy); anomalies always get full review.

## 2. Flag flip & soak

1. Flip default-on in target shell config (flag stays overridable for rollback).
2. Full-app smoke + all scenarios touching the unit's routes.
3. Soak per charter policy (defaults: low = none; medium = 3 days; high = 7 days;
   critical = 14 days + shadow comparison if EXTENSIONS-OOB §3 is enabled).
4. Soak abort criteria (any → flag off + `SOAKING → DIVERGENT`): new console error signature
   on the unit's routes; error-budget burn (frontend error rate on those routes above
   baseline + threshold); user-reported defect traced to the unit; shadow-traffic
   counterexample.
5. Rollback is ALWAYS flag-off, never revert-commit, until tombstone. That is why legacy code
   must remain untouched and bootable throughout.

## 3. Decommission (per unit)

Evidence required for G8 (both, independently):
- **Static zero:** re-run the P1 scanner scoped to the legacy artifact — no inbound edges
  except from other tombstoned/dead nodes.
- **Runtime zero:** shim usage counters for the artifact = 0 across the soak window AND the
  nightly full parity runs (the legacy twin still runs nightly — its counters prove which
  legacy code is still exercised by remaining routes).

Then: delete legacy files, remove the unit's flag, remove its `ng-if` fork in legacy
templates (this is the ONE permitted legacy edit class — template fork removal — executed by
the decommissioner with a scoped diff + smoke run), remove bridge registrations if the unit
was the last consumer. One unit per PR. Tombstone ledger event includes revert instructions.

## 4. Event façade retirement

Per event name: when publishers = 0 and subscribers = 0 on the legacy side (façade counters),
delete the bridge entry; when the whole legacy side is gone, delete the façade↔$rootScope
bridge, keep the typed React event layer only where routes still need cross-cutting events —
then schedule its replacement by props/context (post-migration cleanup list, out of scope).

## 5. The shell flip (route-majority point)

Treated as its own critical-tier `infra` unit (planned in P4 §3). Scenarios must cover: every
remaining legacy route loads under the React shell; history back/forward across the
framework boundary; deep links (old hashbang URLs 301 to new paths); auth/session continuity;
title/analytics events. Soak 14 days. This is the single riskiest day of the program — the
charter should schedule it in a low-traffic window with the flag-off rollback rehearsed.

## 6. Final cutover checklist (program end)

- [ ] All units `TOMBSTONED` / `QUARANTINED` (quarantines have documented owners + plans)
- [ ] `bridge-count` ratchet = number of quarantined islands only
- [ ] angular.js, angular-* modules, jQuery (if unused by quarantines) out of the bundle;
      bundle-size delta recorded
- [ ] Shim retired; nightly legacy twin runs stop; legacy checkout archived (not deleted —
      trace baselines reference it)
- [ ] All `mx_*` flags removed; `window.mxFlags` machinery deleted
- [ ] Waivers reviewed: each either becomes a documented product decision or a backlog item
- [ ] Parity suite rebranded as the app's regression suite (scenarios outlive the migration —
      they are the lasting asset)
- [ ] `migration/` archived; lessons + recipe stats exported to the org's next migration

## 7. Drift-sentinel operations (continuous, if legacy development continues)

On every legacy commit: map changed files → inventory nodes → units/scenarios.
- Unit `DISCOVERED..READY`: update inventory + risk, note in ledger.
- Unit in flight (`CONVERTING..PASSING`): invalidate (T21 → re-spec); the scenario-author
  re-records baselines; conversion resumes with a drift note in the pack.
- Unit `INTEGRATED+`: the legacy change must be REPLICATED in React (it's now the live
  implementation) — sentinel opens a `feature-drift` task with the legacy diff attached, and
  the scenario is updated first (oracle-first applies to drift too).
- Ratchet baselines adjust only through sentinel events (never silently).
