// Planner (§10) + plan-ordered scheduling: waves respect deps, intra-wave order
// follows the services/leaves-first policy, cycles are surfaced not looped, and
// unitClaim picks the plan-earliest eligible unit.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { computePlan, planRankIndex } from "../src/planner.mjs";
import { Orchestrator } from "../src/orchestrator.mjs";
import { CheckRegistry } from "../src/gates.mjs";
import { validate } from "../src/schema.mjs";

const now = () => 1_700_000_000_000;

function unit(id, { kind = "component", deps = [], tier = "low", seam } = {}) {
  return {
    schemaVersion: "2.0.0", id, kind, rev: 0, state: "DISCOVERED",
    stateSince: "2026-07-17T00:00:00Z", deps,
    risk: { score: 10, tier, factors: [] },
    attempts: { convert: 0, repair: 0 },
    budget: { maxConvertAttempts: 3, maxRepairAttempts: 5, tokenCap: 1e5, tokensSpent: 0 },
    artifacts: {}, ...(seam && { seam }),
  };
}

test("waves are dependency-layered and schema-valid", () => {
  // svc (leaf) <- table <- page ; and an independent pipe.
  const units = [
    unit("unit:route:page", { kind: "route", deps: ["unit:component:table"] }),
    unit("unit:component:table", { kind: "component", deps: ["unit:service:svc"] }),
    unit("unit:service:svc", { kind: "service" }),
    unit("unit:pipe-like:money", { kind: "pipe-like" }),
  ];
  const plan = computePlan(units, { strategy: { defaultSeam: "route-shell" } });
  assert.ok(validate("migration-plan", plan).ok, validate("migration-plan", plan).errors);

  const waveOf = new Map();
  plan.waves.forEach((w) => w.units.forEach((u) => waveOf.set(u.unitId, w.waveIndex)));
  // deps land in strictly-earlier waves.
  assert.ok(waveOf.get("unit:service:svc") < waveOf.get("unit:component:table"));
  assert.ok(waveOf.get("unit:component:table") < waveOf.get("unit:route:page"));
  // wave 0 holds both leaves (service + independent pipe).
  assert.deepEqual(new Set(plan.waves[0].units.map((u) => u.unitId)),
    new Set(["unit:service:svc", "unit:pipe-like:money"]));
  // blockedBy is carried through.
  const page = plan.waves.at(-1).units.find((u) => u.unitId === "unit:route:page");
  assert.deepEqual(page.blockedBy, ["unit:component:table"]);
});

test("intra-wave order is services/leaves before components before routes", () => {
  const units = [
    unit("unit:route:a", { kind: "route" }),
    unit("unit:component:b", { kind: "component" }),
    unit("unit:service:c", { kind: "service" }),
  ];
  const plan = computePlan(units);
  assert.equal(plan.waves.length, 1);
  assert.deepEqual(plan.waves[0].units.map((u) => u.unitId),
    ["unit:service:c", "unit:component:b", "unit:route:a"]);
});

test("a dependency cycle is surfaced as a flagged final wave, not an infinite loop", () => {
  const units = [
    unit("unit:component:x", { deps: ["unit:component:y"] }),
    unit("unit:component:y", { deps: ["unit:component:x"] }),
  ];
  const plan = computePlan(units);
  const last = plan.waves.at(-1);
  assert.match(last.rationale || "", /cycle/);
  assert.equal(last.units.length, 2);
});

test("scheduler claims the plan-earliest eligible unit", () => {
  const ws = mkdtempSync(join(tmpdir(), "mx-plan-"));
  mkdirSync(join(ws, "migration"), { recursive: true });
  const orch = new Orchestrator(ws, { registry: new CheckRegistry(), now });

  // Discover two independent units; svc should schedule before the route.
  orch.createUnit(unit("unit:route:z", { kind: "route" }));
  orch.createUnit(unit("unit:service:a", { kind: "service" }));
  assert.ok(orch.plan().ok);

  const rank = planRankIndex(orch.store.readJson("migration/plan.json"));
  assert.ok(rank.get("unit:service:a")[1] < rank.get("unit:route:z")[1]); // same wave, svc first

  // scenario-author claims from DISCOVERED — should get the service, not the route.
  const c = orch.unitClaim("scenario-author");
  assert.equal(c.unitId, "unit:service:a");
});
