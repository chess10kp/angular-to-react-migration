# 01 — Shared State, Artifacts, and the Unit State Machine

> This document is normative. The orchestrator implements exactly this state model; agents
> read and write only through the tool contracts in `02-TOOL-CONTRACTS.md`. JSON Schemas for
> every artifact live in `plans/schemas/`.

---

## 1. Ground rules for all state

1. **Files are the database.** Everything under `migration/` is plain JSON/NDJSON/Markdown.
   No hidden orchestrator memory: if it isn't in a file, it didn't happen.
2. **The ledger is append-only.** `migration/ledger.ndjson` records every state transition,
   claim, release, escalation, waiver, and tombstone. Unit records are a *materialized view*;
   on conflict, the ledger wins and unit records are rebuilt from it.
3. **Optimistic concurrency.** Every mutable record carries an integer `rev`. Writers must
   supply the `rev` they read; the orchestrator rejects stale writes. Agents never write these
   files directly — they call `unit.update`, `ledger.append`, etc.
4. **Leases, not locks.** Claiming a unit grants a lease with a TTL (default 30 min,
   orchestrator-configurable). Expired leases are reclaimable. An agent holding an expired
   lease must treat its work as abandoned unless it can re-acquire at the same `rev`.
5. **Evidence is content-addressed.** Ledger events reference evidence by workspace-relative
   path + SHA-256. The orchestrator verifies hashes at gate time.

## 2. The migration unit

A **unit** is the atomic tracked thing. Kinds: `route`, `component`, `directive`, `service`,
`filter`, `primitive` (design-system building block created in P4/P5), `infra` (seam, shim,
event façade). Unit IDs are stable and derived from the inventory:

```
unit:<kind>:<canonical-name>        e.g.  unit:route:/invoices
                                          unit:cmp:invoiceTable
                                          unit:dir:datePicker
                                          unit:svc:InvoiceService
                                          unit:flt:currencyShort
```

Full record schema: `schemas/unit.schema.json`. Illustrative record:

```json
{
  "id": "unit:cmp:invoiceTable",
  "kind": "component",
  "rev": 14,
  "state": "VERIFYING",
  "stateSince": "2026-07-11T14:02:11Z",
  "deps": ["unit:svc:InvoiceService", "unit:flt:currencyShort"],
  "dependents": ["unit:route:/invoices"],
  "risk": { "score": 62, "tier": "high", "factors": ["directive-link", "jquery-plugin", "watch-heavy"] },
  "motifs": ["ngrepeat-table", "watch-derived-state"],
  "recipes": ["r-017-ngrepeat-table"],
  "scenarios": ["invoice-list.filter-by-status", "invoice-list.sort-by-amount"],
  "seam": { "type": "element-bridge", "flag": "mx_invoiceTable" },
  "attempts": { "convert": 2, "repair": 3 },
  "budget": {
    "maxConvertAttempts": 3, "maxRepairAttempts": 5,
    "tokenCap": 600000, "tokensSpent": 184000,
    "wallClockCapMinutes": 240
  },
  "modelTier": "standard",
  "artifacts": {
    "legacyPaths": ["legacy/src/app/invoices/invoiceTable.js", "legacy/src/app/invoices/invoiceTable.html"],
    "targetPaths": ["target/src/features/invoices/InvoiceTable.tsx"],
    "stories": ["target/src/features/invoices/InvoiceTable.stories.tsx"],
    "tests": ["target/src/features/invoices/InvoiceTable.test.tsx"]
  },
  "assignee": { "role": "verifier", "agentId": "v-19", "leaseExpiresAt": "2026-07-11T14:32:11Z" },
  "waivers": [],
  "openCounterexamples": ["ce-000412"],
  "notes": "Plugin `jquery.floatThead` isolated behind ref-wrapper per r-031."
}
```

## 3. The unit state machine

### 3.1 States

| State | Meaning | Set by |
|---|---|---|
| `DISCOVERED` | Created from inventory; not yet specified | inventory-cartographer |
| `SPECIFIED` | Has ≥ 1 Behavior IR scenario; **all its scenarios pass against legacy**; oracle calibrated if risk tier requires | orchestrator (gate G1) |
| `READY` | Specified AND all `deps` are `INTEGRATED`/`ACCEPTED` or reachable through a live bridge | orchestrator (computed) |
| `CONVERTING` | Leased to a converter | orchestrator on claim |
| `BUILT` | Target code compiles; types, lint, unit tests, story render all pass | orchestrator (gate G2) |
| `WIRED` | Mounted behind its seam + feature flag; both twins bootable | orchestrator (gate G3) |
| `VERIFYING` | Parity suite executing | orchestrator |
| `DIVERGENT` | ≥ 1 open counterexample | verifier via gate G4-fail |
| `REPAIRING` | Leased to a repairer with a repair directive | orchestrator on claim |
| `PASSING` | Parity suite green under current diff policy + waivers | orchestrator (gate G4) |
| `AUDITED` | Critic approved (no slop, conventions, recipe conformance) | orchestrator (gate G5) |
| `INTEGRATED` | Flag default-on in the target shell; legacy path still present | integrator (gate G6) |
| `SOAKING` | Optional shadow/staged exposure period running | integrator |
| `ACCEPTED` | Soak clean (or waived); unit is done | orchestrator (gate G7) |
| `TOMBSTONED` | Legacy counterpart deleted/retired with evidence | decommissioner (gate G8) |
| `ESCALATED` | Budget exhausted or hard blocker; awaiting stronger model or human | orchestrator |
| `DEFERRED` | Deliberately postponed (dependency shape, business priority) | human via orchestrator |
| `QUARANTINED` | Intentionally left legacy behind a bridge indefinitely (documented) | human via orchestrator |

### 3.2 Transition table

Only these transitions are legal. Each requires the listed **evidence**, validated
mechanically by the orchestrator before the transition commits. "Mechanically" means: exit
codes, schema validation, artifact-hash existence — never the agent's prose.

| # | From → To | Guard / Required evidence | Performed by |
|---|---|---|---|
| T1 | `DISCOVERED → SPECIFIED` | Gate **G1**: ≥1 schema-valid Behavior IR linked; Playwright run vs **legacy** green (exit 0, report artifact); if `risk.tier ∈ {high, critical}`: oracle-calibration report with mutation-kill ≥ threshold from charter | scenario-author, oracle-calibrator |
| T2 | `SPECIFIED → READY` | All deps satisfied or bridged (computed from unit graph) | orchestrator (automatic) |
| T3 | `READY → CONVERTING` | Lease granted; converter received context pack; `attempts.convert < maxConvertAttempts` | orchestrator |
| T4 | `CONVERTING → BUILT` | Gate **G2**: `tsc` exit 0; lint exit 0; unit tests exit 0; Storybook story renders (smoke); all target artifacts exist and are referenced in the unit record | converter submits, orchestrator validates |
| T5 | `BUILT → WIRED` | Gate **G3**: seam mount test passes — legacy app boots with flag OFF (unchanged) and ON (React mounts, no console errors) | converter or scaffolder |
| T6 | `WIRED → VERIFYING` | Verifier lease | orchestrator |
| T7 | `VERIFYING → PASSING` | Gate **G4**: every linked scenario replayed on both twins; trace diff empty under diff policy + active waivers; zero new console errors | verifier (mechanical) |
| T8 | `VERIFYING → DIVERGENT` | ≥1 schema-valid counterexample written | verifier |
| T9 | `DIVERGENT → REPAIRING` | Repair directive exists (from counterexample-analyst); `attempts.repair < maxRepairAttempts` | orchestrator |
| T10 | `REPAIRING → BUILT` | Same evidence as T4 (re-run) | repairer |
| T11 | `PASSING → AUDITED` | Gate **G5**: critic verdict artifact = approve; any critic findings either fixed or waived | critic |
| T12 | `AUDITED → INTEGRATED` | Gate **G6**: flag flipped in target shell config; full app smoke suite green; ratchet counters updated | integrator |
| T13 | `INTEGRATED → SOAKING` | Soak plan exists (duration, metrics, abort criteria) | integrator |
| T14 | `SOAKING → ACCEPTED` | Gate **G7**: soak window elapsed, error budget not consumed, no new counterexamples from shadow traffic | orchestrator |
| T15 | `INTEGRATED → ACCEPTED` | Charter allows skipping soak for `risk.tier ∈ {low}` | orchestrator |
| T16 | `ACCEPTED → TOMBSTONED` | Gate **G8**: static usage of legacy artifact = 0 (inventory re-scan) AND runtime usage = 0 over soak window (trace evidence) | decommissioner |
| T17 | any → `ESCALATED` | Any budget cap reached, or agent emits `blocker` event | orchestrator (automatic) |
| T18 | `ESCALATED → READY` | Human or stronger-tier agent resolution recorded; budgets reset explicitly | human/orchestrator |
| T19 | any → `DEFERRED` / `QUARANTINED` | Human decision recorded in ledger with reason | human |
| T20 | `SOAKING → DIVERGENT` | Shadow traffic produced a counterexample | verifier |
| T21 | any post-`SPECIFIED` → `SPECIFIED`⁻ (re-spec) | Drift-sentinel invalidation: legacy change touched this unit's files/scenarios | drift-sentinel |

**Failure of a gate never moves a unit backward silently.** A failed G2/G3 keeps the unit in
`CONVERTING`/`REPAIRING`, increments the attempt counter, and returns the failure artifact to
the same agent (same lease) for one in-lease fix; after that, the lease ends and the counter
governs.

### 3.3 Anti-loop invariants (orchestrator MUST enforce)

- `attempts.convert + attempts.repair` monotonically increases; caps trigger T17. Caps are
  per-tier defaults in the charter (suggested: low=3/5, medium=3/6, high=4/8, critical=escalate-first).
- A repairer must state, in its repair directive response, which counterexample it targets.
  If the same counterexample (by fingerprint) reopens **twice** after being claimed fixed →
  automatic T17 escalation. Fingerprint = hash of (scenarioId, divergence kind, first divergent
  semantic event).
- Token metering: the orchestrator records tokens per unit per role; `tokenCap` breach → T17.
- A unit may not be claimed by the same agent identity that just failed it if another eligible
  agent is available (prevents self-reinforcing error styles); if only one agent tier exists,
  the orchestrator must inject the prior failure artifact into the new attempt's context pack.

## 4. The ledger

`migration/ledger.ndjson` — one JSON object per line. Schema: `schemas/ledger-event.schema.json`.

```json
{"seq": 4812, "ts": "2026-07-11T14:02:11Z", "actor": {"role": "verifier", "agentId": "v-19"},
 "unitId": "unit:cmp:invoiceTable", "type": "transition", "from": "WIRED", "to": "VERIFYING",
 "evidence": [{"path": "migration/traces/target/invoice-list.filter-by-status/run-88.ndjson", "sha256": "…"}],
 "note": "parity run 3"}
```

Event types: `transition`, `claim`, `release`, `lease-expired`, `gate-fail`, `counterexample-opened`,
`counterexample-closed`, `waiver-granted`, `escalation`, `drift-invalidation`, `tombstone`,
`recipe-created`, `recipe-revised`, `lesson-added`, `budget-updated`.

Rules: `seq` strictly increasing, assigned by orchestrator; agents append only through
`ledger.append`; the ledger is never edited or compacted during the program.

## 5. Artifact catalog

| Artifact | Path | Schema | Producer | Consumers |
|---|---|---|---|---|
| Charter | `migration/charter.json` | `charter.schema.json` | intake-analyst (human-approved) | everyone |
| Inventory graph | `migration/inventory/graph.json` | `inventory-graph.schema.json` | inventory-cartographer | recipe-miner, scenario-author, decommissioner, drift-sentinel |
| Motif map | `migration/inventory/motifs.json` | (embedded in graph schema) | recipe-miner | converter routing |
| Unit record | `migration/units/<id>.json` | `unit.schema.json` | orchestrator | everyone |
| Behavior IR | `migration/behavior-ir/<scenario>.json` | `behavior-ir.schema.json` | scenario-author | verifier, converter (read) |
| Trace | `migration/traces/<side>/<scenario>/<run>.ndjson` | `trace-event.schema.json` | tracer/verifier tooling | analyst, verifier |
| Counterexample | `migration/counterexamples/<ce>.json` | `counterexample.schema.json` | verifier + analyst | repairer, librarian |
| Recipe | `migration/recipes/<id>.md` | frontmatter: `recipe.schema.json` | recipe-miner, librarian | converter, critic |
| Recipe stats | `migration/recipes/stats.json` | (part of recipe schema file) | orchestrator | librarian |
| Lessons | `migration/lessons.md` | free markdown, append-only, one `##` per lesson | librarian | context packs |
| Waiver | `migration/waivers/<id>.json` | `waiver.schema.json` | human (agent-drafted) | verifier diff policy |
| Context pack manifest | `migration/context-packs/<hash>.json` | `context-pack.schema.json` | orchestrator | audit/debug |
| Dashboard | `migration/reports/dashboard.json` | free-form | orchestrator | humans |

## 6. Context Packs

The single highest-leverage orchestrator feature for weak agents. A context pack is the
**complete** context for one task — the agent gets nothing else and must need nothing else.

**Assembly rules (orchestrator code, deterministic):**

1. Always include: the role card (from `03-AGENT-ROLES.md`), the task instruction
   (instantiated prompt template from `prompts/`), the unit record.
2. Include by role (see the per-role table in `03-AGENT-ROLES.md §per-role packs`): e.g., a
   converter gets: legacy source of the unit (all `legacyPaths` + templates it references),
   matched recipe(s) in full, the unit's Behavior IR scenarios, relevant lessons (matched by
   motif tag), the target app's conventions doc, and the last failure artifact if this is a
   retry. It does NOT get: the whole inventory, other units' source, the full report, or
   phase docs for other phases.
3. Hard size budget per pack (charter default: 60k tokens for standard tier). If required
   items exceed budget, the orchestrator must SPLIT THE TASK, never truncate silently.
   Overflow → emit `pack-overflow` ledger event and route the unit to a higher tier.
4. Deterministic ordering and a manifest (`context-pack.schema.json`) listing every included
   item + hash, so any run can be reproduced and audited.
5. Lessons inclusion: top-K (default 5) lessons whose motif/failure tags intersect the unit's,
   most-recently-reinforced first. Never include the entire lessons file.

## 7. Ratchets (program-level regression brakes)

Implemented as CI checks on the workspace; numbers stored in `migration/reports/dashboard.json`:

- `legacy-file-count`: count of files under `legacy/` referenced by the runtime bundle; may
  never increase. (New legacy features during migration are allowed only via drift-sentinel
  flow, which adjusts the baseline explicitly.)
- `parity-suite-size`: number of Behavior IR scenarios with green-on-legacy status; may never
  decrease.
- `bridge-count`: number of live seams; must reach 0 by program end; alert if it grows two
  weeks in a row.
- `waiver-count` by category: visible to humans; unexplained growth is a smell.
- `escalation-rate`: escalations per 10 accepted units, tracked per motif — a motif with a
  spiking rate means its recipe is bad → librarian task.
