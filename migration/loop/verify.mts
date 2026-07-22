#!/usr/bin/env node
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  TypeOracle,
  loadResidueJsonl,
} from './oracles/type-oracle.mts';
import type { TypeRunSummary, Verdict } from './types.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '../..');

function usage(): never {
  console.error(
    'Usage: npx tsx migration/loop/verify.mts type <workspaceDir> --residue <residue.jsonl> [--baseline <baseline.json>] [--tsconfig <tsconfig.json>]',
  );
  process.exit(2);
}

function parseArgs(argv: string[]) {
  if (argv.length < 4 || argv[0] !== 'type') usage();
  const workspaceDir = resolve(REPO_ROOT, argv[1]);
  let residuePath = '';
  let baselinePath = join(__dirname, 'baseline.json');
  let tsconfigPath = join(workspaceDir, 'tsconfig.json');

  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--residue' && argv[i + 1]) {
      residuePath = resolve(REPO_ROOT, argv[++i]);
    } else if (arg === '--baseline' && argv[++i]) {
      baselinePath = resolve(REPO_ROOT, argv[i]);
    } else if (arg === '--tsconfig' && argv[++i]) {
      tsconfigPath = resolve(REPO_ROOT, argv[i]);
    } else {
      usage();
    }
  }

  if (!residuePath) usage();
  const workspaceRel = argv[1].replace(/\\/g, '/').replace(/^\.\//, '');
  return { workspaceDir, workspaceRel, residuePath, baselinePath, tsconfigPath };
}

function runId(): string {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  const items = loadResidueJsonl(opts.residuePath);
  const oracle = new TypeOracle({
    tsconfigPath: opts.tsconfigPath,
    baselinePath: opts.baselinePath,
    workspaceRel: opts.workspaceRel,
  });
  const { verdicts, summary } = oracle.run(items);

  const outDir = join(REPO_ROOT, 'migration/verdicts');
  mkdirSync(outDir, { recursive: true });
  const id = runId();
  const outPath = join(outDir, `${id}.jsonl`);
  const lines: Array<Verdict | TypeRunSummary> = [...verdicts, summary];
  writeFileSync(outPath, lines.map((r) => JSON.stringify(r)).join('\n') + '\n');

  console.log(
    JSON.stringify({
      runId: id,
      verdictFile: outPath.replace(REPO_ROOT + '/', ''),
      ...summary,
    }),
  );

  process.exit(summary.status === 'pass' ? 0 : 1);
}

main();
