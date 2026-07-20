# Risks, Failure Modes, and Calibrated Expectations

## 1. Calibrated expectations (from published systems, 2024–2026)

Set these numbers as planning baselines, not aspirations:

| Evidence | Number | Implication for this harness |
|---|---|---|
| Google int32→int64 (FSE'25) | ~74% of changes LLM-generated; ~50% time savings; humans reverted some model edits "in most cases" | Even rule-like migrations keep a large human lane; design review flow, not just generation |
| Google JUnit3→4 | ~87% of AI code landed unmodified; generation deliberately throttled to review bandwidth | The WIP cap in P6 §0 is not optional |
| Airbnb Enzyme→RTL (2025) | 75% automated in 4h; 97% after 4 days of sample-tune-sweep; last 3% human | The long tail is won by tuning recipes on failure clusters, not by more retries |
| Slack Enzyme→RTL (2024) | AST alone 45%; LLM alone 40–60%; hybrid ~80% on selected files; ~22% of cases fully hands-off | Codemod+LLM hybrid beats either; keep denominators honest in the dashboard |
| HeroDevs AngularJS AI migration (Dec 2025) | 50–75% per-file success; ~100% "migrated with some issues"; cheap models ~9× cheaper and "surprisingly capable" under a strong pipeline | Weak agents + strong harness is a validated economic strategy for exactly this migration |
| Repo-level benchmarks (MigrationBench, FreshBrew) | 50–72% pass@1 with frontier models | Plan the escalated/human lane at 25–50% of units by count early, shrinking as recipes mature |
| Google x86→Arm CogniPort | Autonomous agents fix failed builds/tests ~30% of the time WITHOUT a playbook | The playbook/recipe layer is the difference between 30% and Airbnb's 97% |

## 2. Harness failure modes and their defenses

| # | Failure mode | Signal | Defense (built into plan) |
|---|---|---|---|
| F1 | **Reward hacking the oracle** — agent weakens tests/scenarios to pass | test/assertion count drops; scenario diffs | Test-integrity gate + ratchet (P6 §1.8); scenarios writable only by scenario-author; verifier re-runs from clean state |
| F2 | **Cyclical repair loops** (ZoomInfo's "cyclical AST transformations") | same fingerprint reopening; error count non-decreasing | Fingerprint escalation rule (01 §3.3); rollback-to-green (P6 §0); attempt caps |
| F3 | **Plausible-but-wrong conversion passing thin scenarios** | high first-pass parity on a unit whose motif historically diverges | Oracle calibration (P3 §6) — the defense is proving scenario strength BEFORE trusting green |
| F4 | **Watcher-emulation slop** — `useEffect` chains reproducing digest semantics | critic checklist item 3; commit-pressure budget | Mapping-table hard rules (P5 §2); critic (P6 §5); perf budgets (OOB §6) |
| F5 | **Context overload of weak agents** | pack-overflow events; incoherent output on big units | Context packs w/ hard budget + task splitting (01 §6); unit size guardrail (P1 §5.8) |
| F6 | **Oracle rot** — legacy changes under the migration | scenarios green on stale baselines | Drift sentinel (P7 §7); fixture profiles versioned; re-spec transitions (T21) |
| F7 | **Flaky parity suite destroying trust** | flake-suspect rate climbing | Determinism rules (P3 §2.3–2.4); 3-run screens; flake routed to scenario-author, never waived by verifier |
| F8 | **Seam decay** — bridges accumulate and never retire | bridge-count ratchet flat/growing | Evidence-gated tombstones (P7 §3); façade counters; quarantine requires named owner |
| F9 | **Shim contaminating the oracle** | inertness gate diff | P2 §4 gate; shim changes re-run the inertness proof |
| F10 | **Agent state divergence** — two agents claim/write same unit | rev conflicts, lease collisions | Optimistic concurrency + leases (01 §1); role-scoped write paths (02 §0) |
| F11 | **Silent scope creep** — "improvements" during conversion | scenario divergences classified waiver-recommended climbing | Waiver discipline (01 P9); bug-for-bug default (P3 §7) |
| F12 | **Review-lane collapse** — humans rubber-stamp or abandon | review time per unit trending to zero or to abandonment | Review packets designed for auditability (P7 §1); expedited lane only via recipe stats; CHI'24 finding: reviewers abandon what they can't audit |
| F13 | **Environment rot** — target/legacy stop booting cleanly over months | app.start failures unrelated to units | CI boots both apps nightly from clean; `serving.howToServe` is executable documentation; the seam-proof unit re-runs weekly |
| F14 | **Model-update drift** — a model upgrade changes recipe success rates | recipe stats shift without recipe changes | Stats are per (recipe × model tier); fleet floor check re-runs on model changes (P6 §0) |
| F15 | **Trace volume blowup** | storage/pack-size pressure | Normalized layer is small; raw retained only for open CEs + baselines; hash payloads not bodies |

## 3. AngularJS-specific technical traps (for the analyst's and recipe-miner's benefit)

- **Digest-synchronized expectations:** legacy code that "works" because a `$broadcast` lands
  before a digest completes; React's microtask timing breaks the implicit ordering. Detection:
  ordering divergences at settle points. Never fix with setTimeout — restructure ownership.
- **`track by` identity:** dropped identity → remounts → focus loss, animation restarts,
  IME breakage. Scenarios should include a focus assertion on any editable repeated list.
- **`$scope` inheritance shadowing:** legacy templates reading a parent-scope property that a
  child accidentally shadows — behavior the team thinks exists may differ from what runs.
  Trust traces over source.
- **Filters as hidden business logic:** `currency`/`date`/custom filters encode locale and
  rounding rules; convert once, golden-test against legacy outputs across a value corpus.
- **`$http` response transforms + interceptor ordering:** global transforms silently reshape
  every payload; the typed client must reproduce them or the fixtures will "pass" while the
  real API breaks — capture HARs at the network layer, not post-transform.
- **jqLite vs jQuery:** if jQuery loads after angular.js, the app runs jqLite even though
  jQuery is on the page — plugin behavior differs. The P0 probe result matters; don't assume.
- **Multi-slot transclusion focus order:** DOM order vs visual order vs tab order can all
  differ; ARIA snapshot + focus-order assertions are the only reliable oracle.
- **`ng-model-options` debounce/updateOn:** the most common source of "form feels different"
  reports that pass naive tests; scenario timing assertions must cover it (mutant class exists
  for this reason).
- **Third-party AngularJS UI libs (ui-bootstrap, ngMaterial, ui-grid):** each vendored widget
  is a mini-migration; decide rebuild-vs-React-library per widget in P4/P5, never inline
  during a route conversion.

## 4. Program-level risks

- **The flip point (P7 §5) is the riskiest single event.** Rehearse rollback; schedule
  deliberately; treat as critical-tier with 14-day soak.
- **Waiver accumulation as silent product change:** review the waiver ledger monthly with a
  product owner; waivers are product decisions wearing engineering clothes.
- **Recipe overfitting to the exemplar:** a recipe verified on one exemplar can still fail its
  cluster (stats catch it at 5 applications — accept that cost; do not batch 50 units of an
  unproven recipe).
- **Long-tail denial:** the last 3–5% of units will cost as much as the first 50%. Budget it;
  the QUARANTINED state exists so business can decide some islands aren't worth it.
- **Team knowledge transfer:** if humans only review packets, nobody learns the new codebase.
  Rotate engineers through escalation duty — escalations are the best teaching units
  (consultancy case studies flag knowledge transfer as a first-class migration requirement).
