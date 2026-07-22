/**
 * Reactive forms -> react-hook-form.
 *
 * Angular's `new FormGroup({...})` / `fb.group({...})` declares a form's shape,
 * default values, and validators in one initializer. react-hook-form expresses
 * the same thing as `useForm({ defaultValues })` plus `register()`/a resolver.
 *
 * This module parses the initializer (via the TypeScript AST, so nested object
 * literals and call arguments are handled precisely) into a small, deterministic
 * model. The emitter turns that into a real `useForm(...)` call; validators are
 * surfaced as residue because RHF needs a schema resolver (zod/yup) rather than
 * per-control validator functions.
 */

import ts from 'typescript';

export interface FormControlModel {
  name: string;
  /** Default-value expression text (already TS source), or `''` when absent. */
  defaultValue: string;
  /** Inferred TS type of the field from its default literal. */
  tsType: string;
  /** Validator expression texts (positional array tail or `validators:` option). */
  validators: string[];
  /** A nested FormGroup/FormArray we can't flatten — the reviewer must port it. */
  nested: boolean;
}

export interface FormModel {
  controls: FormControlModel[];
  /** Group-level (cross-field) validators from the 2nd FormGroup argument. */
  groupValidators: string[];
}

/**
 * Rewrite Angular reactive-form operations inside a *method/lifecycle body* to
 * react-hook-form idioms, for the given known form handles. This is the
 * imperative counterpart of the template-side `rewriteFormReads`: templates read
 * reactively (`.watch()`), method bodies read/write imperatively (`.getValues()`,
 * `.setValue()`, `.reset()`).
 *
 * Runs on the body text *after* the `this.` head has already been stripped
 * (`this.editForm.value` -> `editForm.value`), so it matches on bare handles.
 * Every rewrite is head-only — it replaces the accessor/method head and leaves
 * the original call arguments intact — so nested parens in args are never a
 * problem. Order is load-bearing: per-control `.get('f')?.setValue(` is consumed
 * before the whole-form `.setValue(` pattern could clobber it.
 *
 *   form.get('f')?.setValue(x) / .patchValue(x) -> form.setValue('f', x)
 *   form.get('f')?.value                        -> form.getValues('f')
 *   form.get('f')?.invalid | errors             -> form.formState.errors.f
 *   form.get('f')?.valid                        -> !form.formState.errors.f
 *   form.value.f                                -> form.getValues('f')
 *   form.value                                  -> form.getValues()
 *   form.setValue(v) / form.patchValue(v)       -> form.reset(v)
 *   form.markAllAsTouched() / markAsTouched()   -> form.trigger()
 *   form.invalid | valid                        -> form.formState.isValid idiom
 *   form.valueChanges.subscribe(cb)             -> form.watch(cb)
 *
 * Returns the rewritten code plus a `residue` list of form members we can't map
 * mechanically (`.controls`, `.valueChanges`, a bare `.get('f')`), so the caller
 * can flag exactly what still needs a human.
 */
export function rewriteFormMethodReads(
  code: string,
  formNames: ReadonlySet<string>,
): { code: string; residue: string[] } {
  let out = code;
  const residue = new Set<string>();
  for (const f of formNames) {
    const F = f.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

    // --- Whole-form writes (head-only; args preserved) --------------------
    // Run before the per-control block: `\bform\.setValue(` can't match a
    // `form.get('f')?.setValue(` chain, but the per-control rewrite *produces* a
    // `form.setValue('f', …)` head — so whole-form must fire first or it'd clobber it.
    // setValue/patchValue both take one object arg -> reset(...) (same signature).
    out = out.replace(new RegExp(`\\b${F}\\.(?:set|patch)Value\\(`, 'g'), `${f}.reset(`);
    // markAllAsTouched()/markAsTouched()/updateValueAndValidity() -> trigger()
    out = out.replace(
      new RegExp(`\\b${F}\\.(?:markAllAsTouched|markAsTouched|updateValueAndValidity)\\(`, 'g'),
      `${f}.trigger(`,
    );

    // --- Per-control ops via .get('f') ------------------------------------
    // form.get('f')?.setValue(  /  .patchValue(  -> form.setValue('f',   (args kept)
    out = out.replace(
      new RegExp(`\\b${F}\\.get\\(\\s*(['"\`])([^'"\`]+)\\1\\s*\\)(?:\\?\\.|\\.)(?:set|patch)Value\\(`, 'g'),
      (_m, _q, field) => `${f}.setValue('${field}', `,
    );
    // form.get('f')?.value / .invalid / .valid / .errors / .touched / .dirty / .pristine
    out = out.replace(
      new RegExp(`\\b${F}\\.get\\(\\s*(['"\`])([^'"\`]+)\\1\\s*\\)(?:\\?\\.|\\.)(value|invalid|valid|errors|touched|dirty|pristine)\\b`, 'g'),
      (_m, _q, field, member) => controlRead(f, field, member),
    );

    // --- Reactive stream -> RHF watch -------------------------------------
    // `form.valueChanges.subscribe(cb)` -> `form.watch(cb)`. RHF's `watch(cb)`
    // returns an object with `.unsubscribe()`, same shape as the RxJS Subscription
    // the original assigned/cleaned up, so surrounding code keeps working. Head-only
    // (args preserved). Guarded to the *direct* `.valueChanges.subscribe(` chain:
    // an intervening `.pipe(...)` (debounce/map/etc.) has no mechanical RHF form and
    // is left to the residue channel below.
    out = out.replace(
      new RegExp(`\\b${F}\\.valueChanges\\.subscribe\\(`, 'g'),
      `${f}.watch(`,
    );

    // --- Whole-form reads --------------------------------------------------
    // form.value.field -> form.getValues('field'); form.value -> form.getValues()
    out = out.replace(new RegExp(`\\b${F}\\.value\\.([A-Za-z_$][\\w$]*)`, 'g'), `${f}.getValues('$1')`);
    out = out.replace(new RegExp(`\\b${F}\\.value\\b(?!\\()`, 'g'), `${f}.getValues()`);
    out = out.replace(new RegExp(`\\b${F}\\.invalid\\b`, 'g'), `!${f}.formState.isValid`);
    out = out.replace(new RegExp(`\\b${F}\\.valid\\b`, 'g'), `${f}.formState.isValid`);

    // --- Residue: members with no mechanical RHF equivalent ---------------
    if (new RegExp(`\\b${F}\\.controls\\b`).test(out)) residue.add(`${f}.controls`);
    // `.valueChanges` only survives here when it wasn't the direct `.subscribe(`
    // chain rewritten above (e.g. a `.pipe(...)` sits in between). `.statusChanges`
    // has no RHF form-level equivalent (validation state lives in `formState`).
    if (new RegExp(`\\b${F}\\.valueChanges\\b`).test(out)) residue.add(`${f}.valueChanges`);
    if (new RegExp(`\\b${F}\\.statusChanges\\b`).test(out)) residue.add(`${f}.statusChanges`);
    if (new RegExp(`\\b${F}\\.get\\(`).test(out)) residue.add(`${f}.get(...)`);
  }
  return { code: out, residue: [...residue] };
}

/** RHF read idiom for a single control member reached via `.get('f')`. */
function controlRead(f: string, field: string, member: string): string {
  switch (member) {
    case 'invalid':
    case 'errors':
      return `${f}.formState.errors.${field}`;
    case 'valid':
      return `!${f}.formState.errors.${field}`;
    case 'touched':
      return `${f}.formState.touchedFields.${field}`;
    case 'dirty':
      return `${f}.formState.dirtyFields.${field}`;
    case 'pristine':
      return `!${f}.formState.dirtyFields.${field}`;
    case 'value':
    default:
      return `${f}.getValues('${field}')`;
  }
}

/** Does this field look like an Angular reactive form? (type or initializer). */
export function isReactiveForm(type: string | null, init: string | null): boolean {
  return (
    /\b(FormGroup|FormControl|FormArray)\b/.test(type ?? '') ||
    /\b(FormBuilder|FormGroup|FormControl|FormArray)\b/.test(init ?? '') ||
    /\.(group|control|array)\s*\(/.test(init ?? '')
  );
}

/**
 * Parse a `new FormGroup({...})` / `fb.group({...})` initializer into a FormModel.
 * Returns null when the initializer isn't a recognisable group literal (e.g. a
 * form-service factory call), so the caller can fall back to flagging residue.
 */
export function parseFormGroup(init: string): FormModel | null {
  let expr: ts.Expression;
  try {
    const sf = ts.createSourceFile('form.ts', `const __f = ${init};`, ts.ScriptTarget.Latest, true);
    const stmt = sf.statements[0];
    if (!ts.isVariableStatement(stmt)) return null;
    const decl = stmt.declarationList.declarations[0];
    if (!decl?.initializer) return null;
    expr = decl.initializer;
  } catch {
    return null;
  }

  if (!ts.isCallExpression(expr) && !ts.isNewExpression(expr)) return null;
  const args = expr.arguments;
  if (!args || args.length === 0) return null;

  // The controls live in the first object-literal argument. Both
  // `new FormGroup({...})` and `fb.group({...})` follow this shape.
  const groupArg = args[0];
  if (!ts.isObjectLiteralExpression(groupArg)) return null;

  const src = init; // getText() needs the original source file; use the parsed one instead.
  const text = (n: ts.Node): string => n.getText(n.getSourceFile());

  const controls: FormControlModel[] = [];
  for (const prop of groupArg.properties) {
    if (!ts.isPropertyAssignment(prop)) return null; // shorthand/spread -> bail to residue
    const name = propName(prop.name);
    if (name == null) return null;
    controls.push(parseControl(name, prop.initializer, text));
  }

  const groupValidators: string[] = [];
  if (args.length > 1 && ts.isObjectLiteralExpression(args[1])) {
    for (const prop of args[1].properties) {
      if (ts.isPropertyAssignment(prop) && propName(prop.name) === 'validators') {
        groupValidators.push(...validatorList(prop.initializer, text));
      }
    }
  }

  void src;
  return { controls, groupValidators };
}

function parseControl(
  name: string,
  value: ts.Expression,
  text: (n: ts.Node) => string,
): FormControlModel {
  // `field: ['default', Validators.required, ...]`
  if (ts.isArrayLiteralExpression(value)) {
    const els = value.elements;
    const def = els[0] ? text(els[0]) : "''";
    const validators = els.slice(1).flatMap((e) => validatorList(e, text));
    return { name, defaultValue: def, tsType: inferType(els[0]), validators, nested: false };
  }

  // `field: new FormControl('default', { validators: [...] })` / `fb.control(...)`
  if (isFormControlCtor(value)) {
    const cargs = (value as ts.CallExpression | ts.NewExpression).arguments ?? [];
    const first = cargs[0];
    let def = first ? text(first) : "''";
    let inferSource: ts.Expression | undefined = first;
    let validators: string[] = [];
    // FormControl can take `{ value, disabled }` as its initial state.
    if (first && ts.isObjectLiteralExpression(first)) {
      const valueProp = first.properties.find(
        (p): p is ts.PropertyAssignment => ts.isPropertyAssignment(p) && propName(p.name) === 'value',
      );
      def = valueProp ? text(valueProp.initializer) : "''";
      inferSource = valueProp?.initializer;
    }
    if (cargs[1]) validators = validatorList(cargs[1], text);
    return { name, defaultValue: def, tsType: inferType(inferSource), validators, nested: false };
  }

  // Nested FormGroup / FormArray — can't flatten into flat defaultValues.
  if (isFormGroupCtor(value) || isFormArrayCtor(value)) {
    return { name, defaultValue: text(value), tsType: 'unknown', validators: [], nested: true };
  }

  // Anything else (a bare expression) -> treat as the default value verbatim.
  return { name, defaultValue: text(value), tsType: inferType(value), validators: [], nested: false };
}

/** Extract validator expression texts from a positional arg or `{ validators }` option. */
function validatorList(node: ts.Expression, text: (n: ts.Node) => string): string[] {
  if (ts.isObjectLiteralExpression(node)) {
    const out: string[] = [];
    for (const p of node.properties) {
      if (
        ts.isPropertyAssignment(p) &&
        (propName(p.name) === 'validators' || propName(p.name) === 'asyncValidators')
      ) {
        out.push(...validatorList(p.initializer, text));
      }
    }
    return out;
  }
  if (ts.isArrayLiteralExpression(node)) return node.elements.map(text);
  // A bare validator (function reference) — but skip form-control option flags.
  return [text(node)];
}

function inferType(node: ts.Expression | undefined): string {
  if (!node) return 'string';
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return 'string';
  if (ts.isNumericLiteral(node)) return 'number';
  if (node.kind === ts.SyntaxKind.TrueKeyword || node.kind === ts.SyntaxKind.FalseKeyword) {
    return 'boolean';
  }
  if (node.kind === ts.SyntaxKind.NullKeyword) return 'unknown';
  return 'unknown';
}

function propName(name: ts.PropertyName): string | null {
  if (ts.isIdentifier(name) || ts.isStringLiteral(name)) return name.text;
  return null;
}

function callName(expr: ts.Expression): string | null {
  const callee = ts.isCallExpression(expr) || ts.isNewExpression(expr) ? expr.expression : null;
  if (!callee) return null;
  if (ts.isIdentifier(callee)) return callee.text;
  if (ts.isPropertyAccessExpression(callee)) return callee.name.text;
  return null;
}

function isFormControlCtor(e: ts.Expression): boolean {
  const n = callName(e);
  return n === 'FormControl' || n === 'control';
}
function isFormGroupCtor(e: ts.Expression): boolean {
  const n = callName(e);
  return n === 'FormGroup' || n === 'group';
}
function isFormArrayCtor(e: ts.Expression): boolean {
  const n = callName(e);
  return n === 'FormArray' || n === 'array';
}
