# Prompt template — scenario-author (v2, framework-neutral)

> **Orchestrator:** fill the `{{…}}` mustache variables and assemble the scenario-author pack
> per `ORCHESTRATOR.md §8` (role-card, phase-doc section, unit record, source, recorded traces,
> fixture list). The role card stays in `plans/03-AGENT-ROLES.md §scenario-author`; operational
> vocabulary follows the v2 docs. System prompt = role card + universal rules U1–U3. This file
> is the user/task message. Source and target frameworks are **parameters**
> (`RunRequest.source/target`); this template must read correctly for any pair.

---

You are writing the acceptance oracle for ONE unit of the source framework before anyone
converts it (this run: {{sourceFramework}} → {{targetFramework}}). Your scenarios define what
"correct" means for the future target implementation. They must pass against the SOURCE app
first (gate **G1**) — a test that never passed on source proves nothing about parity. Each
scenario is a `BehaviorScenario` (`behavior-scenario.schema.json`).

## 1. Your unit
- id: `{{unitId}}` (kind {{kind}}, risk {{riskTier}}) — requires ≥{{minScenarios}} scenarios
  covering: {{requiredCoverage}}
- Source sources + templates (below): {{sourcePathList}}
- Recorded `SemanticTrace`s for its flows: {{tracePathList}}
- Verification emphasis for its motifs (historic divergence kinds): {{verificationEmphasis}}

## 2. Procedure
1. Read the traces before the source: they show what actually happens (events, requests,
   ARIA milestones) — write scenarios about THAT, then use source to find edge behaviors
   the traces missed (error branches, validation messages, empty states).
2. For each scenario: write the `BehaviorScenario` JSON first (schema
   `behavior-scenario.schema.json`) into `migration/behavior-ir/`, then the executable spec
   that drives it under `target/e2e/`, using the target's **browser-driver**.
3. Pin determinism in `preconditions`: `fixtureProfile` ({{fixtureProfiles}}), `clock` if any
   date/time appears in the UI, `seed` if randomness, `viewport`.
4. Run each spec 3× against the source app via `scenario.run`; fix flake by strengthening
   determinism, NEVER by loosening assertions or adding timeouts.
5. Assemble an `EvidenceBundle` and submit **G1** via `unit.submitGate` with the green run
   reports (`parity-report` items). Set `status.greenOnLegacy = true` only when it is.

## 3. Assertion rules (hard)
- Locate by role+name (query by accessible role/name). CSS-selector fallback allowed only with
  a `selector-debt` note.
- Assert only at settle points (`waitForSettle` steps). No fixed-duration waits.
- Floor per scenario: ≥1 ARIA assertion (aria-snapshot preferred), network semantics if the
  flow touches the network, final URL if navigation occurs, `consoleErrors: 0`.
- Assert **user-observable behavior**, never source-framework internals — the semantic-event
  probe / `framework.event` trace channels are diagnostics, not spec.
  - _Example (Angular 2+ → React): assert the rendered rows, emitted domain events, and
    network calls; do not assert change-detection cycles, zone turns, or internal
    subscription counts._
- If source behavior looks like a bug: default is encode-as-is (bug-for-bug) and add a note;
  if `RunRequest` policy is `fix-with-waiver`, draft a `DecisionRecord` (`type: waiver`) via
  `decision.draft` instead. Never silently "improve".

## 4. Unit context
{{unitRecordJson}}
{{sourceSources}}
{{traceExcerpts}}
