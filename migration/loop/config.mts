import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { GitCommitter } from './committer.mts';
import { runDriver } from './driver.mts';
import { JsonlPicker } from './picker.mts';
import { BudgetRetryPolicy } from './retry.mts';
import { JsonlContextStore } from './store.mts';
import { TypeOracle } from './oracles/type-oracle.mts';
import type { FixApplier, FixResult, Oracle, ResidueItem, RetrievedContext } from './contracts.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = resolve(__dirname, '../..');

export interface LoopConfig {
  repoRoot?: string;
  residuePath?: string;
  statusPath?: string;
  lessonsPath?: string;
  workspaceDir?: string;
  workspaceRel?: string;
  tsconfigPath?: string;
  baselinePath?: string;
  blockedDir?: string;
  applier?: FixApplier;
  oracles?: Oracle[];
}

export class PauseFixApplier implements FixApplier {
  apply(item: ResidueItem, _ctx: RetrievedContext): FixResult {
    return { files: [item.file] };
  }
}

export function createLoopConfig(overrides: LoopConfig = {}) {
  const repoRoot = overrides.repoRoot ?? REPO_ROOT;
  const workspaceRel = overrides.workspaceRel ?? 'migration/app';
  const workspaceDir = overrides.workspaceDir ?? join(repoRoot, workspaceRel);
  const tsconfigPath =
    overrides.tsconfigPath ?? join(workspaceDir, 'tsconfig.json');
  const baselinePath =
    overrides.baselinePath ?? join(__dirname, 'baseline.json');

  const picker = new JsonlPicker({
    residuePath: overrides.residuePath ?? join(repoRoot, 'migration/residue.jsonl'),
    statusPath: overrides.statusPath ?? join(__dirname, 'status.jsonl'),
  });

  const store = new JsonlContextStore({ repoRoot });
  const committer = new GitCommitter({ repoRoot });
  const retry = new BudgetRetryPolicy();
  const applier = overrides.applier ?? new PauseFixApplier();
  const oracles =
    overrides.oracles ??
    ([
      new TypeOracle({
        tsconfigPath,
        baselinePath,
        workspaceRel,
      }),
    ] as Oracle[]);

  return {
    picker,
    store,
    applier,
    oracles,
    committer,
    retry,
    blockedDir: overrides.blockedDir ?? join(__dirname, 'blocked'),
  };
}

export function runLoop(overrides: LoopConfig = {}) {
  const deps = createLoopConfig(overrides);
  return runDriver(deps);
}

import { pathToFileURL } from 'node:url';

const isMain =
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMain) {
  const result = runLoop();
  console.log(JSON.stringify(result));
}
