# Migration status (grounded in the repo)

Last updated: 2026-07-21. This doc supersedes earlier summaries that described the harness as
"Slice 1 only" with no evidence layer.

## Long-term target

Per [`PLAN.md`](./PLAN.md) and [`plans/HARNESS-BOUNDARY.md`](./plans/HARNESS-BOUNDARY.md), the
long-term product is a reusable **8-module agentic migration harness** (`harness-core`,
`source-angular`, `target-react`, `profile-onecx`, `model-gateway`, `oracle`,
`recipe-registry`, `operator-control`). Thesis: deterministic codemods do the bulk; agents repair
under evidence gates; humans approve.

## What exists today

### Deterministic codemod harness (`tools/codemod-harness/`)

**Slices 1–9 are implemented and verified on both fixtures** (jHipster ng17 + OneCX shell
reference). See [`tools/codemod-harness/README.md`](./tools/codemod-harness/README.md) for the
full catalog.

| Slice | Scope |
|---|---|
| 1 | Template control-flow → JSX |
| 2 | Component skeleton (`.component.ts` + template → `.tsx`) |
| 3 | Translate service (`jhiTranslate` / `\| translate` → react-i18next) |
| 4 | Services (`@Injectable` → plain TS module) |
| 5 | Universal template layer (`*ngIf`/`*ngFor`, `[ngClass]`, built-in pipes, `[(ngModel)]`) |
| 6 | Router template directives (`routerLink`, `<router-outlet>`, `<ng-container>`) |
| 7 | Lifecycle → `useEffect` (safe shapes only; per-CD hooks stay residue) |
| 8 | DI → React hooks/context (known tokens mapped; app services → `use<Service>()`) |
| 9 | `this.` rewiring (AST-driven splices against the component symbol table) |

The IR seam holds: Angular parsing in one file, Babel emit in one, ts-morph in `parse/`.
Vitest covers unit, golden snapshot, and idempotence. Jac driver (`jac/codemod.jac`) wraps the
Node worker for orchestration.

**Fixture results (latest documented runs):** jHipster 54/54 components, 0 parse failures;
OneCX shell 13/13 components, 12/12 services. Residue is explicit (`MIGRATION_TODO` markers),
counted, and categorized — never silently dropped.

### Operator-driven repair loop (deliberate architecture)

Per [`tools/codemod-harness/docs/migration-system-rationale.md`](./tools/codemod-harness/docs/migration-system-rationale.md)
(2026-07-18 decision record): **Claude Code *is* the agent loop.** The seven standalone
governance modules (`harness-core` orchestrator, `model-gateway`, etc.) were judged over-built
once the operator is a capable in-editor agent. That is a recorded architectural choice, not an
oversight. Operator skill: `.claude/skills/migrate-residue/`.

### Evidence and compounding primitives (type oracle + ledger + recipes)

These are **implemented** in the Jac driver — not aspirational:

| Primitive | Flag / artifact | What it does |
|---|---|---|
| **Type oracle** | `--scaffold[=<dir>]` | Emits a Vite + React + TS project; `tsc --noEmit` gates promotion. Proven: only residue errors, no framework noise. See [`scaffold.md`](./tools/codemod-harness/docs/scaffold.md). |
| **Residue ledger** | `--ledger` → `residue.jsonl` | Stable IDs, 18 categories, `priority`, `deps`, resumable `status`. See `jac/README.md`. |
| **Recipe store** | `--recipes` / `--learn` | Anti-unification, replay across sessions; ledger `recipe` field annotates suggestions. See [`recipe-schema.md`](./tools/codemod-harness/docs/recipe-schema.md). |

**Success today** = parses + residue count + **`tsc` compiles** + recipe-suggested fixes +
resumable ledger — not "parses + residue count" alone.

### Angular unit-test baseline (partial behavioral signal)

JHipster fixture: **402 Jest tests / 80 suites pass** on Angular (`PLAN.md` §38). This is a
green-on-Angular baseline, not yet wired as a cross-framework Playwright parity suite.

## What's still missing (honest gaps)

### 1. Behavioral parity oracle — the genuine keystone for trust-at-scale

**Not built.** This is [`PLAN.md`](./PLAN.md) §90 (behavior-oracle contract) and §163
(green-on-Angular Playwright/MSW suite). Needed: scenario execution, trace normalization,
settle-point semantics across Angular zone digests vs React microtasks, semantic diff,
mutation-kill thresholds.

`tsc` catches unresolved hooks, unwrapped observables, and leftover `@angular/*` imports. It
**cannot** catch plausible-but-wrong output (RISKS F3) or watcher-emulation slop (F4) — e.g. a
`useEffect` that runs in the wrong order or a missing teardown.

The **type oracle exists**; the **behavioral oracle does not**. Only the latter gates
evidence-based promotion for semantic correctness at scale.

### 2. Full 8-module harness — deliberate non-goal (for now)

`harness-core` state machine, `model-gateway`, standalone `recipe-registry`,
`operator-control`, etc. remain **designed in `plans/` but unimplemented**. Reversing the
2026-07-18 pivot is an explicit conversation, not an assumed blocker.

### 3. Slice 10+ deterministic residue burn-down

Long-tail catalog rows still open: `@switch`, `@defer`, `| async` unwrap at component scope,
reactive forms, router call-site rewiring (`Router.navigate`), RxJS teardown inside effects,
`@ViewChild`/template refs, `ng-content`/`ng-template`, OpenAPI client regen, UI library mapping.
Cheap and compounding, but diminishing returns (RISKS §4).

### 4. Real-target profile / fixture gap

The JHipster stand-in deliberately lacks the bespoke pieces that dominate the real app. The
[`fixtures/jhipster-ng17-fixture/retrofit/`](./fixtures/jhipster-ng17-fixture/retrofit/) overlay
now covers the **framework-level** differentiators (Transloco, Okta, NgRx, LaunchDarkly,
base-class, permissions, guards/resolvers, validators) in real Angular code. Still **uncovered**:

- `webcore` host / Module-Federation mounting + custom webpack plugins (both `❓ OPEN` —
  discovery; do not synthesize blindly).
- Bid-list page bloat (10 modals), UUIP shared services, modal service-closures.
- **Remote compatibility matrix** (§131) — which remotes become web-components vs compatibility
  islands vs block shell flip. **Independently gates the shell flip**; not gated on the behavioral
  oracle.

### 5. Singular high-stakes events — unproven

- Browser-history ownership cutover (`PLAN.md` §167)
- Shell flip (RISKS §4 — single riskiest event)

Both need a rehearsal path before production.

### 6. Knowledge-transfer / review lane (RISKS F12)

Review-packet auditability and rotation-through-escalation design exists in `plans/` but is
unbuilt. Risk: seniors rubber-stamp or abandon review packets; nobody learns the new codebase.

## Option space (corrected sequencing)

Not everything is gated on the behavioral oracle. Honest near-term options:

| Option | What | Notes |
|---|---|---|
| **A** | Behavioral parity oracle (MVP) | Keystone for evidence-gated *semantic* promotion. Scope: shell + 2–3 representative pages, Playwright + MSW, normalized trace diff vs Angular baseline. |
| **B** | Slice 10+ residue burn-down | Parallel, cheap compounding work. Shrinks surface A must cover. |
| **C** | Close OneCX profile/fixture gap | Remote compatibility matrix de-risks shell flip. **Not blocked by A.** |
| **D** | Rehearse singular events | Browser-history cutover + shell flip. Needs C's matrix first. |
| **E** | Build the 7 governance modules | Deliberate non-goal unless operator-agent model is outgrown. |
| **F** | Review-lane / knowledge transfer | Later or reversible. |

**Recommended sequencing:** **C and A in parallel** — matrix (C) de-risks the riskiest event;
scoped behavioral oracle MVP (A) unblocks trust for everything else. **B** continues in the
background. **D** follows once C's matrix exists.

## Open design question

**Minimal behavioral-oracle MVP** given type oracle + residue ledger already exist:

- Scenario representation: DOM/ARIA snapshot vs full event trace vs network diff?
- Settle-point normalization: Angular zone digests vs React microtasks (RISKS §3 trap #1)
- Mutation-kill threshold: where does it realistically land for these pages?

This is the one decision that turns on design choice rather than execution sequencing.
