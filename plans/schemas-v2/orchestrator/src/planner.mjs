// The planner (ORCHESTRATOR.md §10). Pure, deterministic, framework-neutral:
// given the set of units (the materialized InventoryGraph + each Unit.deps) and
// the RunRequest.strategy, compute the MigrationPlan.waves — dependency-respecting
// execution waves. Nothing here branches on source/target framework.
//
// Ordering policy (§10): dependency layers first (Kahn), then within a layer
// "leaves/services first, shared primitives, then routes" — approximated by a
// stable kind-priority × ascending-risk × id sort so a plan is reproducible.

// Lower = scheduled earlier within a wave. Services/leaves and shared primitives
// convert before the routes that compose them.
// Keyed by unit.schema.json `kind` enum. Services / shared primitives / stores /
// infra are the leaves everything else composes, so they convert first.
const KIND_RANK = {
  service: 0, store: 0, primitive: 0, infra: 0,
  "pipe-like": 1, "directive-like": 2, presentation: 2,
  component: 3, module: 3, route: 4,
};
const RISK_RANK = { low: 0, medium: 1, high: 2, critical: 3 };

const kindRank = (k) => (k in KIND_RANK ? KIND_RANK[k] : 3);
const riskRank = (t) => (t in RISK_RANK ? RISK_RANK[t] : 1);

// Stable intra-wave ordering. Pure comparator over unit records.
function byPolicy(a, b) {
  return (
    kindRank(a.kind) - kindRank(b.kind) ||
    riskRank(a.risk?.tier) - riskRank(b.risk?.tier) ||
    (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  );
}

// Map a unit's declared seam (or the run-request default) onto the plan's
// seam vocabulary. A unit with no seam and no target default is internal.
function seamFor(unit, strategy) {
  const t = unit.seam?.type;
  if (t) return t;
  if (strategy?.defaultSeam) return strategy.defaultSeam; // route-shell | element-bridge
  return "none-internal";
}

/**
 * Compute a MigrationPlan from the unit set.
 * @param {object[]} units  materialized Unit records.
 * @param {object}   opts   { strategy, planId, runId, generatedAt }
 * @returns {object} a MigrationPlan (schema: migration-plan.schema.json).
 */
export function computePlan(units, { strategy = {}, planId, runId, generatedAt } = {}) {
  const byId = new Map(units.map((u) => [u.id, u]));
  // Only deps that point at units *in this plan* constrain sequencing; deps on
  // already-accepted/out-of-scope ids are treated as satisfied (bridged).
  const unmet = new Map(
    units.map((u) => [u.id, (u.deps || []).filter((d) => byId.has(d))]),
  );
  const done = new Set();
  const waves = [];

  let remaining = units.map((u) => u.id);
  while (remaining.length) {
    // A unit is ready for this wave when every in-plan dep is already done.
    const ready = remaining.filter((id) => unmet.get(id).every((d) => done.has(d)));
    if (ready.length === 0) {
      // A dependency cycle among the leftovers — cannot layer them. Emit them as
      // a final wave flagged for human attention rather than looping forever.
      const cyc = remaining.map((id) => byId.get(id)).sort(byPolicy);
      waves.push(buildWave(waves.length, cyc, strategy, byId, "cycle — deps unresolved; needs bridge or human ordering"));
      break;
    }
    const wave = ready.map((id) => byId.get(id)).sort(byPolicy);
    waves.push(buildWave(waves.length, wave, strategy, byId));
    ready.forEach((id) => done.add(id));
    remaining = remaining.filter((id) => !done.has(id));
  }

  return {
    schemaVersion: "2.0.0",
    planId: planId || `plan-${units.length}u-${waves.length}w`,
    ...(runId && { runId }),
    generatedAt: generatedAt || new Date(0).toISOString(),
    orderingPolicy:
      strategy.unitOrdering ||
      "dependency-layered; within a wave: services/leaves first, then shared primitives, then routes; ascending risk",
    waves,
    bridgePlan: buildBridgePlan(units, strategy),
  };
}

function buildWave(waveIndex, unitRecords, strategy, byId, rationale) {
  return {
    waveIndex,
    ...(rationale && { rationale }),
    units: unitRecords.map((u) => ({
      unitId: u.id,
      seam: seamFor(u, strategy),
      ...(u.seam?.flag && { flag: u.seam.flag }),
      // Only surface deps that actually gate this unit (in-plan ones).
      blockedBy: (u.deps || []).filter((d) => byId.has(d)),
      ...(u.recipes?.length && { recipeHints: u.recipes }),
      ...(u.risk?.tier && { riskTier: u.risk.tier }),
    })),
  };
}

// The seams that will exist during coexistence, one per distinct flag, with the
// retire condition. Neutral: retire when the hosting unit reaches ACCEPTED.
function buildBridgePlan(units, strategy) {
  const seen = new Map();
  for (const u of units) {
    const type = u.seam?.type;
    const flag = u.seam?.flag;
    if (!type || type === "none-internal" || !flag || seen.has(flag)) continue;
    seen.set(flag, {
      flag,
      seamType: type,
      ...(strategy.shellDirection && { shellDirection: strategy.shellDirection }),
      retireWhen: `unit ${u.id} ACCEPTED and no live consumers of ${flag}`,
    });
  }
  return [...seen.values()];
}

// A rank index unitId -> [waveIndex, positionInWave] for the scheduler to order
// claimable candidates by plan position. O(units).
export function planRankIndex(plan) {
  const rank = new Map();
  for (const w of plan.waves) {
    w.units.forEach((u, i) => rank.set(u.unitId, [w.waveIndex, i]));
  }
  return rank;
}

// ---- scheduler policy (ORCHESTRATOR.md §10) --------------------------------
// Priority = (RunRequest priority) × (risk-adjusted readiness); prefer finishing
// in-flight units over starting new ones; enforce `budgets.wipLimits` per phase.
// Pure & framework-neutral, same as the planner above — the orchestrator injects
// the clock (lease validity) so nothing here reads time.

// The coarse pipeline stages that `RunRequest.budgets.wipLimits` caps, one per
// lifecycle state (mirrors state-machine.mjs STATES). A phase groups the states a
// unit passes through under one role's stewardship.
export const PHASE_OF = {
  DISCOVERED: "specify", SPECIFIED: "specify",
  READY: "convert", CONVERTING: "convert", BUILT: "convert", WIRED: "convert",
  VERIFYING: "verify", DIVERGENT: "verify", REPAIRING: "verify", PASSING: "verify",
  AUDITED: "integrate", INTEGRATED: "integrate", SOAKING: "integrate",
  ACCEPTED: "decommission",
  TOMBSTONED: "terminal", ESCALATED: "terminal", DEFERRED: "terminal", QUARANTINED: "terminal",
};
export const phaseOf = (state) => PHASE_OF[state] || "terminal";

// Transient states in which a unit is *actively being worked* (a lease is driving
// a gate). A unit in one of these — or holding a live lease — occupies a WIP slot
// in its phase. Resting/handoff states (READY, WIRED, PASSING, AUDITED, …) queue
// for the next role but do not consume WIP.
const WORKING_STATES = new Set(["CONVERTING", "VERIFYING", "REPAIRING"]);

// Does this unit currently hold a WIP slot? `leased` is the orchestrator's verdict
// on lease validity (it owns the clock).
export const occupiesWip = (unit, leased) => leased || WORKING_STATES.has(unit.state);

// Live WIP per phase over the unit set. `isLeased(u) -> bool` is injected so this
// stays clock-free. Returns a plain { phase: count } tally.
export function wipByPhase(units, isLeased) {
  const wip = {};
  for (const u of units) {
    if (!occupiesWip(u, isLeased(u))) continue;
    const p = phaseOf(u.state);
    wip[p] = (wip[p] || 0) + 1;
  }
  return wip;
}

// Lifecycle progress index — later state = closer to done. Drives the
// "prefer finishing in-flight units over starting new ones" rule: among a role's
// claimable candidates, a further-along unit outranks a fresher one.
const LIFECYCLE_ORDER = [
  "DISCOVERED", "SPECIFIED", "READY", "CONVERTING", "BUILT", "WIRED",
  "VERIFYING", "DIVERGENT", "REPAIRING", "PASSING", "AUDITED", "INTEGRATED",
  "SOAKING", "ACCEPTED", "TOMBSTONED",
];
const progressIndex = (s) => LIFECYCLE_ORDER.indexOf(s);

// risk-adjusted readiness: a ready riskier unit scores higher so it is dispatched
// earlier and gets the most repair + soak lead time inside the run's budget.
// low→1 … critical→4. Multiplied by the run-level priority (default 1).
const riskAdjustedPriority = (unit, runPriority = 1) =>
  (runPriority ?? 1) * (riskRank(unit.risk?.tier) + 1);

// Order claimable candidates for dispatch (§10), layered onto the plan-earliest
// base. Precedence, highest first:
//   1. in-flight     — further-along state first (finish before starting new)
//   2. plan wave      — earlier dependency layer first (never violates deps)
//   3. risk-priority  — riskier / higher-priority first  (scheduler override of
//      the planner's intra-wave ascending-risk order, at dispatch time)
//   4. plan position  — intra-wave order from the planner
//   5. id             — stable, deterministic final tiebreak
export function schedulerComparator(rank, runPriority = 1) {
  const pos = (u) => rank?.get(u.id) || [Infinity, 0];
  return (a, b) => {
    const [aw, ap] = pos(a), [bw, bp] = pos(b);
    return (
      progressIndex(b.state) - progressIndex(a.state) ||
      aw - bw ||
      riskAdjustedPriority(b, runPriority) - riskAdjustedPriority(a, runPriority) ||
      ap - bp ||
      (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
    );
  };
}
