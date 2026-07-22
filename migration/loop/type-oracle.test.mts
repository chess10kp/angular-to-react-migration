import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  TypeOracle,
  attributeErrors,
  normalizeMigrationPath,
  parseTscStdout,
} from './oracles/type-oracle.mts';
import type { ResidueItem } from './types.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES = join(__dirname, '__fixtures__');

describe('normalizeMigrationPath', () => {
  it('maps residue .tsx paths to tsc cwd-relative paths', () => {
    expect(
      normalizeMigrationPath('migration/app/campaign/edit/campaign-edit.tsx'),
    ).toBe('campaign/edit/campaign-edit');
    expect(normalizeMigrationPath('campaign/edit/campaign-edit.tsx')).toBe(
      'campaign/edit/campaign-edit',
    );
  });

  it('maps .component.ts residue to .tsx tsc paths', () => {
    expect(normalizeMigrationPath('migration/app/campaign/campaign.component.ts')).toBe(
      'campaign/campaign',
    );
    expect(normalizeMigrationPath('campaign/campaign.tsx')).toBe('campaign/campaign');
  });
});

describe('parseTscStdout', () => {
  it('parses tsc diagnostic lines from stdout', () => {
    const stdout = [
      'campaign/edit/campaign-edit.tsx(9,14): error TS2304: Cannot find name useFormBuilder.',
      'noise line',
    ].join('\n');
    const diags = parseTscStdout(stdout);
    expect(diags).toEqual([
      {
        file: 'campaign/edit/campaign-edit.tsx',
        line: 9,
        col: 14,
        code: 'TS2304',
        message: 'Cannot find name useFormBuilder.',
      },
    ]);
  });
});

describe('attributeErrors', () => {
  it('maps an error inside a residue span to that residue id', () => {
    const items: ResidueItem[] = [
      {
        id: 'seed-1',
        file: 'migration/app/foo/sample.tsx',
        span: { startLine: 5, endLine: 5 },
      },
    ];
    const diags = parseTscStdout(
      'foo/sample.tsx(5,10): error TS2551: Property lable does not exist.',
    );
    const { verdicts, unattributed } = attributeErrors(items, diags);
    expect(verdicts).toHaveLength(1);
    expect(verdicts[0].residueId).toBe('seed-1');
    expect(verdicts[0].status).toBe('fail');
    expect(verdicts[0].detail[0].code).toBe('TS2551');
    expect(unattributed).toHaveLength(0);
  });

  it('leaves errors outside spans as unattributed', () => {
    const items: ResidueItem[] = [
      {
        id: 'seed-1',
        file: 'migration/app/foo/sample.tsx',
        span: { startLine: 1, endLine: 1 },
      },
    ];
    const diags = parseTscStdout(
      'foo/sample.tsx(9,10): error TS2551: Property lable does not exist.',
    );
    const { verdicts, unattributed } = attributeErrors(items, diags);
    expect(verdicts[0].status).toBe('pass');
    expect(unattributed).toHaveLength(1);
  });
});

describe('TypeOracle integration', () => {
  it('fails broken fixture with mapped residue verdict (RED)', () => {
    const fixture = join(FIXTURES, 'broken');
    const oracle = new TypeOracle({
      tsconfigPath: join(fixture, 'tsconfig.json'),
      baselinePath: join(fixture, 'baseline.json'),
      workspaceRel: 'migration/loop/__fixtures__/broken',
    });
    const items = [
      {
        id: 'broken-001',
        file: 'migration/loop/__fixtures__/broken/src/sample.ts',
        span: { startLine: 6, endLine: 6 },
      },
    ];
    const { verdicts, summary } = oracle.run(items);
    expect(summary.status).toBe('fail');
    expect(summary.totalErrors).toBeGreaterThan(0);
    const itemVerdict = verdicts.find((v) => v.residueId === 'broken-001');
    expect(itemVerdict?.status).toBe('fail');
    expect(itemVerdict?.detail.some((d) => d.code === 'TS2551')).toBe(true);
  });

  it('passes clean fixture (GREEN)', () => {
    const fixture = join(FIXTURES, 'clean');
    const oracle = new TypeOracle({
      tsconfigPath: join(fixture, 'tsconfig.json'),
      baselinePath: join(fixture, 'baseline.json'),
      workspaceRel: 'migration/loop/__fixtures__/clean',
    });
    const items = [
      {
        id: 'clean-001',
        file: 'migration/loop/__fixtures__/clean/src/sample.ts',
        span: { startLine: 2, endLine: 2 },
      },
    ];
    const { verdicts, summary } = oracle.run(items);
    expect(summary.status).toBe('pass');
    expect(verdicts.every((v) => v.status === 'pass')).toBe(true);
  });
});

describe('verify.mts CLI', () => {
  const verify = join(__dirname, 'verify.mts');

  it('exits 1 on broken fixture', () => {
    expect(() =>
      execFileSync(
        'npx',
        [
          'tsx',
          verify,
          'type',
          'migration/loop/__fixtures__/broken',
          '--residue',
          'migration/loop/__fixtures__/broken/residue.jsonl',
          '--baseline',
          'migration/loop/__fixtures__/broken/baseline.json',
        ],
        { cwd: join(__dirname, '../..'), encoding: 'utf8' },
      ),
    ).toThrow();
  });

  it('exits 0 on clean fixture', () => {
    const out = execFileSync(
      'npx',
      [
        'tsx',
        verify,
        'type',
        'migration/loop/__fixtures__/clean',
        '--residue',
        'migration/loop/__fixtures__/clean/residue.jsonl',
        '--baseline',
        'migration/loop/__fixtures__/clean/baseline.json',
      ],
      { cwd: join(__dirname, '../..'), encoding: 'utf8' },
    );
    const summary = JSON.parse(out.trim());
    expect(summary.status).toBe('pass');
  });
});
