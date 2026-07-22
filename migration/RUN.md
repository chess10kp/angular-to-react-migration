# RUN.md — the one document an agent executes end-to-end

> **You are the orchestrator.** This file is the single entrypoint for running the whole
> Angular 17 → React 19 migration: codemod the target, scaffold a compilable React app, then
> burn residue down to the floor — verifying and committing each step yourself. A fresh chat
> should be able to read *only this file* and run the entire flow.
>
> **Prime directive (inherited from [`../tools/HARNESS-EXECUTION-PLAN.md`](../tools/HARNESS-EXECUTION-PLAN.md)):**
> code to the seam, never to the fixture; **residue is a sanctioned answer**, never a failure;
> **escalation is a success path**. Never guess a semantic transform — emit/keep typed residue.

The harness is deliberately split into a deterministic front end and an agent back end. Nothing
auto-applies a semantic fix; **you** are the `FixApplier` the loop pauses for (this is why
`migration/loop/config.mts` ships a `PauseFixApplier` stub). Governing docs, in force here:

- [`../PLAN.md`](../PLAN.md) — master plan + definition-of-done for the real target.
- [`../tools/HARNESS-EXECUTION-PLAN.md`](../tools/HARNESS-EXECUTION-PLAN.md) — the *method*
  (invariants, seam rules, task/commit discipline). Obey its §1 invariants and §3 standing rules.
- The **`migrate-residue`** skill (`../tools/codemod-harness/.claude/skills/migrate-residue/`) —
  the category→canonical-fix playbook for the burndown. Load it before Stage 3.

---

## Preflight (STOP if red)

```bash
cd ~/repos/angular
git switch -c migration-run              # never run on a dirty main; one branch per run
git status                               # expect clean (or only this run's files)
( cd tools/codemod-harness && npm ci && npm test )   # harness green BEFORE you start
( cd migration/loop && npm ci && npm test )          # loop spine green (28 tests)
```
If either suite is red you inherited a broken tree — write `BLOCKED-preflight.md` and STOP. Do
**not** "fix" it by editing tests (a forbidden cheat move, HARNESS-EXECUTION-PLAN §3.2).

---

## Stage 0 — Point at the target

The real target is private and may not be checked out. Set `$TARGET` to the Angular source dir
to convert. Until the real repo is available, the standing target is the enriched fixture:

```bash
export TARGET=references/jhipster-ng17-fixture/src/main/webapp/app/campaign
export OUT=migration/app                 # the scaffolded React workspace (already seeded)
```

`$TARGET` must be the Angular app root (has `.component.ts` / `.service.ts` / `.html`). If you
were handed a different real target, set `$TARGET` to it — **change nothing else**; the pipeline
is target-agnostic by construction. A construct the codemod doesn't recognize becomes residue,
not a crash.

---

## Stage 1 — Codemod (deterministic front end)

Run the Jac driver (it owns `--scaffold`/`--ledger`; the `src/cli.ts` path only has
`--report`/`--dry-run`). This converts what it can *prove* safe and emits typed `MIGRATION_TODO`
residue for the rest.

```bash
cd tools/codemod-harness

# Components + templates → .tsx, services → .react.ts, into a compilable Vite/React/TS scaffold:
npm run jac -- --components --services --scaffold=../../$OUT "../../$TARGET"

# Write the residue ledger (stable ids, priority, deps, cluster_id, status):
npm run jac -- --components --services --ledger --ledger-file=../../migration/residue.jsonl "../../$TARGET"

cd ../..
```

Sanity check the output before trusting it:
```bash
grep -rhoE "MIGRATION_TODO\(([a-z]+)\)" $OUT | sort | uniq -c   # residue histogram by category
wc -l migration/residue.jsonl                                  # worklist size
```

**Idempotence gate:** run the scaffold command twice; the second run must produce byte-identical
output (`git diff --stat` empty). If not, STOP — the codemod is non-deterministic (a bug), not
your problem to hand-patch.

---

## Stage 2 — Baseline the type oracle

The verifier is `git`-honest: it passes only when `tsc` errors do not exceed a recorded baseline.
Record the floor once, right after codemod, so Stage 3 measures burn-down against it.

```bash
npx tsx migration/loop/verify.mts type $OUT --residue migration/residue.jsonl
```

This scaffolds + runs real `tsc --noEmit`, writes a verdict to `migration/verdicts/<runId>.jsonl`,
and prints `{status, totalErrors, baseline}`. On a fresh target the initial errors ARE the
residue floor (unmigrated-dependency stubs: `rxjs`, `@okta/*`, `launchdarkly-*`, `@angular/*`,
webcore `app/core/*`). Set `migration/loop/baseline.json` to this count so "green = ≤ baseline".

---

## Stage 3 — Burndown loop

Load the **`migrate-residue`** skill now — it holds the category→canonical-fix map. Then loop,
**one residue item per commit**, until the ledger hits its floor. This is the state machine from
HARNESS-EXECUTION-PLAN §C.1:

```
pick → retrieve context → apply ONE fix → VERIFY → green? commit+learn : retry|escalate
```

**Two ways to run it — the FixApplier is a swap seam (§C.1.5):**

- **Agentic (autonomous).** The loop drives itself: for each item it shells out to a headless
  coding agent (`AgentFixApplier`) that edits the file in place, then verifies and commits. The
  agent's output is **untrusted** — the committer firewall re-derives touched files from
  `git status` and enforces the per-item allowlist, and the oracle re-verifies, so a wrong edit
  just fails the gate and is retried or blocked. Run the whole ledger end-to-end with:
  ```bash
  LOOP_APPLIER=agent npx tsx migration/loop/config.mts
  ```
  (Requires the `claude` CLI on PATH and authenticated; swap the runtime by constructing
  `AgentFixApplier` with a different `invoke` in a one-line config edit — never touch the driver.)

- **Agent-in-the-loop (manual, default).** `LOOP_APPLIER` unset → `PauseFixApplier`: *you* do each
  fix by hand following the steps below, running `verify.mts` and committing yourself. Use this
  when you want to review every edit, or for Tier B/C items where a hand fix is the highest-value
  lesson.

Either way, each iteration is:

1. **Pick.** Read `migration/residue.jsonl`; skip `done`/`wontfix`. Take the highest-`priority`,
   dependency-unblocked item. Order: **`openapi` and shared `di` providers first** (highest
   fan-out — one provider unblocks every component that injects it), then walk by `cluster_id`
   (same normalized reason = same fix — resolve one, apply it to the whole cluster), localized
   residue (`field`/`rename`/`tpl-*`) last. A `this` item with non-empty `deps` is blocked until
   its providers are done.

2. **Apply ONE fix — by hand.** Edit the generated `.react.ts` / `.tsx` in place, following the
   skill's canonical fix for that category. **Recipes are suggestions, never auto-applied**
   (auto-apply is a forbidden move, §3.2). Only touch files on this item's allowlist (its own
   file + `migration/lessons.jsonl` + `migration/facts-proposals.jsonl`); the committer firewall
   rejects anything else.

3. **Verify.** Re-run the type oracle:
   ```bash
   npx tsx migration/loop/verify.mts type $OUT --residue migration/residue.jsonl
   ```
   Green = `totalErrors ≤ baseline`. If a parity unit covers the changed behavior, that stronger
   gate applies too (`done:parity` beats `done:type`). Re-grep to confirm the marker is gone:
   `grep -rn "MIGRATION_TODO(<cat>)" $OUT`.

4. **Green → commit + learn.** One commit, message `fix(migration): resolve residue <id>`, with
   trailers `residue-id`, `done-state` (`done:type` or `done:parity`), `oracle: type=… parity=…`.
   Set the item's ledger `status`. Append a lesson to `migration/lessons.jsonl`; if the cluster's
   fix is reusable, `npm run jac -- --learn=fix.json` to seed a recipe (human-reviewed before any
   sweep). **A `done:type` item may not seed a promoted lesson** — compiling ≠ behaviorally proven.

5. **Red → diagnose the FIRST failure only, retry within budget** (§3.9: 3 consecutive failed
   verifies OR ~30 min → stop). Out of budget → write `migration/loop/blocked/BLOCKED-<id>.md`
   (task id, exact command, full output, one-line diagnosis), set `status: blocked`, move on.
   **Escalation counts as completing the item.** A human fix here is the highest-value lesson.

**Stop condition:** every ledger item is `done:*`, `blocked`, or `wontfix`, and
`verify.mts` is green. The remaining `tsc` errors should be exactly the unmigrated-dependency
stubs (Tier B/C — `di`/`rxjs` keep-vs-convert, `effect`/`state` verify) that are **not
codemoddable** and are Harness B's job. Do not force them green by guessing.

---

## Stage 4 — Report & resume

Print residue-remaining by category so the next chat resumes cleanly, and record the run:

```bash
grep -rhoE "MIGRATION_TODO\(([a-z]+)\)" $OUT | sort | uniq -c    # what's left
git log --oneline migration-run ^main                            # what this run committed
```

Because the ledger carries `status` forward across codemod re-runs (and drops ids whose residue
is gone), **the burn-down is resumable**: a later session re-reads `migration/residue.jsonl` and
picks up where this one stopped. Update PLAN.md's definition-of-done checkboxes only for
contracts a **parity** unit actually proved, never for `done:type` alone.

---

## What this flow does NOT do (by design)

- **No real browser.** Verification is `tsc` (compiles) + jsdom parity (behaves, simulated). A
  real-browser rung (Playwright) is specified but deferred — HARNESS-EXECUTION-PLAN §B.7.
- **No autonomous semantic transforms.** Tier B/C residue is left as typed markers, not guessed.
- **No cross-run auto-apply of recipes.** Induction is allowed; applying in a sweep is
  human-gated.
