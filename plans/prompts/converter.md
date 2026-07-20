# Prompt template — converter

> Orchestrator: fill `{{…}}`, assemble per the converter pack recipe (`03-AGENT-ROLES.md`).
> System prompt = role card (03 §converter) + universal rules U1–U3. This file is the user/task
> message. On retry, append section 9.

---

You are converting ONE AngularJS unit to React. Work only on this unit. Your output is judged
mechanically: gates re-run every check you run, and parity against the legacy app is verified
in a real browser afterward. Honest partial escalation beats confident wrong submission.

## 1. Your unit
- id: `{{unitId}}` (kind: {{kind}}, risk: {{riskTier}}, attempt {{attemptN}} of {{maxAttempts}})
- Legacy sources (read-only, included below): {{legacyPathList}}
- Write ONLY under: {{allowedWritePaths}}
- Feature flag: `{{flagName}}` | Seam: {{seamType}}

## 2. Procedure (follow in order)
1. Check every recipe precondition (section 4) against the legacy source. Any false →
   STOP and call `escalate` quoting the failing precondition.
2. Write the **state classification table** first, into `unit.notes` via `unit.update`:
   every `$scope`/controller member → one of {prop | local state | derived | server state |
   event}. Include the template's bindings in your audit ({{bindingSummary}}).
3. {{#if codemod}}A codemod has pre-generated scaffolding at {{codemodOutputPaths}} with
   `// TODO(mx)` markers — fill those in; do not restructure the scaffold.{{/if}}
   Follow the recipe steps IN ORDER; perform each step's "verify by" check before moving on.
4. Write unit tests (RTL) for classified logic and one Storybook story per template shape
   listed in section 6. Use fixture profile `{{fixtureProfile}}` via msw-storybook-addon.
5. Pre-flight: run `tsc`, lint, tests via `shell.run`; iterate on errors (you have ~10 cheap
   iterations — read section 9's error memory first if present, and never repeat a failed fix).
6. Submit gate G2 with the report artifacts. Then wire the seam exactly as recipe r-010 /
   the island pattern in CONVENTIONS.md prescribes (flag-guarded, legacy fallback untouched)
   and submit G3.

## 3. Absolute constraints
- No edits outside {{allowedWritePaths}}. Never touch `legacy/`.
- No watcher emulation: no `useEffect` that mirrors state into other state; derived values are
  computed, not synchronized. No mutable service-object bags. No `any`.
- Do not modify, skip, or delete any test or scenario. If a scenario seems wrong, escalate.
- Two-way bindings (`=`) become value + onChange callback with a single owner — never a
  synced pair of states.
- Seam boundary: data in via properties, data out via CustomEvents with payload in `detail`.
- If the recipe and CONVENTIONS.md conflict, CONVENTIONS.md wins; note the conflict.

## 4. Recipe
{{recipeMarkdown}}

## 5. Behavior IR scenarios your code must satisfy (read as the spec)
{{scenarioJsonList}}

## 6. Realized template shapes (from runtime tracing — your component must render all of these)
{{templateShapes}}

## 7. Conventions
{{conventionsMd}}

## 8. Lessons from earlier units with your motifs
{{topKLessons}}

## 9. {{#if retry}}Previous attempt feedback (this is why you are retrying)
- Gate failures: {{gateFailureReport}}
- Error memory (fixes already tried — do NOT repeat them): {{errorMemoryTail}}
- Best partial output is already in your write paths; continue from it, do not start over
  unless it is fundamentally misdesigned (if so, say why in notes).{{/if}}
