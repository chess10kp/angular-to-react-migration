// Scheduler refinements (ORCHESTRATOR.md §10): prefer finishing in-flight units,
// risk-adjusted priority, and per-phase WIP limits — layered onto the existing
// plan-earliest claim. Exercises the tool surface (unitClaim) plus the pure
// policy helpers in planner.mjs directly.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Orchestrator } from "../src/orchestrator.mjs";
import { CheckRegistry } from "../src/gates.mjs";
import {
  phaseOf, wipByPhase, occupiesWip, schedulerComparator,
} from "../src/planner.mjs";

const clock = 1_700_000_000_000;
const now = () => clock;

function freshWorkspace() {
  const ws = mkdtempSync(join(tmpdir(), "mx-sched-"));
  mkdirSync(join(ws, "migration", "evidence"), { recursive: true });
  return ws;
}

// A unit in an arbitrary state/tier — state is set directly at creation (the
// scheduler reads the materialized record; state is not writable post-hoc).
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

const orchestrator = (ws, runRequest = {}) =>
  new Orchestrator(ws, { registry: new CheckRegistry(), now, runRequest });

// ---- pure policy helpers ----------------------------------------------------

test("phaseOf maps every lifecycle state to a pipeline phase", () => {
  assert.equal(phaseOf("READY"), "convert");
  assert.equal(phaseOf("REPAIRING"), "verify");
  assert.equal(phaseOf("INTEGRATED"), "integrate");
  assert.equal(phaseOf("ACCEPTED"), "decommission");
  assert.equal(phaseOf("ESCALATED"), "terminal");
});

test("occupiesWip: transient work states and live leases consume WIP; resting states do not", () => {
  assert.equal(occupiesWip({ state: "CONVERTING" }, false), true);  // transient work
  assert.equal(occupiesWip({ state: "READY" }, false), false);      // resting / queued
  assert.equal(occupiesWip({ state: "READY" }, true), true);        // leased => active
});

test("wipByPhase tallies live work per phase", () => {
  const units = [
    unitIn("a", "CONVERTING"), unitIn("b", "BUILT"),   // convert: 1 active (BUILT rests)
    unitIn("c", "VERIFYING"), unitIn("d", "REPAIRING"), // verify: 2
    unitIn("e", "READY"),                               // convert: resting, not counted
  ];
  const wip = wipByPhase(units, () => false);
  assert.deepEqual(wip, { convert: 1, verify: 2 });
});

test("schedulerComparator prefers in-flight over earlier plan wave", () => {
  const rank = new Map([["fresh", [0, 0]], ["inflight", [3, 0]]]);
  const cmp = schedulerComparator(rank, 1);
  const fresh = unitIn("fresh", "AUDITED");        // wave 0 but earlier lifecycle
  const inflight = unitIn("inflight", "INTEGRATED"); // wave 3 but further along
  assert.ok(cmp(inflight, fresh) < 0, "further-along unit sorts first");
});

// ---- via the orchestrator tool surface --------------------------------------

test("prefer-in-flight: integrator claims the further-along unit first", () => {
  const orch = orchestrator(freshWorkspace());
  orch.createUnit(unitIn("unit:component:audited", "AUDITED"));
  orch.createUnit(unitIn("unit:component:integrated", "INTEGRATED"));
  // integrator may claim AUDITED or INTEGRATED; INTEGRATED is closer to done.
  const c = orch.unitClaim("integrator");
  assert.equal(c.unitId, "unit:component:integrated");
});

test("risk-adjusted priority: converter claims the riskier ready unit first", () => {
  const orch = orchestrator(freshWorkspace());
  orch.createUnit(unitIn("unit:component:low", "READY", { tier: "low" }));
  orch.createUnit(unitIn("unit:component:high", "READY", { tier: "high" }));
  const c = orch.unitClaim("converter"); // no plan => risk breaks the tie
  assert.equal(c.unitId, "unit:component:high");
  assert.equal(c.state, "CONVERTING");
});

test("wipLimits: a full phase caps new claims and reports backpressure", () => {
  const orch = orchestrator(freshWorkspace(), { budgets: { wipLimits: { convert: 1 } } });
  orch.createUnit(unitIn("unit:component:busy", "CONVERTING")); // 1 active in the convert phase
  orch.createUnit(unitIn("unit:component:ready", "READY"));      // would become the 2nd
  const c = orch.unitClaim("converter");
  assert.equal(c.empty, true);
  assert.equal(c.wipCapped, "convert");
  assert.equal(orch.unitGet("unit:component:ready").record.state, "READY"); // untouched
});

test("wipLimits: headroom in the phase still allows the claim", () => {
  const orch = orchestrator(freshWorkspace(), { budgets: { wipLimits: { convert: 2 } } });
  orch.createUnit(unitIn("unit:component:busy", "CONVERTING")); // 1 of 2
  orch.createUnit(unitIn("unit:component:ready", "READY"));
  const c = orch.unitClaim("converter");
  assert.equal(c.unitId, "unit:component:ready");
  assert.equal(c.state, "CONVERTING");
});

test("no eligible unit for a role returns a bare empty (not WIP backpressure)", () => {
  const orch = orchestrator(freshWorkspace(), { budgets: { wipLimits: { convert: 1 } } });
  orch.createUnit(unitIn("unit:component:busy", "CONVERTING"));
  const c = orch.unitClaim("converter"); // nothing in READY at all
  assert.equal(c.empty, true);
  assert.equal(c.wipCapped, undefined);
});
