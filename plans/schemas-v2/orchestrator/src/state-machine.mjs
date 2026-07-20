// The unit state machine — pure data + pure functions, transcribed from
// ORCHESTRATOR.md §3.2 (transition table) and §4 (gate check matrix).
// Framework-neutral: nothing here branches on source/target framework.

// §3.1 — the 18 legal Unit.state values (mirrors unit.schema.json state enum).
export const STATES = [
  "DISCOVERED", "SPECIFIED", "READY", "CONVERTING", "BUILT", "WIRED",
  "VERIFYING", "DIVERGENT", "REPAIRING", "PASSING", "AUDITED", "INTEGRATED",
  "SOAKING", "ACCEPTED", "TOMBSTONED", "ESCALATED", "DEFERRED", "QUARANTINED",
];

// §3.2 — the legal transitions. `gate` is null for orchestrator-automatic /
// evidence-free moves. `from: "*"` matches any current state (T17/T19/T21).
// `id` is the T-number in the spec. `by` is the role that drives it (doc only).
export const TRANSITIONS = [
  { id: "T1",  from: "DISCOVERED", to: "SPECIFIED",   gate: "G1", by: "scenario-author" },
  { id: "T2",  from: "SPECIFIED",  to: "READY",       gate: null, by: "orchestrator", auto: true },
  { id: "T3",  from: "READY",      to: "CONVERTING",  gate: null, by: "orchestrator", claim: true },
  { id: "T4",  from: "CONVERTING", to: "BUILT",       gate: "G2", by: "converter" },
  { id: "T5",  from: "BUILT",      to: "WIRED",       gate: "G3", by: "converter" },
  { id: "T6",  from: "WIRED",      to: "VERIFYING",   gate: null, by: "orchestrator", claim: true },
  { id: "T7",  from: "VERIFYING",  to: "PASSING",     gate: "G4", by: "verifier" },
  { id: "T8",  from: "VERIFYING",  to: "DIVERGENT",   gate: null, by: "verifier" },
  { id: "T9",  from: "DIVERGENT",  to: "REPAIRING",   gate: null, by: "orchestrator", claim: true },
  { id: "T10", from: "REPAIRING",  to: "BUILT",       gate: "G2", by: "repairer" },
  { id: "T11", from: "PASSING",    to: "AUDITED",     gate: "G5", by: "critic" },
  { id: "T12", from: "AUDITED",    to: "INTEGRATED",  gate: "G6", by: "integrator" },
  { id: "T13", from: "INTEGRATED", to: "SOAKING",     gate: null, by: "integrator" },
  { id: "T14", from: "SOAKING",    to: "ACCEPTED",    gate: "G7", by: "orchestrator" },
  { id: "T15", from: "INTEGRATED", to: "ACCEPTED",    gate: "G7", by: "orchestrator" },
  { id: "T16", from: "ACCEPTED",   to: "TOMBSTONED",  gate: "G8", by: "decommissioner" },
  { id: "T17", from: "*",          to: "ESCALATED",   gate: null, by: "orchestrator", auto: true },
  { id: "T18", from: "ESCALATED",  to: "READY",       gate: null, by: "human", decision: "escalation-resolution" },
  { id: "T19a", from: "*",         to: "DEFERRED",    gate: null, by: "human", decision: "deferral" },
  { id: "T19b", from: "*",         to: "QUARANTINED", gate: null, by: "human", decision: "quarantine" },
  { id: "T20", from: "SOAKING",    to: "DIVERGENT",   gate: null, by: "verifier" },
  // T21 (drift-invalidation) resets to SPECIFIED⁻; modeled as an explicit reset, not a gate.
  { id: "T21", from: "*",          to: "SPECIFIED",   gate: null, by: "drift-sentinel", drift: true },
];

// §4 — required re-run check names per gate. The orchestrator (not the agent)
// must confirm all of these pass before a gate transition commits.
export const GATE_CHECKS = {
  G1: ["scenario-source-green"],                 // + mutation-kill when high/critical (added dynamically)
  G2: ["tsc", "lint", "unit-tests", "story-smoke", "artifacts-exist"],
  G3: ["seam-off-unchanged", "seam-on-mounts", "console-errors-zero"],
  G4: ["all-scenarios-replayed", "trace-diff-empty", "console-errors-zero"],
  G5: ["critic-verdict-approve"],
  G6: ["flag-flipped", "full-app-smoke", "ratchets-updated"],
  G7: ["soak-window-elapsed", "error-budget-ok", "no-shadow-counterexamples"],
  G8: ["static-usage-zero", "runtime-usage-zero"],
};

// The resting state each claim-transition (T3/T6/T9) moved a unit *out of*,
// keyed by the transient work state it moved *into*. The lease reaper (§6.1)
// uses this to return an abandoned in-flight unit to the pool in a state a role
// can re-claim — nothing claims work from CONVERTING/VERIFYING/REPAIRING.
export const CLAIM_ORIGIN = Object.fromEntries(
  TRANSITIONS.filter((t) => t.claim).map((t) => [t.to, t.from]),
);

// Which gate a submitGate(gate) call maps to a transition from `fromState`.
// A gate can appear on >1 transition (G2 on T4 and T10; G7 on T14 and T15),
// so we disambiguate by the unit's current state.
export function transitionForGate(fromState, gate) {
  return TRANSITIONS.find((t) => t.gate === gate && t.from === fromState) || null;
}

// Is a non-gate transition (from → to) legal? Used for automatic/claim/decision moves.
export function isLegalMove(fromState, toState) {
  return TRANSITIONS.some(
    (t) => t.to === toState && (t.from === fromState || t.from === "*"),
  );
}

// Required checks for a gate, given the unit's risk tier (adds the G1 kill-rate
// check for high/critical units — §3.2 T1).
export function requiredChecks(gate, riskTier) {
  const base = GATE_CHECKS[gate] ? [...GATE_CHECKS[gate]] : [];
  if (gate === "G1" && (riskTier === "high" || riskTier === "critical")) {
    base.push("mutation-kill-rate");
  }
  return base;
}
