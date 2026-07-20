# Jac driver

The codemod's orchestration layer, ported from TypeScript to **Jac** (jaclang).

## Why this shape

The converter is "AST-based": it stands on four JS-ecosystem libraries with **no
Python/Jac equivalent** — `@angular/compiler` (Angular template + expression
parsing), `@babel/*` (JSX emit), `ts-morph` (TypeScript parse/rewrite) and
`prettier`. Jac transpiles to Python, so it cannot import those npm packages. A
literal 100% port is therefore impossible without reimplementing babel + the TS
compiler + the Angular compiler in Python.

So the tool is split at the one clean seam — the framework-neutral IR:

```
  ┌─────────────── Jac (the brain) ────────────────┐   ┌──── Node worker ────┐
  argv parse · file walk · template resolution ·   │   │ @angular/compiler   │
  coverage counting · dispatch · report/exit codes │◄─►│ @babel/*  ts-morph  │
  (codemod.jac, worker_client.jac)                 │   │ prettier (worker.ts)│
  └─────────────────────────────────────────────────┘   └─────────────────────┘
                        line-delimited JSON over stdin/stdout
```

Everything that makes a *decision* is Jac. The Node worker (`src/worker.ts` →
`dist/worker.js`) is a dumb RPC server exposing only the irreducibly-JS steps:
`parseTemplate`, `emitTemplate`, `parseComponent`, `emitComponent`,
`transformService`, `format`. The IR crosses the boundary as plain JSON.

The original `src/transform*.ts` modules are kept — the vitest suite drives them
directly, and the worker reuses their parse/emit functions.

## Run

```sh
npm run build                                    # compiles the worker (+ TS libs)

jac run jac/codemod.jac -- <path...>             # templates: .html -> .jsx
jac run jac/codemod.jac -- --components <path>   # *.component.ts -> .tsx
jac run jac/codemod.jac -- --services <path>     # *.service.ts -> .service.react.ts
#   flags: --dry-run (write nothing) · --report (recurse + aggregate)
#          --ledger            (also write residue.jsonl, see below)
#          --scaffold[=<dir>]  (also emit a compilable Vite+React+TS project)
#          --recipes=<file>    (recipe store the ledger consults; default recipes.jsonl)
#          --learn=<spec.json> (capture a fix into recipes.jsonl and exit)

npm run jac -- --report src/app                  # build + run in one step
```

Output is **byte-for-byte identical** to the former `src/cli.ts` across all three
modes, the aggregate report, residue-reason normalization, parse-failure
reporting and exit codes.

## `--ledger` — the residue ledger

`--ledger` writes a `residue.jsonl` sidecar (in the cwd) alongside whatever the
run already does — one structured, stable-`id` record per `MIGRATION_TODO`, so an
operator agent can find, prioritize, verify and **resume** residue burn-down
across sessions instead of re-deriving the landscape from stdout. Spec:
[`../docs/residue-schema.md`](../docs/residue-schema.md).

It's a pure second pass over the `outcomes` list the driver already holds — no
worker calls, no re-parsing (`build_ledger`/`write_ledger` in `codemod.jac`).
Each record carries `id · file · span · category · fix_shape · reason · cluster_id ·
deps · priority · status · mode`.

- **`category` / `fix_shape`** are derived from the emitter's stable reason-string
  prefixes (the driver only receives the bare `todos` strings, not the inline
  `MIGRATION_TODO(cat)` comments), covering the 18 real categories.
- **`priority`** encodes DI-token fan-out ("fix once, unblocks many"): a token
  injected across N files scores N; `openapi` is a fixed 9; everything else 1.
- **`deps`** links a `this` residue to the same-file `di`/`state` record that
  provides each `this.X` member it still references — "fix the provider first"
  made machine-readable. In practice the reachable edge is `this` → `state`
  (signals); see the schema §6 reachability note. **`span` stays `null`** for
  component/service residue (no line/col without threading offsets through the
  worker — deferred to keep output byte-identical).
- **Stable across runs:** a re-run preserves `status` (`done`/`wontfix`) for ids
  that reappear and drops ids no longer produced — that IS the burn-down signal.
  The extra `mode` field scopes the drop per run mode, so running all three modes
  in turn accumulates one complete ledger instead of clobbering.
- **`recipe`** (added when `--ledger` finds a matching recipe): the canonical fix
  for this residue's cluster, rendered for this occurrence. See below.

## `--scaffold[=<dir>]` — a compilable target

Emits a self-contained **Vite + React + TS** project (default `./react-app`) whose
`tsconfig` `include`s the migrated `.tsx`/`.service.react.ts` output. After
`npm install`, `npm run typecheck` (`tsc --noEmit`) is the residue gate — the
remaining `MIGRATION_TODO`s show up as **real compiler errors**, not just comments.
Existing files are never overwritten. Full spec:
[`../docs/scaffold.md`](../docs/scaffold.md).

## `--recipes` / `--learn` — recipes that compound

A **recipe** captures a residue cluster's canonical fix once, as a template with
`$holes`. When `--ledger` runs it renders the matching recipe per occurrence into
each record's `recipe` field, so a fix from one session (or the bundled seeds) is
replayed as a concrete suggestion in the next. `--learn=<spec.json>` captures a fix
— an agent-authored template, or one anti-unified from a `before`/`after` pair —
into `recipes.jsonl`, overlaying the seeds. Recipes annotate the ledger only;
emitted `.tsx` stays byte-identical. Full spec:
[`../docs/recipe-schema.md`](../docs/recipe-schema.md).
