# Orchestrator Design (v2, framework-neutral)

> **Status: normative.** This document is the v2 successor to `plans/01-STATE-AND-ARTIFACTS.md`
> (state machine, ledger, context packs) and the operational half of `plans/03-AGENT-ROLES.md`
> (leases, retries, gate authority). It is rewritten against `schemas-v2/` so that the **source
> and target frameworks are parameters, not assumptions** (`RunRequest.source.framework` /
> `RunRequest.target.framework`). AngularJS→React is used only as a worked example; nothing in
> the orchestrator logic depends on it. Where a rule needs framework specifics, it reads them
> from a `sourceAdapter`/`targetAdapter` slot (`adapter-ref.schema.json`) — never from an
> inlined field.
>
> The orchestrator is **deterministic code**, not an agent. It schedules work, assembles context
> packs, validates gates by re-running mechanical checks, meters budgets, and reaps leases.
> Agents read and write state only through the tool surface in `plans/02-TOOL-CONTRACTS.md`.

---

## 1. Ground rules for all state

1. **Files are the database.** Everything under `migration/` is plain JSON / NDJSON / Markdown,
   each document valid against a `schemas-v2/` schema. No hidden orchestrator memory: if it
   isn't in a file, it didn't happen.
2. **The ledger is append-only.** `migration/ledger.ndjson` records every transition, claim,
   release, escalation, decision, and tombstone as a `RunResult#/$defs/ledgerEvent`. Unit
   records are a *materialized view*; on conflict the ledger wins and units are rebuilt from it.
3. **Optimistic concurrency.** Every mutable record carries an integer `rev` (`Unit.rev`).
   Writers supply the `rev` they read; the orchestrator rejects stale writes (`unit.update` →
   `CONFLICT`). Agents never write these files directly.
4. **Leases, not locks.** Claiming a unit grants a lease (`Unit.assignee.leaseId` +
   `leaseExpiresAt`) with a TTL (default 30 min, `RunRequest.budgets`-configurable). Expired
   leases are reclaimable; an agent holding an expired lease must treat its work as abandoned
   unless it re-acquires at the same `rev`.
5. **Evidence is content-addressed.** Every artifact reference is an
   `common.schema.json#/$defs/evidenceRef` — workspace-relative `path` + `sha256`. Gate
   submissions bundle these into an `EvidenceBundle`; the orchestrator verifies hashes and
   **re-runs the mechanical checks itself** at gate time (§4). An agent's prose is never evidence.
6. **Framework facts live in adapters.** Any decision that would otherwise hardcode "AngularJS"
   or "React" reads a neutral field first and falls back to `sourceAdapter`/`targetAdapter` only
   for classification/metadata. Core transitions never branch on framework identity.

## 2. The migration unit

A **unit** (`unit.schema.json`) is the atomic tracked thing. Neutral `kind` vocabulary:
`route`, `component`, `service`, `presentation`, `directive-like`, `pipe-like`, `module`,
`store`, `primitive` (design-system building block), `infra` (seam, shim, event façade).
The exact source construct (e.g. Angular2+ `component` vs `pipe` vs `injectable`, or a React
`hook`) lives in `Unit.sourceAdapter`, not in `kind`.

Unit IDs match `common.schema.json#/$defs/unitId` — `unit:<kind>:<canonical-name>`, where the
canonical name is framework-agnostic:

```
unit:route:/invoices
unit:component:invoiceTable
unit:directive-like:datePicker
unit:service:InvoiceService
unit:pipe-like:currencyShort
```

The record carries: `state` + `stateSince`, `deps`/`dependents`, `risk` (`score`, `tier`,
neutral `factors[]`), `motifs`, `recipes`, `scenarios`, `seam` (`route-shell` / `element-bridge`
/ `none-internal` + `flag`), `attempts` (`convert`, `repair`), `budget`
(`maxConvertAttempts`, `maxRepairAttempts`, `tokenCap`, `tokensSpent`, `wallClockCapMinutes`),
`modelTier` (`cheap`/`standard`/`strong`/`human`), `artifacts` (source/target/stories/tests
paths), `assignee` (lease), `waivers` → now **`DecisionRecord` ids**, `openCounterexamples`, and
`notes`. `sourceAdapter` optionally classifies the legacy artifact; core logic never depends on it.

## 3. The unit state machine

### 3.1 States (`Unit.state` enum — 18 states)

| State | Meaning | Set by |
|---|---|---|
| `DISCOVERED` | Created from the `InventoryGraph`; not yet specified | inventory-cartographer |
| `SPECIFIED` | ≥1 `BehaviorScenario`; **all its scenarios pass against the SOURCE app**; oracle calibrated if risk tier requires | orchestrator (gate **G1**) |
| `READY` | Specified AND all `deps` are `INTEGRATED`/`ACCEPTED` or reachable through a live bridge (computed from `MigrationPlan` + unit graph) | orchestrator (computed) |
| `CONVERTING` | Leased to a converter | orchestrator on claim |
| `BUILT` | Target compiles; types, lint, unit tests, story/render smoke all pass | orchestrator (gate **G2**) |
| `WIRED` | Mounted behind its seam + flag; both twins bootable | orchestrator (gate **G3**) |
| `VERIFYING` | Parity suite executing | orchestrator |
| `DIVERGENT` | ≥1 open `Counterexample` | verifier (G4-fail) |
| `REPAIRING` | Leased to a repairer with a repair directive | orchestrator on claim |
| `PASSING` | Parity suite green under current diff policy + active decisions | orchestrator (gate **G4**) |
| `AUDITED` | Critic approved (no slop, conventions, recipe conformance) | orchestrator (gate **G5**) |
| `INTEGRATED` | Flag default-on in the target shell; source path still present | integrator (gate **G6**) |
| `SOAKING` | Optional shadow/staged exposure period running | integrator |
| `ACCEPTED` | Soak clean (or waived); unit is done | orchestrator (gate **G7**) |
| `TOMBSTONED` | Source counterpart deleted/retired with evidence | decommissioner (gate **G8**) |
| `ESCALATED` | Budget exhausted or hard blocker; awaiting stronger model or human | orchestrator |
| `DEFERRED` | Deliberately postponed | human via `DecisionRecord` |
| `QUARANTINED` | Intentionally left on source behind a bridge indefinitely | human via `DecisionRecord` |

### 3.2 Transition table

Only these transitions are legal. Each requires the listed **evidence**, submitted as an
`EvidenceBundle` (`unit.submitGate`) and validated **mechanically** by the orchestrator before
the transition commits. "Mechanically" = exit codes, schema validation, artifact-hash existence,
re-run check results in `EvidenceBundle.checks[]` — never the agent's prose.

| # | From → To | Gate | Required evidence (bundle items + re-run checks) | Performed by |
|---|---|---|---|---|
| T1 | `DISCOVERED → SPECIFIED` | **G1** | ≥1 schema-valid `BehaviorScenario` linked; scenario run vs **source** green (`parity-report`, exit 0); if `risk.tier ∈ {high,critical}`: oracle-calibration report with mutation-kill ≥ `RunRequest.oracle.minKillRate` | scenario-author, oracle-calibrator |
| T2 | `SPECIFIED → READY` | — | All `deps` satisfied or bridged (computed from `MigrationPlan.waves[].units[].blockedBy` + unit graph) | orchestrator (automatic) |
| T3 | `READY → CONVERTING` | — | Lease granted; converter received `RunManifest` (context pack); `attempts.convert < budget.maxConvertAttempts` | orchestrator |
| T4 | `CONVERTING → BUILT` | **G2** | `checks`: `tsc` exit 0, `lint` exit 0, `unit-tests` exit 0, `story-smoke` renders; all target artifacts (`Patch` + `artifacts.targetPaths`) exist and are referenced in the unit record | converter submits, orchestrator re-runs |
| T5 | `BUILT → WIRED` | **G3** | `seam-mount-report`: source app boots with flag OFF (unchanged) and ON (target mounts, zero new console errors) | converter or scaffolder |
| T6 | `WIRED → VERIFYING` | — | Verifier lease | orchestrator |
| T7 | `VERIFYING → PASSING` | **G4** | Every linked scenario replayed on both twins; `trace-diff` empty under diff policy + active `DecisionRecord` waivers; zero new console errors | verifier (mechanical) |
| T8 | `VERIFYING → DIVERGENT` | — | ≥1 schema-valid `Counterexample` written (survives flake screen, §6.4) | verifier |
| T9 | `DIVERGENT → REPAIRING` | — | `Counterexample.analysis.repairDirective` exists; `attempts.repair < budget.maxRepairAttempts` | orchestrator |
| T10 | `REPAIRING → BUILT` | **G2** | Same as T4 (re-run) | repairer |
| T11 | `PASSING → AUDITED` | **G5** | `critic-verdict` = approve; any findings fixed or absorbed by a `DecisionRecord` | critic |
| T12 | `AUDITED → INTEGRATED` | **G6** | Flag flipped in target shell config; full-app `smoke-report` green; ratchet counters updated | integrator |
| T13 | `INTEGRATED → SOAKING` | — | Soak plan exists (duration, metrics, abort criteria) | integrator |
| T14 | `SOAKING → ACCEPTED` | **G7** | `soak-report`: window elapsed, error budget not consumed, no new counterexamples from shadow traffic | orchestrator |
| T15 | `INTEGRATED → ACCEPTED` | **G7** | `RunRequest.strategy.soakPolicy` allows skipping soak for `risk.tier = low` | orchestrator |
| T16 | `ACCEPTED → TOMBSTONED` | **G8** | `usage-scan`: static usage of source artifact = 0 (inventory re-scan) AND runtime usage = 0 over soak window (trace evidence) | decommissioner |
| T17 | any → `ESCALATED` | — | Any budget cap reached, or agent emits an `escalation` event | orchestrator (automatic) |
| T18 | `ESCALATED → READY` | — | `DecisionRecord` type `escalation-resolution` recorded (`resolution.budgetsReset = true`) | human / stronger-tier agent |
| T19 | any → `DEFERRED` / `QUARANTINED` | — | `DecisionRecord` (`deferral` / `quarantine`), status `approved` | human |
| T20 | `SOAKING → DIVERGENT` | — | Shadow traffic produced a `Counterexample` | verifier |
| T21 | any post-`SPECIFIED` → `SPECIFIED`⁻ | — | Drift-invalidation: a source change touched this unit's files/scenarios | drift-sentinel |

**Gate failure never moves a unit backward silently.** A failed G2/G3 keeps the unit in
`CONVERTING`/`REPAIRING`, increments the attempt counter, writes a `gate-fail` ledger event, and
returns the failing `EvidenceBundle.checks[]` to the same agent (same lease) for one in-lease
fix; after that the lease ends and the counter governs.

### 3.3 Anti-loop invariants (orchestrator MUST enforce)

- `attempts.convert + attempts.repair` increases monotonically; hitting
  `budget.maxConvertAttempts`/`maxRepairAttempts` triggers T17. Caps are per-tier defaults from
  `RunRequest.budgets.attemptCapsByTier` (suggested: low 3/5, medium 3/6, high 4/8,
  critical → escalate-first).
- A repairer's directive names its target `Counterexample` (via `repairDirective`). If the same
  counterexample **fingerprint** (`Counterexample.fingerprint` =
  `sha256(scenarioId | divergence.kind | firstDivergentSemanticKey)`) reaches `reopenCount ≥ 2`
  after a claimed fix (`status: fix-claimed → reopened`), the orchestrator forces T17.
- Token metering per unit per role; `budget.tokensSpent > tokenCap` → T17 (`tokenCap` from
  `RunRequest.budgets.tokenCapsByTier`).
- A unit may not be re-claimed by the identity that just failed it while another eligible agent
  exists (prevents self-reinforcing error styles). If only one tier exists, the orchestrator
  injects the prior failure artifact (`RunManifest` item `kind: failure-artifact`) into the new
  pack.

## 4. Gate authority — how the orchestrator validates

Gates are the only way `state` advances; `unit.update` may **never** write `state`. The flow:

1. Agent assembles evidence and calls `unit.submitGate(unitId, "G2", evidenceBundle, leaseId)`.
2. Orchestrator schema-validates the `EvidenceBundle`, verifies every `evidenceRef.sha256`
   against the file on disk, and rejects any `..`/absolute path.
3. Orchestrator **re-runs the mechanical checks itself** — it does not trust
   `EvidenceBundle.checks[]` as submitted. For G2 it re-executes `tsc`/lint/tests via
   `shell.run`; for G4 it re-runs `trace.diff` under the active policy and `DecisionRecord`
   waivers. It fills its own authoritative `checks[]`.
4. If all required checks pass: commit the transition, bump `rev`, append a `transition` ledger
   event citing the bundle. Otherwise: append `gate-fail`, keep state, apply the §3.2
   in-lease-fix rule.

Required-check matrix per gate (neutral check names; framework-specific proofs ride in
`EvidenceBundle.targetAdapter`):

| Gate | Required re-run checks |
|---|---|
| G1 | `scenario-source-green`, (`mutation-kill ≥ min` if high/critical) |
| G2 | `tsc`, `lint`, `unit-tests`, `story-smoke`, `artifacts-exist` |
| G3 | `seam-off-unchanged`, `seam-on-mounts`, `console-errors-zero` |
| G4 | `all-scenarios-replayed`, `trace-diff-empty`, `console-errors-zero` |
| G5 | `critic-verdict-approve` |
| G6 | `flag-flipped`, `full-app-smoke`, `ratchets-updated` |
| G7 | `soak-window-elapsed`, `error-budget-ok`, `no-shadow-counterexamples` |
| G8 | `static-usage-zero`, `runtime-usage-zero` |

## 5. The ledger

`migration/ledger.ndjson` — one `RunResult#/$defs/ledgerEvent` per line. Neutral event `type`s:
`transition`, `claim`, `release`, `lease-expired`, `gate-fail`, `counterexample-opened`,
`counterexample-closed`, `decision-granted`, `decision-rejected`, `escalation`,
`escalation-resolved`, `drift-invalidation`, `tombstone`, `recipe-created`, `recipe-revised`,
`lesson-added`, `patch-submitted`, `budget-updated`, `pack-overflow`, `flake-suspect`,
`ratchet-adjusted`, `note`. (v1 `waiver-granted` is gone — waivers are now
`decision-granted`/`decision-rejected` over a `DecisionRecord`.)

```json
{"seq": 4812, "ts": "2026-07-11T14:02:11Z", "actor": {"role": "verifier", "agentId": "v-19"},
 "unitId": "unit:component:invoiceTable", "type": "transition", "from": "WIRED", "to": "VERIFYING",
 "gate": "G4", "evidence": [{"path": "migration/traces/target/invoice-list.filter-by-status/run-88.ndjson", "sha256": "…"}],
 "note": "parity run 3"}
```

Rules: `seq` strictly increasing, assigned by the orchestrator; agents append only through
`ledger.append` (type-restricted per role, §permissions in `02-TOOL-CONTRACTS.md §7`); the
ledger is never edited or compacted during the program. A `RunResult` document
(`unitStateCounts`, `ratchets`, `recentEvents`) is the materialized rollup at a point in time.

## 6. Leases, retries, budgets, and flake screening

### 6.1 Leases
`unit.claim(role, filter?)` grants `{unitId, leaseId, leaseExpiresAt}`. The lease auto-extends
while the agent actively calls tools; it expires on idle past TTL. The **lease reaper**
(orchestrator-internal) scans for `leaseExpiresAt < now`, emits `lease-expired`, clears
`assignee`, and returns the unit to the pool at its current `rev`. Work done under an expired
lease is void unless re-acquired at the same `rev`.

### 6.2 Retries
Governed entirely by `attempts` vs `budget` (§3.3). One free in-lease fix per gate failure; then
the lease ends and the attempt counter decides retry-vs-escalate. Cross-attempt state travels
only through the unit record + the injected failure artifact — never orchestrator memory.

### 6.3 Budgets
Metered per unit per role: tokens (`budget.tokensSpent`/`tokenCap`), attempts, wall-clock
(`wallClockCapMinutes`). Any breach → automatic T17 with a `budget-updated` then `escalation`
event. Partial output is preserved (the last `Patch`/`EvidenceBundle` stays on disk).

### 6.4 Flake screen
Divergences must reproduce ≥`RunRequest.oracle.flakeScreenRuns`-majority (default ≥2/3) before a
`Counterexample` opens (`divergence.reproducibility.runs`/`reproduced`). Sub-threshold results
emit `flake-suspect` and route to scenario-author; they never open a counterexample or fail G4.

## 7. Artifact catalog (v2)

| Artifact | Path | Schema (`schemas-v2/`) | Producer | Consumers |
|---|---|---|---|---|
| Run request | `migration/run-request.json` | `run-request.schema.json` | intake-analyst (human-approved) | everyone |
| Inventory graph | `migration/inventory/graph.json` | `inventory-graph.schema.json` | inventory-cartographer | recipe-miner, scenario-author, planner, decommissioner, drift-sentinel |
| Migration plan | `migration/plan.json` | `migration-plan.schema.json` | orchestrator (planner) | scheduler, integrator |
| Unit record | `migration/units/<id>.json` | `unit.schema.json` | orchestrator | everyone |
| Behavior scenario | `migration/behavior-ir/<scenario>.json` | `behavior-scenario.schema.json` | scenario-author | verifier, converter (read) |
| Semantic trace | `migration/traces/<side>/<scenario>/<run>.ndjson` | `semantic-trace.schema.json` | tracer/verifier tooling | analyst, verifier |
| Patch | `migration/patches/<id>.json` | `patch.schema.json` | converter/repairer | critic, integrator, decommissioner |
| Evidence bundle | `migration/evidence/<bundle>.json` | `evidence-bundle.schema.json` | any gate-submitting role | orchestrator (gate validation), audit |
| Counterexample | `migration/counterexamples/<ce>.json` | `counterexample.schema.json` | verifier + analyst | repairer, librarian |
| Recipe | `migration/recipes/<id>.md` | `recipe.schema.json` (frontmatter) | recipe-miner, librarian | converter, critic |
| Decision record | `migration/decisions/<id>.json` | `decision-record.schema.json` | human (agent-drafted) | verifier diff policy, orchestrator |
| Lessons | `migration/lessons.md` | free markdown, append-only, one `##` per lesson | librarian | context packs |
| Run manifest (context pack) | `migration/context-packs/<packId>.json` | `run-manifest.schema.json` | orchestrator | audit/debug |
| Run result (rollup) | `migration/reports/run-result.json` | `run-result.schema.json` | orchestrator | humans |

## 8. Context packs → `RunManifest`

The single highest-leverage orchestrator feature for weak agents. A context pack is the
**complete** context for one task; the agent gets nothing else and must need nothing else. Its
audit record is a `RunManifest` (`packId` = sha256 of ordered item hashes; records
`sourceFramework`/`targetFramework` so any run is reproducible independent of framework).

**Assembly rules (deterministic orchestrator code):**

1. Always include: the role card, the instantiated task instruction (prompt template), the unit
   record. (`RunManifest.items[].kind`: `role-card`, `task-instruction`, `unit-record`.)
2. Include by role. A converter gets: source of the unit (all `artifacts.legacyPaths` + referenced
   templates → `legacy-source`, `template`), matched `recipe`(s) in full, the unit's
   `BehaviorScenario`s, top-K `lesson`s (matched by motif tag), the target `conventions` doc, and
   on retry the last `failure-artifact`. It does NOT get the whole inventory, other units' source,
   the full report, or other phases' docs.
3. Hard size budget (`RunManifest.budget`, default `RunRequest.budgets.contextPackTokenBudget` =
   60k). If required items exceed budget the orchestrator **splits the task, never truncates
   silently**: set `RunManifest.overflowed = true`, emit `pack-overflow`, and route the unit to a
   higher `modelTier`.
4. Deterministic ordering + the `RunManifest` listing every item with `kind`, `ref`, `sha256`,
   `tokens`, so any run can be reproduced and audited.
5. Lessons inclusion: top-K (default 5) whose motif/failure tags intersect the unit's,
   most-recently-reinforced first. Never the entire lessons file.

Per-role pack summary (neutral):

| Role | Always | Task-specific | Deliberately excluded |
|---|---|---|---|
| converter/repairer | role-card, conventions | recipe(s), unit-record, unit source+templates, scenarios, top-5 lessons, prior failure (retries) | inventory graph, other units, other phases' docs, report |
| scenario-author | role-card, phase-doc section | unit-record, source, recorded traces, fixture list | target code |
| analyst | role-card | counterexample, both traces, recipe, directive template | full app source |
| critic | role-card, conventions | patch/diff, recipe, scenarios (names+assertions) | traces |
| others | role-card + own phase-doc | per phase doc | everything else |

## 9. Roles → orchestrator obligations (neutral)

The role cards in `plans/03-AGENT-ROLES.md` remain the behavioral contract. Three universal
rules bind every role and are enforced by the tool layer, not trust:

- **U1. Source is read-only.** No agent writes `legacy/**` (path sandbox in
  `02-TOOL-CONTRACTS.md §0`). Only the tracer writes `shim/**`.
- **U2. Never self-certify.** Agents submit an `EvidenceBundle` via `unit.submitGate`; the
  orchestrator judges (§4). No agent writes `Unit.state`.
- **U3. Escalate over guessing.** Blocked / out-of-scope / budget-about-to-breach → `escalate`
  with artifacts, triggering T17.

Neutralized role→artifact ownership (framework-specific behavior rides in adapters):

| Role | Owns (writes) | Gate(s) it submits |
|---|---|---|
| intake-analyst | `RunRequest` | — |
| inventory-cartographer | `InventoryGraph`, `Unit` (`DISCOVERED`) | — |
| tracer | `shim/**`, source `SemanticTrace`s | — |
| scenario-author | `BehaviorScenario`, e2e specs | G1 |
| oracle-calibrator | calibration report | G1 (kill-rate) |
| scaffolder | target app, seam lib, conventions | G3 (hello-world) |
| recipe-miner | `Recipe`, exemplar units | G1–G4 (exemplar) |
| converter | `Patch`, target code/tests/story | G2, G3 |
| verifier | `SemanticTrace`s, `Counterexample` (open) | G4 |
| counterexample-analyst | `Counterexample.analysis` + `repairDirective` | — |
| repairer | `Patch` (directive-scoped) | G2 |
| critic | `critic-verdict` | G5 |
| integrator | flag config, soak plan | G6, G7 |
| decommissioner | tombstone, source deletions | G8 |
| drift-sentinel | `drift-invalidation` events | — (triggers T21) |
| librarian | `lessons.md`, `Recipe` revisions, recipe stats | — |

Human decisions (`DecisionRecord`): `waiver` (absorbs divergences by neutral `match`),
`deferral`, `quarantine`, `escalation-resolution` (resets budgets → T18), `scope-change`.
Agents may *draft* (`status: pending-human`); only a human sets `approved`.

## 10. Scheduling & orchestrator-internal duties

Not exposed as tools (see `02-TOOL-CONTRACTS.md §8`):

- **Planner.** Compute `MigrationPlan.waves` from the `InventoryGraph` + `Unit.deps` +
  `RunRequest.strategy` (dependency-respecting waves; leaves/services first, shared primitives,
  then routes). `READY` (T2) is derived from `blockedBy` reaching `INTEGRATED`/`ACCEPTED`/bridge.
- **Scheduler.** Priority = (RunRequest priority) × (risk-adjusted readiness); prefer finishing
  in-flight units over starting new ones; enforce `RunRequest.budgets.wipLimits` per phase.
- **Gate runners** (§4), **context-pack assembly** (§8), **budget metering + T17** (§6.3),
  **lease reaper** (§6.1).
- **Model-tier routing** from `RunRequest.budgets.modelRouting` (risk tier × role), including
  optional two-cheap-conversions cross-check.
- **Ratchets & dashboard** (§11).

## 11. Ratchets (program-level regression brakes)

CI checks over the workspace; values stored in `RunResult.ratchets`:

- `legacyFileCount` — source files still referenced by the runtime bundle; may never increase
  (drift-sentinel adjusts the baseline explicitly via `ratchet-adjusted`).
- `paritySuiteSize` — `BehaviorScenario`s green-on-source; may never decrease.
- `bridgeCount` — live seams; must reach 0 by program end; alert if it grows two windows running.
- `waiverCountByCategory` — approved `DecisionRecord`s by `category`; visible to humans;
  unexplained growth is a smell.
- `escalationRate` — escalations per 10 `ACCEPTED` units, tracked per motif; a spiking motif
  means its recipe is bad → librarian task.

---

### Appendix — v1 → v2 vocabulary crosswalk

| v1 (`plans/01`, `plans/03`) | v2 (this doc + `schemas-v2/`) |
|---|---|
| Charter (`charter.schema.json`) | `RunRequest`; source/target frameworks are parameters |
| inline `evidence[]` on submissions | first-class `EvidenceBundle` (hash-verified, re-run `checks[]`) |
| prose `strategy.unitOrdering` + graph | explicit `MigrationPlan.waves` |
| Waiver | `DecisionRecord` (waiver / deferral / quarantine / escalation-resolution / scope-change) |
| implicit code change (`artifacts` + hashes) | first-class `Patch` |
| Context-pack manifest | `RunManifest` (+ framework params) |
| Ledger event (`waiver-granted`, ng event types) | `RunResult#/$defs/ledgerEvent` (neutral types) |
| `unit:cmp:` / `unit:flt:` ids, ng `kind`s | neutral `unitId` pattern + neutral `kind`; construct in `sourceAdapter` |
| "legacy/React" hardcoded | `source`/`target` parameters; specifics in adapters |
