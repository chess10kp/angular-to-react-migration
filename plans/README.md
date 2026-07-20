# AngularJS → React Migration Harness — Implementation Plans

A complete, self-calibrating design for an agentic harness that migrates AngularJS 1.x apps to
React, written to be executed by a custom orchestrator driving weaker/cheaper LLM agents.
These documents ARE the deliverable: structured prompts, state schemas, tool contracts, and
phase playbooks precise enough that agent capability is spent on code, not on interpretation.

Companion: `../REPORT.md` (the research report this design builds on). This plan adopts the
report's core thesis — execution-grounded migration with an executable twin, Behavior IR, and
counterexample-guided repair — and extends it with the operational machinery the report leaves
open: an evidence-gated state machine, tool contracts, context-pack discipline, budgets and
anti-loop rules, oracle calibration, drift handling, and an economics layer. Where 2026
tooling facts in the report were stale or wrong, these plans supersede it (verified July
2026): notably, the interop seam is `@r2wc/react-to-web-component` + AngularJS `ng-prop-*`/
`ng-on-*` (NOT react2angular/angular2react, both dead upstream), and zero-touch legacy
instrumentation uses the official `NG_DEFER_BOOTSTRAP!`/`resumeBootstrap` mechanism.

## Reading order

| Doc | What it specifies |
|---|---|
| `00-ARCHITECTURE.md` | Theory of the system, design principles P1–P10, phase map, workspace layout, glossary |
| `01-STATE-AND-ARTIFACTS.md` | The unit state machine (18 states, 21 transitions, 8 gates), ledger, artifact catalog, context packs, ratchets |
| `02-TOOL-CONTRACTS.md` | The tool surface the orchestrator must implement, permission matrix, orchestrator-internal duties |
| `03-AGENT-ROLES.md` | 16 role cards with hard rules and escalation triggers |
| `phases/P0…P7` | Step-by-step playbooks per phase, with probe commands, decision tables, and gate mechanics |
| `prompts/` | Instantiable prompt templates for converter, scenario-author, counterexample-analyst, critic |
| `schemas/` | JSON Schemas for every shared artifact (units, Behavior IR, traces, counterexamples, recipes, charter, ledger, waivers, packs, inventory) |
| `EXTENSIONS-OOB.md` | Ten out-of-distribution extensions beyond the report (session-replay mining, dark-launch dual rendering, N-version cross-check, perf-parity budgets, twin fuzzing, …) |
| `RISKS-AND-FAILURE-MODES.md` | Calibrated expectations from published systems + 15 failure modes with built-in defenses |

## The design in one diagram

```
           understand                 build the oracle              prepare                factory (per unit)                land
  ┌──────────────────────┐   ┌──────────────────────────┐   ┌─────────────────┐   ┌────────────────────────────────┐   ┌─────────────┐
  │ P0 charter           │   │ P2 zero-touch tracing    │   │ P4 scaffold +   │   │ P6 convert → wire → verify     │   │ P7 flag on  │
  │ P1 inventory graph,  │──▶│ P3 Behavior IR, green    │──▶│    seams        │──▶│    twins → counterexample →    │──▶│    soak     │
  │    units, risk       │   │    on LEGACY first,      │   │ P5 recipes from │   │    repair (budgeted) → audit   │   │    tombstone│
  │                      │   │    mutation-calibrated   │   │    exemplars    │   │                                │   │             │
  └──────────────────────┘   └──────────────────────────┘   └─────────────────┘   └────────────────────────────────┘   └─────────────┘
        every transition evidence-gated · all state in files · budgets + escalation everywhere · knowledge compounds via recipes/lessons
```

## Non-negotiables (if you cut scope, don't cut these)

1. **Green-on-legacy before conversion (G1).** The single highest-leverage discipline.
2. **Evidence-gated transitions** — the orchestrator re-runs checks; agent claims are not evidence.
3. **Budgets with escalation** — every loop bounded; partial output preserved on escalation.
4. **Context packs** — deterministic, size-capped, audited context assembly.
5. **Test-integrity ratchet** — agents can never delete/weaken tests to get green.

## Evidence base

Design mechanisms are grounded in verified primary sources (July 2026): Google's LLM migration
papers (validation cascade, review-bandwidth throttling, dependency-wave clustering), Airbnb's
Enzyme→RTL run (per-file state machine, error-fed retries, sample-tune-sweep), Slack's
codemod+LLM hybrid (annotated-residue pattern), AWS Transform (job plans, build-fix loop,
error memory, rollback critic), ZoomInfo's Angular→React multi-agent run (planner/worker
split, shared-file state, audit gates), Anthropic's harness guidance (JSON ledgers,
initializer/coder rituals, skills authoring), HeroDevs' AngularJS-specific pipeline economics,
and the AngularJS 1.8.3 docs/source for every instrumentation and interop mechanism.
