/**
 * Slice 2 transform: an Angular `.component.ts` (+ its paired template) -> a
 * React `.tsx` module. Combines the component extractor, the slice-1 template
 * transform, and the `.tsx` emitter, then formats the whole module once.
 */

import { readFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import prettier from 'prettier';
import { parseAngularComponent } from './parse/angular-component.js';
import { transformTemplateToExpr } from './transform.js';
import { emitComponent, methodRenameMap } from './emit/component.js';
import type { Coverage } from './transform.js';

export interface ComponentTransformResult {
  ok: boolean;
  tsx: string;
  errors: string[];
  /** Union of extractor + template + emitter residue. */
  todos: string[];
  /** Template-side coverage (node counts), when a template was found. */
  templateCoverage: Coverage | null;
  /** Where the template came from. */
  templateSource: 'external' | 'inline' | 'none';
}

/**
 * @param tsSource  the `.component.ts` contents
 * @param tsPath    its path (used to resolve a relative templateUrl)
 */
export async function transformComponent(
  tsSource: string,
  tsPath: string,
): Promise<ComponentTransformResult> {
  const parsed = parseAngularComponent(tsSource, tsPath);
  if (!parsed.model) {
    return {
      ok: false,
      tsx: '',
      errors: parsed.errors,
      todos: [],
      templateCoverage: null,
      templateSource: 'none',
    };
  }
  const model = parsed.model;

  // Resolve the template: external file, inline string, or none.
  let templateHtml: string | null = null;
  let templateSource: ComponentTransformResult['templateSource'] = 'none';
  if (model.templateUrl) {
    const abs = resolve(dirname(tsPath), model.templateUrl);
    if (existsSync(abs)) {
      templateHtml = readFileSync(abs, 'utf8');
      templateSource = 'external';
    } else {
      return {
        ok: false,
        tsx: '',
        errors: [`templateUrl not found: ${model.templateUrl} (resolved ${abs})`],
        todos: [],
        templateCoverage: null,
        templateSource: 'none',
      };
    }
  } else if (model.inlineTemplate) {
    templateHtml = model.inlineTemplate;
    templateSource = 'inline';
  }

  let jsxExpr = 'null';
  let templateImports: string[] = [];
  let templateCoverage: Coverage | null = null;
  let usesTranslate = false;
  let helpers: string[] = [];
  const todos: string[] = [];

  if (templateHtml !== null) {
    const renames = methodRenameMap(model.methods);
    const raw = transformTemplateToExpr(templateHtml, model.templateUrl ?? `${tsPath}#inline`, renames);
    if (!raw.ok) {
      return {
        ok: false,
        tsx: '',
        errors: raw.errors,
        todos: [],
        templateCoverage: raw.coverage,
        templateSource,
      };
    }
    jsxExpr = raw.jsxExpr;
    templateImports = raw.imports;
    templateCoverage = raw.coverage;
    usesTranslate = raw.usesTranslate;
    helpers = raw.helpers;
    todos.push(...raw.coverage.todoReasons);
  } else {
    todos.push('no template (templateUrl/template) found on @Component');
  }

  // Recover `x | async` bindings from the template's structured todo marker.
  // The template layer (owned elsewhere) folds expr todos into coverage but does
  // not aggregate the `asyncBindings` hint, so we parse the marker it emitted.
  const asyncBindings: string[] = [];
  for (const reason of templateCoverage?.todoReasons ?? []) {
    const m = reason.match(/^async pipe on `([^`]+)`/);
    if (m) asyncBindings.push(m[1]);
  }

  const emitted = emitComponent(model, {
    jsxExpr,
    templateImports,
    usesTranslate,
    helpers,
    asyncBindings,
  });
  todos.push(...emitted.todos);

  let tsx: string;
  try {
    tsx = await prettier.format(emitted.code, {
      parser: 'babel-ts',
      singleQuote: true,
      printWidth: 100,
    });
  } catch (e) {
    return {
      ok: false,
      tsx: emitted.code,
      errors: [`prettier failed: ${(e as Error).message}`],
      todos,
      templateCoverage,
      templateSource,
    };
  }

  return { ok: true, tsx, errors: [], todos, templateCoverage, templateSource };
}
