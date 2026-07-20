// The orchestrator: deterministic code (not an agent) implementing the state
// tools from TOOL-CONTRACTS.md §4 and the gate/lease/anti-loop rules from
// ORCHESTRATOR.md §3-6. Framework-neutral throughout.
//
// Tool results follow the §0 envelope: {ok:true, ...} | {ok:false, error:{code,message,retryable}}.

import { Store } from "./store.mjs";
import { validate } from "./schema.mjs";
import { runGate, CheckRegistry } from "./gates.mjs";
import { transitionForGate, isLegalMove, CLAIM_ORIGIN } from "./state-machine.mjs";
import { computePlan, planRankIndex, phaseOf, wipByPhase, schedulerComparator } from "./planner.mjs";
import { assembleContextPack } from "./context-pack.mjs";

const LEDGER = "migration/ledger.ndjson";
const PLAN = "migration/plan.json";
const DEFAULT_LEASE_TTL_MS = 30 * 60 * 1000; // §1.4 default 30 min

// Which state a role claims work from, and whether the claim itself performs a
// transition (T3/T6/T9) vs. just grants a lease (§6.1). Neutral.
const CLAIM_RULES = {
  "scenario-author": { fromStates: ["DISCOVERED"] },
  converter:         { fromStates: ["READY"],    transitionTo: "CONVERTING", counter: "convert" },
  verifier:          { fromStates: ["WIRED"],     transitionTo: "VERIFYING" },
  repairer:          { fromStates: ["DIVERGENT"], transitionTo: "REPAIRING", counter: "repair" },
  critic:            { fromStates: ["PASSING"] },
  integrator:        { fromStates: ["AUDITED", "INTEGRATED"] },
  decommissioner:    { fromStates: ["ACCEPTED"] },
};

const ok = (extra) => ({ ok: true, ...extra });
const err = (code, message, retryable = false) => ({ ok: false, error: { code, message, retryable } });

export class Orchestrator {
  // `now` is injectable so tests are deterministic.
  constructor(workspaceRoot, { registry, leaseTtlMs = DEFAULT_LEASE_TTL_MS, now = () => Date.now(), runRequest = {} } = {}) {
    this.store = new Store(workspaceRoot);
    this.registry = registry || new CheckRegistry();
    this.leaseTtlMs = leaseTtlMs;
    this.now = now;
    this.runRequest = runRequest; // strategy / budgets / framework params (§8, §10)
    this._seq = this._maxSeq();
    this._leaseCounter = 0;
  }

  _maxSeq() {
    const events = this.store.readNdjson(LEDGER);
    return events.reduce((m, e) => Math.max(m, e.seq || 0), 0);
  }

  // ---- ledger (§5 / TOOL-CONTRACTS §4) --------------------------------------
  ledgerAppend(event) {
    const seq = ++this._seq;
    const full = { seq, ts: new Date(this.now()).toISOString(), ...event };
    const v = validate("run-result", { schemaVersion: "2.0.0", runId: "r", generatedAt: full.ts, unitStateCounts: {}, recentEvents: [full] });
    if (!v.ok) { this._seq--; return err("SCHEMA", `invalid ledger event: ${v.errors}`); }
    this.store.appendNdjson(LEDGER, full);
    return ok({ seq });
  }

  ledgerQuery({ unitId, type, sinceSeq = 0, limit = Infinity } = {}) {
    let events = this.store.readNdjson(LEDGER).filter((e) => e.seq > sinceSeq);
    if (unitId) events = events.filter((e) => e.unitId === unitId);
    if (type) events = events.filter((e) => e.type === type);
    return ok({ events: events.slice(0, limit) });
  }

  // ---- unit CRUD (§4) -------------------------------------------------------
  createUnit(unit) {
    const v = validate("unit", unit);
    if (!v.ok) return err("SCHEMA", v.errors);
    if (this.store.exists(this.store.unitPath(unit.id))) return err("EXISTS", `unit ${unit.id} exists`);
    this.store.writeJson(this.store.unitPath(unit.id), unit);
    this.ledgerAppend({ actor: { role: "inventory-cartographer" }, unitId: unit.id, type: "note", note: "unit created" });
    return ok({ unitId: unit.id, rev: unit.rev });
  }

  unitGet(unitId) {
    const p = this.store.unitPath(unitId);
    if (!this.store.exists(p)) return err("NOT_FOUND", unitId);
    const record = this.store.readJson(p);
    return ok({ record, rev: record.rev });
  }

  // Whitelisted, non-state fields only. `state` is NEVER writable here (§4).
  unitUpdate(unitId, patch, expectedRev) {
    if ("state" in patch) return err("FORBIDDEN", "state is not writable via unit.update; use submitGate", false);
    const g = this.unitGet(unitId);
    if (!g.ok) return g;
    const unit = g.record;
    if (unit.rev !== expectedRev) return err("CONFLICT", `stale rev: have ${unit.rev}, got ${expectedRev}`, true);
    const next = { ...unit, ...patch, rev: unit.rev + 1 };
    const v = validate("unit", next);
    if (!v.ok) return err("SCHEMA", v.errors);
    this.store.writeJson(this.store.unitPath(unitId), next);
    return ok({ rev: next.rev });
  }

  // ---- planner (§10) --------------------------------------------------------
  // Compute MigrationPlan.waves from the current unit set + RunRequest.strategy
  // and persist it. Deterministic; safe to recompute as units are discovered.
  plan() {
    const units = this._allUnits();
    const p = computePlan(units, {
      strategy: this.runRequest.strategy || {},
      runId: this.runRequest.runId,
      generatedAt: new Date(this.now()).toISOString(),
    });
    const v = validate("migration-plan", p);
    if (!v.ok) return err("SCHEMA", v.errors);
    this.store.writeJson(PLAN, p);
    this.ledgerAppend({ actor: { role: "orchestrator" }, type: "note", note: `plan ${p.planId}: ${p.waves.length} waves` });
    return ok({ planId: p.planId, waves: p.waves.length });
  }

  _planRank() {
    if (!this.store.exists(PLAN)) return null;
    return planRankIndex(this.store.readJson(PLAN));
  }

  // ---- leases (§6.1) --------------------------------------------------------
  _leaseValid(unit, leaseId) {
    const a = unit.assignee;
    return a && a.leaseId === leaseId && new Date(a.leaseExpiresAt).getTime() > this.now();
  }

  unitClaim(role, filter = {}) {
    const rule = CLAIM_RULES[role];
    if (!rule) return err("FORBIDDEN", `role ${role} cannot claim`);
    const found = this._findClaimable(rule, filter);
    if (!found) return ok({ empty: true });
    // Eligible work exists but its phase is at `budgets.wipLimits` — surface the
    // backpressure so the caller drains in-flight work instead of starting new.
    if (!found.id) return ok({ empty: true, wipCapped: found.wipCapped });
    const unit = found;

    const leaseId = `lease-${role}-${++this._leaseCounter}`;
    const claimedAt = new Date(this.now()).toISOString();
    const leaseExpiresAt = new Date(this.now() + this.leaseTtlMs).toISOString();
    // `claimedAt` is the fixed wall-clock anchor for §6.3 metering — unlike
    // `leaseExpiresAt` (idle TTL, auto-extended by activity) it never moves, so
    // it bounds *total* time on task regardless of how busy the agent looks.
    let next = { ...unit, assignee: { role, leaseId, claimedAt, leaseExpiresAt }, rev: unit.rev + 1 };

    // Claim-transitions T3/T6/T9 move state as part of the claim.
    if (rule.transitionTo) {
      if (!isLegalMove(unit.state, rule.transitionTo)) return err("ILLEGAL", `claim cannot move ${unit.state}->${rule.transitionTo}`);
      next = this._applyState(next, rule.transitionTo);
      if (rule.counter) next.attempts = { ...next.attempts, [rule.counter]: (next.attempts[rule.counter] || 0) + 1 };
    }
    this.store.writeJson(this.store.unitPath(unit.id), next);
    this.ledgerAppend({ actor: { role }, unitId: unit.id, type: "claim", note: `lease ${leaseId}` });
    if (rule.transitionTo) this._ledgerTransition(role, unit.id, unit.state, next.state, null);

    // §8: hand the claimer its context pack (RunManifest) — the complete context
    // for the task, assembled and audited by the orchestrator, not the agent.
    const pack = this._assemblePack(role, next, rule.counter);
    return ok({ unitId: unit.id, leaseId, leaseExpiresAt, rev: next.rev, state: next.state, ...(pack && { packId: pack.packId, manifest: pack.manifest }) });
  }

  // Assemble + persist a RunManifest for the claimed unit (§8). Returns null for
  // roles that don't consume a context pack. On overflow, routes to a higher tier
  // and emits pack-overflow rather than truncating.
  _assemblePack(role, unit, counter) {
    const retry = counter ? (unit.attempts?.[counter] || 0) > 1 : false;
    const { manifest, overflowed, effectiveTier } = assembleContextPack(role, unit, {
      store: this.store,
      runId: this.runRequest.runId,
      strategy: this.runRequest.strategy || {},
      sourceFramework: this.runRequest.sourceFramework,
      targetFramework: this.runRequest.targetFramework,
      budget: this.runRequest.budgets?.contextPackTokenBudget,
      modelTier: unit.modelTier,
      retry,
      createdAt: new Date(this.now()).toISOString(),
    });
    const v = validate("run-manifest", manifest);
    if (!v.ok) { this.ledgerAppend({ actor: { role: "orchestrator" }, unitId: unit.id, type: "note", note: `pack invalid: ${v.errors}` }); return null; }
    this.store.writeJson(`migration/context-packs/${manifest.packId}.json`, manifest);
    this.ledgerAppend({ actor: { role: "orchestrator" }, unitId: unit.id, type: "note", note: `pack ${manifest.packId} (${manifest.tokenEstimate} tok, tier ${effectiveTier})` });
    if (overflowed) this.ledgerAppend({ actor: { role: "orchestrator" }, unitId: unit.id, type: "pack-overflow", note: `${manifest.tokenEstimate} > ${manifest.budget}; routed to ${effectiveTier}` });
    return { packId: manifest.packId, manifest };
  }

  // Hand off: free the lease so the next role can claim (§6.1).
  release(unitId, leaseId) {
    const g = this.unitGet(unitId);
    if (!g.ok) return g;
    const unit = g.record;
    if (!this._leaseValid(unit, leaseId)) return err("LEASE_INVALID", "not your lease");
    const next = { ...unit, assignee: undefined, rev: unit.rev + 1 };
    this.store.writeJson(this.store.unitPath(unitId), next);
    this.ledgerAppend({ actor: { role: unit.assignee.role }, unitId, type: "release", note: `lease ${leaseId}` });
    return ok({ rev: next.rev });
  }

  // ---- lease reaper (§6.1) --------------------------------------------------
  // Scan every unit for an expired lease (`assignee.leaseExpiresAt < now`); for
  // each, void the assignment and return the unit to the pool so it can be
  // re-dispatched. A unit a claim moved into a transient work state
  // (CONVERTING/VERIFYING/REPAIRING) is rolled back to the resting state it was
  // claimed from — no role claims work from a transient state, so clearing the
  // assignee alone would strand it. Emits `lease-expired` (plus a `transition`
  // event when rolled back). Bumping `rev` is what voids the abandoned agent's
  // work: it can no longer submit under the old lease, nor re-acquire at the
  // now-superseded rev (Principle 4). The convert/repair attempt already
  // consumed at claim time is *not* refunded — an abandoned attempt still spent
  // budget, and a fresh claim increments again, giving natural push toward
  // escalation for units whose agents keep dying. Deterministic; intended to be
  // driven by an orchestrator-internal timer (or called before scheduling).
  // Returns the reaped units.
  reapLeases() {
    const reaped = [];
    for (const unit of this._allUnits()) {
      const a = unit.assignee;
      if (!a) continue;
      if (new Date(a.leaseExpiresAt).getTime() > this.now()) continue; // still live
      const rollbackTo = CLAIM_ORIGIN[unit.state] || null;
      let next = { ...unit, assignee: undefined, rev: unit.rev + 1 };
      if (rollbackTo) next = this._applyState(next, rollbackTo);
      this.store.writeJson(this.store.unitPath(unit.id), next);
      this.ledgerAppend({ actor: { role: "orchestrator" }, unitId: unit.id, type: "lease-expired", note: `lease ${a.leaseId} expired; assignee ${a.role} cleared` });
      if (rollbackTo) this._ledgerTransition("orchestrator", unit.id, unit.state, rollbackTo, null);
      reaped.push({ unitId: unit.id, leaseId: a.leaseId, role: a.role, from: unit.state, to: next.state, rev: next.rev });
    }
    return ok({ reaped });
  }

  // Scheduler (§10). Among the units this role may claim, order by the plan-earliest
  // policy augmented with prefer-in-flight and risk-adjusted priority
  // (planner.schedulerComparator), then honour per-phase `budgets.wipLimits`:
  // skip any candidate whose phase is already at its WIP cap and hand back the
  // best claimable candidate in an uncapped phase. Returns:
  //   a unit record        — claim it
  //   null                 — no eligible unit for this role at all
  //   { wipCapped: phase } — eligible work exists but every candidate is WIP-capped
  _findClaimable(rule, filter) {
    const all = this._allUnits();
    const isLeased = (u) => this._leaseValid(u, u.assignee?.leaseId);
    const candidates = all.filter((u) => {
      if (!rule.fromStates.includes(u.state)) return false;
      if (isLeased(u)) return false; // actively leased
      if (filter.kind && u.kind !== filter.kind) return false;
      if (filter.riskTier && u.risk?.tier !== filter.riskTier) return false;
      return true;
    });
    if (candidates.length === 0) return null;

    candidates.sort(schedulerComparator(this._planRank(), this.runRequest.priority));

    // A claim makes a resting candidate active in its phase, so it must fit under
    // that phase's live WIP count. Walk the ranked list and take the first
    // candidate whose phase has headroom.
    const limits = this.runRequest.budgets?.wipLimits || {};
    const wip = wipByPhase(all, isLeased);
    let capped = null;
    for (const u of candidates) {
      const phase = phaseOf(u.state);
      const limit = limits[phase];
      if (limit != null && (wip[phase] || 0) >= limit) { capped ??= phase; continue; }
      return u;
    }
    return { wipCapped: capped };
  }

  _allUnits() {
    // Scan of the materialized unit view. A real orchestrator keeps an index;
    // for the skeleton we enumerate the ledger's known unit ids.
    const ids = new Set(this.store.readNdjson(LEDGER).map((e) => e.unitId).filter(Boolean));
    return [...ids].map((id) => this.store.readJson(this.store.unitPath(id)));
  }

  // ---- gate authority (§4) --------------------------------------------------
  submitGate(unitId, gate, bundle, leaseId) {
    const g = this.unitGet(unitId);
    if (!g.ok) return g;
    const unit = g.record;
    if (!this._leaseValid(unit, leaseId)) return err("LEASE_INVALID", "no valid lease for this unit", true);

    const t = transitionForGate(unit.state, gate);
    if (!t) return err("ILLEGAL", `${gate} is not valid from state ${unit.state}`);

    const result = runGate({ gate, bundle, unit, store: this.store, registry: this.registry });

    if (result.passed) {
      // Lease persists across a gate pass — a role may drive several gates
      // (e.g. converter: G2 then G3). It is freed by an explicit release().
      const next = this._applyState({ ...unit, rev: unit.rev + 1 }, t.to);
      this.store.writeJson(this.store.unitPath(unitId), next);
      this._ledgerTransition(t.by, unitId, unit.state, next.state, gate, bundle);
      return ok({ passed: true, checks: result.checks, newState: next.state, rev: next.rev });
    }

    // Gate fail: no backward move; count the attempt; escalate on cap breach
    // (§3.3/§6.2 — attempts are metered at their natural point, the failed gate).
    const next = { ...unit, rev: unit.rev + 1 };
    const counter = unit.state === "REPAIRING" ? "repair" : unit.state === "CONVERTING" ? "convert" : null;
    let escalated = false, cap;
    if (counter) {
      next.attempts = { ...next.attempts, [counter]: (next.attempts[counter] || 0) + 1 };
      cap = counter === "repair" ? next.budget?.maxRepairAttempts : next.budget?.maxConvertAttempts;
      if (cap != null && next.attempts[counter] >= cap) escalated = true;
    }
    this.ledgerAppend({ actor: { role: t.by }, unitId, type: "gate-fail", gate, note: JSON.stringify(result.failures) });
    if (escalated) this._escalate(t.by, next, `${counter} attempt cap reached (${next.attempts[counter]}/${cap})`);
    this.store.writeJson(this.store.unitPath(unitId), next);
    return ok({ passed: false, checks: result.checks, failures: result.failures, escalated, newState: next.state, rev: next.rev });
  }

  // ---- budgets + automatic T17 (§6.3) ---------------------------------------
  // Meter token spend against a unit's active lease and enforce the token +
  // wall-clock caps synchronously. The orchestrator calls this as it observes an
  // agent's usage (metering is orchestrator-internal, §7 — not an agent tool).
  // A breach forces automatic T17. Partial output is preserved: we only bump
  // state, never touch the unit's artifacts.
  meterUsage(unitId, { tokens = 0 } = {}, leaseId) {
    const g = this.unitGet(unitId);
    if (!g.ok) return g;
    const unit = g.record;
    if (!this._leaseValid(unit, leaseId)) return err("LEASE_INVALID", "no valid lease for this unit", true);
    const spent = (unit.budget?.tokensSpent || 0) + Math.max(0, tokens);
    const next = { ...unit, rev: unit.rev + 1, budget: { ...unit.budget, tokensSpent: spent } };
    const role = unit.assignee.role;
    if (tokens) this.ledgerAppend({ actor: { role }, unitId, type: "note", note: `metered +${tokens} tok (${spent}/${next.budget.tokenCap})` });
    const breach = this._budgetBreach(next);
    if (breach) this._escalate(role, next, breach);
    this.store.writeJson(this.store.unitPath(unitId), next);
    return ok({ rev: next.rev, tokensSpent: spent, escalated: !!breach, ...(breach && { newState: next.state }) });
  }

  // Timer-driven budget sweep (§6.3) — the analog of reapLeases(). Enforces the
  // budget dimensions that accrue passively (wall-clock elapsed, and token spend
  // as a backstop) on every actively-assigned unit, forcing automatic T17 on
  // breach. Wall-clock has no agent action to hang off, so without this a unit
  // that quietly runs past `wallClockCapMinutes` would never escalate. Intended
  // to be driven by the same orchestrator-internal timer as the reaper.
  sweepBudgets() {
    const escalated = [];
    for (const unit of this._allUnits()) {
      if (!unit.assignee || unit.state === "ESCALATED") continue;
      const breach = this._budgetBreach(unit);
      if (!breach) continue;
      const next = { ...unit, rev: unit.rev + 1 };
      this._escalate(unit.assignee.role, next, breach);
      this.store.writeJson(this.store.unitPath(unit.id), next);
      escalated.push({ unitId: unit.id, from: unit.state, reason: breach, rev: next.rev });
    }
    return ok({ escalated });
  }

  // Agent-initiated escalation (§U3 + T17 "agent emits an escalation event"):
  // the agent deliberately gives up — blocked, out-of-scope, or about to breach —
  // rather than guessing. Not a budget breach, so no `budget-updated` event.
  escalate(unitId, { reason = "agent-initiated" } = {}, leaseId) {
    const g = this.unitGet(unitId);
    if (!g.ok) return g;
    const unit = g.record;
    if (!this._leaseValid(unit, leaseId)) return err("LEASE_INVALID", "no valid lease for this unit", true);
    const next = { ...unit, rev: unit.rev + 1 };
    this._escalate(unit.assignee.role, next, `agent escalation: ${reason}`, false);
    this.store.writeJson(this.store.unitPath(unitId), next);
    return ok({ escalated: true, newState: next.state, rev: next.rev });
  }

  // Token + wall-clock breach for an actively-worked unit (§6.3). Attempts are
  // deliberately NOT checked here: a unit on its last *allowed* attempt is
  // legitimately in flight (convert/repair counters are consumed at claim time),
  // so attempts are enforced only at the failed gate (§6.2), never by a passive
  // sweep — otherwise a live final attempt would be killed the moment it reports.
  _budgetBreach(unit) {
    const b = unit.budget || {};
    if (b.tokenCap != null && (b.tokensSpent || 0) > b.tokenCap)
      return `token cap exceeded (${b.tokensSpent}/${b.tokenCap})`;
    const startedAt = unit.assignee?.claimedAt || unit.stateSince;
    if (b.wallClockCapMinutes != null && startedAt) {
      const mins = (this.now() - new Date(startedAt).getTime()) / 60000;
      if (mins > b.wallClockCapMinutes) return `wall-clock cap exceeded (${Math.round(mins)}/${b.wallClockCapMinutes} min)`;
    }
    return null;
  }

  // Force T17 (any → ESCALATED). Mutates `unit` in place and writes the ledger
  // pair the spec mandates for a budget breach — `budget-updated` then
  // `escalation` (§6.3) — plus the transition event. Caller persists the unit.
  // `budgetUpdate=false` for a voluntary agent escalation, which is not a breach.
  _escalate(role, unit, reason, budgetUpdate = true) {
    const from = unit.state;
    this._applyState(unit, "ESCALATED");
    if (budgetUpdate) this.ledgerAppend({ actor: { role: "orchestrator" }, unitId: unit.id, type: "budget-updated", note: `${reason}; budget ${JSON.stringify(unit.budget)}` });
    this.ledgerAppend({ actor: { role }, unitId: unit.id, type: "escalation", note: reason });
    this._ledgerTransition("orchestrator", unit.id, from, "ESCALATED", null);
  }

  // ---- automatic transitions (T2 etc.) --------------------------------------
  // SPECIFIED -> READY once all deps are INTEGRATED/ACCEPTED (§3.2 T2). Skeleton
  // treats missing/empty deps as satisfied.
  computeReady(unitId) {
    const g = this.unitGet(unitId);
    if (!g.ok) return g;
    const unit = g.record;
    if (unit.state !== "SPECIFIED") return ok({ changed: false, state: unit.state });
    const deps = unit.deps || [];
    const satisfied = deps.every((d) => {
      const dg = this.unitGet(d);
      return dg.ok && ["INTEGRATED", "ACCEPTED"].includes(dg.record.state);
    });
    if (!satisfied) return ok({ changed: false, state: unit.state });
    const next = this._applyState({ ...unit, rev: unit.rev + 1 }, "READY");
    this.store.writeJson(this.store.unitPath(unitId), next);
    this._ledgerTransition("orchestrator", unitId, "SPECIFIED", "READY", null);
    return ok({ changed: true, state: "READY", rev: next.rev });
  }

  // ---- helpers --------------------------------------------------------------
  _applyState(unit, to) {
    unit.state = to;
    unit.stateSince = new Date(this.now()).toISOString();
    return unit;
  }

  _ledgerTransition(role, unitId, from, to, gate, bundle) {
    const event = { actor: { role }, unitId, type: "transition", from, to };
    if (gate) event.gate = gate;
    // Ledger evidence validates against the sealed evidenceRef — cite only the
    // content-addressed fields, not bundle-item extras like `role`.
    if (bundle) event.evidence = bundle.items.map(({ path, sha256, kind, note }) => ({ path, sha256, ...(kind && { kind }), ...(note && { note }) }));
    this.ledgerAppend(event);
  }
}
