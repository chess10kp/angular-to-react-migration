// Lease reaper (ORCHESTRATOR.md §6.1 + Principle 4): expired leases are
// reclaimable. The reaper scans for `assignee.leaseExpiresAt < now`, voids the
// assignment, rolls transient work states back to the resting state they were
// claimed from so a role can re-dispatch them, and emits `lease-expired`.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Orchestrator } from "../src/orchestrator.mjs";
import { CheckRegistry } from "../src/gates.mjs";

function freshWorkspace() {
  const ws = mkdtempSync(join(tmpdir(), "mx-reaper-"));
  mkdirSync(join(ws, "migration", "evidence"), { recursive: true });
  return ws;
}

function unitIn(id, state, { tier = "low", kind = "component" } = {}) {
  const score = { low: 20, medium: 45, high: 70, critical: 90 }[tier];
  return {
    schemaVersion: "2.0.0", id, kind, rev: 0,
    state, stateSince: "2026-07-17T00:00:00Z", deps: [],
    risk: { score, tier, factors: [] },
    attempts: { convert: 0, repair: 0 },
    budget: { maxConvertAttempts: 3, maxRepairAttempts: 5, tokenCap: 200000, tokensSpent: 0 },
    artifacts: {},
  };
}

// Mutable clock so a granted lease can age past its TTL within a test.
const TTL = 1000;
function harness(runRequest = {}) {
  let t = 1_700_000_000_000;
  const orch = new Orchestrator(freshWorkspace(), {
    registry: new CheckRegistry(), now: () => t, leaseTtlMs: TTL, runRequest,
  });
  return { orch, advance: (ms) => { t += ms; } };
}

test("reaper voids an expired lease on a resting-state unit without moving its state", () => {
  const { orch, advance } = harness();
  orch.createUnit(unitIn("unit:component:passing", "PASSING")); // critic claims, no transition
  const claim = orch.unitClaim("critic");
  assert.ok(claim.leaseId);
  assert.equal(orch.unitGet("unit:component:passing").record.state, "PASSING");

  advance(TTL + 1);
  const r = orch.reapLeases();
  assert.equal(r.reaped.length, 1);
  assert.equal(r.reaped[0].unitId, "unit:component:passing");
  assert.equal(r.reaped[0].from, "PASSING");
  assert.equal(r.reaped[0].to, "PASSING"); // resting => no rollback

  const rec = orch.unitGet("unit:component:passing").record;
  assert.equal(rec.assignee, undefined); // returned to the pool
  assert.equal(rec.state, "PASSING");
  assert.ok(rec.rev > claim.rev); // rev bumped: the abandoned lease is voided

  const ev = orch.ledgerQuery({ unitId: "unit:component:passing", type: "lease-expired" });
  assert.equal(ev.events.length, 1);
});

test("reaper rolls a transient work state back to its pre-claim resting state and re-dispatches", () => {
  const { orch, advance } = harness();
  orch.createUnit(unitIn("unit:component:ready", "READY"));
  const claim = orch.unitClaim("converter"); // T3: READY -> CONVERTING
  assert.equal(orch.unitGet("unit:component:ready").record.state, "CONVERTING");
  assert.equal(orch.unitGet("unit:component:ready").record.attempts.convert, 1);

  advance(TTL + 1);
  const r = orch.reapLeases();
  assert.equal(r.reaped[0].from, "CONVERTING");
  assert.equal(r.reaped[0].to, "READY"); // rolled back so a converter can re-claim

  const rec = orch.unitGet("unit:component:ready").record;
  assert.equal(rec.state, "READY");
  assert.equal(rec.assignee, undefined);

  // A rollback emits a transition event so the ledger explains the state change.
  const t = orch.ledgerQuery({ unitId: "unit:component:ready", type: "transition" });
  assert.ok(t.events.some((e) => e.from === "CONVERTING" && e.to === "READY"));

  // Re-claimable — and the fresh claim spends another attempt (abandoned work
  // is not refunded; push toward escalation is intentional).
  const reclaim = orch.unitClaim("converter");
  assert.equal(reclaim.unitId, "unit:component:ready");
  assert.notEqual(reclaim.leaseId, claim.leaseId);
  assert.equal(orch.unitGet("unit:component:ready").record.attempts.convert, 2);
});

test("reaper leaves a still-live lease untouched", () => {
  const { orch, advance } = harness();
  orch.createUnit(unitIn("unit:component:ready", "READY"));
  const claim = orch.unitClaim("converter");

  advance(TTL - 1); // not yet expired
  const r = orch.reapLeases();
  assert.equal(r.reaped.length, 0);
  const rec = orch.unitGet("unit:component:ready").record;
  assert.equal(rec.state, "CONVERTING");
  assert.equal(rec.assignee.leaseId, claim.leaseId);
});

test("reaper sweeps only expired leases and skips unassigned units", () => {
  const { orch, advance } = harness();
  orch.createUnit(unitIn("unit:component:a", "READY"));
  orch.createUnit(unitIn("unit:component:b", "WIRED"));   // verifier: T6 -> VERIFYING
  orch.createUnit(unitIn("unit:component:c", "READY"));   // never claimed => no assignee
  orch.unitClaim("converter"); // claims a (plan-earliest / id tiebreak)
  advance(TTL + 1);
  orch.unitClaim("verifier");  // claims b, fresh lease (still live at reap time)

  const r = orch.reapLeases();
  const ids = r.reaped.map((x) => x.unitId);
  assert.deepEqual(ids, ["unit:component:a"]); // only the aged one
  assert.equal(orch.unitGet("unit:component:b").record.state, "VERIFYING"); // live
  assert.equal(orch.unitGet("unit:component:c").record.assignee, undefined);
});
