import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  AgentFixApplier,
  buildFixPrompt,
  type AgentInvoke,
} from './fix-applier-agent.mts';
import type { ResidueItem, RetrievedContext } from './contracts.ts';

function makeItem(overrides: Partial<ResidueItem> = {}): ResidueItem {
  return {
    id: 'abc123',
    file: 'migration/app/foo.react.ts',
    span: { startLine: 10, endLine: 10 },
    category: 'di',
    fix_shape: 'di-hook',
    ...overrides,
  };
}

const EMPTY_CTX: RetrievedContext = { champion: null, challengers: [], facts: [] };

describe('buildFixPrompt', () => {
  it('names the file, category, span, and the one-marker constraint', () => {
    const p = buildFixPrompt(makeItem(), EMPTY_CTX);
    expect(p).toContain('migration/app/foo.react.ts');
    expect(p).toContain('MIGRATION_TODO(di)');
    expect(p).toContain('lines 10-10');
    expect(p).toContain('Touch ONLY migration/app/foo.react.ts');
    expect(p).toContain('ONE residue');
  });

  it('folds in the ledger reason and recipe hints when present', () => {
    const item = {
      ...makeItem(),
      reason: { text: 'DI: inject(HttpClient) -> axios' },
      recipe: { fix: 'const http = useHttp();' },
    } as ResidueItem;
    const p = buildFixPrompt(item, EMPTY_CTX);
    expect(p).toContain('DI: inject(HttpClient) -> axios');
    expect(p).toContain('const http = useHttp();');
  });

  it('includes a prior lesson as a worked example', () => {
    const ctx: RetrievedContext = {
      champion: {
        id: 'L1',
        category: 'di',
        fix_shape: 'di-hook',
        before: 'this.router.navigate([x])',
        after: 'navigate(x)',
        which_oracle: 'type',
        commit: '',
        evidence: { counterexample: '', units_won: [], units_regressed: [] },
      },
      challengers: [],
      facts: ['Router maps to useNavigate'],
    };
    const p = buildFixPrompt(makeItem(), ctx);
    expect(p).toContain('this.router.navigate([x])');
    expect(p).toContain('navigate(x)');
    expect(p).toContain('Router maps to useNavigate');
  });
});

describe('AgentFixApplier.apply', () => {
  it('invokes the agent with the prompt + repo cwd, and captures before/after', () => {
    const repoRoot = mkdtempSync(join(tmpdir(), 'agentfix-'));
    const item = makeItem();
    const abs = join(repoRoot, item.file);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, '// MIGRATION_TODO(di): wire the hook\n');

    const seen: { prompt: string; cwd: string } = { prompt: '', cwd: '' };
    // Stub agent: performs a deterministic in-place edit, like a real fix.
    const invoke: AgentInvoke = (prompt, opts) => {
      seen.prompt = prompt;
      seen.cwd = opts.cwd;
      writeFileSync(abs, 'const http = useHttp(); // fixed\n');
      return { ok: true, stdout: 'done', stderr: '' };
    };

    const applier = new AgentFixApplier({ repoRoot, invoke });
    const result = applier.apply(item, EMPTY_CTX);

    expect(seen.cwd).toBe(repoRoot);
    expect(seen.prompt).toContain('MIGRATION_TODO(di)');
    expect(result.files).toEqual([item.file]);
    expect(result.before).toContain('MIGRATION_TODO(di)');
    expect(result.after).toContain('useHttp');
    // the edit really landed on disk
    expect(readFileSync(abs, 'utf8')).toContain('useHttp');
  });

  it('still self-reports only the item file even if the agent is a no-op', () => {
    const repoRoot = mkdtempSync(join(tmpdir(), 'agentfix-'));
    const item = makeItem();
    const abs = join(repoRoot, item.file);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, 'unchanged\n');

    const invoke: AgentInvoke = () => ({ ok: false, stdout: '', stderr: 'boom' });
    const applier = new AgentFixApplier({ repoRoot, invoke });
    const result = applier.apply(item, EMPTY_CTX);

    expect(result.files).toEqual([item.file]);
    expect(result.before).toBe('unchanged\n');
    expect(result.after).toBe('unchanged\n');
  });
});
