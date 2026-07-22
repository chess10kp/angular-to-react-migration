import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type {
  FixApplier,
  FixResult,
  Lesson,
  ResidueItem,
  RetrievedContext,
} from './contracts.ts';

/**
 * The residue ledger carries richer hints than the ResidueItem contract types
 * (reason prose, the emitter's recipe suggestion). The picker preserves them on
 * the runtime object; read them opportunistically without widening the seam.
 */
interface LedgerHints {
  reason?: { text?: string } | string;
  recipe?: { fix?: string; title?: string };
}

/**
 * Shells out to a headless coding agent to apply ONE residue fix in place.
 *
 * The agent runs with the repo as CWD and edits `item.file` directly. Its output
 * is UNTRUSTED — exactly like the human FixApplier it replaces (§C.1.5). The
 * committer firewall re-derives touched files from `git status` and enforces the
 * per-item allowlist, and the type/parity oracle re-verifies, so a wrong edit
 * fails the gate and is retried or blocked. This class never has to be "correct".
 *
 * `invoke` is injectable so tests drive a deterministic stub instead of a real
 * model, and so the runtime is swappable (claude CLI today, an API call later)
 * without touching the driver.
 */
export interface AgentInvokeResult {
  ok: boolean;
  stdout: string;
  stderr: string;
}

export type AgentInvoke = (
  prompt: string,
  opts: { cwd: string; item: ResidueItem },
) => AgentInvokeResult;

export interface AgentFixApplierOptions {
  repoRoot: string;
  /** Deterministic stub in tests; defaults to the `claude -p` headless CLI. */
  invoke?: AgentInvoke;
  /** Agent executable (default 'claude'). */
  command?: string;
  /** Flags placed BEFORE the prompt (default headless + acceptEdits). */
  args?: string[];
  timeoutMs?: number;
}

const DEFAULT_ARGS = ['--permission-mode', 'acceptEdits'];

export function buildFixPrompt(
  item: ResidueItem,
  ctx: RetrievedContext,
): string {
  const hints = item as ResidueItem & LedgerHints;
  const reason =
    typeof hints.reason === 'string' ? hints.reason : hints.reason?.text ?? '';
  const recipe = hints.recipe?.fix ? `\nEmitter recipe suggestion:\n${hints.recipe.fix}` : '';

  const champion = ctx.champion ? exampleFromLesson(ctx.champion) : '';
  const facts = ctx.facts.length
    ? `\nProject facts to respect:\n${ctx.facts.map((f) => `- ${f}`).join('\n')}`
    : '';

  return [
    `You are the FixApplier in an Angular 17 -> React 19 migration loop.`,
    `Resolve exactly ONE residue marker and nothing else.`,
    ``,
    `File (edit ONLY this file): ${item.file}`,
    `Marker: MIGRATION_TODO(${item.category ?? 'unknown'}) around lines ${item.span.startLine}-${item.span.endLine}`,
    `fix_shape: ${item.fix_shape ?? 'unknown'}`,
    reason ? `Reason: ${reason}` : '',
    recipe,
    champion,
    facts,
    ``,
    `Rules (from the migrate-residue skill and HARNESS-EXECUTION-PLAN §3):`,
    `- Apply the category's canonical React fix; make the file compile (tsc --noEmit).`,
    `- Touch ONLY ${item.file}. Do not edit any other file, test, or snapshot.`,
    `- Never delete a MIGRATION_TODO marker without actually doing the fix. If you`,
    `  cannot prove the fix safe, leave a TIGHTER, more specific residue marker`,
    `  instead of guessing a semantic transform (residue is a sanctioned answer).`,
    `- Do not add \`any\`, \`@ts-ignore\`, or \`eslint-disable\` to pass a gate.`,
    `Make the edit now.`,
  ]
    .filter((l) => l !== '')
    .join('\n');
}

function exampleFromLesson(l: Lesson): string {
  if (!l.before && !l.after) return '';
  return [
    `\nA prior lesson fixed a ${l.category}/${l.fix_shape} the same way:`,
    l.before ? `  before: ${l.before}` : '',
    l.after ? `  after:  ${l.after}` : '',
  ]
    .filter(Boolean)
    .join('\n');
}

export class AgentFixApplier implements FixApplier {
  private readonly invoke: AgentInvoke;

  constructor(private readonly options: AgentFixApplierOptions) {
    this.invoke = options.invoke ?? this.defaultInvoke.bind(this);
  }

  private defaultInvoke(
    prompt: string,
    opts: { cwd: string },
  ): AgentInvokeResult {
    const command = this.options.command ?? 'claude';
    const args = [...(this.options.args ?? DEFAULT_ARGS), '-p', prompt];
    const res = spawnSync(command, args, {
      cwd: opts.cwd,
      encoding: 'utf8',
      timeout: this.options.timeoutMs ?? 600_000,
    });
    return {
      ok: res.status === 0,
      stdout: res.stdout ?? '',
      stderr: res.stderr ?? '',
    };
  }

  apply(item: ResidueItem, ctx: RetrievedContext): FixResult {
    const abs = join(this.options.repoRoot, item.file);
    const before = existsSync(abs) ? readFileSync(abs, 'utf8') : '';

    const prompt = buildFixPrompt(item, ctx);
    this.invoke(prompt, { cwd: this.options.repoRoot, item });

    const after = existsSync(abs) ? readFileSync(abs, 'utf8') : '';

    // Self-reported and UNTRUSTED — the committer re-derives from git status.
    return { files: [item.file], before, after };
  }
}
