# Harness Execution Plan

> **Audience.** Subagents executing autonomously, possibly on weaker models, after the
> author is gone. This plan is written to be executed literally. Where it says "STOP", stop.
> Where it gives an exact command and expected output, that command **is** the definition of
> done — not your judgement that the work "looks right".
>
> **Scope.** Three harnesses under `tools/`:
> - **A — `codemod-harness/`** — deterministic Angular 17 → React 19 transpiler (IR seam).
> - **B — `parity-harness/`** — cross-framework behavioral parity oracle.
> - **C — Migration Execution Loop** — the verify → fix → learn loop that drives converted code
>   to green and compounds lessons (mostly greenfield; see §C.0 for ground truth).
>
> **Prime directive: generality.** The real target app is private and *not yet accessible*.
> Every specific in the current dev fixture (a generated jHipster ng17 app) **will change** —
> the real target uses Transloco (not ngx-translate), Okta, NgRx→RTK, LaunchDarkly, a `webcore`
> MFE host, and Jasmine. Therefore: **code to the seam, never to the fixture.** A transform that
> only works on jHipster is a bug, not progress.

---

## Glossary (load-bearing terms — these decide behavior)

- **Provably safe.** A transform is *provably safe* only if its output is correct for **every**
  input matching its precondition, checkable mechanically (a type checks, a test passes). If you
  can imagine one matching input where the output is wrong, it is **not** provably safe → emit
  residue instead.
- **Surface syntax.** The written form of an Angular construct, independent of its meaning. `@if`
  and `*ngIf` are two *surface syntaxes* for one semantic (conditional render). The `| translate`
  pipe and the `jhiTranslate` directive are two surface syntaxes for one semantic (translate a
  key). Two fixtures that differ only in whitespace, names, or formatting are the **same** surface
  syntax.
- **Framework-incidental noise.** A difference between Angular and React output that a user cannot
  observe: attribute order, wrapper elements, whitespace, the exact microtask/zone tick a value
  settled on. Normalization must erase these. A difference a user *can* observe (text, focus, an
  emitted event, a network call, a computed color) is **never** incidental.
- **Residue.** A visible, typed `MIGRATION_TODO:<category>` marker the harness emits when it
  cannot prove a transform safe. Residue is a **correct, sanctioned answer** — never a failure.
- **Template (in this plan).** A reusable *recipe* for a kind of change (e.g. "add an emit
  consumer"). Templates are §A.1–A.6 and §B.1–B.7. They are **not** schedulable work.
- **Task.** A concrete, schedulable unit of work that instantiates a template. Tasks live in
  **[§7 The Task Queue](#7-the-task-queue-the-only-schedulable-work)** with a status. You only
  ever execute tasks from the queue.

---

## 0. How to use this plan (read every session, every agent)

1. **Preflight** — run the [Preflight ritual](#preflight-ritual). If it is red, STOP.
2. **Confirm Task 0 is DONE.** If the [baselines table](#recorded-baselines) still has blanks,
   the next task is **[Task 0](#7-the-task-queue-the-only-schedulable-work)** — do it first.
3. **Pick the next task** from [§7 The Task Queue](#7-the-task-queue-the-only-schedulable-work):
   the **topmost `TODO` whose every `DEPENDS-ON` is `DONE`**. Do not skip ahead. Do not re-open a
   `DONE` task. **Never invent a task that is not in the queue** — if you believe one is missing,
   escalate (write `BLOCKED-newtask.md` describing it) and stop.
4. **Read the template** the task points at (its §A.x/§B.x recipe) and the
   [Invariants](#1-invariants) for that harness. They are short so they survive context loss.
5. **Execute the task's steps in order.** The template's `NEW-TESTS` step is **RED-first**: write
   the test, run it, and confirm it fails *for the reason you expect* before writing any
   implementation. Paste that failure output into your commit body (see [§3 rule 8](#3-standing-rules-non-negotiable)).
6. **Hit an `ESCALATE-IF` → escalate.** Write `BLOCKED-<taskid>.md` and stop. Escalation is a
   **success path** (see [§3](#3-standing-rules-non-negotiable)), not a failure.
7. **Never declare done without a green `DONE-CHECK`.** "It should work" is not done. Mark the
   queue row `DONE` only after the exact `DONE-CHECK` commands print their expected output.

### Preflight ritual

```bash
# From the harness you're about to edit (tools/codemod-harness or tools/parity-harness):
git status                 # MUST be clean, or only your own in-progress task's files.
npm ci                     # install exact locked deps.
npm run build --if-present # if the package has a build step, run it so scaffold/tsc see fresh output.
npm test                   # MUST be all-green BEFORE you start. If red, you inherited a broken
                           # tree: write BLOCKED-preflight.md and STOP. Do NOT "fix" it by editing
                           # tests — that is a forbidden cheat move (§3.2).
```
If preflight is red, the tree is not a safe foundation. Stop. Do not build on it.

---

## 1. Invariants

Re-read the block for the harness you are editing, every task. Plain sentences, one rule per
line, on purpose — do not compress them. The single source of truth for *how they are enforced*
is [§5 Seam grep checks](#5-seam-invariant-grep-checks).

### A — codemod-harness invariants
```
1.  @angular/compiler is imported ONLY in src/parse/ (template parsing) and src/expr-ast.ts
    (the expression sub-seam, §A.4). ts-morph is imported ONLY in src/parse/ (component
    extraction), src/transform-service.ts (in-place service surgery), and src/worker.ts
    (the Node JS-AST worker). These allowlists are exact — widen one only via a seam task.
2.  @babel/* may be imported ONLY inside src/emit/ (src/worker.ts re-exports the emitters).
3.  src/ir/ must import nothing from src/parse/ or src/emit/. It is pure data and types.
4.  To teach the harness a new construct you EXTEND the IR: first add a node or field to
    src/ir/types.ts (its own task), then add a parse producer, then add an emit consumer.
5.  You must never thread a raw AST object or raw source string THROUGH the IR, and you must
    never edit the emitted .tsx with a regex after emit. Fix the seam, not the output.
6.  Anything you cannot prove safe becomes a visible typed residue marker
    (MIGRATION_TODO:<category>). A silent drop or a fabricated/guessed semantic is forbidden.
7.  The codemod is deterministic: running it twice on the same input produces byte-identical output.
8.  No fixture-specific token (for example jhi, jhipster, a fixture component name, or an
    ngx-translate API) may appear anywhere under src/. Such tokens belong only in test fixtures.
9.  Every transform is exercised by at least two fixtures that differ in Angular SURFACE SYNTAX
    for the same semantic (see Glossary), not by two cosmetic variants of one syntax.
```

### B — parity-harness invariants
```
1.  runner, diff, gate, and normalize may consume ONLY ParityCase and Observation. They may not
    import any framework code.
2.  Framework imports (@angular/*, react*, jsdom bootstrap) may live ONLY inside src/adapters/.
3.  You must never capture or compare raw HTML/innerHTML outside an adapter. A new signal is added
    as a new NORMALIZED channel on Observation, defined in the schema and captured by BOTH
    adapters symmetrically.
4.  The oracle compares normalized user-observable behavior, never DOM structure.
5.  A failed check must produce a Divergence naming the first checkpoint, channel, and path where
    the two sides disagree — never a bare "mismatch".
6.  Changing the Observation schema or the adapter contract invalidates every baseline. The task
    that makes such a change must bump the harness version and regenerate baselines in the same task.
7.  The Angular and React workbenches for a unit must import the SAME shared pure-logic module, so
    any divergence is a real bug and not copy drift.
8.  The adapter contract (mount, setInputs, settle, drainEvents, observe, dispose) is fixed. It
    exists so the runner can later be re-hosted on Playwright untouched. Do not leak jsdom
    assumptions past an adapter.
```

---

## 2. Work-unit template

Every template in §A/§B, and every task you author, uses this shape. All fields are **mandatory**
— a task with an empty `FILES-ALLOWED` or `FALLBACK` is not ready to run.

```
### <ID> — <Title>
TEMPLATE:    <which §A.x/§B.x recipe this instantiates>
DEPENDS-ON:  [<task IDs>]   # Re-run each dep's DONE-CHECK NOW. If any is red, STOP.
GOAL:        <one sentence, behavior not code>
FILES-ALLOWED:   <exact paths/globs you may touch>
FILES-FORBIDDEN: <the seam files you must not touch>
INPUTS:      <fixtures, IR node types / Observation channels to consume, by name>
NON-GOALS:   <2-3 adjacent things this task must NOT do>
STEPS:       <numbered; each step is one decision or one edit>
NEW-TESTS:   <the fixture + assertion to add. State the DIFFERENCE AXIS of the 2nd fixture.>
RED-PROOF:   <run the new test BEFORE impl; paste its failure into the commit body>
FALLBACK:    <the residue category / waiver to emit if it can't be made provably safe>
DONE-CHECK:  <exact commands + expected output, incl. the FULL suite + idempotence>
ESCALATE-IF: <concrete triggers>
```

Field notes:
- **FALLBACK is the escape hatch.** Because residue is a first-class, sanctioned answer, you never
  *need* to guess. When the safe transform is unclear, emit typed residue and move on. A correct
  `MIGRATION_TODO` always beats a wrong transform.
- **RED-PROOF is not optional.** If the new test passes *before* you write the implementation, the
  test is wrong — it proves nothing. STOP and fix the test. The pasted failure output is the
  artifact that proves you did this; a reviewer checks the commit body for it.
- **The 2nd fixture must differ on a named axis.** In `NEW-TESTS`, state which surface-syntax axis
  the two fixtures differ on (e.g. "`@if` block vs `*ngIf` directive"). A rename/whitespace
  variant is **not** a second fixture (Invariant A9 / Glossary).
- **DONE-CHECK always runs the FULL suite**, not just your new test — you must not regress a sibling.

---

## 3. Standing rules (non-negotiable)

1. **Escalation is a success path.** On any `ESCALATE-IF`, write `BLOCKED-<taskid>.md` containing:
   the task ID, the exact command run, its full output, and your one-line diagnosis. Then STOP.
   This *counts as completing the task* (mark the queue row `BLOCKED`). Do not improvise around a blocker.

2. **Forbidden cheat moves (auto-fail):**
   - Editing or regenerating an existing golden snapshot to green a build. If an existing snapshot
     changes unexpectedly, **STOP** — you changed behavior you didn't intend.
   - Weakening, deleting, or `.skip`-ing an existing test.
   - Converting existing *typed residue* into a *silent drop* to lower the residue count.
   - Adding `any`, `@ts-ignore`, `@ts-expect-error`, or `eslint-disable` to get past a gate.
   - **Attempting to codemod a Tier B/C residue category** (`di`, `rxjs` keep-vs-convert,
     `effect`-verify, `state`-verify). These are not mechanically decidable; a codemod for them
     produces plausible-but-wrong output. They are Harness B's job (see the [Stop line](#a7-open-construct-tickets-queued-in-7)).
   - **Auto-applying a learned recipe** (§A.6) without human review. A weak agent may *induce* and
     *record* a recipe; applying it in a sweep is human-gated. Treat an unreviewed auto-apply as a
     forbidden move → escalate.

3. **Ratchet rule.** These may only move in the good direction, measured against the
   [Recorded baselines](#recorded-baselines):
   - Passing test count: only up (or equal for a task that legitimately adds no test).
   - Residue: only *smaller* or *more precisely categorized*, never *more silent*.
   - Scaffold `tsc --noEmit` error count: only down.

4. **Generality gate (grep-enforced, see §5).** Fixture/target specifics never leak into `src/`.
   Library-specific mappings (translate lib, UI lib, auth lib) live in a declared **mapping
   table / recipe file**, never inline in transform logic. A hardcoded library name in a `.ts`
   under `src/` is wrong — key off the table, fall back to residue for unmapped entries.

5. **Two-fixture rule.** A new transform is proven on ≥2 fixtures differing on a **named surface-
   syntax axis** (Glossary). If the current fixture has only one shape, synthesize the second — but
   it must genuinely differ in syntax, not in names/whitespace.

6. **One task = one commit**, message prefixed with the task ID (e.g. `A-T3: @switch → ternary`).
   Rollback for a bad task is `git revert <that commit>`. Never smear two tasks into one commit.

7. **Seam violations are auto-fail.** Enforced by the greps in [§5](#5-seam-invariant-grep-checks),
   which are the single source of truth for the seam boundaries.

8. **RED-before-green is mandatory** and its artifact is the pasted failure output in the commit
   body (see §2 `RED-PROOF`). A commit that adds a transform but shows no red proof is auto-fail.

9. **Budget / anti-grind.** Escalate (write a `BLOCKED-` file, stop) when **either** of these
   trips: 3 consecutive failed `DONE-CHECK` attempts on the same task, **or** ~30 minutes of
   wall-clock with no green `DONE-CHECK` step. Grinding past this amplifies a wrong approach.

---

## 4. Milestone gates

**When to run a gate:** after every **3 completed tasks**, **or** immediately before any commit
that touches a seam file (`src/ir/**`, adapter contract, `Observation` schema), **whichever comes
first**. A gate does no feature work; it re-establishes a trustworthy foundation and records the
numbers the ratchet reads.

```
### GATE-<n> — Full-suite + oracle checkpoint
TEMPLATE:    (gate — no feature work)
DEPENDS-ON:  [all tasks since the previous gate]
STEPS:
  1. npm test                             # expect: all green, count >= last recorded.
  2. (codemod) npx tsx src/cli.ts --scaffold /tmp/scaf && (cd /tmp/scaf && npx tsc --noEmit)
                                          # expect: only residue errors; error count <= last recorded.
  3. (codemod) npx tsx src/cli.ts --ledger <fixture> && wc -l residue.jsonl
                                          # expect: line count <= last recorded (or equal + better-categorized).
  4. (codemod) idempotence: run the codemod twice on a fixture; diff outputs -> empty.
  5. (parity)  npm run parity -- run      # expect: every unit accepted, zero divergence, no baseline drift.
  6. bash tools/seam-check.sh             # the §5 greps; expect: no FAIL lines.
  7. Update the "Recorded baselines" table with the new numbers, in this file, and commit it.
DONE-CHECK:  all of the above green; numbers recorded and committed.
ESCALATE-IF: any number regresses vs the recorded baseline and you cannot attribute it to a
             specific preceding task -> BLOCKED, stop.
```

### Recorded baselines
**Task 0 populates this table before any feature work** (blanks below are the signal that Task 0
is not yet done). The ratchet (§3.3) reads from the latest row.

| Date | codemod tests | scaffold tsc errors | residue lines | parity tests | parity units accepted |
|---|---|---|---|---|---|
| 2026-07-22 | _pending_ | 30 (baseline.json) | 13 | _pending_ | _pending_ |
| _pending Task 0_ | _run `npm test`_ | _run scaffold_ | _run ledger_ | _run `npm test`_ | _run parity_ |

---

# HARNESS A — codemod-harness

> Pipeline (the load-bearing shape — do not restructure it):
> ```
> .html / .component.ts
>    └─ src/parse/*            (@angular/compiler + ts-morph — ISOLATED here)
>         └─ src/ir/*          (Template IR + Component IR — the STABLE SEAM)
>              └─ src/emit/*   (@babel/* → JSX/TSX — ISOLATED here) → prettier → .tsx
> ```
> Orchestration: `src/transform*.ts` + `src/cli.ts`; Jac driver + `src/worker.ts` (JSON-RPC to
> keep JS-AST steps in Node). Evidence layer: `--scaffold` (type oracle), `--ledger`
> (residue.jsonl), `--recipes`/`--learn`.
>
> **§A.1–A.6 below are TEMPLATES (recipes), not tasks.** Schedulable work lives in
> [§7 The Task Queue](#7-the-task-queue-the-only-schedulable-work) and points back here.

## A.1 — Parse layer (`src/parse/`) — TEMPLATE

**Role.** Turn version-pinned framework ASTs into IR. The only place `@angular/compiler` and
`ts-morph` may be imported. When Angular or ts-morph is upgraded, changes are confined here.
Every parse task: produce IR nodes only (never leak a compiler/ts-morph object past the return);
record `SourceLoc` on every node you can; an unknown/unsafe construct becomes a `TodoNode`
(template) or a residue record (component) with a precise `reason` — never a drop.

```
### <id> — Add a template construct to the parser
TEMPLATE:    A.1
DEPENDS-ON:  [the A.2 task that added the target IR node]
GOAL:        Lower one Angular template construct into its IR node.
FILES-ALLOWED:   src/parse/angular-template.ts, test/*.test.ts, test/fixtures/**
FILES-FORBIDDEN: src/emit/**, src/ir/types.ts (the node must already exist — separate task)
INPUTS:      @angular/compiler AST for the construct; the target IR node from src/ir/types.ts
NON-GOALS:   emitting JSX (an emit task); inventing a new IR node inline
STEPS:
  1. Confirm the target IR node exists in src/ir/types.ts. If not, STOP — do the A.2 task first.
  2. Add two fixtures for the construct differing on a NAMED surface-syntax axis (state it).
  3. Map the compiler AST node -> the IR node, carrying SourceLoc.
  4. Any sub-case you can't prove safe -> TodoNode with a specific reason string.
NEW-TESTS:   parse-only assertion: fixture -> expected IR shape (not JSX yet). Axis: <state it>.
RED-PROOF:   run it; confirm it fails because the IR node isn't produced yet; paste output.
FALLBACK:    emit TodoNode{ reason } for the unsafe sub-case.
DONE-CHECK:  npm test  # all green; new parse test passes; NO snapshot churn elsewhere.
ESCALATE-IF: the construct needs a new @angular/compiler API not yet used, OR it can't be
             represented without a new IR node/field -> STOP, request the A.2 task first.
```

## A.2 — IR layer (`src/ir/`) — TEMPLATE

**Role.** The stable, framework-neutral seam. Pure data + types; imports nothing from `parse/` or
`emit/`. Changing the IR is the *only* sanctioned way to teach the harness a new construct.

```
### <id> — Add or extend an IR node
TEMPLATE:    A.2
DEPENDS-ON:  []
GOAL:        Introduce a new IR node type or field so a construct can flow parse -> emit.
FILES-ALLOWED:   src/ir/types.ts, src/ir/component.ts, src/ir/service.ts
FILES-FORBIDDEN: src/parse/**, src/emit/** (they consume the node in follow-up tasks)
INPUTS:      the construct's data requirements (what emit will need to produce correct output)
NON-GOALS:   parsing or emitting (separate tasks); putting logic in the IR (it is data-only)
STEPS:
  1. Add the node/field to the IRNode union (or Component/Service model) with doc comments.
  2. Keep it minimal: only fields emit provably needs. No raw AST handles. No stringly-typed
     escape hatch that bypasses the seam.
  3. IRNode is a discriminated union: adding a member turns every non-exhaustive emit switch into
     a COMPILE ERROR. That is intended — it points the follow-up A.3 task at every consumer.
NEW-TESTS:   a shape/type test asserting the node's fields.
RED-PROOF:   run it; confirm it fails because the type doesn't exist yet; paste output.
FALLBACK:    n/a (structural). If unsure what fields emit needs, STOP and ask.
DONE-CHECK:  npx tsc --noEmit  # compiles. Emit consumers may now fail to compile — expected; the
             A.3 task fixes them. Do NOT stub them with a `default:` that silently drops.
ESCALATE-IF: you want to store a raw compiler/babel object on the IR -> STOP; that violates the
             seam. Rethink what emit actually needs.
```

## A.3 — Emit layer (`src/emit/`) — TEMPLATE

**Role.** Turn IR into React TSX via `@babel/*`. The only place Babel types may be imported. Reads
only the IR — never reaches back into parse or the original source string.

```
### <id> — Emit React for an IR node
TEMPLATE:    A.3
DEPENDS-ON:  [the A.2 task for the node, the A.1 task that produces it]
GOAL:        Produce idiomatic, compilable React/JSX for one IR node.
FILES-ALLOWED:   src/emit/jsx.ts, src/emit/component.ts, src/emit/forms.ts, test/**
FILES-FORBIDDEN: src/parse/**, src/ir/types.ts
INPUTS:      the IR node from A.2; the expression layer (src/expr*.ts) for embedded exprs
NON-GOALS:   post-processing emitted text with regex; parsing anything
STEPS:
  1. Handle the new IR node in the emit switch (the A.2 compile error points you at it).
  2. For anything the node marks unsafe (TodoNode / flagged field): emit a MIGRATION_TODO marker
     (a comment for element content, a data-migration-todo attr for events/props) and COUNT it in
     the coverage report's todoReasons. Never a blind, confident emit.
  3. Thread needed import hints (e.g. clsx, react-router-dom) to the component emitter — don't
     hardcode imports inline.
NEW-TESTS:   golden-snapshot test: fixture -> exact .tsx, on the two-fixture axis. Axis: <state it>.
RED-PROOF:   run it; confirm the snapshot doesn't exist / output is wrong pre-impl; paste output.
FALLBACK:    MIGRATION_TODO:<category> marker + a coverage.todoReasons entry.
DONE-CHECK:  npm test  # snapshot created ONLY for the new fixture; siblings unchanged. Then:
             npx tsx src/cli.ts --scaffold /tmp/s && (cd /tmp/s && npx tsc --noEmit)
             # new output compiles (or fails ONLY with a residue marker, never a type error).
ESCALATE-IF: an EXISTING snapshot changes -> STOP (you altered behavior you didn't mean to). OR
             you can't emit compilable React without guessing semantics -> emit residue instead.
```

## A.4 — Expression layer (`src/expr.ts`, `src/expr-ast.ts`) — TEMPLATE

**Role.** Translate Angular binding expressions into JS expression text, AST-based (an Angular
expression `Parser` + a precedence-aware printer), *not* regex-on-source. Consumed by emit.

```
### <id> — Support an expression form
TEMPLATE:    A.4
DEPENDS-ON:  []
GOAL:        Translate one Angular expression form to correct JS via the AST printer.
FILES-ALLOWED:   src/expr.ts, src/expr-ast.ts, test/**
FILES-FORBIDDEN: src/parse/**, src/emit/** (they call expr; don't reach into them)
INPUTS:      Angular expression Parser AST; the precedence printer
NON-GOALS:   string/regex manipulation of expression source (the whole point is AST)
STEPS:
  1. Add the AST node case to the printer with correct precedence/parenthesization.
  2. A pipe/method with no exact JS equivalent -> flag it (residue), don't fake it.
  3. A this.x inside a string literal must NOT be treated as a member access (this is why we use
     the AST, not regex — keep it that way).
NEW-TESTS:   expr-in -> expr-out units, incl. a precedence edge AND a string-literal false-positive guard.
RED-PROOF:   run them; confirm they fail pre-impl; paste output.
FALLBACK:    leave the sub-expression flagged in coverage; don't emit invalid JS.
DONE-CHECK:  npm test  # green, incl. idempotence (printing twice is stable).
ESCALATE-IF: the expression needs runtime semantics that differ on React (e.g. an RxJS operator)
             -> that's a residue/behavioral-oracle concern, not an expr task. Flag and stop.
```

## A.5 — Orchestration + CLI + Jac driver — TEMPLATE

Files: `src/transform*.ts`, `src/cli.ts`, `jac/codemod.jac`, `src/worker.ts`. **Invariant: the Jac
driver and the Node worker produce byte-identical output.**

```
### <id> — Change orchestration / a CLI flag
TEMPLATE:    A.5
DEPENDS-ON:  []
GOAL:        Add/modify a driver behavior without changing per-construct transform output.
FILES-ALLOWED:   src/transform.ts, src/transform-component.ts, src/transform-service.ts,
                 src/cli.ts, src/worker.ts, jac/codemod.jac, test/**
FILES-FORBIDDEN: src/parse/**, src/ir/**, src/emit/** (transform semantics live there)
INPUTS:      the existing CLI surface; the Jac<->Node JSON-RPC contract
NON-GOALS:   changing what a construct emits (that's an emit task)
STEPS:
  1. Make the change behind a flag; default behavior unchanged.
  2. If you touch the Jac driver AND the Node worker, assert byte-identical output on a fixture.
NEW-TESTS:   a CLI/driver test; and a Jac-vs-Node parity assertion if both paths touched.
RED-PROOF:   run it; confirm failure pre-impl; paste output.
FALLBACK:    n/a — orchestration must be deterministic; if it can't be, STOP.
DONE-CHECK:  npm test; diff(Jac output, Node output) == empty on the fixture.
ESCALATE-IF: Jac and Node outputs diverge and you can't reconcile -> BLOCKED, stop.
```

## A.6 — Evidence layer: type oracle, ledger, recipes — TEMPLATE

Keep these **general** — they must work on any Angular app, not the current fixture.
- **`--scaffold`** emits a Vite+React+TS project; `tsc --noEmit` is the **type oracle**. It catches
  won't-compile (unresolved hooks, unwrapped observables, leftover `@angular/*` imports). It does
  **not** catch plausible-but-wrong runtime behavior — that is Harness B. Keep the scaffold stack
  swappable (the real target's libs differ): stack choices live in config/templates, not inline.
- **`--ledger`** writes stable-ID `residue.jsonl`. Every new residue category must be registered here.
- **`--recipes` / `--learn`** induce reusable fix recipes. A recipe is auto-applicable only after
  ≥2 independent successful applications + an exact fixture snapshot **and human review** (§3.2).

```
### <id> — Extend a type-oracle / ledger / recipe behavior
TEMPLATE:    A.6
DEPENDS-ON:  []
GOAL:        Improve an evidence primitive while keeping it target-agnostic.
FILES-ALLOWED:   the Jac driver + scaffold/ledger/recipe modules + their docs + test/**
FILES-FORBIDDEN: src/parse/**, src/ir/**, src/emit/** — UNLESS the task explicitly registers a
                 new residue category (then emit must produce it; see step 1)
INPUTS:      the residue category vocabulary; the recipe schema; scaffold templates
NON-GOALS:   hardcoding the real target's libraries into the scaffold stack
STEPS:
  1. Adding a residue category means all three: register it in the ledger category list, make emit
     produce it, and make the coverage report count it. Any one missing = a silent drop.
  2. Touching the scaffold stack: put target-specific choices behind config, not inline.
  3. Touching recipes: enforce ≥2-application + snapshot, and human-review before auto-apply.
NEW-TESTS:   ledger round-trip / recipe replay / scaffold `tsc` assertion as appropriate.
RED-PROOF:   run it; confirm failure pre-impl; paste output.
FALLBACK:    n/a.
DONE-CHECK:  npm test; ledger line count sane; scaffold `tsc --noEmit` = only residue errors.
ESCALATE-IF: a change would make residue harder to count, or let a recipe auto-apply without
             human review -> STOP; that breaks the trust model.
```

## A.7 — Open construct tickets (queued in §7)

Each ticket is one instance of A.1→A.2→A.3 (or its stated variant), with the two-fixture rule and
a residue fallback. Per-ticket detail is in `TICKETS.md` (T-1..T-8); this plan is the *method*. The
queue in §7 lists them in leverage order.

> **Stop line.** After A-T8 the deterministic compiler is essentially tapped. Remaining residue
> (`di`, `rxjs` keep-vs-convert, `effect`/`state` verify) is **Tier B/C — not codemoddable**, and
> attempting to codemod it is a forbidden cheat move (§3.2): that is the #1 source of
> plausible-but-wrong output. The next investment is Harness B, which gates trust for the stubs
> these tickets leave behind.

---

# HARNESS B — parity-harness

> The behavioral oracle. One `ParityCase` runs against a **real Angular** and a **real React**
> workbench under one jsdom; each checkpoint yields a normalized `Observation`; the contract is
> checked on both sides and React is diffed against the Angular baseline → a `Divergence`.
> ```
> ParityCase ─┬─ AngularAdapter ─┐
>             └─ ReactAdapter  ──┴─ runner → observe → normalize → diff → gate
> ```
> This is the **acknowledged keystone gap** for trust-at-scale. The type oracle (Harness A)
> catches "won't compile"; only Harness B catches "compiles but behaves wrong" (wrong effect
> order, missing teardown, off-by-one derived render).
>
> **§B.1–B.7 are TEMPLATES, not tasks.** Schedulable work is in [§7](#7-the-task-queue-the-only-schedulable-work).

## B.1 — ParityCase + schema + validate — TEMPLATE

Files: `src/types.ts`, `src/schema/parity-case.schema.json`, `src/validate.ts`. The framework-
neutral recipe: *what to do and what to observe*, never *how a framework bootstraps*.

```
### <id> — Add a Step / contract assertion type
TEMPLATE:    B.1
DEPENDS-ON:  []
GOAL:        Extend the neutral case vocabulary (a new Step or ExpectedAtCheckpoint field).
FILES-ALLOWED:   src/types.ts, src/schema/parity-case.schema.json, src/validate.ts, test/**
FILES-FORBIDDEN: src/adapters/** (adapters implement it in a separate B.2 task)
INPUTS:      the existing Step union / ExpectedAtCheckpoint shape
NON-GOALS:   framework-specific semantics in the case (cases are neutral by definition)
STEPS:
  1. Add the Step/field to types.ts AND the JSON schema (keep them in lockstep).
  2. Update validate.ts to accept it and reject a malformed one.
  3. Every new Step must be implementable by BOTH adapters, or it doesn't belong in the case.
NEW-TESTS:   validate() accepts a case using the field; rejects a malformed one.
RED-PROOF:   run it; confirm failure pre-impl; paste output.
FALLBACK:    n/a.
DONE-CHECK:  npm test; npm run parity -- validate <a case using the new field>  # passes.
ESCALATE-IF: the Step can only be expressed for one framework -> it's not neutral, STOP.
```

## B.2 — Adapters — TEMPLATE

Files: `src/adapters/angular.ts`, `src/adapters/react.tsx`, `src/adapter.ts`. The **only** place
framework code lives. Both implement `mount / setInputs / settle / drainEvents / observe /
dispose`. **Symmetry is the law.** Settle: Angular waits on zone `isStable`; React uses `act()` +
real microtask ticks; both must be quiescent before `observe`.

```
### <id> — Change adapter capability (both sides)
TEMPLATE:    B.2
DEPENDS-ON:  [the B.1 task, if a new Step drives it]
GOAL:        Teach both adapters a new capability, symmetrically.
FILES-ALLOWED:   src/adapters/angular.ts, src/adapters/react.tsx, src/adapter.ts, test/**,
                 units/**/{angular.ts,react.tsx}
FILES-FORBIDDEN: src/runner.ts, src/diff.ts, src/gate.ts, src/normalize.ts, src/contract.ts
INPUTS:      the adapter contract in src/adapter.ts; the shared pure logic in units/**/{i18n,classes}.ts
NON-GOALS:   leaking jsdom specifics into the runner; asymmetric behavior between adapters
STEPS:
  1. Implement in BOTH adapters, reusing the SAME shared pure-logic module (no copy).
  2. Respect settle: don't observe before the framework is quiescent.
  3. Keep everything jsdom-swappable — no assumption that blocks a later Playwright re-host.
NEW-TESTS:   a case producing IDENTICAL observations on both adapters for a known-correct unit.
RED-PROOF:   run it; confirm failure pre-impl; paste output.
FALLBACK:    n/a — an adapter can't "residue". If a framework genuinely can't do it, STOP.
DONE-CHECK:  npm test; npm run parity -- run <unit>  # zero divergence on the correct unit.
ESCALATE-IF: you can only implement it on one side -> STOP (asymmetry breaks the oracle).
```

## B.3 — Observe + normalize — TEMPLATE

Files: `src/observe.ts`, `src/normalize.ts`. Capture *semantic, user-observable* signal (aria /
visibleText / focus / events / network / styles / console); normalize away framework-incidental
noise. **Never raw HTML.**

```
### <id> — Add a normalized observation channel
TEMPLATE:    B.3
DEPENDS-ON:  []
GOAL:        Capture a new user-observable signal as a NORMALIZED channel (never raw HTML).
FILES-ALLOWED:   src/observe.ts, src/normalize.ts, src/types.ts (Observation), src/schema/**,
                 src/baseline.ts, baselines/**, test/**
FILES-FORBIDDEN: any innerHTML/raw-HTML comparison; any framework import in these files
INPUTS:      the adapter contract (capture only through it, not framework internals)
NON-GOALS:   capturing DOM structure; asymmetric capture between adapters
STEPS:
  1. Add the channel to the Observation type + schema.
  2. Capture it in observe.ts from BOTH adapters symmetrically, via the adapter contract.
  3. Normalize away framework-incidental noise so only real behavioral differences survive.
  4. This changes the Observation schema -> bump the harness version and regenerate baselines in
     THIS task (Invariant B6), not a follow-up.
NEW-TESTS:   two units that agree -> zero divergence; a seeded-difference unit -> a precise
             Divergence on this channel.
RED-PROOF:   run it; confirm failure pre-impl; paste output.
FALLBACK:    n/a.
DONE-CHECK:  npm test; npm run parity -- run  # baselines regenerated; no spurious drift.
ESCALATE-IF: the only way to capture the signal is raw DOM/HTML comparison -> STOP; find the
             normalized semantic form or don't add the channel.
```

## B.4 — Runner + diff + gate + contract — TEMPLATE

Files: `src/runner.ts`, `src/diff.ts`, `src/gate.ts`, `src/contract.ts`. The framework-neutral
core; consumes ONLY `ParityCase` + `Observation`. **No framework import may ever appear here.**
Acceptance (all five must hold): (1) Angular baseline satisfies the contract; (2) React satisfies
the same contract; (3) React's normalized observations match the Angular baseline (zero
divergence); (4) the cached baseline shows no drift; (5) the gate finds every public input/output
covered / irrelevant / waived.

```
### <id> — Change runner / diff / gate / contract
TEMPLATE:    B.4
DEPENDS-ON:  []
GOAL:        Improve the neutral core (diff policy, gate rule, settle protocol) framework-blindly.
FILES-ALLOWED:   src/runner.ts, src/diff.ts, src/gate.ts, src/contract.ts, test/**
FILES-FORBIDDEN: any @angular/* or react* import in these files (grep-enforced)
INPUTS:      ParityCase, Observation, Divergence types
NON-GOALS:   framework-specific branching in the core ("if angular then ..." is a bug)
STEPS:
  1. The change must be expressible purely over ParityCase/Observation.
  2. A failed check must still yield a Divergence (first checkpoint+channel+path), not a boolean.
  3. If diff policy changes what counts as equal, re-justify that each proof unit still passes.
NEW-TESTS:   core.test.ts cases; a divergence-shape assertion (the counterexample is precise).
RED-PROOF:   run it; confirm failure pre-impl; paste output.
FALLBACK:    n/a.
DONE-CHECK:  npm test; npm run parity -- run  # all units accepted; divergences (if any) precise.
ESCALATE-IF: you need framework info in the core to decide -> STOP; the fix is a new normalized
             Observation channel (B.3), not a framework import in the core.
```

## B.5 — Baseline + provenance — TEMPLATE

File: `src/baseline.ts`. Baseline key = `sourceCommit + componentHash + caseHash + fixtureHash +
harnessVersion`. A stale baseline = phantom green = the worst failure a trust tool can have.

**First-run bootstrap (critical).** When a *new* unit is added there is no Angular baseline yet.
The Angular side *generates* the first baseline, but "whatever Angular did" is not automatically
correct — it may contain the very bug you're checking for. So a first baseline must be
**human-confirmed against the unit's `io.json` contract** before it is trusted, and that
confirmation is recorded as a commit artifact (a note in the commit body / a `confirmed: true`
marker). An unconfirmed baseline may not gate a React candidate.

```
### <id> — Keep baselines honest across a change
TEMPLATE:    B.5
DEPENDS-ON:  [the change task that touched observation/adapter/schema]
GOAL:        Ensure baselines reflect the change and remain trustworthy.
FILES-ALLOWED:   src/baseline.ts, baselines/**, test/**
FILES-FORBIDDEN: src/runner.ts, src/diff.ts, src/gate.ts
INPUTS:      the baseline key components; the affected unit's io.json contract
NON-GOALS:   silently accepting a regenerated baseline
STEPS:
  1. If schema/adapter/normalization changed: bump harnessVersion.
  2. Regenerate baselines, then eyeball the diff. A change you can't explain is a real behavior
     change — investigate before committing.
  3. For a brand-new baseline: confirm it against io.json and record the confirmation artifact.
NEW-TESTS:   n/a (this task validates data, not code) unless you touch baseline.ts logic.
RED-PROOF:   n/a unless code changed.
FALLBACK:    n/a.
DONE-CHECK:  npm run parity -- run  # no unexplained drift; key reflects the change.
ESCALATE-IF: baselines change in a way you can't attribute to your edit -> STOP.
```

## B.6 — Proof units (`units/`) — TEMPLATE

Each unit = `{angular.ts, react.tsx, case.*.json, io.json}` + a shared pure-logic module. Two
exist (`item-count`, `slot-group`). Growing units is how the oracle's coverage grows.

```
### <id> — Add a parity proof unit
TEMPLATE:    B.6
DEPENDS-ON:  [any B.2/B.3 task for behaviors the unit needs]
GOAL:        Prove one migration motif behaves identically in Angular and React.
FILES-ALLOWED:   units/<name>/**, test/<name>.test.ts, baselines/<name>/**
FILES-FORBIDDEN: src/runner.ts, src/diff.ts, src/gate.ts (a unit must need no core change; if it
                 does, that's a separate B.4/B.2 task first)
INPUTS:      the shared pure logic (import into BOTH workbenches — no copy)
NON-GOALS:   copying logic between the two workbenches (divergence must mean a real bug)
STEPS:
  1. Author the neutral ParityCase(s): inputs, steps, checkpoints, expected contract.
  2. Build both workbenches importing the SAME shared logic module.
  3. Author io.json (the public I/O inventory) so the gate can prove full coverage.
  4. Record the Angular baseline and CONFIRM it against io.json (B.5 bootstrap). Then confirm
     React matches with zero divergence.
NEW-TESTS:   the unit's cases pass the 5-part acceptance; a deliberately-broken React variant
             yields a precise Divergence (proves the oracle can actually catch the bug).
RED-PROOF:   run the broken-variant test first; confirm it Diverges as expected; paste output.
FALLBACK:    a behavior you can't yet observe is a B.3 dependency — STOP and do it first.
DONE-CHECK:  npm test; npm run parity -- run <unit>  # accepted; gate finds full I/O coverage.
ESCALATE-IF: the unit needs the core to branch on framework -> STOP; fix via channel/adapter.
```

## B.7 — Future re-host (Playwright + real dev servers)

**Do not build yet.** Recorded as a non-goal for the jsdom slice. The adapter contract exists so
this is possible without touching runner/diff/gate. When it's time: implement new adapters
satisfying the same `mount/setInputs/settle/drainEvents/observe/dispose` contract against
Playwright pages; the neutral core is reused untouched. If a jsdom assumption has leaked past the
adapters (Invariant B8), that leak is what will block this — the §5 greps should already catch it.

---

# HARNESS C — Migration Execution Loop (verify → fix → learn)

> Harness A converts. Harness B judges behavior. **Harness C is the loop that drives converted
> code to green and compounds what it learns doing so.** This is the part the user asked about,
> and it is mostly **greenfield** — see the honest ground-truth below before building.

## C.0 — Ground truth (what exists vs what you are building)

Verified against `tools/codemod-harness/jac/codemod.jac` (all the ledger/recipe/scaffold logic
lives in that one file; `src/cli.ts` only has `--dry-run`/`--report`; `src/worker.ts` is a dumb
6-method RPC). **Do not assume the loop exists — it does not.**

| Piece | Reality today | Implication for the loop |
|---|---|---|
| **Ledger** (`residue.jsonl`) | Real. Stable 8-char sha1 ids; fields `id/file/category/fix_shape/reason/cluster_id/deps/priority/status/mode/recipe`. Status **carry-forward** across runs is implemented. | This is your worklist and audit spine. Reuse it. |
| **Status transitions** | **Missing.** All 356 records are `status:"open"`; nothing in code ever sets `done`/`blocked`/`wontfix`. | The loop must own status transitions. |
| **Type oracle** (`--scaffold`) | Emits a Vite+React+TS project but **does not run tsc** — it prints the command. | The loop must run `tsc` and route errors back to the ledger. |
| **Parity oracle** (Harness B) | Real but only 2 units; not wired to residue at all. | The loop's second, stronger gate. Grows one unit at a time. |
| **Recipes** (`--recipes`/`--learn`) | Real store; 13 seed recipes; induction is **crude whole-word backtick-token replacement, no AST**. **Application is annotation-only** — renders a suggestion into the ledger's `recipe` field, never edits `.tsx`. **No promotion gate** — `occurrences` is counted but never read. | Keep as a *suggestion* layer. Do NOT auto-apply. Real mechanical learning graduates into the codemod (Tier 1 below), not this store. |
| **migrate-residue skill** | Doc-only. Holds the category→canonical-fix mapping. Assumes a human agent hand-fixes everything. | This is the executor's playbook. The loop operationalizes it. |
| **Any convert→verify→fix loop** | **None.** Deliberate ("don't build a loop; the agent runs tsc itself"). | You are building the missing orchestration spine — thin, not an 8-module engine. |

**Design stance (from the advisory):** v1 is *the existing pieces + a thin spine*, not a new
engine. The spine = commit trailers (audit) + status transitions + automated verify + keyed
lesson retrieval + a project fact sheet. Anti-unification, recipe auto-apply, and versioned
invalidation are **later** — their real output is codemod PRs, not a runtime rule engine.

## C.1 — The loop (state machine)

One residue item at a time, one commit each, same rules as everywhere (§2/§3). "Escalation is a
success path."

```
        ┌─────────────────────────────────────────────────────────────┐
        │  pick next residue item                                      │
        │  (ledger: highest priority, deps satisfied, status=open)     │
        └───────────────┬─────────────────────────────────────────────┘
                        ▼
        retrieve context: matching recipe (suggestion) + top-k lessons
        (lessons.jsonl by category+fix_shape) + project facts (facts.md)
                        ▼
        ┌─────────── apply ONE fix ───────────┐
        │  recipe/lesson suggests a shape →    │   (agent writes the edit by hand;
        │  agent adapts it to this file;       │    recipes are NOT auto-applied)
        │  else agent proposes from the        │
        │  category canonical fix (skill)      │
        └───────────────┬─────────────────────┘
                        ▼
        VERIFY  (C.2):  ① type oracle: scaffold + `tsc --noEmit`
                        ② parity oracle (if a unit covers this behavior)
                        ▼
              ┌─────────┴───────────┐
          green                    red (tsc error OR Divergence)
              ▼                     ▼
   commit (trailer: residue-id,   diagnose FIRST failure only;
   done-state, oracle results);   retry within budget (§3.9), with
   set ledger status=done;        tighter cap on "moved the divergence"
   LEARN (C.4): append lesson,    than on "same failure"; else write
   append facts, propose recipe   BLOCKED-<id>.md, set status=blocked,
                                   escalate. A HUMAN fix here is the
                                   highest-value lesson — it also learns.
```

**Two done-states, not one (critical).** Record *which oracle* validated each item:
- `done:type` — compiles, no behavioral proof. **Weaker.** Most Tier B/C items pass `tsc`
  trivially while being behaviorally wrong. A `done:type` item may **not** seed a promoted lesson.
- `done:parity` — a parity unit exercised the changed behavior and matched Angular. **Trusted.**

### C.1.5 — Component contracts (the swap seams)

The loop above must depend on **interfaces, not files** — same discipline as the Harness A IR seam
and the Harness B adapter contract. Each box in the state machine is one pluggable component behind a
small TS interface in `migration/loop/contracts.ts`. Swapping a component (jHipster→real target;
`lessons.jsonl`→a vector store; `tsc`→a different type checker; hand-fix→an LLM fix-applier) means
**writing a new class that implements the interface — never editing the loop driver.** The loop
imports only these types; the concrete impls are wired in one `loop/config.mjs` factory.

**Runtime story (pin it, or a weak model deadlocks on imports):** the whole loop runs under
`tsx` (`npx tsx migration/loop/driver.mts`). Contracts live in `contracts.ts` and are imported as
types by `.mts` modules; there is **no** plain-`node` `.mjs`→`.ts` import anywhere. Every `.mjs`
name in a build sheet is `.mts` run via `tsx`. One runtime, no mixed module systems.

```ts
// migration/loop/contracts.ts — the only thing the loop driver imports.
export interface Picker {        // "pick next residue item"
  next(): ResidueItem | null     // priority ASCENDING (1 = highest), deps satisfied, status=open
  setStatus(id: string, s: 'doing'|'done:type'|'done:parity'|'blocked'): void
}
export interface ContextStore {  // "retrieve context"
  retrieve(item: ResidueItem): RetrievedContext  // lessons ALL labeled 'proposed/unverified' in v1
  appendLesson(l: Lesson): void          // PROPOSE only; writes lessons.jsonl (append-only) + id
  appendFactProposal(f: FactProposal): void      // facts-proposals.jsonl ONLY; never facts.md
}
export interface FixApplier {    // "apply ONE fix" — v1 impl PAUSES for the human/agent
  apply(item: ResidueItem, ctx: RetrievedContext): FixResult   // returns SELF-REPORTED files (untrusted)
}
export interface Oracle {        // "verify" — whole-PROGRAM, not per-item (tsc is global)
  readonly kind: 'type'|'parity'
  covers(item: ResidueItem): boolean          // parity oracle returns false when no unit exists
  verify(items: ResidueItem[]): Verdict[]     // one Verdict per covered item; type oracle diffs baseline
}
export interface Committer {     // the driver-side firewall: trusts git, not the applier
  touchedFiles(): string[]       // from `git status --porcelain`, NOT FixResult
  assertWithinAllowlist(item: ResidueItem, touched: string[]): void  // throws if outside; see C-L4
  commit(item: ResidueItem, verdicts: Verdict[], lessonId: string|null): void  // trailer + append-before-commit
}
export interface RetryPolicy {   // budget lives here, NOT inline in driver.mts
  shouldRetry(item: ResidueItem, history: Verdict[]): boolean   // §3.9 caps; divergence-chase cap < same-failure cap
}
export interface PromoteGate {   // offline, behind the firewall (C.4.1) — NOT called by the loop
  evaluate(candidate: Lesson): { promote: boolean; scoreVector: UnitScore[]; regressions: string[] }
}
```

**The swap table (what each contract lets you replace without touching the loop):**

| Contract | v1 impl (jHipster demo) | Swap to (real target / later) |
|---|---|---|
| `Picker` | reads `residue.jsonl` | same file, real-target residue; or a DB |
| `ContextStore` | `lessons.jsonl` grep + `facts-proposals.jsonl` grep | vector store / embeddings; different key |
| `FixApplier` | agent hand-edit (pauses) | an LLM auto-fixer; a codemod-rerun |
| `Oracle[]` | `[TypeOracle(tsc)]`; `ParityOracle` when units cover it | swap `tsc`→another checker; add oracles |
| `Committer` | `git status` allowlist + trailer | signed commits; a PR-per-item bot |
| `RetryPolicy` | §3.9 3-strike + divergence cap | per-target budget; an escalation policy |
| `PromoteGate` | `evaluate-candidate.mts` (C-L5, **deferred**) | different scoring; a human panel |

**Why `Committer` and `RetryPolicy` are contracts, not driver code:** Fable's review caught that
retry/budget and commit/allowlist enforcement were leaking into `driver.mts` — and those are exactly
the policies that change per target. If a change forces editing `driver.mts`, the seam is wrong
(§3.7). The driver body is only: `pick → retrieve → apply → verify → (green: append-lesson then
commit) | (red: retry-or-block)`, every verb a contract call.

Rule: **any new capability is a new impl of one contract + one line in `config.ts`.** If a change
forces editing `loop/driver.ts`, the seam is wrong — stop and escalate (mirrors §3.7).

## C.2 — Verification automation — TEMPLATE

**Role.** Turn the two oracles from "the agent runs a command by hand" into a scripted gate that
emits a machine-readable verdict the loop consumes.

```
### <id> — Automate an oracle gate
TEMPLATE:    C.2
DEPENDS-ON:  []
GOAL:        Run an oracle and emit a structured pass/fail the loop can branch on.
FILES-ALLOWED:   tools/codemod-harness/jac/** (a --verify action), a thin runner script, docs, tests
FILES-FORBIDDEN: src/parse/**, src/ir/**, src/emit/** (verification observes output, doesn't transform)
INPUTS:      the scaffold output dir; residue.jsonl; the parity harness CLI
NON-GOALS:   fixing anything; changing what the codemod emits
STEPS:
  1. TYPE oracle: scaffold to a dir, run `tsc --noEmit`, parse errors into
     {file, line, code, message}. Map each error back to a residue id where possible
     (same file + symbol), so a red tsc becomes "these residue items are unresolved".
  2. PARITY oracle: run `npm run parity -- run <unit>`; capture the Divergence JSON
     (checkpoint+channel+path) on failure. Zero-divergence = pass.
  3. Emit a single verdict record per item: {oracle: type|parity, status: pass|fail,
     detail: <errors|divergence>}. This is what C.1 branches on.
NEW-TESTS:   feed a known-broken scaffold -> expect the mapped residue ids; a known-good -> pass.
RED-PROOF:   run against a deliberately broken fixture first; paste the failure.
FALLBACK:    if an error can't be mapped to a residue id, record it as an UNATTRIBUTED failure
             (visible, never dropped) — a new residue category candidate.
DONE-CHECK:  npm test; the verify action prints a structured verdict on a fixture.
ESCALATE-IF: tsc reports framework noise (not residue) -> the scaffold stack is wrong, not the
             code; fix the scaffold (A.6), don't paper over it.
```

## C.3 — Fix application — TEMPLATE

**Role.** Apply exactly one fix to one residue item, by hand, guided by (in priority order) a
matching recipe suggestion, retrieved lessons, then the category canonical fix from the skill.
**Recipes are never auto-applied** (they're annotation-only by design and stay that way in v1).

```
### <id> — Resolve one residue item
TEMPLATE:    C.3
DEPENDS-ON:  [C.2 automated verify exists; deps of THIS residue item are status=done]
GOAL:        Move one residue item to done:type or done:parity.
FILES-ALLOWED:   the migrated target file(s) for this item; migration/lessons.jsonl;
                 migration/facts.md
FILES-FORBIDDEN: the codemod src/ (a fix that belongs in the converter is a Tier-1 codemod PR,
                 not a hand-edit here — see C.4)
INPUTS:      the residue record (category, fix_shape, reason, deps); the matching recipe if any;
             top-k lessons for this category+fix_shape; project facts
NON-GOALS:   fixing more than one item; batch-applying a pattern across files (§3 firewall);
             attempting a Tier B/C item as a codemod (§3.2 forbidden)
STEPS:
  1. Read the residue record + retrieved context. If a project fact already fixes it
     (e.g. `AccountService -> useAccount()`), use it verbatim — do not reinvent.
  2. Apply ONE edit. For DI/provider items, fix the provider/hook BEFORE its consumers
     (deps order); land the fact-sheet entry for a shared service before fanning out.
  3. Verify via C.2. Record which oracle passed (done:type vs done:parity).
NEW-TESTS:   n/a for a hand-fix, but if a parity unit covers the behavior, it must stay green.
RED-PROOF:   n/a (this consumes the oracle, doesn't add a harness test).
FALLBACK:    can't resolve within budget -> BLOCKED-<id>.md, status=blocked, escalate.
DONE-CHECK:  C.2 verdict = pass; ledger status set; commit carries the trailer (C.4).
ESCALATE-IF: the same fix would apply to >1 file -> STOP; that's a codemod gap (Tier 1), file it
             as a codemod task, don't hand-fix N copies (sibling-monoculture trap).
```

## C.4 — The learning system (tiered; the answer to "keep learning")

Learning is **not one thing**. Three tiers by how much autonomy each safely allows, plus a set of
distinct stores. The weak executor may **propose** to any store; only oracles + human review may
**promote**; only Tier 1 ever changes behavior mechanically — and it does so by graduating into the
codemod, reviewed, not by a runtime rule engine.

**Tiers**
- **T1 — Mechanical rule.** A fix that is provably context-free after the fact (its precondition is
  syntactically decidable). These are **codemod gaps**: the right home is a PR against `src/` (a new
  IR node + parse + emit), not the recipe store. Anti-unification is only ever appropriate here.
- **T2 — Worked exemplar (retrieval-only).** `{category+fix_shape, before/after diff, the tsc
  error / Divergence that motivated it, the residue reason, commit sha, which-oracle}`. Injected
  into the agent's context when a similar item comes up. **No autonomy, no auto-apply.** Most Tier
  B/C learning lives here.
- **T3 — Playbook.** Category/library-scoped prose (grow the `migrate-residue` skill). Human-curated,
  agent-proposed.

**Distinct stores** (all plain in-repo files under `migration/`, versioned with the code so a
checkout is a consistent code+lessons snapshot):
1. **`migration/lessons.jsonl`** (append-only, T2). The v1 workhorse. Keyed retrieval by
   `category+fix_shape` — literally grep + inject **champion + ≤2 challengers** (C.4.1), no matching
   engine, no embeddings (18 categories don't need them). **Required schema fields:**
   `{category, fix_shape, before/after diff, which_oracle, commit,
   evidence: {counterexample, units_won[], units_regressed[]}}`. A lesson with no `counterexample`
   citation is auto-rejected at the promote gate (C.4.1). Negative lessons carry the same schema; their
   score component is "regressions prevented," evaluated by replaying the quarantined failures.
2. **`migration/facts.md`** — the **project fact sheet**: `service→hook` map, library mappings
   (Transloco→…, the vendor UI→…), route table, provider→context. Highest ROI for the `di`-dominated
   ledger (112 of 356 items). The agent appends on green; a human skims periodically.
3. **`migration/recipes/`** — promoted recipes only, one human-readable file each with evidence
   links. The existing `recipes.jsonl` induction stays a *suggestion* feed into the ledger.
4. **Negative lessons** — anti-patterns ("converting `valueChanges.pipe(debounceTime)` to a naive
   watch loses debounce — always flag"). Appended to `lessons.jsonl`. Cheap, safe (only add caution).
5. **Diagnosis shortcuts** — `tsc/divergence pattern → likely category` ("TS2551 on `.subscribe`
   after convert = missed `rxjs` residue, not a new bug"). Saves retry budget.
6. **Oracle hygiene** — flaky-settle signatures, per-fixture channel masks. **Quarantined
   per-fixture, never global** (a global mask learned from flake blinds the oracle). Start as a
   manual `migration/masks.json`.

**The propose/promote split (the anti-poisoning firewall).** The weak agent writes ONLY to the
append-only proposal streams (`lessons.jsonl`, `facts.md`, recipe *proposals*). Promotion to
`migration/recipes/` (or folding a T1 into the codemod) is a **separate, human-or-strong-model
step**. This single split kills most of the poisoning risk.

### C.4.1 — Evaluation geometry (GEPA-derived; the promote gate is *measured*, not judged)

We reviewed two SOTA "agent evolves as it works" methods — **GEPA** (Genetic-Pareto reflective
prompt evolution, arxiv 2507.19457) and the **textual-gradient-over-`skills.md`** family
("SkillOpt"/TextGrad). Verdict (Fable + author, agreed): **adopt GEPA's evaluation *geometry*;
reject its mutation *topology*.** GEPA assumes a *strong* optimizer editing a shared artifact in
place — our executors are weak, so in-place mutation of a shared prompt/skill is exactly the silent,
unbounded-blast-radius poisoning our propose/promote firewall exists to stop. GEPA slots in **behind**
the firewall, at the promote gate; it does not replace it. (The papers' central empirical claim —
rich natural-language feedback beats scalar reward — *validates* our two-oracle asymmetry: the parity
`Divergence` is Actionable Side Information; `done:type` is the near-scalar. Keep the asymmetry.)

**What we adopt:**
- **The candidate is a proposed lesson + its retrieval effect** — i.e. `lessons.jsonl` state `S`
  vs `S+L`. NOT the codemod config (that's already PR-gated code — evolve it as code, §T1) and NOT
  the skill prose (too coarse to mutate safely at runtime).
- **Score vector, one component per frozen migration unit** (module/fixture), valued
  `done:parity > done:type > fail`, plus a **regression bit** per previously-green unit. Your fixture
  corpus + `masks.json` is GEPA's minibatch. `done:type` may *filter* a candidate but never *counts
  as a Pareto win* (Goodhart guard: a "cast to `any`" lesson improves the type minibatch and poisons
  behavior).
- **Pareto pool, not one canonical lesson per category.** Keyed retrieval by `category+fix_shape` is
  already a pool in disguise; formalize as **champion + challengers** per category. Runtime injects
  the champion by default; a challenger is surfaced only when the champion's category just failed.
  Cap what the weak runtime sees (champion + ≤2 challengers) — a big pool = nondeterministic executor.
  The full pool lives offline in the evaluator.
- **`system-aware merge` is free**: lessons are additive documents — two lessons winning disjoint
  units = append both. No merge machinery.
- **Every proposed lesson must cite its counterexample** (the exact parity `Divergence`
  checkpoint+channel+path, or the tsc error). No citation → auto-reject at promote. This is GEPA's
  "reflect on traces, not scalars," and it makes promotion machine-checkable.

**Where it plugs in:** a new offline evaluator `migration/evaluate-candidate.mjs` sits **between
PROPOSE and PROMOTE**. It replays the residue loop over N frozen units *with* and *without* the
candidate lesson and emits the score vector + regression bits. Promote iff **non-dominated AND zero
parity regressions AND ≥2 component wins in different modules** — this *replaces* the old asserted
"cross-module ≥2" heuristic (C.5) with a measured one.

**`skills.md` / textual gradient — the safe relocation:** `facts.md` *is* our `skills.md` (a
service→hook map, project invariants). The weak agent appends evidence-linked proposals to
`facts-proposals.jsonl`; a **strong model computes the "gradient" offline** at epoch boundaries
(reads accumulated proposals + failing traces → emits a diff to `facts.md`), validated by full
replay, landed as a reviewed PR. The weak agent never holds the pen on the shared artifact. Same
treatment, rarer, for the `migrate-residue` skill prose (T3): version it, A/B on frozen units, PR.
This is the entire useful content of SkillOpt, run **cold and on the safe side of the firewall**.

```
### <id> — Wire a learning store into the loop
TEMPLATE:    C.4
DEPENDS-ON:  [C.1 loop, C.2 verify]
GOAL:        On a green fix, append the lesson/fact; on pickup, retrieve and inject it.
FILES-ALLOWED:   migration/lessons.jsonl, migration/facts.md, migration/masks.json,
                 the loop driver's retrieve/append hooks, docs, tests
FILES-FORBIDDEN: migration/recipes/** by an executing agent (promotion is a separate human step)
INPUTS:      the green fix's diff + oracle verdict + residue record
NON-GOALS:   auto-applying lessons; embedding/similarity retrieval; promotion
STEPS:
  1. APPEND on green: write a T2 lesson keyed by category+fix_shape, stamped with which-oracle
     (only done:parity may later seed a promoted recipe; done:type is retrieval-only).
  2. RETRIEVE on pickup: grep lessons + recipe suggestion + facts for this item; inject top-k.
  3. A shared-service resolution appends a fact (service→hook) BEFORE fan-out.
NEW-TESTS:   append→retrieve round-trip; a done:type lesson is never marked promotable.
RED-PROOF:   run retrieval on an empty store, then after one append; paste both.
FALLBACK:    n/a.
DONE-CHECK:  npm test; a two-item sequence shows item 2 receiving item 1's lesson.
ESCALATE-IF: you're tempted to auto-apply a lesson or write to recipes/ -> STOP; that's promotion.
```

## C.5 — Safety rails (encode these as rules, not hopes)

Add these to §3 enforcement for any C-loop work:
- **Amplification firewall.** A recipe/lesson is never batch-applied. One item, one commit, each
  carrying `applied-lesson: <id>` in the trailer. Rollback = `git log --grep`; blast radius = number
  of commits, each independently re-verifiable.
- **Cross-module diversity for promotion — now MEASURED (C.4.1).** Promotion runs
  `evaluate-candidate.mjs`: replay N frozen units ± the candidate lesson → score vector + regression
  bits. Promote iff **non-dominated AND zero parity regressions AND ≥2 component wins in different
  modules**. Two near-identical siblings still count as one data point (same module → one component).
  This replaces the old eyeball heuristic; the gate is a script, not a judgment.
- **Front-load the first instance.** The *first* time a `fix_shape` is fixed, it seeds every
  sibling — so a strong model or human reviews the first instance of each `fix_shape` before the
  pattern spreads.
- **`done:type` may not promote.** A lesson learned from a tsc-only-green item is retrieval-only
  until a parity unit confirms the behavior. Otherwise the store fills with type-plausible,
  behaviorally-wrong fixes.
- **Quarantine triggers (automatic), wired to Pareto refresh (C.4.1).** A later parity regression on
  a file → every lesson whose commit touched it → `status: suspect`, commits flagged for re-verify;
  a **promoted** champion whose evidence units later flip is **auto-demoted to challenger**, not just
  flagged (this is GEPA's frontier refresh). Version drift (Angular/compiler/target-stack/model) →
  `stale`, demoted to exemplar (never hard-deleted). 2 misfires (matched but the item still
  escalated) → `quarantined`.

## C.6 — Sequencing traps (encode as loop rules)

- **Topological order.** Fix `di`/provider items before the components that consume them; the ledger
  `deps` field carries this — the pick step must respect it.
- **Reconvert after any codemod change.** When a T1 lesson graduates into the codemod, re-run
  convert → reconcile the ledger (ids may disappear/change) → *then* continue. Never fix residue
  against a stale conversion.
- **Divergence-chasing cap.** The parity diff reports the *first* divergence; a fix that merely
  moves it later looks like progress and can loop forever. Cap "different-divergence" retries lower
  than "same-failure" retries; oscillating divergence count = escalate.
- **Escalation must learn.** When an item escalates and a human fixes it, that repair is the
  highest-quality lesson — the human path writes to `lessons.jsonl` too, or the store only ever
  learns what the weak agent could already do.

## C.7 — v1 scope (build this; defer the rest)

**v1 (the compounding minimum — no orchestrator):**
0. **C-L0 committed workspace** — convert into in-repo `migration/app/`, populate `span`, record the
   tsc baseline. Everything below dereferences this; it is the true first step (Fable-caught blocker).
1. The loop over the ledger, with **status transitions** (via a `status.jsonl` sidecar; `residue.jsonl`
   stays immutable) and **commit trailers** (`residue-id`, done-state, oracle verdict, `applied-lesson`)
   — the audit spine — plus the **git-status allowlist firewall** and **RetryPolicy/Committer** contracts.
2. **C.2 automated type-oracle gate** (`tsc` on **stdout**, `span`-line mapping, **baseline-diff pass**).
3. **`lessons.jsonl` keyed retrieval** (T2), append-only with a stable `id`, **status in a sidecar**;
   retrieval returns newest ≤3 **unverified** challengers (no champion from a proposed lesson) — using
   the full C.4.1 evidence schema, so the later promote gate is a no-migration add-on, not a rewrite.
4. **`facts.md` project fact sheet** — kills repeated `di` rediscovery. Weak agents append to
   `facts-proposals.jsonl` (retrieval greps it too, labeled unverified); shared `facts.md` changes only
   via a reviewed PR (C-L6).
5. **Quarantine-on-regression** (suspect-only in v1) + the propose/promote split + first-instance review gate.

**Defer (tempting, but not v1):** the GEPA **replay evaluator** `evaluate-candidate.mjs` and the
measured Pareto promote gate (C.4.1) — needs a frozen fixture corpus + both oracles automated first;
until then promotion stays human/strong-model over the same schema, so no rework when it lands. The
offline **`facts.md`/skill epoch-optimizer** (strong-model textual-gradient, PR-gated — the safe
`SkillOpt`) is deferred with it. Also: anti-unification / T1 induction engine (do it
human-in-the-loop — read `lessons.jsonl` periodically, fold obvious mechanical ones into the codemod
as PRs); recipe auto-apply (stays off); versioned invalidation machinery beyond a `versions` stamp +
staleness check; similarity/embedding retrieval; automated oracle-flake learning (start with manual
`masks.json`). The full parity-oracle coverage grows in the background via Harness B (`B-U*` tasks);
until a behavior has a parity unit, its items can only reach `done:type`.

## C.8 — Build sheets (zero-decision; demo corpus: jHipster)

The §C templates above give *intent*; these build sheets give *transcribable literals* so a weak
model makes **no** architectural decisions. Each implements one contract from §C.1.5. **Paths and
fixtures are tagged for the jHipster demo corpus — when the real codebase lands, only the values in
the `SWAP:` lines change; the signatures and the loop do not.** If a sheet's literal doesn't fit the
tree as you find it, that's an escalation, not a freelance redesign.

```
BUILD SHEET — C-L0  (the committed workspace — MUST precede C-L1; Fable-caught blocker)
WHY:         Today conversion output goes to a throwaway /tmp/angular-migration-run-* dir,
             residue.jsonl points at that dead dir, and its `span` field is null in all 356 rows.
             Nothing the loop needs exists on disk. C-L0 creates it.
CODEMOD FIX (small, in tools/codemod-harness): the IR carries SourceLoc but the ledger writer drops
             it — make the ledger emit `span:{startLine,endLine}` from the IR node's loc (grep the
             writer for where a residue record is built; add the two fields). Land as its own commit.
RUN:         convert the jHipster campaign module into an IN-REPO dir migration/app/ (deterministic
             path, committed), NOT /tmp. Regenerate residue.jsonl so every record has:
               file: repo-relative path INTO migration/app/, pointing at the EMITTED .tsx
               span: {startLine,endLine} (non-null)
BASELINE:    run the type oracle once over migration/app/, record total error count into
             migration/loop/baseline.json {tscErrorCount:N}. This is the diff datum C-L1 needs.
COMMIT:      migration/app/** + regenerated residue.jsonl + baseline.json, one commit.
DONE-CHECK:  jq '.[].span' residue.jsonl has zero nulls; every .file resolves under migration/app/;
             baseline.json exists.
SWAP:        the module list to convert; everything else target-independent.

BUILD SHEET — C-L1  (implements Oracle, kind:'type'; DEPENDS-ON C-L0)
NEW FILE:    migration/loop/oracles/type-oracle.mts   (run via tsx)
EXPORTS:     export class TypeOracle { kind='type'; covers(){return true}
                                       verify(items) -> Verdict[] }   // whole-program, see below
CLI WRAP:    npx tsx migration/loop/verify.mts type migration/app --residue <residue.jsonl>
             → writes migration/verdicts/<runId>.jsonl (one Verdict per item); exit code: see PASS.
TSC INVOKE:  spawnSync('npx',['tsc','--noEmit','--pretty','false','-p','migration/app/tsconfig.json'])
             — use `-p <tsconfig>` (NOT a dir); if the scaffold uses project references, invoke the
             leaf tsconfig, not the solution file. tsc exits non-zero on any error — that's expected.
PARSE:       tsc writes diagnostics to **stdout**, not stderr. Read result.stdout. For each line
             matching /^(?<file>.+?)\((?<line>\d+),(?<col>\d+)\): error (?<code>TS\d+): (?<msg>.+)$/
             → {file,line:+line,col:+col,code,message:msg}.
NORMALIZE:   tsc `file` is cwd-relative to migration/app/ and names the .tsx; residue `file` is
             repo-relative into migration/app/ (post-C-L0). Reduce both to
             `<basename without ext>` + parent dir before comparing, so campaign.component.ts's
             residue matches campaign.tsx's errors. State this mapping explicitly; don't assume ===.
MAP→RESIDUE: error attaches to item R iff normalized paths equal AND
             error.line ∈ [R.span.startLine, R.span.endLine]. No match → UNATTRIBUTED (visible).
PASS SEMANTICS (critical — the scaffold has hundreds of baseline errors):
             item R passes iff (attributed-errors-for-R == 0). The RUN passes iff
             (total error count ≤ baseline.json.tscErrorCount) — i.e. this fix added no new errors.
             A fix that clears R's errors AND doesn't raise the total = green. CLI exit 0 iff run passes.
VERDICT:     {residueId, kind:'type', status:'pass'|'fail', detail:[errors]}
TEST:        type-oracle.test.mts — a fixture .tsx with one TS2551 on a line inside a seeded span →
             expect one fail mapped to that residueId; a clean fixture → zero fails, exit 0.
RED CMD:     npx tsx migration/loop/verify.mts type migration/loop/__fixtures__/broken → exit 1
GREEN CMD:   npx tsx migration/loop/verify.mts type migration/loop/__fixtures__/clean  → exit 0
SWAP:        migration/app path, tsconfig path, residue path. (tsc parsing is target-independent.)

BUILD SHEET — C-L2  (the loop driver + Picker + Committer + RetryPolicy; wires Oracles from C-L1)
NEW FILES:   migration/loop/contracts.ts   (from §C.1.5, verbatim)
             migration/loop/picker.mts     (implements Picker over residue.jsonl)
             migration/loop/committer.mts  (implements Committer — the git-status firewall)
             migration/loop/retry.mts      (implements RetryPolicy — §3.9 caps)
             migration/loop/driver.mts     (the state machine; imports ONLY contracts; run via tsx)
             migration/loop/config.mts     (factory: which impls the driver uses)
PICKER:      next() = first item where status==='open' AND every id in item.deps has
             status starting 'done'; ordered by PRIORITY ASCENDING (1=highest) then id. setStatus()
             writes an entry to migration/loop/status.jsonl (sidecar, last-write-wins) — residue.jsonl
             stays immutable after C-L0. next() reads current status = last sidecar entry per id.
DRIVER LOOP: while ((item=picker.next())){ picker.setStatus(item.id,'doing');
             ctx=store.retrieve(item); fix=applier.apply(item,ctx);
             touched=committer.touchedFiles(); committer.assertWithinAllowlist(item,touched); // FIREWALL
             covered=oracles.filter(o=>o.covers(item)); verdicts=covered.flatMap(o=>o.verify([item]));
             green = verdicts.length>0 && verdicts.every(v=>v.status==='pass');
             if(green){ const id=store.appendLesson(makeLesson(item,fix,verdicts)); // APPEND FIRST
                        committer.commit(item,verdicts,id);                          // THEN COMMIT (same tree)
                        picker.setStatus(item.id,bestDoneState(verdicts)); }
             else { diagnoseFirst(verdicts);
                    if(retry.shouldRetry(item,verdicts)) continue;
                    else { writeBlocked(item,verdicts); picker.setStatus(item.id,'blocked'); } } }
DONE-STATE:  bestDoneState = any parity pass → 'done:parity'; else type pass → 'done:type'.
COMMITTER:   touchedFiles() = parse `git status --porcelain` (NOT FixResult — the applier is untrusted).
             assertWithinAllowlist throws unless every touched path ∈ {item's target file(s) under
             migration/app/, migration/lessons.jsonl, migration/facts-proposals.jsonl}. A write to
             facts.md, migration/recipes/**, or a 'promoted' status = throw → item blocked, human review.
             commit() emits trailer lines: `residue-id: <id>`, `done-state: <state>`,
             `oracle: type=<..> parity=<..>`, `applied-lesson: <lessonId|none>`. Lesson append and the
             code edit land in ONE commit (audit chain: residue-id→commit→lesson greppable, GATE-5).
FIX APPLIER (v1): PAUSES for the human/agent to edit; returns self-reported files (the Committer
             ignores them and trusts git). The agent doing C.3 IS this impl in v1.
TEST:        (a) #2 deps-on #1 → picks #1 first; after #1 done, #2 pickable. (b) applier that touches
             facts.md → assertWithinAllowlist throws → item blocked. (c) green item → exactly one
             commit carrying all four trailers + the lesson in the same tree.
RED CMD:     driver with all status=open, oracles stubbed fail → every item 'blocked', BLOCKED-*.md written.
GREEN CMD:   oracles stubbed pass → items done, one commit each, trailers + lesson present, git clean.
SWAP:        Picker source (file→DB); FixApplier (human→LLM); RetryPolicy — driver.mts unchanged.

BUILD SHEET — C-L3  (implements ContextStore; fills appendLesson/retrieve)
NEW FILE:    migration/loop/store.mts (implements ContextStore)
LESSON SHAPE (C.4.1 schema, required):
             {id, category, fix_shape, before, after, which_oracle, commit,
              evidence:{counterexample, units_won:[], units_regressed:[]}}
             id = short hash of (category+fix_shape+after) — stable identity for trailers/quarantine.
             STATUS IS NOT STORED HERE. lessons.jsonl is truly append-only; status lives in the
             sidecar migration/lesson-status.jsonl (last-write-wins {id,status}), written only by
             C-L5 (promote) and C-L4 (quarantine). This makes "only writer of 'promoted'" grep-checkable.
FILES:       lessons → migration/lessons.jsonl (append-only). facts → grep BOTH migration/facts.md
             AND migration/facts-proposals.jsonl (proposals labeled 'unverified').
RETRIEVE (v1 — NO champion from proposed; anti-poisoning, Fable-caught):
             lessons where l.category===item.category AND l.fix_shape===item.fix_shape.
             A lesson is a "champion" ONLY if its sidecar status==='promoted'. In v1 nothing is
             promoted yet, so: return {champion: the promoted one if any (else null),
             challengers: newest ≤3 others ALL labeled 'proposed/unverified',
             facts: grep(facts.md ∪ facts-proposals.jsonl, category)}.
             The driver/agent MUST treat challengers as suggestions to weigh, never to apply verbatim.
FIRST-INSTANCE GATE (from C.5, now enforced): if NO promoted lesson exists for this fix_shape and
             this is its first occurrence, flag the item `needs-first-review` — a human/strong model
             reviews before the pattern can seed siblings. Encoded as a Picker/driver check, not advice.
APPEND:      appendLesson writes one JSONL line WITHOUT status (append-only), returns the id.
             appendFactProposal → facts-proposals.jsonl only; NEVER writes facts.md (offline PR job C-L6).
TEST:        empty store → retrieve {champion:null,challengers:[]}; append one → returned as an
             unverified challenger, champion still null; a sidecar 'promoted' entry → returned as champion.
RED CMD:     retrieve on empty lessons.jsonl → {champion:null,challengers:[]}
GREEN CMD:   two appends same key → both returned as unverified challengers, champion null.
SWAP:        the whole class (grep→vector store) — retrieve()/appendLesson() signatures fixed.

BUILD SHEET — C-L4  (the firewall as code + quarantine script)
NEW FILE:    migration/loop/quarantine.mts
APPEND GUARD (in store.appendLesson): throw if evidence.counterexample is empty, or if the caller
             passes any status field at all (status is sidecar-only, set by C-L4/C-L5, never on append).
FS FIREWALL: the driver-side Committer allowlist (C-L2) is the real guard — a test greps store.mts to
             assert no writeFile/appendFile/createWriteStream targets facts.md or lessons.jsonl-with-status
             (add this grep to seam-check.sh §5, Harness C block).
QUARANTINE:  given a residueId that regressed (later parity fail on a file), find every lesson whose
             commit touched that file (via `git log --grep=applied-lesson`) → sidecar status:'suspect';
             a 'promoted' champion → demote to (no status = proposed) — the Pareto refresh of C.4.1/C.5.
NON-PROMOTABLE: a lesson whose which_oracle==='done:type' is never eligible for 'promoted' (C-L5 refuses).
             (v1 keeps ONLY suspect-on-regression; drop the version-drift/stale/misfire ladder — no
             parity coverage exists to exercise it yet. Re-add when Harness B coverage lands.)
TEST:        appendLesson with a status field → throws; missing counterexample → throws; a seeded
             regression flips exactly the touching lesson's sidecar status to 'suspect'.
RED CMD:     feed a lesson with status/without counterexample → append throws (paste the throw).
GREEN CMD:   valid lesson appends (no status); quarantine on a seeded regression flips exactly it.
SWAP:        regression signal source (parity harness) — quarantine logic unchanged.

BUILD SHEET — C-L5  (implements PromoteGate; GEPA measured promotion, offline) — DEFERRED past GATE-5
PRECONDITION: requires an AUTOMATED FixApplier (replaying a unit ± a lesson means re-running the fix
             with different context). v1's FixApplier pauses for a human, so C-L5 is NOT runnable in
             v1 — keep the C.4.1 lesson SCHEMA now, build this gate only after an LLM FixApplier exists.
NEW FILE:    migration/evaluate-candidate.mts (implements PromoteGate)
CORPUS:      the frozen units under tools/parity-harness/units/ + the jHipster scaffold set.
EVALUATE:    for each unit U: run the loop's oracles on U WITH and WITHOUT candidate lesson L
             injected into that category's retrieval → score(U) = parity>type>fail (2>1>0),
             regressed(U)=true iff score dropped vs baseline.
PROMOTE IFF: L.promotable !== false  AND  zero units regressed  AND
             ≥2 units in DIFFERENT modules improved  AND  L is non-dominated
             (no existing champion beats it on every unit).
ON PROMOTE:  write {id, status:'promoted'} to migration/lesson-status.jsonl (sidecar; lessons.jsonl
             stays append-only). This is the ONLY writer of 'promoted' — grep-enforced in seam-check.
             On a later regression, quarantine.mjs (C-L4) demotes it back — Pareto refresh.
TEST:        a lesson that helps 2 modules, breaks none → promote=true; one that breaks any unit →
             promote=false; a done:type lesson → promote=false regardless.
RED CMD:     candidate that regresses unit X → prints promote:false + X in regressions.
GREEN CMD:   candidate winning ItemCount + SlotGroup, zero regressions → promote:true.
SWAP:        the corpus list + scoring weights — the dominance check is target-independent.
```

Each sheet is a §7 queue row's implementation contract. A weak model transcribes the sheet; the only
allowed deviation is an **escalation** when the tree doesn't match a literal (never a redesign).

---

## 5. Seam-invariant grep checks

These are the **single source of truth** for the seam boundaries (Invariants §1 and rule §3.7
reference them; do not re-describe the seam elsewhere). Put them in `tools/seam-check.sh`; every
gate runs it; each check must print nothing.

```bash
#!/usr/bin/env bash
# tools/seam-check.sh — the seam is grep-provable. Any FAIL line = auto-fail.
set -uo pipefail

# --- Harness A ---
grep -rlE "@angular/compiler|ts-morph" tools/codemod-harness/src | grep -v "/parse/" && echo "A1 FAIL: compiler/ts-morph outside parse/"
grep -rl  "@babel" tools/codemod-harness/src | grep -v "/emit/"  && echo "A2 FAIL: @babel outside emit/"
grep -rE  "from '\.\./(parse|emit)" tools/codemod-harness/src/ir && echo "A3 FAIL: ir/ imports parse|emit"
grep -riE "jhi|jhipster" tools/codemod-harness/src               && echo "A8 FAIL: fixture token in src/"

# --- Harness B ---
grep -rlE "@angular/|(^|[^a-z])react" \
  tools/parity-harness/src/{runner,diff,gate,normalize,contract}.ts && echo "B1 FAIL: framework import in core"
grep -rn "innerHTML" tools/parity-harness/src | grep -v "/adapters/"  && echo "B3 FAIL: raw HTML outside adapters"

echo "seam-check done"   # if no FAIL lines above, the seam holds.
```
(Tune the exact patterns to the repo as it evolves, but keep the intent: the seam is grep-provable,
and this file is where that truth lives.)

---

## 6. Reviewer audit (run by a human or a review task, not the executing agent)

This is a checklist for whoever accepts a batch of work — it is prose, so an executing agent will
skip it; that's intended. To make it enforceable, a dedicated review task runs the gate + these:

- `git log` shows one commit per task, each prefixed with a task ID, each with a `RED-PROOF` in the body.
- Every gate's numbers are recorded and monotonic in the good direction (the ratchet, §3.3).
- No `BLOCKED-*.md` was worked around silently — each is either resolved by a human or still open.
- `bash tools/seam-check.sh` prints no FAIL lines.
- Residue count went down (or got better-categorized); scaffold `tsc` error count went down; the
  parity oracle still accepts every unit with zero divergence.
- No forbidden cheat move (§3.2) appears in the diffs (no snapshot rewrites, no weakened tests, no
  `any`/`@ts-ignore`, no Tier B/C codemod attempt, no unreviewed recipe auto-apply).

If any is false, the *process* — not just a task — has broken. Stop and escalate.

---

## 7. The Task Queue (the only schedulable work)

**Rules:** execute the **topmost `TODO` whose every `DEPENDS-ON` is `DONE`**. One task = one
commit. Update the `Status` here in the same commit. Never invent a task not in this queue — if one
seems missing, escalate. Insert a `GATE` per §4 cadence (every 3 tasks or before a seam-touching
commit). Statuses: `TODO` / `DOING` / `BLOCKED` / `DONE`.

| ID | Template | Depends-on | Status | One-line goal |
|---|---|---|---|---|
| **Task 0** | (bootstrap) | — | **TODO** | Run preflight in both harnesses; write the actual current numbers into the [Recorded baselines](#recorded-baselines) table; run `bash tools/seam-check.sh` (must be OK); commit. **Nothing else may start until this is DONE.** |
| A-DEBT-1 | A.6+A.1+A.3 | Task 0 | TODO | **Generality debt (pre-existing):** `jhiTranslate` (a jHipster/ngx-translate directive) is hardcoded in `parse/` + `emit/`. Move translate-directive handling to the mapping table (§3.4) keyed by directive name, so Transloco (`*transloco`) and others slot in without touching transform logic. Then drop the seam-check allowlist for `jhitranslate`. Fallback: `tpl-node`. |
| A-T1 | A.5+A.3 | Task 0 | TODO | Router call-sites (`Router.navigate`, `ActivatedRoute.*` in TS bodies) → hooks; drop from DI when fully rewired. Fallback: `router`. |
| A-T2 | A.6 | Task 0 | TODO | OpenAPI generated client → axios (regenerate, don't hand-port; flag hand-edited). Fallback: `generated`. |
| A-T3 | A.2→A.1→A.3 | Task 0 | TODO | `@switch` (→ ternary/IIFE) and `@defer` (→ React.lazy/Suspense or shaped TODO). Fallback: `tpl-node`. |
| GATE-1 | gate | A-T1..A-T3 | TODO | Checkpoint + record numbers. |
| A-T4 | A.3+A.4 | GATE-1 | TODO | `this`/`rename`/`async-unwrap` tail cleanup. Fallback: `this`,`rename`,`async`. |
| A-T5 | A.2→A.1→A.3 | GATE-1 | TODO | UI-lib component map via **mapping table** (Bootstrap→React-Bootstrap for the fixture). Fallback: `tpl-node`. |
| A-T6 | A.2→A.1→A.3 | GATE-1 | TODO | `ng-content` / `ng-template` completeness (named slots, `ngTemplateOutlet`, `*ngIf...else/then`). Fallback: `tpl-node`. |
| GATE-2 | gate | A-T4..A-T6 | TODO | Checkpoint + record numbers. |
| A-T7 | A.3+A.4 | GATE-2 | TODO | Pipe long-tail (parameterized built-ins → `Intl.*`; custom → import+stub). Fallback: `tpl-node`. |
| A-T8 | A.6 | GATE-2 | TODO | Test scaffold (spec framework → Vitest/RTL). **Mechanical only — never weaken assertions.** Fallback: `tests`. |
| GATE-3 | gate | A-T7..A-T8 | TODO | Checkpoint. **After this: A-side compiler is tapped (Stop line §A.7).** |
| B-U1 | B.6 | Task 0 | TODO | Add a 3rd parity proof unit covering a lifecycle/effect motif (the residue A leaves as stubs). |
| B-U2 | B.6 | B-U1 | TODO | Add a parity unit covering a state-transition motif (maps to NgRx→RTK parity later). |
| GATE-4 | gate | B-U1..B-U2 | TODO | Checkpoint. |
| C-L0 | **build sheet C.8** | Task 0 | DONE | **Committed workspace (BLOCKER — do first).** Convert the jHipster campaign module into in-repo `migration/app/` (committed, not /tmp); patch the codemod ledger writer to emit non-null `span:{startLine,endLine}` from the IR loc; regenerate `residue.jsonl` with repo-relative `.tsx` paths; record `baseline.json` tsc error count. Transcribe C.8/C-L0. |
| C-L1 | C.2 · **build sheet C.8** | C-L0 | DONE | Automate the **type-oracle gate** (impl `Oracle` kind:type): `tsc` reads **stdout**, `-p tsconfig`, normalize `.component.ts↔.tsx` paths, map by `span` line-range, **pass = baseline-diff** (no new errors). Transcribe C.8/C-L1. |
| C-L2 | C.1 · **build sheet C.8** | C-L1 | DONE | Build the **loop spine + contracts.ts + Picker + Committer + RetryPolicy** (§C.1.5, `tsx`/`.mts`): pick → retrieve → apply → **git-status allowlist firewall** → verify → **append-lesson-then-commit** (one tree). Status in `status.jsonl` sidecar. Transcribe C.8/C-L2. |
| C-L3 | C.4 · **build sheet C.8** | C-L2 | DONE | Implement **ContextStore**: `lessons.jsonl` (append-only, has `id`, **no status field**); retrieve returns newest ≤3 **unverified** challengers (no champion from proposed); grep `facts.md`∪`facts-proposals.jsonl`; first-instance review gate. Transcribe C.8/C-L3. |
| C-L4 | C.4 · **build sheet C.8** | C-L3 | DONE | **Firewall-as-code** + **quarantine.mts**: append-guard (evidence required, no status on append), status in `lesson-status.jsonl` sidecar, suspect-on-regression only (drop drift ladder in v1). Transcribe C.8/C-L4. |
| GATE-5 | gate | C-L1..C-L4 | DONE | Checkpoint. Run the loop on 3–5 real residue items; confirm audit chain (residue id → commit → lesson) is greppable end-to-end; `seam-check.sh` Harness-C block green; no allowlist bypass. |
| C-L5 | C.4.1 · **build sheet C.8** | GATE-5 + **automated FixApplier** | **DEFERRED** | **GEPA promote gate.** NOT runnable in v1 (needs an LLM FixApplier to replay units ± a lesson). Keep the C.4.1 schema now; build the gate later. Only writer of sidecar `status:'promoted'`. |
| C-L6 | C.4 | C-L5 | **DEFERRED** | **Offline `facts.md`/skill epoch-optimizer (the safe SkillOpt):** strong model turns `facts-proposals.jsonl` → a reviewed `facts.md` PR. Deferred with C-L5. Weak agents never edit the shared artifact. |

> This queue is the current best ordering; the harness shape (IR seam, residue accounting,
> idempotence, adapter contract, baseline provenance) is built to carry rows added later. When the
> real codebase becomes accessible, new tickets are appended here as `TODO` rows — the templates
> and invariants above do not change.
