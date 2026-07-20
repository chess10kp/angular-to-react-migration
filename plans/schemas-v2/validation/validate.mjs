// schemas-v2 fixture validator.
// Loads every schema under ../ and ../adapters/ (registered by $id), then runs
// the fixture corpus in ./fixtures. Layout:
//
//   fixtures/<schema-basename>/valid/*.json      -> MUST validate against <schema-basename>.schema.json
//   fixtures/<schema-basename>/invalid/*.json    -> MUST fail
//   fixtures/adapters/angular2plus/<def>/valid   -> MUST validate against adapters/angular2plus.schema.json#/$defs/<def>
//   fixtures/adapters/angular2plus/<def>/invalid -> MUST fail
//
// An invalid fixture may be a bare JSON value, or {"$doc": <value>, "$why": "..."} to document intent.
// Exit code is nonzero if any fixture behaves unexpectedly OR a schema fails to compile.

import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const schemaRoot = resolve(here, "..");
const fixturesRoot = join(here, "fixtures");

const ajv = new Ajv2020({ strict: false, allErrors: true, allowUnionTypes: true });
addFormats(ajv);

// ---- load & register all schemas by $id -------------------------------------
const schemaFiles = [];
for (const f of readdirSync(schemaRoot)) {
  if (f.endsWith(".schema.json")) schemaFiles.push(join(schemaRoot, f));
}
const adapterDir = join(schemaRoot, "adapters");
if (existsSync(adapterDir)) {
  for (const f of readdirSync(adapterDir)) {
    if (f.endsWith(".schema.json")) schemaFiles.push(join(adapterDir, f));
  }
}

const byId = new Map();       // $id -> schema object
const idByBasename = new Map(); // "run-request" -> $id
let loadErrors = 0;
for (const path of schemaFiles) {
  let schema;
  try {
    schema = JSON.parse(readFileSync(path, "utf8"));
  } catch (e) {
    console.error(`  ✗ PARSE  ${path}: ${e.message}`);
    loadErrors++;
    continue;
  }
  if (!schema.$id) {
    console.error(`  ✗ NO $id ${path}`);
    loadErrors++;
    continue;
  }
  byId.set(schema.$id, schema);
  const base = path.split("/").pop().replace(".schema.json", "");
  idByBasename.set(base, schema.$id);
  try {
    ajv.addSchema(schema);
  } catch (e) {
    console.error(`  ✗ ADD   ${schema.$id}: ${e.message}`);
    loadErrors++;
  }
}

// force-compile every registered schema to surface $ref/enum drift eagerly
let compileErrors = 0;
for (const [id] of byId) {
  try {
    ajv.getSchema(id) || ajv.compile(byId.get(id));
  } catch (e) {
    console.error(`  ✗ COMPILE ${id}: ${e.message}`);
    compileErrors++;
  }
}

console.log(`Loaded ${byId.size} schemas (${loadErrors} load errors, ${compileErrors} compile errors)\n`);

// ---- helpers ----------------------------------------------------------------
function listJson(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((f) => f.endsWith(".json")).map((f) => join(dir, f));
}
function unwrap(raw) {
  if (raw && typeof raw === "object" && !Array.isArray(raw) && "$doc" in raw) {
    return { value: raw.$doc, why: raw.$why };
  }
  return { value: raw, why: undefined };
}

let pass = 0, fail = 0;
const failures = [];

function check(validate, file, expectValid) {
  const raw = JSON.parse(readFileSync(file, "utf8"));
  const { value } = unwrap(raw);
  const ok = validate(value);
  const rel = file.replace(fixturesRoot + "/", "");
  if (ok === expectValid) {
    pass++;
  } else {
    fail++;
    const detail = ok
      ? "expected INVALID but it PASSED"
      : "expected VALID but it FAILED: " + ajv.errorsText(validate.errors, { separator: " | " });
    failures.push(`  ✗ ${rel}\n      ${detail}`);
  }
}

function runGroup(dir, validate) {
  for (const f of listJson(join(dir, "valid"))) check(validate, f, true);
  for (const f of listJson(join(dir, "invalid"))) check(validate, f, false);
}

// ---- core artifact fixtures -------------------------------------------------
if (existsSync(fixturesRoot)) {
  for (const entry of readdirSync(fixturesRoot)) {
    const dir = join(fixturesRoot, entry);
    if (!statSync(dir).isDirectory() || entry === "adapters") continue;
    const id = idByBasename.get(entry);
    if (!id) {
      console.error(`  ! no schema for fixtures/${entry} (expected ${entry}.schema.json)`);
      fail++;
      continue;
    }
    const validate = ajv.getSchema(id);
    runGroup(dir, validate);
  }

  // ---- adapter $def fixtures ------------------------------------------------
  const adFix = join(fixturesRoot, "adapters", "angular2plus");
  if (existsSync(adFix)) {
    const adId = idByBasename.get("angular2plus");
    for (const def of readdirSync(adFix)) {
      const dir = join(adFix, def);
      if (!statSync(dir).isDirectory()) continue;
      const ptr = `${adId}#/$defs/${def}`;
      let validate;
      try {
        validate = ajv.getSchema(ptr);
      } catch (e) {
        console.error(`  ! bad $def pointer ${ptr}: ${e.message}`);
        fail++;
        continue;
      }
      if (!validate) {
        console.error(`  ! no $def ${def} in angular2plus adapter`);
        fail++;
        continue;
      }
      runGroup(dir, validate);
    }
  }
}

// ---- report -----------------------------------------------------------------
if (failures.length) {
  console.log("FAILURES:\n" + failures.join("\n") + "\n");
}
console.log(`fixtures: ${pass} passed, ${fail} failed`);
const bad = loadErrors + compileErrors + fail;
process.exit(bad ? 1 : 0);
