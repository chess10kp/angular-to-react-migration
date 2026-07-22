# Angular → React Migration

Research, plans, and a reusable codemod harness for migrating large Angular
codebases to React — combining deterministic AST transforms with agentic
repair under evidence gates.

> **Status:** research + design + **working codemod harness** (slices 1–9, type-oracle
> scaffold, residue ledger, recipe store) with an operator-agent repair loop. Not a finished
> migration or full 8-module harness. See [`TODO.md`](./TODO.md) for the grounded snapshot,
> [`REPORT.md`](./REPORT.md) (research base), [`PLAN.md`](./PLAN.md) (build plan), and
> [`plans/`](./plans/) (executable design for the full harness).

## What's in this repo

| Path | What it is |
|---|---|
| [`REPORT.md`](./REPORT.md) | Literature + industry review: "Agentic Angular to React Migration at Scale." Argues for a hybrid deterministic-codemods + agents + human-gates model, with the evidence base (Google, Amazon AWS Transform, MigrationBench, etc.). |
| [`PLAN.md`](./PLAN.md) | The build plan: a reusable `harness-core` (scheduling, state, evidence gates, retries, replay, learning) with an Angular 2+ adapter, piloted against OneCX as Profile 1. |
| [`IDEAS.md`](./IDEAS.md) | Working notes / future ideas. |
| [`plans/`](./plans/) | A complete, self-calibrating design for an agentic migration harness: architecture, the 18-state unit state machine, tool contracts, 16 agent role cards, phase playbooks P0–P7, prompt templates, and JSON Schemas for every shared artifact. *(Note: the `plans/` thread targets AngularJS 1.x; the `PLAN.md` thread targets Angular 2+ — the two are companion designs, see `plans/README.md`.)* |
| [`tools/codemod-harness/`](./tools/codemod-harness/) | The working prototype: Angular 17 → React codemod pipeline (templates, components, services, lifecycle, DI, `this.` rewiring — slices 1–9). Jac driver adds `--scaffold` (`tsc` gate), `--ledger`, and `--recipes`/`--learn`. See its [README](./tools/codemod-harness/README.md) and [`TODO.md`](./TODO.md). |
| [`TODO.md`](./TODO.md) | Grounded status: what's built, what's missing, and recommended sequencing. |

## Core thesis (from `REPORT.md`)

> Deterministic structural analysis and codemods should do the bulk of the
> safe, repetitive work; agentic systems should plan, synthesize missing
> transformations, explain diffs, and repair validation failures; and humans
> should approve plans, review high-risk edits, and control rollout.

## Running the codemod harness

```bash
cd tools/codemod-harness
npm install
npm run build
npm start -- <args>
```

See [`tools/codemod-harness/README.md`](./tools/codemod-harness/README.md) for
the translation catalog and architecture.

## License

Original content in this repo is dedicated to the public domain under
[CC0-1.0](https://creativecommons.org/publicdomain/zero/1.0/). Third-party
material (none currently tracked in this repo) would carry its own license.
