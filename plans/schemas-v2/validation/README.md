# schemas-v2 validation harness

Fixture-based validation for the 13 migration artifacts + the Angular-2+ adapter. The passing
fixture corpus doubles as the orchestrator's golden test data.

## Run

```bash
npm install        # ajv@8 + ajv-formats@3
npm test           # regenerate fixtures, then validate (exit 1 on any surprise)
```

`npm run validate` validates without regenerating. `npm run gen` only regenerates.

## Layout

- `validate.mjs` — loads every `../*.schema.json` and `../adapters/*.schema.json`, registers them by
  `$id` (the `mx://schemas/v2/...` scheme), force-compiles all (surfacing `$ref`/enum drift eagerly),
  then runs the corpus. `valid/*` must validate; `invalid/*` must fail.
- `gen-fixtures.mjs` — emits `fixtures/`. Invalid fixtures wrap their payload as
  `{"$doc": <value>, "$why": "<what this probes>"}` so each negative case is self-documenting.
- `fixtures/<artifact>/{valid,invalid}/*.json` — one dir per schema basename.
- `fixtures/adapters/angular2plus/<def>/{valid,invalid}/*.json` — validated against
  `adapters/angular2plus.schema.json#/$defs/<def>` (per-slot, the way the harness resolves adapter data).

## Coverage

102 fixtures. Every artifact has a minimal (required-only) and a full (optional fields + enums +
adapter slots) valid case, plus targeted negatives for: enum drift, `const schemaVersion`, `$ref`
patterns (`unitId`, `sha256`/`evidenceRef`, `gateId`, `decisionId`, `ceId`, recipe/scenario ids),
`additionalProperties:false`, `minItems`, and numeric bounds.

## Findings (schema bugs surfaced by the corpus — both FIXED)

1. **`evidence-bundle` items could never carry a `role`.** _(fixed)_ Each item was
   `allOf:[evidenceRef]` where `evidenceRef` set `additionalProperties:false`, yet the item also
   defined an enumerated `role` property (and the doc string says an item "proves" a role for the
   gate). The `allOf` made `role` an *additional* property under `evidenceRef`, so any item with a
   role was rejected — the `role` field was dead.
   **Fix:** `common.schema.json` now defines an unsealed `evidenceRefBase`; `evidenceRef` is
   `evidenceRefBase` + `unevaluatedProperties:false` for standalone closed use. The evidence-bundle
   item composes `evidenceRefBase`, adds `role`, and seals with its own `unevaluatedProperties:false`
   — so `role` is accepted while unknown props are still rejected. Fixtures: `valid/item-with-role`,
   `invalid/item-bad-role` (enum), `invalid/item-extra-prop` (seal still closed).

2. **`adapters/angular2plus.schema.json` top-level `oneOf` was not a usable discriminator.** _(fixed)_
   Most `$defs` have no required fields and `additionalProperties:false`, so an empty `{}` matched ~6
   branches and a real payload like `{construct:"component",standalone:true}` matched both
   `nodeDescriptor` and `producedCode` — `oneOf` failed ("exactly one") in both directions.
   **Fix:** the top-level `oneOf` was removed; the file is now documented as a container of `$defs`
   whose selection is by neutral slot (`x-slot`), not structural discrimination. The harness resolves
   `#/$defs/<def>` for the slot and validates `data` against that pointer directly — which is what
   `validate.mjs` does. The top level imposes only `type: object`.

Both were the "$ref/enum drift" class the validation pass was meant to catch before orchestrator code
depends on these shapes.
