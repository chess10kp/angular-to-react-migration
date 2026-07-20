/**
 * Slice 1 transform: Angular template control-flow -> JSX.
 *
 * Orchestrates parse -> lower -> emit -> format, and produces a structured
 * result with coverage counts and diagnostics. This is the unit the CLI and
 * the fixture tests both drive.
 */

import prettier from 'prettier';
import { parseAngularTemplate } from './parse/angular-template.js';
import { emitTemplate } from './emit/jsx.js';
import type { IRNode } from './ir/types.js';

export interface Coverage {
  /** Total IR nodes produced. */
  nodes: number;
  /** Counts by node type. */
  byType: Record<string, number>;
  /** Number of MIGRATION_TODO residue nodes. */
  todoNodes: number;
  /** Non-fatal residue reasons collected during lowering. */
  todoReasons: string[];
}

export interface TransformResult {
  ok: boolean;
  /** Formatted JSX expression (only meaningful when ok). */
  jsx: string;
  /** Fatal Angular parse errors. */
  errors: string[];
  imports: string[];
  coverage: Coverage;
  /** True if the template needs react-i18next's `t` in scope. */
  usesTranslate: boolean;
  /** `@angular/common`-pipe helper fns referenced (e.g. `formatDate`). */
  helpers: string[];
}

function walk(nodes: IRNode[], visit: (n: IRNode) => void): void {
  for (const n of nodes) {
    visit(n);
    switch (n.type) {
      case 'element':
        walk(n.children, visit);
        break;
      case 'if':
        for (const b of n.branches) walk(b.children, visit);
        break;
      case 'for':
        walk(n.children, visit);
        if (n.empty) walk(n.empty, visit);
        break;
    }
  }
}

function coverageOf(nodes: IRNode[], todoReasons: string[]): Coverage {
  const byType: Record<string, number> = {};
  let total = 0;
  let todoNodes = 0;
  walk(nodes, (n) => {
    total++;
    byType[n.type] = (byType[n.type] ?? 0) + 1;
    if (n.type === 'todo') todoNodes++;
  });
  return { nodes: total, byType, todoNodes, todoReasons };
}

/** The raw JSX for a template — an unformatted expression string plus metadata. */
export interface RawTemplate {
  ok: boolean;
  /** Unformatted JSX expression (e.g. `<div>…</div>` or `a && <p/>`). */
  jsxExpr: string;
  errors: string[];
  imports: string[];
  coverage: Coverage;
  /** True if the template needs react-i18next's `t` in scope. */
  usesTranslate: boolean;
  /** `@angular/common`-pipe helper fns referenced (e.g. `formatDate`). */
  helpers: string[];
}

/**
 * Transform a template to a raw JSX *expression* (no `const … =` wrapper, no
 * formatting). Used by the component transform to embed the template inside a
 * function body before formatting the whole module once.
 *
 * @param renames  optional bare-identifier renames (reserved-word methods) so
 *                 template call sites match the component emitter's rewrite.
 */
export function transformTemplateToExpr(
  source: string,
  fileName = 'template.html',
  renames: ReadonlyMap<string, string> = new Map(),
): RawTemplate {
  const parsed = parseAngularTemplate(source, fileName, renames);
  const coverage = coverageOf(parsed.nodes, parsed.todos);
  if (parsed.errors.length) {
    return { ok: false, jsxExpr: '', errors: parsed.errors, imports: [], coverage, usesTranslate: false, helpers: [] };
  }
  const emitted = emitTemplate(parsed.nodes, renames);
  if (emitted.todos.length) {
    coverage.todoReasons = [...coverage.todoReasons, ...emitted.todos];
    coverage.todoNodes += emitted.todos.length;
  }
  return {
    ok: true,
    jsxExpr: emitted.code,
    errors: [],
    imports: [...emitted.imports],
    coverage,
    usesTranslate: parsed.usesTranslate,
    helpers: parsed.helpers,
  };
}

export async function transformTemplate(
  source: string,
  fileName = 'template.html',
): Promise<TransformResult> {
  const raw = transformTemplateToExpr(source, fileName);
  if (!raw.ok) {
    return { ok: false, jsx: '', errors: raw.errors, imports: [], coverage: raw.coverage, usesTranslate: false, helpers: [] };
  }
  const coverage = raw.coverage;
  const wrapped = `const __template = ${raw.jsxExpr};\n`;
  let formatted: string;
  try {
    formatted = await prettier.format(wrapped, {
      parser: 'babel-ts',
      singleQuote: true,
      printWidth: 100,
    });
  } catch (e) {
    return {
      ok: false,
      jsx: '',
      errors: [`prettier failed: ${(e as Error).message}`],
      imports: raw.imports,
      coverage,
      usesTranslate: raw.usesTranslate,
      helpers: raw.helpers,
    };
  }

  return {
    ok: true,
    jsx: formatted,
    errors: [],
    imports: raw.imports,
    coverage,
    usesTranslate: raw.usesTranslate,
    helpers: raw.helpers,
  };
}
