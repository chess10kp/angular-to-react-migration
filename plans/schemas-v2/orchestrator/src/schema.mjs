// Loads every schemas-v2 schema by $id (mx://schemas/v2/...) and exposes
// validators. Reuses the ajv install from ../../validation.

import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const schemaRoot = resolve(here, "..", ".."); // schemas-v2/

const ajv = new Ajv2020({ strict: false, allErrors: true, allowUnionTypes: true });
addFormats(ajv);

const idByBasename = new Map();

function loadDir(dir) {
  if (!existsSync(dir)) return;
  for (const f of readdirSync(dir)) {
    if (!f.endsWith(".schema.json")) continue;
    const schema = JSON.parse(readFileSync(join(dir, f), "utf8"));
    if (!schema.$id) continue;
    ajv.addSchema(schema);
    idByBasename.set(f.replace(".schema.json", ""), schema.$id);
  }
}
loadDir(schemaRoot);
loadDir(join(schemaRoot, "adapters"));

// validator for a schema basename, e.g. "unit", "evidence-bundle".
export function validatorFor(basename) {
  const id = idByBasename.get(basename);
  if (!id) throw new Error(`no schema for '${basename}'`);
  return ajv.getSchema(id);
}

// Validate `value` against a schema basename. Returns {ok, errors?}.
export function validate(basename, value) {
  const v = validatorFor(basename);
  const ok = v(value);
  return ok ? { ok: true } : { ok: false, errors: ajv.errorsText(v.errors, { separator: " | " }) };
}
