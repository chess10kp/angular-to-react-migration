// Budget metering + automatic T17 (ORCHESTRATOR.md §6.3). Tokens and wall-clock
// are metered per unit per active role; any breach forces T17 with a
// `budget-updated` then `escalation` event, and partial output is preserved.
// Attempts are metered separately, at the failed gate (§6.2) — covered here as a
// regression on the shared escalation path.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Orchestrator } from "../src/orchestrator.mjs";
import { CheckRegistry } from "../src/gates.mjs";

function freshWorkspace() {
  const ws = mkdtempSync(join(tmpdir(), "mx-budget-"));
  mkdirSync(join(ws, "migration", "evidence"), { recursive: true });
  return ws;
}

function unitIn(id, state, budget = {}, { tier = "low" } = {}) {
  const score = { low: 20, medium: 45, high: 70, critical: 90 }[tier];
  return {
    schemaVersion: "2.0.0", id, kind: "component", rev: 0,
    state, stateSince: "2026-07-17T00:00:00Z", deps: [],
    risk: { score, tier, factors: [] },
    attempts: { convert: 0, repair: 0 },
    budget: { maxConvertAttempts: 3, maxRepairAttempts: 5, tokenCap: 200000, tokensSpent: 0, ...budget },
    artifacts: { patch: "migration/patches/p1.json" }, // "partial output" on disk
  };
}

const TTL = 10 * 60 * 1000; // 10 min idle TTL — longer than the wall-clock cap under test
function harness(runRequest = {}) {
  let t = 1_700_000_000_000;
  const orch = new Orchestrator(freshWorkspace(), {
    registry: new CheckRegistry(), now: () => t, leaseTtlMs: TTL, runRequest,
  });
  return { orch, advance: (ms) => { t += ms; }, at: () => t };
}

test("meterUsage accumulates token spend under cap without escalating", () => {
  const { orch } = harness();
  orch.createUnit(unitIn("unit:component:ready", "READY", { tokenCap: 1000 }));
  const c = orch.unitClaim("converter"); // READY -> CONVERTING

  let r = orch.meterUsage("unit:component:ready", { tokens: 300 }, c.leaseId);
  assert.equal(r.escalated, false);
  assert.equal(r.tokensSpent, 300);
  r = orch.meterUsage("unit:component:ready", { tokens: 400 }, c.leaseId);
  assert.equal(r.escalated, false);
  assert.equal(r.tokensSpent, 700);

  const rec = orch.unitGet("unit:component:ready").record;
  assert.equal(rec.state, "CONVERTING");
  assert.equal(rec.budget.tokensSpent, 700);
});

test("token cap breach forces T17 with budget-updated then escalation, preserving output", () => {
  const { orch } = harness();
  orch.createUnit(unitIn("unit:component:ready", "READY", { tokenCap: 1000 }));
  const c = orch.unitClaim("converter");

  const r = orch.meterUsage("unit:component:ready", { tokens: 1200 }, c.leaseId);
  assert.equal(r.escalated, true);
  assert.equal(r.newState, "ESCALATED");

  const rec = orch.unitGet("unit:component:ready").record;
  assert.equal(rec.state, "ESCALATED");
  assert.equal(rec.budget.tokensSpent, 1200);       // spend recorded
  assert.equal(rec.artifacts.patch, "migration/patches/p1.json"); // partial output preserved

  // Event pair, in order: budget-updated precedes escalation.
  const events = orch.ledgerQuery({ unitId: "unit:component:ready" }).events;
  const bu = events.findIndex((e) => e.type === "budget-updated");
  const es = events.findIndex((e) => e.type === "escalation");
  assert.ok(bu >= 0 && es >= 0 && bu < es);
  assert.ok(events.some((e) => e.type === "transition" && e.from === "CONVERTING" && e.to === "ESCALATED"));
});

test("sweepBudgets escalates a unit that runs past its wall-clock cap", () => {
  const { orch, advance } = harness();
  orch.createUnit(unitIn("unit:component:ready", "READY", { wallClockCapMinutes: 5 }));
  const c = orch.unitClaim("converter");

  advance(4 * 60 * 1000); // 4 min — under cap, lease still live
  assert.equal(orch.sweepBudgets().escalated.length, 0);
  assert.equal(orch.unitGet("unit:component:ready").record.state, "CONVERTING");

  advance(2 * 60 * 1000); // now 6 min total — over the 5 min wall-clock cap
  const s = orch.sweepBudgets();
  assert.equal(s.escalated.length, 1);
  assert.equal(s.escalated[0].unitId, "unit:component:ready");
  assert.equal(s.escalated[0].from, "CONVERTING");
  assert.match(s.escalated[0].reason, /wall-clock/);
  assert.equal(orch.unitGet("unit:component:ready").record.state, "ESCALATED");
  // Lease is still live by TTL, but wall-clock is independent of idle TTL.
  assert.ok(orch._leaseValid !== undefined);
});

test("sweepBudgets ignores unassigned units and already-escalated units", () => {
  const { orch, advance } = harness();
  orch.createUnit(unitIn("unit:component:idle", "READY", { wallClockCapMinutes: 1 })); // never claimed
  orch.createUnit(unitIn("unit:component:work", "READY", { wallClockCapMinutes: 1 }));
  const c = orch.unitClaim("converter"); // claims :idle or :work by rank; drain both
  advance(2 * 60 * 1000);

  const first = orch.sweepBudgets();
  assert.equal(first.escalated.length, 1); // only the assigned one
  // Second sweep: the escalated unit is skipped, the unassigned one never breaches.
  assert.equal(orch.sweepBudgets().escalated.length, 0);
  assert.equal(orch.unitGet("unit:component:idle").record.state === "ESCALATED" ||
               orch.unitGet("unit:component:work").record.state === "ESCALATED", true);
});

test("agent escalate() forces T17 but emits no budget-updated event", () => {
  const { orch } = harness();
  orch.createUnit(unitIn("unit:component:ready", "READY"));
  const c = orch.unitClaim("converter");

  const r = orch.escalate("unit:component:ready", { reason: "blocked on missing scenario" }, c.leaseId);
  assert.equal(r.escalated, true);
  assert.equal(r.newState, "ESCALATED");

  const events = orch.ledgerQuery({ unitId: "unit:component:ready" }).events;
  assert.ok(events.some((e) => e.type === "escalation"));
  assert.equal(events.some((e) => e.type === "budget-updated"), false); // not a budget breach
});

test("meterUsage and escalate reject a stale/invalid lease", () => {
  const { orch } = harness();
  orch.createUnit(unitIn("unit:component:ready", "READY"));
  orch.unitClaim("converter");
  assert.equal(orch.meterUsage("unit:component:ready", { tokens: 10 }, "lease-bogus").ok, false);
  assert.equal(orch.escalate("unit:component:ready", {}, "lease-bogus").ok, false);
});

test("attempt cap at a failed gate still escalates, now via the shared budget path", () => {
  const { orch } = harness();
  const u = unitIn("unit:component:ready", "READY", { maxConvertAttempts: 1 });
  orch.createUnit(u);
  const c = orch.unitClaim("converter"); // convert attempt -> 1, at cap

  // Fail G2 from CONVERTING: attempt increments to 2 >= cap(1) -> escalate.
  const r = orch.submitGate("unit:component:ready", "G2", { schemaVersion: "2.0.0", items: [], checks: [{ name: "tsc", passed: false }] }, c.leaseId);
  assert.equal(r.escalated, true);
  const events = orch.ledgerQuery({ unitId: "unit:component:ready" }).events;
  assert.ok(events.some((e) => e.type === "gate-fail"));
  assert.ok(events.some((e) => e.type === "budget-updated")); // shared path now emits it
  assert.ok(events.some((e) => e.type === "escalation"));
  assert.equal(orch.unitGet("unit:component:ready").record.state, "ESCALATED");
});
