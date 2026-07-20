# Migration System — Rationale & Decision Record

> How we arrived at the residue-ledger + operator-skill design. Written so the reasoning
> doesn't have to be re-derived. Companion to [`residue-schema.md`](./residue-schema.md)
> and [`../.claude/skills/migrate-residue/SKILL.md`](../.claude/skills/migrate-residue/SKILL.md).
>
> Produced by a Fable advisory pass (2026-07-18). Sources are the harness code itself; file:line
> references were accurate at time of writing — re-verify before relying on them.

## The question we were answering

> Evaluate the current harness and find out-of-distribution ideas to improve the **efficiency
> and speed** of the agentic migration system.

The harness: OneCX Angular 17 (Bootstrap) → React (React-Bootstrap, Axios). A deterministic
codemod (parse → IR → emit → prettier) with a Jac driver over a Node/ts-morph worker.

## Step 1 — First evaluation (and its wrong turn)

The advisor read the source and concluded the codemod front-end is well-built (real IR seam,
residue-as-first-class, decent test discipline) but made a **central claim that turned out to be
wrong**: "there is no LLM/agent in the loop — the system is attached to nothing." It read the
absence of an in-repo agent loop as the system being unfinished.

It also flagged: stringly-typed IR at the expression layer, file-at-a-time with no whole-program
view, no compile gate on output, and — the key insight that survived — that the real throughput
bottleneck is **residue burn-down**, not codemod runtime. ~292 residue TODOs on the jHipster
fixture; the codemod runs in seconds, but each TODO is minutes-to-hours of downstream work.

## Step 2 — The correction that reframed everything

**The harness is designed to be driven from inside Claude Code. Claude Code (an LLM coding agent)
*is* the agent loop.** The residue TODOs, exact spans, and typed reasons are the deliberate
*interface* for that agent to consume interactively. The codemod is the deterministic front-end;
the Claude Code session is the intended back-end that burns down residue.

This inverts the diagnosis:
- The system is **not** "attached to nothing" — it's attached to a high-capability operator.
- The right question becomes: **how well is the harness's output shaped for an in-editor LLM
  agent to find, prioritize, and verify work?**

Judged that way:
- **Well-shaped (keep):** inline `MIGRATION_TODO(category)` anchors and `data-migration-todo`
  attributes are co-located, greppable, and categorized — fix site and instruction are the same
  location. Verbatim body preservation means the agent rarely cross-references source. The
  residue *vocabulary* is genuinely good agent ergonomics.
- **The real gap — the residue *lifecycle*, not the vocabulary:**
  1. The report is stdout, not a persisted ledger — it evaporates. No stable per-residue ID, no
     state, no resumability. Every session re-derives the whole landscape and can't check work off.
  2. Reasons are prose, not structured — the agent re-parses English hundreds of times.
  3. No compilable target — sibling `.tsx` is written into the Angular tree with no scaffold, so
     the agent's superpower (run `tsc`/tests itself) has nothing to run against.
  4. No prioritization signal — flat list; the agent burns context reconstructing dependency
     order the harness already knows internally.

## Step 3 — Ideas re-ranked for "Claude Code is the loop"

Several original ideas collapsed or inverted once the operator was understood to be a capable agent:

| Idea | Verdict under the correction |
|------|------------------------------|
| **Persisted stable-ID residue ledger** (`residue.jsonl`) | **Promoted to #1.** Highest leverage *because* the consumer is an agent working across sessions. Reuses data the harness already computes. |
| **Recipe induction** (capture agent fixes → anti-unify → deterministic rules) | **Reinforced.** *More* valuable now: the agent's fixes are ephemeral (lost at session end, redone per app, target unknown). This is the only way the work compounds. |
| **tsc-gated repair loop** | **Reframed.** Don't build a loop — the agent runs `tsc`/tests itself. Just supply the *target*: emit a compilable Vite/React scaffold. The loop capability is free. |
| **Whole-program DI graph → generated composition root** | **Holds.** Deterministic global work; hand-wiring it across every file wastes scarce agent context. |
| **Trace-replay parity / shadow-render canaries** | **Holds.** The one oracle broad context can't cheaply provide. |
| **"LLM emits IR" fallback** | **Downgraded.** Funneling a high-capability agent through IR-JSON is a straitjacket; the agent writes better JSX directly. Keep only the *validation* use. |
| **Residue clustering (crash-bucket triage)** | **Downgraded to a ledger field** (`cluster_id`). The agent can group ad hoc; heavy triage architecture is over-built. |
| **Content-addressed cache / incrementality** | **Holds moderately.** Matters mainly so "promote a rule, re-run" is instant. |

## Step 4 — What we decided to build first

The three items, in order, that turn this from a codemod into the intended migration *system*:

1. **Persist a stable, structured, prioritized, resumable ledger** (`residue.jsonl`).
2. **Capture agent fixes back into deterministic rules** so work compounds.
3. **Emit a compilable scaffold** so the agent's own verification works.

Plus one artifact that was "newly obvious": **a skill that teaches the operator the residue
vocabulary**, so every session starts warm instead of reconstructing the terrain from README prose.

## Artifacts produced by this pass

- **[`residue-schema.md`](./residue-schema.md)** — the v1 spec for the `residue.jsonl` ledger
  (item #1 above): stable-`id` recipe, the 18 real categories, `fix_shape` enum, structured
  per-category reasons, and the exact emit path (behind a `--ledger` flag). Honestly flags what
  isn't computed yet (cross-file priority/deps aggregation; span for string-form residue).
- **[`../.claude/skills/migrate-residue/SKILL.md`](../.claude/skills/migrate-residue/SKILL.md)** —
  the operator skill: every real `MIGRATION_TODO(category)` and its canonical fix, how to
  read/prioritize/update the ledger, and the resume-across-sessions loop. Honest that no
  compilable scaffold exists yet, so today's verify = re-run `--report` + re-grep + `npm test` +
  inspection.

## Status (updated 2026-07-18)

Item #1 — the **`--ledger` aggregation pass — is now implemented** in
`jac/codemod.jac` (`build_ledger`/`write_ledger`): a driver-side second pass over the
`outcomes` list writes a stable, structured, resumable `residue.jsonl`, with per-mode
burn-down merge and DI-token fan-out priority. It reuses existing data only — no worker
changes, so `.tsx`/`.jsx` output stays byte-identical. Honest v1 gaps (`span:null`,
`deps:[]`, string-derived categories) are documented in `residue-schema.md`.

Item #3 — the **compilable Vite/React scaffold — is now implemented** behind
`--scaffold[=<dir>]` (`scaffold_files`/`write_scaffold`). It emits a self-contained
Vite + React + TS project whose `tsconfig` `include`s the migrated output, so
`npm run typecheck` (`tsc --noEmit`) becomes the real residue gate — the remaining
`MIGRATION_TODO`s surface as actual compiler errors. Proven end-to-end: on migrated
output, `tsc` reports *only* residue (`useAccountService`, `ElementRef`, `user$`,
`@angular/common/http`), no framework noise. See [`scaffold.md`](./scaffold.md).

Item #2 — **recipe induction — is now implemented** behind `--recipes`/`--learn`
(`seed_recipes`/`recipe_set`/`best_recipe`/`induce_recipe`/`learn`). A recipe
captures a cluster's canonical fix as a holed template; `--ledger` renders the
matching recipe per occurrence into a `recipe` field so fixes compound across
sessions. `--learn` captures a fix (agent-authored template, or anti-unified from
a before/after pair) into `recipes.jsonl`, overlaying the bundled seeds. Recipes
annotate the ledger only — emitted `.tsx` stays byte-identical. See
[`recipe-schema.md`](./recipe-schema.md).

All three planned items (#1 ledger, #2 recipes, #3 scaffold) plus the operator
skill are now in place; the harness is the intended migration *system*, not just a
codemod.

The ledger's **`deps` field is now filled** (was `[]`): a `this` residue links to
the same-file `di`/`state` record that provides each `this.X` member it still
references — the skill's "fix the provider first" rule made machine-readable,
driver-side, no worker touch. In practice the reachable edge is `this` → `state`
(signals); the `di` side is wired but not reachable under the current emitter
(schema §6). Remaining honest gaps: ledger **`span:null`** for component/service
residue (needs emitter offsets threaded through the worker — deferred to preserve
byte-identical output); recipe anti-unification is whole-word token replacement,
suggestions not auto-applied; scaffold excludes partial `.jsx` template fragments.
