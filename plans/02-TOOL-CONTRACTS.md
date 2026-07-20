# 02 — Tool Contracts (what the orchestrator must provide to agents)

> The orchestrator exposes these tools to agents (function-calling, MCP, or RPC — transport is
> the orchestrator's choice). Signatures are given in TypeScript-ish pseudocode. Semantics are
> normative: error model, idempotency, and permission rules must be implemented as written,
> because the anti-loop and evidence-gating guarantees in `01-STATE-AND-ARTIFACTS.md` depend
> on them.

## 0. Cross-cutting rules

- **Every tool result is JSON** with `{ok: boolean, ...}` or `{ok: false, error: {code, message, retryable}}`.
- **Idempotency keys.** Mutating tools accept `idempotencyKey`; replays return the original result.
- **Permissions are role-scoped** (matrix in §7). A denied call returns `error.code = "FORBIDDEN"`
  — agents must not retry it.
- **Path sandboxing.** All paths are workspace-relative; `..` and absolute paths are rejected.
  Write scopes: converter/repairer → `target/**` + own unit's record fields; tracer → `shim/**`;
  scenario-author → `migration/behavior-ir/**` + `target/e2e/**`; nobody writes `legacy/**`.
- **Determinism aids.** Tools that run browsers/tests always return artifact paths (reports,
  traces) in addition to summaries, so gates can verify by hash.

## 1. Workspace & code tools

```ts
fs.read(path: string, range?: {startLine, endLine}) → {content, sha256}
fs.write(path: string, content: string, expectedSha256?: string) → {sha256}
  // expectedSha256 mismatch → error CONFLICT; agent must re-read.
fs.patch(path: string, edits: {oldText, newText}[]) → {sha256}   // exact-match edits only
fs.glob(pattern: string, root?: string) → {paths: string[]}
fs.grep(pattern: string, root: string, opts?) → {matches: {path, line, text}[]}
shell.run(cmd: string, opts: {cwd, timeoutSec, env?}) → {exitCode, stdoutPath, stderrPath, stdoutTail, stderrTail}
  // Allowlisted binaries only (node, npm/pnpm, npx, tsc, eslint, vitest, playwright, git read-only).
  // stdout/stderr saved as artifacts; only tails (≤200 lines) returned inline.
```

## 2. App lifecycle tools

```ts
app.start(side: "legacy" | "target" | "hybrid", opts?: {
    flags?: Record<string, boolean>,   // feature flags for seams
    fixtureProfile?: string,           // MSW/fixture profile id
    instrumented?: boolean             // legacy: inject tracer shim at serve time
}) → {baseUrl, appInstanceId}
app.stop(appInstanceId) → {ok}
app.status(appInstanceId) → {healthy, consoleErrorCount, url}
```

`hybrid` = legacy shell with React seams active (flag-controlled). The orchestrator implements
serving; the recommended mechanism for zero-touch legacy instrumentation is response
interception at the proxy/Playwright layer (see `phases/P2-runtime-tracing.md §3`).

## 3. Scenario & browser tools

```ts
scenario.run(scenarioId: string, appInstanceId: string, opts?: {
    record: boolean,            // capture semantic trace
    video?: boolean, ariaSnapshots?: boolean
}) → {passed: boolean, reportPath, tracePath?, consoleErrors: number, failureSummary?}

scenario.runAll(unitId: string, appInstanceId: string) → {passed, results: per-scenario[], reportPath}

browser.explore(appInstanceId, instructions: string, budget: {steps, seconds})
  → {observations, ariaSnapshotPaths[], screenshotPaths[]}
  // Free-form driving for scenario-author/analyst. Never used as parity evidence.

trace.diff(traceA: path, traceB: path, policyId: string, waiverIds: string[])
  → {equivalent: boolean, divergences: DivergenceRecord[], reportPath}
  // Pure function. Policy definitions: phases/P3 §5. DivergenceRecord feeds counterexamples.

trace.bisect(scenarioId, legacyApp, targetApp, divergence: DivergenceRecord)
  → {minimalStepIndex, statePairPath}   // shrink to first divergent step; see EXTENSIONS-OOB §5
```

## 4. State tools

```ts
unit.get(unitId) → {record, rev}
unit.update(unitId, patch: Partial<UnitRecord>, expectedRev: number) → {rev}
  // Only whitelisted fields per role (e.g., converter may update artifacts.*, notes).
  // State field is NEVER writable here — transitions only via gates.
unit.claim(role: string, filter?: {kind?, motif?, riskTier?}) → {unitId, leaseId, leaseExpiresAt} | {empty: true}
  // Orchestrator picks per scheduling policy (charter). Extends automatically while the
  // agent is actively calling tools; idle expiry per lease TTL.
unit.submitGate(unitId, gate: "G1".."G8", evidence: {path, sha256}[], leaseId)
  → {passed: boolean, failures?: GateFailure[], newState?}
  // THE ONLY WAY STATE ADVANCES. Orchestrator re-runs the mechanical checks itself
  // (it does not trust agent-run results): e.g., for G2 it re-executes tsc/lint/tests.
ledger.append(event) → {seq}            // type-restricted per role
ledger.query(filter: {unitId?, type?, sinceSeq?, limit}) → {events[]}
```

## 5. Knowledge tools

```ts
recipes.match(unitId) → {recipes: {id, confidence, path}[]}      // motif-based lookup
recipes.get(recipeId) → {frontmatter, body}
lessons.search(tags: string[], k?: number) → {lessons[]}
lessons.add(lesson: {title, tags[], body, sourceUnitId, sourceCeId?}) → {id}   // librarian only
counterexample.open(ce: CounterexampleDraft) → {ceId}            // verifier/analyst
counterexample.close(ceId, resolution: {kind: "fixed"|"waived"|"invalid", evidence[]}) → {ok}
waiver.draft(unitId, divergence, justification) → {waiverId, status: "pending-human"}
escalate(unitId, reason: string, artifacts: path[]) → {ok}       // any role; triggers T17
```

## 6. Fixture & network tools

```ts
fixtures.captureHar(scenarioId, appInstanceId) → {harPath}
fixtures.deriveProfile(harPaths: path[], profileName: string) → {profilePath, endpointSummary}
  // HAR → MSW handlers + typed client hints; see phases/P4 §6 and EXTENSIONS-OOB §8.
fixtures.list() → {profiles[]}
```

## 7. Permission matrix (abbreviated; full matrix generated from role cards)

| Tool | intake | cartographer | tracer | scenario-author | calibrator | scaffolder | recipe-miner | converter/repairer | verifier | analyst | critic | integrator | decommissioner | sentinel | librarian |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| fs.read (legacy) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | – | ✓ | ✓ | – | ✓ | ✓ | ✓ |
| fs.write target/** | – | – | – | e2e only | – | ✓ | ✓ | ✓ | – | – | – | flags only | ✓ (deletes) | – | – |
| fs.write shim/** | – | – | ✓ | – | ✓ | – | – | – | – | – | – | – | – | – | – |
| app.* | ✓ | – | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | – | ✓ | ✓ | – | – |
| scenario.run / trace.* | – | – | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ (pre-flight only) | ✓ | ✓ | – | ✓ | ✓ | – | – |
| unit.claim/submitGate | – | ✓ | – | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | – | – |
| lessons.add / recipe writes | – | – | – | – | – | – | ✓ | – | – | – | – | – | – | – | ✓ |
| waiver.draft | – | – | – | ✓ | – | – | – | – | – | ✓ | ✓ | ✓ | – | – | – |
| escalate | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |

Notes:
- Converters get `scenario.run` only against their own unit's scenarios ("pre-flight"), to
  self-check before submitting G3/G4 — but gate evidence is always re-run by the orchestrator.
- The verifier role should be implemented as ~90% deterministic tooling with a small agent for
  triage phrasing; that is why its permissions are narrow.

## 8. Orchestrator-internal responsibilities (not exposed as tools)

- Gate validation runners (re-executing builds/tests/diffs itself).
- Context-pack assembly (`01 §6`) and pack-manifest writing.
- Scheduling policy: priority = (charter priority) × (risk-adjusted readiness); prefer
  finishing in-flight units over starting new ones; cap WIP per phase (charter default: 
  converters ≤ N_cpu/2, verifiers ≤ 2 per app instance pool).
- Budget metering (tokens, attempts, wall-clock) and automatic T17 escalation.
- Lease reaper.
- Dashboard rollup and ratchet checks (`01 §7`).
- Model-tier routing: pick the model per task from the charter routing table (risk tier ×
  role), including the "two cheap conversions cross-check" option (EXTENSIONS-OOB §7).
