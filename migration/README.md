# `migration/` — framework-neutral migration workspace

Established per [`PLAN.md` §146](../PLAN.md). This is the append-only artifact workspace for the
OneCX Angular 17 → React migration. Nothing here is source code; it is the **evidence and
contract layer** the harness and operator read/write while converting units.

> Scope: the schemas under `schemas/` model the **private real target (OneCX shell)** surface
> that is *not* present in `references/jhipster-ng17-fixture/` (PLAN §70). They are validated
> against the real target or synthetic fixtures, never against the JHipster baseline.

## Layout

| Path | PLAN ref | Purpose | Status |
|---|---|---|---|
| `schemas/remote-compat-matrix.schema.json` | §158 | Per route/remote mount contract; gates the shell-flip design. | **drafted** |
| `schemas/feature-flag-inventory.schema.json` | §124, §270–276 | All three flag mechanisms (enable/disable, cohort, tenant-UUID rule). | **drafted** |
| `schemas/interceptor-axios-map.schema.json` | §154 | HttpClient interceptor chain → shared Axios instance mapping. | **drafted** |
| `remotes.matrix.json` | §158 | Instance: the actual matrix rows. | seed (1 example row) |
| `feature-flags.json` | §270–276 | Instance: the actual flag inventory. | seed (3 example rows, one per mechanism) |
| `interceptors.json` | §154 | Instance: the actual interceptor chain. | seed (1 example row) |
| `validate.mjs` | — | Zero-dep structural validator (required fields + enums). `node migration/validate.mjs`. | working |

## Not yet created (rest of §146 workspace)

Ledger (`residue.jsonl` lives in the harness today), unit records, inventory graph, contract
catalog, behavior scenarios, traces, counterexamples, waivers, reports. Added as their tracks
open. This slice is **track C: the compatibility matrix + OneCX profile contracts.**

## Decision semantics (matrix)

Each remote row resolves to one `decision` that feeds the shell-flip gate:

- `web-component` — Angular remote can be consumed as a custom element; no compat island needed.
- `compat-island` — requires a temporary, explicitly scoped Angular compatibility island.
- `blocks-shell-removal` — cannot mount without Angular Router/DI; blocks final Angular removal.
- `native-react` — already/will be a React remote.

`status` (`unknown` → `compatible` | `breaking`) is the discovery state; a row starts `unknown`
until its contract is proven by a spike/contract test.
