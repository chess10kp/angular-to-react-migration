// Context-pack assembly (§8): the RunManifest is schema-valid, content-addressed,
// deterministic (same inputs -> same packId), and overflow routes to a higher
// tier without truncating. Also asserts unitClaim hands the claimer a pack.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { assembleContextPack } from "../src/context-pack.mjs";
import { Store } from "../src/store.mjs";
import { Orchestrator } from "../src/orchestrator.mjs";
import { CheckRegistry } from "../src/gates.mjs";
import { validate } from "../src/schema.mjs";

const now = () => 1_700_000_000_000;

function unit(id, extra = {}) {
  return {
    schemaVersion: "2.0.0", id, kind: "component", rev: 0, state: "READY",
    stateSince: "2026-07-17T00:00:00Z", deps: [],
    risk: { score: 10, tier: "low", factors: [] },
    attempts: { convert: 1, repair: 0 },
    budget: { maxConvertAttempts: 3, maxRepairAttempts: 5, tokenCap: 1e5, tokensSpent: 0 },
    artifacts: {}, ...extra,
  };
}

function freshStore() {
  const ws = mkdtempSync(join(tmpdir(), "mx-pack-"));
  mkdirSync(join(ws, "migration", "units"), { recursive: true });
  const store = new Store(ws);
  return { ws, store };
}

test("manifest is schema-valid, content-addressed, and includes the always-items", () => {
  const { store } = freshStore();
  const u = unit("unit:component:c");
  store.writeJson(store.unitPath(u.id), u);

  const { manifest } = assembleContextPack("converter", u, { store });
  assert.ok(validate("run-manifest", manifest).ok, validate("run-manifest", manifest).errors);

  const kinds = manifest.items.map((i) => i.kind);
  assert.deepEqual(kinds.slice(0, 4), ["role-card", "task-instruction", "conventions", "unit-record"]);
  // packId is the sha256 over the ordered item hashes.
  assert.match(manifest.packId, /^[0-9a-f]{64}$/);
  assert.equal(manifest.tokenEstimate, manifest.items.reduce((n, i) => n + i.tokens, 0));
});

test("assembly is deterministic — same inputs yield the same packId", () => {
  const a = freshStore(), b = freshStore();
  const u = unit("unit:component:d");
  a.store.writeJson(a.store.unitPath(u.id), u);
  b.store.writeJson(b.store.unitPath(u.id), u);
  const p1 = assembleContextPack("converter", u, { store: a.store }).manifest;
  const p2 = assembleContextPack("converter", u, { store: b.store }).manifest;
  assert.equal(p1.packId, p2.packId);
});

test("overflow sets overflowed and routes to a higher tier without dropping items", () => {
  const { store } = freshStore();
  const u = unit("unit:component:big", { modelTier: "cheap" });
  store.writeJson(store.unitPath(u.id), u);

  const { manifest, overflowed, effectiveTier } =
    assembleContextPack("converter", u, { store, budget: 5 }); // tiny budget forces overflow
  assert.equal(overflowed, true);
  assert.equal(manifest.overflowed, true);
  assert.equal(effectiveTier, "standard"); // cheap -> standard
  assert.ok(manifest.items.length >= 4); // nothing truncated
});

test("unitClaim hands the claimer a valid pack and emits a ledger note", () => {
  const ws = mkdtempSync(join(tmpdir(), "mx-claim-"));
  mkdirSync(join(ws, "migration"), { recursive: true });
  const orch = new Orchestrator(ws, {
    registry: new CheckRegistry(), now,
    runRequest: { runId: "r1", budgets: { contextPackTokenBudget: 60000 } },
  });
  orch.createUnit(unit("unit:component:e", { state: "DISCOVERED" }));

  const c = orch.unitClaim("scenario-author");
  assert.ok(c.packId, "claim returns a packId");
  assert.ok(validate("run-manifest", c.manifest).ok);
  assert.equal(c.manifest.unitId, "unit:component:e");
  // the pack was persisted and a note recorded.
  assert.ok(orch.store.exists(`migration/context-packs/${c.packId}.json`));
  const notes = orch.ledgerQuery({ unitId: "unit:component:e", type: "note" }).events;
  assert.ok(notes.some((n) => n.note.includes(c.packId)));
});
