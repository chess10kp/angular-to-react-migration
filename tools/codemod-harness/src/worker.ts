#!/usr/bin/env node
/**
 * Parse/emit worker — the thin Node half of the Jac-driven codemod.
 *
 * The decision/orchestration logic (file walking, coverage counting, template
 * resolution, dispatch, reporting) lives in the Jac driver (`jac/codemod.jac`).
 * This process exposes ONLY the steps that are irreducibly tied to the
 * JS-ecosystem AST libraries — parsing Angular templates (`@angular/compiler`),
 * parsing/rewriting TypeScript (`ts-morph`), building JSX (`@babel/*`) and
 * formatting (`prettier`) — none of which have a Python/Jac equivalent.
 *
 * Protocol: line-delimited JSON on stdin/stdout. One request per line
 *   {"id": <n>, "method": <str>, "params": {...}}
 * one response per line
 *   {"id": <n>, "ok": true,  "result": {...}}
 *   {"id": <n>, "ok": false, "error": "<message>"}
 *
 * `Set` values (import hints) are normalized to arrays so they survive JSON.
 */

import { createInterface } from 'node:readline';
import prettier from 'prettier';
import { parseAngularTemplate } from './parse/angular-template.js';
import { emitTemplate } from './emit/jsx.js';
import { parseAngularComponent } from './parse/angular-component.js';
import { emitComponent } from './emit/component.js';
import { transformService } from './transform-service.js';
import type { IRNode } from './ir/types.js';

interface Request {
  id: number;
  method: string;
  params: any;
}

type Handler = (params: any) => unknown | Promise<unknown>;

const handlers: Record<string, Handler> = {
  parseTemplate({ source, fileName }) {
    const r = parseAngularTemplate(source, fileName ?? 'template.html');
    // Everything here is already JSON-safe (nodes are plain objects).
    return r;
  },

  emitTemplate({ nodes }) {
    const r = emitTemplate(nodes as IRNode[]);
    return { code: r.code, imports: [...r.imports], todos: r.todos };
  },

  parseComponent({ source, fileName }) {
    const r = parseAngularComponent(source, fileName ?? 'component.ts');
    return r; // { model, errors } — model is a plain object
  },

  emitComponent({ model, opts }) {
    const r = emitComponent(model, opts);
    return { code: r.code, reactImports: [...r.reactImports], todos: r.todos };
  },

  async transformService({ source, path }) {
    // In-place ts-morph surgery — genuinely not decomposable, so it runs whole
    // here and the Jac driver only dispatches + reports on it.
    return await transformService(source, path ?? 'service.ts');
  },

  async format({ code, parser }) {
    try {
      const out = await prettier.format(code, {
        parser: parser ?? 'babel-ts',
        singleQuote: true,
        printWidth: 100,
      });
      return { ok: true, code: out, error: null };
    } catch (e) {
      return { ok: false, code: '', error: (e as Error).message };
    }
  },
};

const rl = createInterface({ input: process.stdin });

// Requests are processed strictly in order so responses line up 1:1 with the
// Jac side's blocking read, even across the async handlers.
let chain: Promise<void> = Promise.resolve();

rl.on('line', (line) => {
  const trimmed = line.trim();
  if (!trimmed) return;
  chain = chain.then(async () => {
    let req: Request;
    try {
      req = JSON.parse(trimmed);
    } catch (e) {
      process.stdout.write(JSON.stringify({ id: null, ok: false, error: `bad request json: ${(e as Error).message}` }) + '\n');
      return;
    }
    try {
      const handler = handlers[req.method];
      if (!handler) throw new Error(`unknown method: ${req.method}`);
      const result = await handler(req.params ?? {});
      process.stdout.write(JSON.stringify({ id: req.id, ok: true, result }) + '\n');
    } catch (e) {
      process.stdout.write(JSON.stringify({ id: req.id, ok: false, error: (e as Error).stack ?? String(e) }) + '\n');
    }
  });
});
