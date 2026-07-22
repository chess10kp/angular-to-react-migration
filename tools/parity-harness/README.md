# parity-harness

A cross-framework **parity oracle** for the Angular→React migration. It answers one
question per migration unit: *does the React port behave like the Angular original?* —
by comparing **normalized user-observable behavior**, never raw HTML.

One framework-neutral `ParityCase` is run against **both** a real Angular 17 workbench
and a real React 18 workbench; the runner captures an `Observation` at each checkpoint,
checks the authored contract on **both** sides, and diffs the React target against the
Angular baseline. Both frameworks mount into one **jsdom** DOM in Node, so the vertical
slice needs **no browser binary** — the same `ParityAdapter` contract can later be
re-hosted on Playwright + real dev servers without touching the runner/diff/gate layers.

```
        ParityCase (one JSON recipe)
               │
   ┌───────────┴───────────┐
   ▼                       ▼
AngularAdapter          ReactAdapter        ← window.__parity-shaped contract
(real @angular/core     (real react-dom/     (mount/setInputs/settle/
 JIT, ngOnChanges)       client, act())        drainEvents/observe/dispose)
   └───────────┬───────────┘
               ▼
          runner.ts   → captureObservation → normalize → diff
               ▼
   contract check (both sides) + baseline diff (source-as-oracle) + acceptance gate
```

## Run it

```bash
npm install
npm test                     # 16 tests: core + ItemCount + SlotGroup parity
npm run parity -- run        # run every unit's cases, record/reuse baselines, gate
npm run parity -- run ItemCountComponent
npm run parity -- validate units/item-count/case.last-page.json
npm run typecheck
```

## What maps to what (proposal → code)

| Proposal concept | Here |
|---|---|
| `ParityCase` (framework-neutral recipe) | `src/types.ts`, `src/schema/parity-case.schema.json`, `src/validate.ts` |
| Two workbenches exposing `window.__parity` | `src/adapter.ts` + `src/adapters/{angular,react}.ts` |
| Semantic observation (a11y/text/focus/events/net/styles/console), **not HTML** | `src/observe.ts` |
| Normalized diff under a policy → counterexample | `src/normalize.ts`, `src/diff.ts` |
| Settle protocol | `AngularAdapter.settle()` (zone `isStable`), `ReactAdapter.settle()` (`act` + real ticks) |
| Source-as-oracle **and** explicit contract | `src/contract.ts` + `runner.ts` (both must hold) |
| Baseline cache w/ invalidation key | `src/baseline.ts` (`sourceCommit+componentHash+caseHash+fixtureHash+harnessVersion`) |
| Unit acceptance gate (I/O inventory) | `src/gate.ts` |

## Acceptance

A React unit is accepted only when, for every case:
1. the **Angular baseline** satisfies the authored contract,
2. the **React target** satisfies the same contract,
3. React's normalized observations **match** the Angular baseline (zero divergence),
4. the cached baseline shows **no drift**, and
5. the gate finds every public input/output **covered / irrelevant / waived**.

Any failure yields a **counterexample**: the first checkpoint + channel + path where
Angular and React disagree — a precise repair input, not just "test failed".

## The two proof units

- **`units/item-count/`** — the easy proof: inputs → derived rendering, `undefined`
  page, partial last page, i18n (`en`/`de`), domain event on render, baseline
  capture + diff.
- **`units/slot-group/`** — the hard proof (modeled on OneCX `SlotGroupComponent`):
  class/style inputs, a `ResizeObserver` → `debounceTime(100)` domain event (timing),
  and **teardown** (a disposed Angular unit emits nothing on a later resize).

Framework-specific setup lives only in the adapters; the shared pure logic
(`i18n.ts`, `classes.ts`) is imported by both sides, so any divergence is a real bug,
not copy drift.

## Notes / slice boundaries

- Angular renders under the **runtime JIT** compiler in jsdom, which cannot detect
  signal `input()`/`computed()` (those need AOT/partial compilation) — the units use
  classic `@Input()`/`ngOnChanges`. The observable contract is identical either way.
- React object refs did not attach under this jsdom/esbuild setup; the units use
  callback refs.
- No real network yet: the `network` observation channel and `fixtureProfile` are
  wired through the types/diff but the two proof units make no BFF calls.
