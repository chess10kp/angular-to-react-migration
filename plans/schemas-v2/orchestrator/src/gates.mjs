// Gate authority (ORCHESTRATOR.md §4). The orchestrator — never the agent —
// decides whether a gate passes:
//   1. schema-validate the EvidenceBundle
//   2. verify every item's sha256 against disk
//   3. RE-RUN the required mechanical checks itself and write authoritative
//      checks[]. Agent-supplied EvidenceBundle.checks[] are ignored.
//
// The re-run is delegated to a CheckRegistry: a map from neutral check name to a
// runner fn(ctx) -> {passed, detail?, exitCode?}. Real deployments register
// framework-specific runners resolved from RunRequest.target's adapter
// (e.g. angular2plus -> tsc/eslint/vitest). A required check with no registered
// runner FAILS ("no-runner") — the harness cannot certify what it cannot run.

import { validate } from "./schema.mjs";
import { requiredChecks } from "./state-machine.mjs";

export class CheckRegistry {
  constructor() { this.runners = new Map(); }
  register(name, fn) { this.runners.set(name, fn); return this; }
  has(name) { return this.runners.has(name); }
  run(name, ctx) {
    const fn = this.runners.get(name);
    if (!fn) return { name, passed: false, detail: "no-runner registered for this check" };
    const r = fn(ctx);
    return { name, passed: !!r.passed, detail: r.detail, exitCode: r.exitCode };
  }
}

// Validate a gate submission. Returns authoritative result — does not mutate state.
export function runGate({ gate, bundle, unit, store, registry }) {
  // 1. schema-validate the bundle
  const v = validate("evidence-bundle", bundle);
  if (!v.ok) {
    return { passed: false, checks: [], failures: [{ reason: "bundle-invalid", detail: v.errors }] };
  }

  // 2. verify content-addressed items
  const failures = [];
  for (const item of bundle.items) {
    const res = store.verifyEvidence(item);
    if (!res.ok) failures.push({ reason: `evidence-${res.reason}`, path: item.path });
  }
  for (const c of bundle.checks || []) {
    if (c.artifact) {
      const res = store.verifyEvidence(c.artifact);
      if (!res.ok) failures.push({ reason: `evidence-${res.reason}`, path: c.artifact.path });
    }
  }
  if (failures.length) return { passed: false, checks: [], failures };

  // 3. re-run required checks (authoritative)
  const needed = requiredChecks(gate, unit.risk?.tier);
  const ctx = { gate, bundle, unit, store };
  const checks = needed.map((name) => registry.run(name, ctx));
  const failed = checks.filter((c) => !c.passed);

  return {
    passed: failed.length === 0,
    checks,
    failures: failed.map((c) => ({ reason: "check-failed", check: c.name, detail: c.detail })),
  };
}
