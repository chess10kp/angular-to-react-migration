# Tool Contracts (v2, framework-neutral)

> **Status: normative.** v2 successor to `plans/02-TOOL-CONTRACTS.md`, rewritten against
> `schemas-v2/`. The orchestrator exposes these tools to agents (function-calling, MCP, or RPC —
> transport is the orchestrator's choice). Signatures are TypeScript-ish pseudocode; **semantics
> are normative** — the error model, idempotency, and permission rules must be implemented as
> written, because the anti-loop and evidence-gating guarantees in `ORCHESTRATOR.md` depend on
> them. Type names in `PascalCase` (e.g. `EvidenceBundle`, `Unit`, `Counterexample`) refer to
> `schemas-v2/` schemas. Nothing here branches on the source or target framework; framework
> specifics travel inside adapter slots on the artifacts, never as tool parameters.

## 0. Cross-cutting rules

- **Every tool result is JSON** — `{ok: true, ...}` or `{ok: false, error: {code, message, retryable}}`.
- **Idempotency keys.** Mutating tools accept `idempotencyKey`; replays return the original result.
- **Permissions are role-scoped** (matrix in §7). A denied call returns `error.code = "FORBIDDEN"`;
  agents must not retry it.
- **Path sandboxing.** All paths are workspace-relative; `..` and absolute paths are rejected
  (mirrors `common.schema.json#/$defs/evidenceRef`). Write scopes: converter/repairer → `target/**`
  + own unit's whitelisted record fields; tracer → `shim/**`; scenario-author →
  `migration/behavior-ir/**` + target e2e specs; **nobody writes `legacy/**`** (source is read-only
  regardless of which framework it is).
- **Determinism aids.** Tools that run browsers/tests always return artifact paths (reports,
  traces) in addition to inline summaries, so gates can verify by hash and re-run.
- **Framework as parameter.** Where a tool acts on "the app," `side` selects `source`/`target`/
  `hybrid`; it never names a framework. The active frameworks come from `RunRequest.source/target`.

## 1. Workspace & code tools

```ts
fs.read(path, range?: {startLine, endLine}) → {content, sha256}
fs.write(path, content, expectedSha256?) → {sha256}
  // expectedSha256 mismatch → error CONFLICT; agent must re-read (optimistic concurrency).
fs.patch(path, edits: {oldText, newText}[]) → {sha256}   // exact-match edits only
fs.glob(pattern, root?) → {paths: string[]}
fs.grep(pattern, root, opts?) → {matches: {path, line, text}[]}
shell.run(cmd, opts: {cwd, timeoutSec, env?}) → {exitCode, stdoutPath, stderrPath, stdoutTail, stderrTail}
  // Allowlisted binaries only. The allowlist is resolved from RunRequest.target (build system):
  //   runtime (node/deno), package manager, typechecker, linter, unit-test runner,
  //   browser-driver, read-only VCS. Concrete tools per run come from the target adapter
  //   (e.g. angular2plus → tsc/eslint/vitest/playwright); the CONTRACT is neutral.
  // stdout/stderr saved as artifacts; only tails (≤200 lines) returned inline.
```

## 2. App lifecycle tools

```ts
app.start(side: "source" | "target" | "hybrid", opts?: {
    flags?: Record<string, boolean>,   // feature flags for seams (Unit.seam.flag)
    fixtureProfile?: string,           // network fixture profile id
    instrumented?: boolean             // source: inject tracer shim at serve time
}) → {baseUrl, appInstanceId}
app.stop(appInstanceId) → {ok}
app.status(appInstanceId) → {healthy, consoleErrorCount, url}
```

`hybrid` = the coexistence shell with target seams active (flag-controlled); which app owns the
outer page is `RunRequest.strategy.shellDirection`. The orchestrator implements serving per
`RunRequest.serving.instrumentationInjection`; zero-touch source instrumentation is done at the
proxy/driver layer, never by editing `legacy/**`.

## 3. Scenario, trace & browser tools

```ts
scenario.run(scenarioId, appInstanceId, opts?: {record: boolean, video?, ariaSnapshots?})
  → {passed, reportPath, tracePath?, consoleErrors, failureSummary?}
  // tracePath → a SemanticTrace (semantic-trace.schema.json), side-tagged source|target.

scenario.runAll(unitId, appInstanceId) → {passed, results: perScenario[], reportPath}

browser.explore(appInstanceId, instructions, budget: {steps, seconds})
  → {observations, ariaSnapshotPaths[], screenshotPaths[]}
  // Free-form driving for scenario-author/analyst. NEVER used as parity evidence.

trace.diff(traceA, traceB, policyId, decisionIds: string[])
  → {equivalent, divergences: Divergence[], reportPath}
  // Pure function. `decisionIds` are approved DecisionRecords (waivers) whose `match` absorbs
  // divergences. Each Divergence uses the neutral kinds from counterexample.schema.json
  // (missing-event | extra-event | order | payload-mismatch | aria-mismatch | dom-mismatch |
  //  url-mismatch | console-error | timing-semantic | focus-order | visual) and carries
  //  firstDivergentSemanticKey. Feeds Counterexample drafts.

trace.bisect(scenarioId, sourceApp, targetApp, divergence)
  → {minimalStepIndex, statePairPath}   // shrink to first divergent step; fills Counterexample.analysis.minimalRepro
```

## 4. State tools

```ts
unit.get(unitId) → {record: Unit, rev}
unit.update(unitId, patch: Partial<Unit>, expectedRev) → {rev}
  // Only whitelisted fields per role (e.g. converter → artifacts.*, notes). `state` is NEVER
  // writable here — transitions happen only through submitGate. Stale expectedRev → CONFLICT.
unit.claim(role, filter?: {kind?, motif?, riskTier?}) → {unitId, leaseId, leaseExpiresAt} | {empty: true}
  // Orchestrator picks per scheduling policy (ORCHESTRATOR.md §10) from READY units in the
  // active MigrationPlan wave. Lease auto-extends while the agent calls tools; idle expiry per TTL.
unit.submitGate(unitId, gate: GateId, bundle: EvidenceBundle, leaseId)
  → {passed, checks: Check[], newState?, failures?: GateFailure[]}
  // THE ONLY WAY STATE ADVANCES. The orchestrator schema-validates the EvidenceBundle, verifies
  // every item's sha256, then RE-RUNS the required mechanical checks itself (ORCHESTRATOR.md §4)
  // and writes its own authoritative EvidenceBundle.checks[]. It does NOT trust agent-supplied
  // check results. Pass → transition + `transition` ledger event; fail → `gate-fail` event,
  // state unchanged, one in-lease fix allowed.
patch.submit(patch: Patch) → {patchId}
  // Register a code-change artifact (patch.schema.json). Repair patches MUST set
  // intent.targetsCounterexample; anti-loop tracking depends on it. Emits `patch-submitted`.
ledger.append(event: LedgerEvent) → {seq}    // type-restricted per role; seq assigned by orchestrator
ledger.query(filter: {unitId?, type?, sinceSeq?, limit}) → {events: LedgerEvent[]}
```

## 5. Knowledge & decision tools

```ts
recipes.match(unitId) → {recipes: {id, confidence, path}[]}      // motif-based lookup
recipes.get(recipeId) → {frontmatter, body}
lessons.search(tags: string[], k?) → {lessons[]}
lessons.add(lesson: {title, tags[], body, sourceUnitId, sourceCeId?}) → {id}   // librarian only

counterexample.open(ce: CounterexampleDraft) → {ceId}     // verifier/analyst; must pass flake screen
counterexample.close(ceId, resolution: {kind: "fixed"|"waived"|"invalid", evidence[], decisionId?}) → {ok}
  // `waived` requires an approved DecisionRecord id.

decision.draft(d: {type, unitIds, scenarioIds?, category?, match?, justification, expectedNewBehavior?})
  → {decisionId, status: "pending-human"}
  // Creates a DecisionRecord (decision-record.schema.json). `type` ∈ waiver | deferral |
  // quarantine | escalation-resolution | scope-change. Agents may only draft; a human approves.
  // Approval emits `decision-granted`; rejection `decision-rejected`.

escalate(unitId, reason, artifacts: path[]) → {ok}    // any role; triggers T17 + `escalation` event
```

## 6. Fixture & network tools

```ts
fixtures.captureHar(scenarioId, appInstanceId) → {harPath}
fixtures.deriveProfile(harPaths: path[], profileName) → {profilePath, endpointSummary}
  // HAR → mock handlers + typed client hints. Mechanism is target-adapter-specific; contract neutral.
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
| unit.claim / submitGate | – | ✓ | – | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | – | – |
| patch.submit | – | – | – | – | – | ✓ | – | ✓ | – | – | – | – | – | – | – |
| lessons.add / recipe writes | – | – | – | – | – | – | ✓ | – | – | – | – | – | – | – | ✓ |
| decision.draft | – | – | – | ✓ | – | – | – | – | – | ✓ | ✓ | ✓ | – | – | – |
| escalate | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |

Notes:
- Converters get `scenario.run` only against their own unit's scenarios ("pre-flight"), to
  self-check before submitting G3/G4 — gate evidence is always re-run by the orchestrator.
- The verifier is ~90% deterministic tooling with a small agent for triage phrasing; hence its
  narrow permissions.
- `decision.draft` replaces v1 `waiver.draft`; only humans move a `DecisionRecord` to `approved`.

## 8. Orchestrator-internal responsibilities (not exposed as tools)

- **Gate validation runners** — re-executing builds/tests/diffs and writing authoritative
  `EvidenceBundle.checks[]` (`ORCHESTRATOR.md §4`).
- **Context-pack assembly** and `RunManifest` writing (`ORCHESTRATOR.md §8`).
- **Planner** — compute `MigrationPlan.waves`; **Scheduler** — priority = (RunRequest priority) ×
  (risk-adjusted readiness); prefer finishing in-flight units; enforce `budgets.wipLimits`.
- **Budget metering** (tokens, attempts, wall-clock) and automatic T17 escalation.
- **Lease reaper.**
- **Dashboard/`RunResult` rollup** and ratchet checks (`ORCHESTRATOR.md §11`).
- **Model-tier routing** from `RunRequest.budgets.modelRouting` (risk tier × role), including the
  optional two-cheap-conversions cross-check.
