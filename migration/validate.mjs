#!/usr/bin/env node
// Zero-dependency structural validator for the migration/ artifact schemas.
// Supports the JSON Schema (draft-07) subset actually used by the schemas here:
// type, required, enum, const, properties, additionalProperties, items,
// pattern, format:uuid, $ref (#/definitions/...), allOf, if/then.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const PAIRS = [
  ['schemas/remote-compat-matrix.schema.json', 'remotes.matrix.json'],
  ['schemas/feature-flag-inventory.schema.json', 'feature-flags.json'],
  ['schemas/interceptor-axios-map.schema.json', 'interceptors.json'],
];

const load = (p) => JSON.parse(readFileSync(resolve(here, p), 'utf8'));
const typeOf = (v) => (Array.isArray(v) ? 'array' : v === null ? 'null' : typeof v === 'number' && Number.isInteger(v) ? 'integer' : typeof v);
const typeOk = (v, t) => (t === 'integer' ? Number.isInteger(v) : t === 'number' ? typeof v === 'number' : typeOf(v) === t);

function deref(schema, root) {
  if (schema && schema.$ref) {
    const path = schema.$ref.replace(/^#\//, '').split('/');
    return path.reduce((o, k) => o[k], root);
  }
  return schema;
}

function validate(node, schema, root, path, errs) {
  schema = deref(schema, root);
  if (!schema) return;

  if (schema.type && !typeOk(node, schema.type)) {
    errs.push(`${path}: expected ${schema.type}, got ${typeOf(node)}`);
    return;
  }
  if ('const' in schema && node !== schema.const) errs.push(`${path}: must equal ${JSON.stringify(schema.const)}`);
  if (schema.enum && !schema.enum.includes(node)) errs.push(`${path}: ${JSON.stringify(node)} not in [${schema.enum.join(', ')}]`);
  if (schema.pattern && typeof node === 'string' && !new RegExp(schema.pattern).test(node)) errs.push(`${path}: "${node}" fails pattern ${schema.pattern}`);
  if (schema.format === 'uuid' && typeof node === 'string' && !UUID.test(node)) errs.push(`${path}: "${node}" is not a UUID`);

  if (typeOf(node) === 'object') {
    for (const req of schema.required || []) if (!(req in node)) errs.push(`${path}: missing required "${req}"`);
    const props = schema.properties || {};
    if (schema.additionalProperties === false) {
      for (const k of Object.keys(node)) if (!(k in props)) errs.push(`${path}: unexpected property "${k}"`);
    }
    for (const [k, v] of Object.entries(node)) if (props[k]) validate(v, props[k], root, `${path}.${k}`, errs);
  }

  if (typeOf(node) === 'array' && schema.items) node.forEach((it, i) => validate(it, schema.items, root, `${path}[${i}]`, errs));

  for (const sub of schema.allOf || []) {
    if (sub.if) {
      const condErrs = [];
      validate(node, sub.if, root, path, condErrs);
      if (condErrs.length === 0 && sub.then) validate(node, sub.then, root, path, errs);
    } else validate(node, sub, root, path, errs);
  }
}

let failed = 0;
for (const [schemaPath, instPath] of PAIRS) {
  const errs = [];
  validate(load(instPath), load(schemaPath), load(schemaPath), instPath, errs);
  if (errs.length) {
    failed += errs.length;
    console.log(`✗ ${instPath}`);
    for (const e of errs) console.log(`    ${e}`);
  } else {
    console.log(`✓ ${instPath}`);
  }
}
console.log(failed ? `\n${failed} error(s).` : '\nAll instances valid.');
process.exit(failed ? 1 : 0);
