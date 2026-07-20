# Orchestrator skeleton (v2)

A runnable, framework-neutral skeleton of the deterministic orchestrator described in
[`../ORCHESTRATOR.md`](../ORCHESTRATOR.md) and [`../TOOL-CONTRACTS.md`](../TOOL-CONTRACTS.md).
It implements the **state-machine heart** — the part that does not depend on the source or target
framework — and leaves the framework-specific mechanics (running `tsc`, driving a browser, diffing
traces) as pluggable check runners.

```bash
npm install
npm test        # node --test — 13 lifecycle / planner / context-pack tests
```

## What's implemented

| Module | Responsibility (spec ref) |
|---|---|
| `src/store.mjs` | Files-are-the-database: sandboxed workspace-relative I/O, sha256 content-addressing, NDJSON ledger, `evidenceRef` verification (§1, §0 sandbox). |
| `src/schema.mjs` | Loads every `schemas-v2` schema by `$id` (`mx://…`) and validates against it. |
| `src/state-machine.mjs` | The 18 states, the T1–T21 transition table, and the per-gate re-run check matrix (§3.2, §4) as pure data + pure functions. |
| `src/gates.mjs` | Gate authority: schema-validate the bundle → verify every `sha256` → **re-run** the required checks via an injected `CheckRegistry` and write authoritative `checks[]`. Agent-supplied results are ignored (§4). A required check with no runner **fails** (`no-runner`). |
| `src/planner.mjs` | The planner (§10): pure, deterministic. Computes `MigrationPlan.waves` — dependency-layered (Kahn), services/leaves-first intra-wave — from the unit set + `RunRequest.strategy`. Cycles surface as a flagged final wave, never an infinite loop. Emits a schema-valid `MigrationPlan` + a `unitId → [wave, pos]` rank index for the scheduler. |
| `src/context-pack.mjs` | Context-pack assembly (§8): builds the `RunManifest` for one task — always-items (role-card, task-instruction, unit-record, conventions) then role-specific artifacts then top-K matched lessons. Every item is content-addressed + token-estimated; `packId` = sha256 of the ordered hashes. Over budget → `overflowed=true` + route to a higher `modelTier`, **never silent truncation** (§8.3). |
| `src/orchestrator.mjs` | The tool surface: `unitGet/Update/Claim/submitGate`, `release`, `plan`, `ledgerAppend/Query`, `computeReady`, plus optimistic-`rev` concurrency, leases with TTL, and the anti-loop attempt-cap → `ESCALATED` rule (§3.3, §4, §6). `unitClaim` now schedules from `MigrationPlan.waves` (plan-earliest eligible unit) and hands the claimer its assembled `RunManifest`. |

## Guarantees the tests pin down

- **Full happy path** `DISCOVERED → SPECIFIED → READY → CONVERTING → BUILT → WIRED → VERIFYING →
  PASSING → AUDITED → INTEGRATED → ACCEPTED`, driven only through the tool surface, with a
  `transition` ledger event per gate.
- **No self-certify** — `unit.update` can never write `state`; only `submitGate` advances it, and only
  when the orchestrator's own re-run of the checks passes.
- **Optimistic concurrency** — a stale `expectedRev` is rejected with `CONFLICT`.
- **Anti-loop** — hitting `budget.maxConvertAttempts` on repeated G2 failure auto-escalates to
  `ESCALATED` (T17).
- **Deterministic planning** — `computePlan` layers deps into waves (services/leaves first) and is
  reproducible; a dependency cycle is surfaced as a flagged wave, not a hang.
- **Plan-ordered scheduling** — `unitClaim` picks the plan-earliest eligible unit, not a raw scan.
- **Context packs are complete & bounded** — every claim yields a schema-valid `RunManifest`;
  identical inputs give an identical `packId`; over-budget packs set `overflowed` and bump the tier
  instead of dropping items.

## What's intentionally stubbed

- **Check runners.** Real deployments register framework-specific runners (resolved from
  `RunRequest.target`'s adapter, e.g. `angular2plus → tsc/eslint/vitest/playwright`) on the
  `CheckRegistry`. The tests inject passing/failing stubs. The *contract* — orchestrator re-runs,
  never trusts the agent — is real.
- **Framework-specific parts of context packs.** Assembly is real (ordering, hashing, budget,
  overflow, schema-valid `RunManifest`), but source/recipe/scenario/lesson artifacts are included
  only when present on disk; the role-card and task-instruction are synthesized placeholders. On
  overflow the task is routed to a higher tier but not yet actually **split** into subtasks (§8.3).
- **Scheduler refinements (§10).** Ordering is by plan wave/position; the risk-adjusted priority,
  "prefer finishing in-flight over starting new," and per-phase `wipLimits` are not yet enforced.
- The **lease reaper** timer and the **app/scenario/trace/browser tools** (TOOL-CONTRACTS §1–3, §6)
  are still not built.
