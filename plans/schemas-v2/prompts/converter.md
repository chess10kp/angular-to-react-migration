# Prompt template — converter (v2, framework-neutral)

> **Orchestrator:** fill the `{{…}}` mustache variables and assemble the context pack per the
> converter pack recipe. The role card still lives in `plans/03-AGENT-ROLES.md §converter`, but
> the operational vocabulary (artifacts, gates, leases, budgets) now follows the v2 docs
> (`ARCHITECTURE.md`, `ORCHESTRATOR.md §8` pack rules, `TOOL-CONTRACTS.md`). System prompt =
> role card + universal rules U1–U3 (`ORCHESTRATOR.md §9`). This file is the user/task message.
> On retry, append section 9. The source and target frameworks are **parameters**
> (`RunRequest.source.framework` / `RunRequest.target.framework`); this template must read
> correctly for any pair.

---

You are converting ONE unit from the source framework to the target framework (this run:
{{sourceFramework}} → {{targetFramework}} — e.g. Angular 2+ → React). Work only on this unit.
Your output is judged mechanically: gates re-run every check you run
(`ORCHESTRATOR.md §4`), and parity against the source app is verified in a real browser
afterward. Honest partial escalation beats confident wrong submission.

## 1. Your unit
- id: `{{unitId}}` (kind: {{kind}}, risk: {{riskTier}}, attempt {{attemptN}} of {{maxAttempts}})
- Source sources (read-only, included below): {{sourcePathList}}
- Write ONLY under: {{allowedWritePaths}} (target write-scope, `target/**`)
- Feature flag: `{{flagName}}` | Seam: {{seamType}} (`route-shell` / `element-bridge`)

## 2. Procedure (follow in order)
1. Check every recipe precondition (section 4) against the source. Any false →
   STOP and call `escalate` quoting the failing precondition (triggers T17).
2. Write the **state-classification table** first, into `unit.notes` via `unit.update`:
   every reactive member / dataflow element of the source unit → one of
   {prop | local state | derived | server state | event}. Include the template's bindings in
   your audit ({{bindingSummary}}).
   - _Example (Angular 2+ → React): each `@Input`, class field, `@Output`, injected-service
     stream, and template binding is classified; a value the template computes from other
     members is `derived`, not stored state._
3. {{#if codemod}}A codemod has pre-generated scaffolding at {{codemodOutputPaths}} with
   `// TODO(mx)` markers — fill those in; do not restructure the scaffold.{{/if}}
   Follow the recipe steps IN ORDER; perform each step's "verify by" check before moving on.
4. Write unit tests for the classified logic (via the target's **unit-test runner**) and one
   **component story / render smoke** per template shape listed in section 6. Wire the
   **network fixture layer** to fixture profile `{{fixtureProfile}}` for the stories.
5. Pre-flight: run the **typechecker**, **linter**, and **unit tests** via `shell.run`;
   iterate on errors (you have ~10 cheap iterations — read section 9's error memory first if
   present, and never repeat a failed fix).
6. Assemble an `EvidenceBundle` and submit gate **G2** via `unit.submitGate` with the report
   artifacts, and register your code change as a `Patch` via `patch.submit`
   (`intent.kind: initial-conversion`, `intent.appliedRecipe: {{recipeId}}`). Then wire the
   seam exactly as recipe `{{seamRecipeId}}` / the seam pattern in the target conventions doc
   prescribes (flag-guarded, source fallback untouched) and submit **G3**.

## 3. Absolute constraints
- No edits outside {{allowedWritePaths}}. Never touch `legacy/` — the source app is read-only
  regardless of which framework it is (U1).
- No reactive-emulation: derived values are **computed**, not synchronized; there is no effect
  or subscription whose only job is mirroring one piece of state into another. No mutable
  shared-object "bags." No untyped escape hatches (no `any`).
  - _Example (Angular 2+ → React): don't write a `useEffect` that copies one `useState` into
    another to imitate a watcher; compute it inline. Don't stash mutable state in a `useRef`
    bag._
- Do not modify, skip, or delete any test or scenario. If a scenario seems wrong, escalate.
- Two-way bindings become **value + onChange with a single owner** — never a synced pair of
  states.
  - _Example (Angular 2+ → React): an Angular `[(ngModel)]` two-way binding becomes a
    controlled `value` + `onChange` prop owned by one component._
- Seam boundary (element-bridge): data in via **element properties**; data out via the
  element's **event mechanism** with the payload in the event's `detail`. No function props
  across the boundary.
  - _Example (Angular 2+ → React): the target custom element receives inputs as DOM
    properties and emits `CustomEvent`s whose `detail` carries the payload._
- If the recipe and the target conventions doc conflict, the conventions doc wins; note the
  conflict.

## 4. Recipe
{{recipeMarkdown}}

## 5. BehaviorScenarios your code must satisfy (read as the spec)
{{scenarioJsonList}}

## 6. Realized template shapes (from runtime tracing — your component must render all of these)
{{templateShapes}}

## 7. Conventions (the target conventions doc, `target/CONVENTIONS.md`)
{{conventionsMd}}

## 8. Lessons from earlier units with your motifs
{{topKLessons}}

## 9. {{#if retry}}Previous attempt feedback (this is why you are retrying)
- Gate failures (authoritative `EvidenceBundle.checks[]`): {{gateFailureReport}}
- Error memory (fixes already tried — do NOT repeat them): {{errorMemoryTail}}
- Best partial output (your last `Patch`) is already in your write paths; continue from it, do
  not start over unless it is fundamentally misdesigned (if so, say why in notes).{{/if}}
