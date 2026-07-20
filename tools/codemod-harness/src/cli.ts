#!/usr/bin/env node
/**
 * codemod-harness CLI.
 *
 * Template mode (slice 1) — default:
 *   codemod <path...>              transform each .html, writing a sibling .jsx
 *
 * Component mode (slice 2) — `--components`:
 *   codemod --components <path...> transform each *.component.ts (+ its
 *                                  template) into a sibling .tsx
 *
 * Service mode (slice 4) — `--services`:
 *   codemod --services <path...>   transform each *.service.ts (@Injectable)
 *                                  into a sibling .service.react.ts
 *
 * Flags:
 *   --dry-run   report only; write nothing
 *   --report    recurse and print an aggregate coverage report (implies dry-run)
 *
 * Exit code is non-zero if any file failed to parse.
 */

import { readFileSync, writeFileSync, statSync, readdirSync } from 'node:fs';
import { join, extname, dirname, basename } from 'node:path';
import { transformTemplate } from './transform.js';
import { transformComponent } from './transform-component.js';
import { transformService } from './transform-service.js';

interface FileOutcome {
  file: string;
  ok: boolean;
  errors: string[];
  todoNodes: number;
  todoReasons: string[];
  byType: Record<string, number>;
  imports: string[];
}

function collect(paths: string[], match: (p: string) => boolean): string[] {
  const out: string[] = [];
  for (const p of paths) {
    const st = statSync(p);
    if (st.isDirectory()) {
      for (const entry of readdirSync(p)) out.push(...collect([join(p, entry)], match));
    } else if (match(p)) {
      out.push(p);
    }
  }
  return out;
}

const isHtml = (p: string) => extname(p) === '.html';
const isComponentTs = (p: string) => p.endsWith('.component.ts');
const isServiceTs = (p: string) => p.endsWith('.service.ts') && !p.endsWith('.service.spec.ts');

async function run(): Promise<void> {
  const argv = process.argv.slice(2);
  const componentMode = argv.includes('--components');
  const servicesMode = argv.includes('--services');
  const dryRun = argv.includes('--dry-run');
  const reportOnly = argv.includes('--report');
  const paths = argv.filter((a) => !a.startsWith('--'));

  if (paths.length === 0) {
    console.error('usage: codemod [--components|--services] [--dry-run|--report] <path...>');
    process.exit(2);
  }

  const outcomes: FileOutcome[] = [];

  if (servicesMode) {
    for (const file of collect(paths, isServiceTs)) {
      const r = await transformService(readFileSync(file, 'utf8'), file);
      // A .service.ts without an @Injectable class is simply not a service; skip
      // it rather than counting it as a parse failure.
      if (!r.ok && r.model === null) continue;
      outcomes.push({
        file,
        ok: r.ok,
        errors: r.errors,
        todoNodes: r.todos.length,
        todoReasons: r.model?.generated ? ['generated OpenAPI client (regenerate, not migrated)'] : r.todos,
        byType: {},
        imports: [],
      });
      if (r.ok && !dryRun && !reportOnly) {
        writeFileSync(join(dirname(file), basename(file, '.service.ts') + '.service.react.ts'), r.ts);
      }
    }
  } else if (componentMode) {
    for (const file of collect(paths, isComponentTs)) {
      const r = await transformComponent(readFileSync(file, 'utf8'), file);
      outcomes.push({
        file,
        ok: r.ok,
        errors: r.errors,
        todoNodes: r.todos.length,
        todoReasons: r.todos,
        byType: r.templateCoverage?.byType ?? {},
        imports: [],
      });
      if (r.ok && !dryRun && !reportOnly) {
        writeFileSync(join(dirname(file), basename(file, '.component.ts') + '.tsx'), r.tsx);
      }
    }
  } else {
    for (const file of collect(paths, isHtml)) {
      const r = await transformTemplate(readFileSync(file, 'utf8'), file);
      outcomes.push({
        file,
        ok: r.ok,
        errors: r.errors,
        todoNodes: r.coverage.todoNodes,
        todoReasons: r.coverage.todoReasons,
        byType: r.coverage.byType,
        imports: r.imports,
      });
      if (r.ok && !dryRun && !reportOnly) {
        writeFileSync(join(dirname(file), basename(file, '.html') + '.jsx'), r.jsx);
      }
    }
  }

  printReport(outcomes, { dryRun, reportOnly, componentMode, servicesMode });

  if (outcomes.some((o) => !o.ok)) process.exit(1);
}

function printReport(
  outcomes: FileOutcome[],
  opts: { dryRun: boolean; reportOnly: boolean; componentMode: boolean; servicesMode: boolean },
): void {
  const agg: Record<string, number> = {};
  let totalTodo = 0;
  let failed = 0;
  const reasonCounts: Record<string, number> = {};

  for (const o of outcomes) {
    if (!o.ok) failed++;
    totalTodo += o.todoNodes;
    for (const [k, v] of Object.entries(o.byType)) agg[k] = (agg[k] ?? 0) + v;
    for (const reason of o.todoReasons) {
      const norm = reason.replace(/`[^`]*`/g, '`…`');
      reasonCounts[norm] = (reasonCounts[norm] ?? 0) + 1;
    }
  }

  console.log(
    opts.servicesMode
      ? '\n=== codemod-harness: service (@Injectable .service.ts) -> .service.react.ts ==='
      : opts.componentMode
        ? '\n=== codemod-harness: component (.component.ts + template) -> .tsx ==='
        : '\n=== codemod-harness: template control-flow -> JSX ===',
  );
  console.log(`files:        ${outcomes.length}`);
  console.log(`parsed ok:    ${outcomes.length - failed}`);
  console.log(`parse-failed: ${failed}`);
  console.log(`residue (MIGRATION_TODO) nodes: ${totalTodo}`);
  console.log('\nIR node coverage (by type):');
  for (const [k, v] of Object.entries(agg).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${k.padEnd(14)} ${v}`);
  }

  if (Object.keys(reasonCounts).length) {
    console.log('\nResidue reasons (normalized):');
    for (const [k, v] of Object.entries(reasonCounts).sort((a, b) => b[1] - a[1])) {
      console.log(`  ${String(v).padStart(4)}  ${k}`);
    }
  }

  const failedFiles = outcomes.filter((o) => !o.ok);
  if (failedFiles.length) {
    console.log('\nParse failures:');
    for (const o of failedFiles) console.log(`  ${o.file}\n    ${o.errors.join('\n    ')}`);
  }

  const ext = opts.servicesMode ? '.service.react.ts' : opts.componentMode ? '.tsx' : '.jsx';
  if (opts.dryRun) console.log('\n(dry-run: no files written)');
  else if (!opts.reportOnly) console.log(`\nWrote sibling ${ext} files.`);
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
