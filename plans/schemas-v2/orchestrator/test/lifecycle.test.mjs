// Drives one unit through the full happy-path lifecycle
// DISCOVERED -> ... -> ACCEPTED using the orchestrator tool surface, with
// stub check runners standing in for the framework-specific re-run tooling.
// Also asserts the anti-loop escalation and the "no self-certify" guarantees.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";

import { Orchestrator } from "../src/orchestrator.mjs";
import { CheckRegistry } from "../src/gates.mjs";
import { GATE_CHECKS } from "../src/state-machine.mjs";

// A frozen clock so lease math and timestamps are deterministic.
let clock = 1_700_000_000_000;
const now = () => clock;

function freshWorkspace() {
  const ws = mkdtempSync(join(tmpdir(), "mx-orch-"));
  mkdirSync(join(ws, "migration", "evidence"), { recursive: true });
  return ws;
}

const sha256 = (c) => createHash("sha256").update(c).digest("hex");

// Write an evidence artifact and return an evidence-bundle item pointing at it.
function evidence(ws, rel, content, role) {
  writeFileSync(join(ws, rel), content);
  return { path: rel, sha256: sha256(content), ...(role && { role }) };
}

function bundle(ws, unitId, gate, item) {
  return {
    schemaVersion: "2.0.0",
    bundleId: `eb-${gate}-${Date.now?.() ?? 0}-${Math.floor(clock % 100000)}`,
    unitId,
    gate,
    items: [item],
  };
}

// A registry where every gate check passes — the stand-in for real tsc/lint/etc.
function passingRegistry() {
  const reg = new CheckRegistry();
  const all = new Set([...Object.values(GATE_CHECKS).flat(), "mutation-kill-rate"]);
  for (const name of all) reg.register(name, () => ({ passed: true, exitCode: 0 }));
  return reg;
}

function newUnit(id) {
  return {
    schemaVersion: "2.0.0", id, kind: "component", rev: 0,
    state: "DISCOVERED", stateSince: "2026-07-17T00:00:00Z", deps: [],
    risk: { score: 20, tier: "low", factors: [] },
    attempts: { convert: 0, repair: 0 },
    budget: { maxConvertAttempts: 3, maxRepairAttempts: 5, tokenCap: 200000, tokensSpent: 0 },
    artifacts: {},
  };
}

test("full happy-path lifecycle DISCOVERED -> ACCEPTED", () => {
  const ws = freshWorkspace();
  const orch = new Orchestrator(ws, { registry: passingRegistry(), now });
  const id = "unit:component:invoiceTable";

  assert.ok(orch.createUnit(newUnit(id)).ok);

  // G1: scenario-author claims DISCOVERED (lease only), submits, hands off.
  let c = orch.unitClaim("scenario-author");
  assert.equal(c.unitId, id);
  let r = orch.submitGate(id, "G1", bundle(ws, id, "G1", evidence(ws, "migration/evidence/g1.json", "scen", "parity-report")), c.leaseId);
  assert.equal(r.passed, true);
  assert.equal(r.newState, "SPECIFIED");
  assert.ok(orch.release(id, c.leaseId).ok);

  // T2 automatic: SPECIFIED -> READY (no deps).
  assert.equal(orch.computeReady(id).state, "READY");

  // G2: converter claims READY (-> CONVERTING), builds.
  c = orch.unitClaim("converter");
  assert.equal(c.state, "CONVERTING");
  r = orch.submitGate(id, "G2", bundle(ws, id, "G2", evidence(ws, "migration/evidence/g2.log", "build", "build-log")), c.leaseId);
  assert.equal(r.newState, "BUILT");

  // G3: same converter lease continues to wire the seam.
  r = orch.submitGate(id, "G3", bundle(ws, id, "G3", evidence(ws, "migration/evidence/g3.json", "mount", "seam-mount-report")), c.leaseId);
  assert.equal(r.newState, "WIRED");
  assert.ok(orch.release(id, c.leaseId).ok);

  // G4: verifier claims WIRED (-> VERIFYING), proves parity.
  c = orch.unitClaim("verifier");
  assert.equal(c.state, "VERIFYING");
  r = orch.submitGate(id, "G4", bundle(ws, id, "G4", evidence(ws, "migration/evidence/g4.json", "trace", "trace-diff")), c.leaseId);
  assert.equal(r.newState, "PASSING");
  assert.ok(orch.release(id, c.leaseId).ok);

  // G5 critic, G6 integrator, G7 accept.
  c = orch.unitClaim("critic");
  r = orch.submitGate(id, "G5", bundle(ws, id, "G5", evidence(ws, "migration/evidence/g5.json", "verdict", "critic-verdict")), c.leaseId);
  assert.equal(r.newState, "AUDITED");
  orch.release(id, c.leaseId);

  c = orch.unitClaim("integrator");
  r = orch.submitGate(id, "G6", bundle(ws, id, "G6", evidence(ws, "migration/evidence/g6.json", "smoke", "smoke-report")), c.leaseId);
  assert.equal(r.newState, "INTEGRATED");
  // integrator continues (fromStates includes INTEGRATED) to accept low-risk unit (T15).
  r = orch.submitGate(id, "G7", bundle(ws, id, "G7", evidence(ws, "migration/evidence/g7.json", "soak", "soak-report")), c.leaseId);
  assert.equal(r.newState, "ACCEPTED");

  // The ledger recorded a transition for every gate.
  const transitions = orch.ledgerQuery({ unitId: id, type: "transition" }).events;
  assert.deepEqual(transitions.map((e) => e.to),
    ["SPECIFIED", "READY", "CONVERTING", "BUILT", "WIRED", "VERIFYING", "PASSING", "AUDITED", "INTEGRATED", "ACCEPTED"]);
});

test("state is never writable via unit.update", () => {
  const ws = freshWorkspace();
  const orch = new Orchestrator(ws, { registry: passingRegistry(), now });
  const id = "unit:service:x";
  orch.createUnit(newUnit(id));
  const res = orch.unitUpdate(id, { state: "ACCEPTED" }, 0);
  assert.equal(res.ok, false);
  assert.equal(res.error.code, "FORBIDDEN");
  assert.equal(orch.unitGet(id).record.state, "DISCOVERED");
});

test("optimistic concurrency rejects a stale rev", () => {
  const ws = freshWorkspace();
  const orch = new Orchestrator(ws, { registry: passingRegistry(), now });
  const id = "unit:service:y";
  orch.createUnit(newUnit(id));
  assert.ok(orch.unitUpdate(id, { notes: "a" }, 0).ok);       // rev 0 -> 1
  const stale = orch.unitUpdate(id, { notes: "b" }, 0);        // still using rev 0
  assert.equal(stale.error.code, "CONFLICT");
});

test("gate fails when a required check has no runner (no self-certify)", () => {
  const ws = freshWorkspace();
  const empty = new CheckRegistry(); // registers nothing
  const orch = new Orchestrator(ws, { registry: empty, now });
  const id = "unit:component:z";
  orch.createUnit(newUnit(id));
  const c = orch.unitClaim("scenario-author");
  const r = orch.submitGate(id, "G1", bundle(ws, id, "G1", evidence(ws, "migration/evidence/z.json", "x")), c.leaseId);
  assert.equal(r.passed, false);
  assert.equal(orch.unitGet(id).record.state, "DISCOVERED"); // no advance
});

test("anti-loop: hitting maxConvertAttempts escalates the unit", () => {
  const ws = freshWorkspace();
  // A registry where tsc always fails -> every G2 fails.
  const reg = passingRegistry();
  reg.register("tsc", () => ({ passed: false, detail: "type error" }));
  const orch = new Orchestrator(ws, { registry: reg, now });
  const id = "unit:component:flaky";
  const u = newUnit(id);
  u.budget.maxConvertAttempts = 2;
  orch.createUnit(u);

  // advance to READY then claim as converter (-> CONVERTING, attempt 1).
  let c = orch.unitClaim("scenario-author");
  orch.submitGate(id, "G1", bundle(ws, id, "G1", evidence(ws, "migration/evidence/f1.json", "s", "parity-report")), c.leaseId);
  orch.release(id, c.leaseId);
  orch.computeReady(id);
  c = orch.unitClaim("converter"); // attempts.convert = 1
  assert.equal(orch.unitGet(id).record.attempts.convert, 1);

  // First G2 fail -> attempt 2 == cap -> escalate.
  const r = orch.submitGate(id, "G2", bundle(ws, id, "G2", evidence(ws, "migration/evidence/f2.log", "b", "build-log")), c.leaseId);
  assert.equal(r.passed, false);
  assert.equal(r.escalated, true);
  assert.equal(orch.unitGet(id).record.state, "ESCALATED");
});
