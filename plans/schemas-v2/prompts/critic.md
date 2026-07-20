# Prompt template — critic (v2, framework-neutral)

> **Orchestrator:** fill the `{{…}}` mustache variables and assemble the critic pack per
> `ORCHESTRATOR.md §8` (role-card, conventions, the `Patch`/diff, recipe, scenario
> names+assertions; traces deliberately excluded). The role card stays in
> `plans/03-AGENT-ROLES.md §critic`; operational vocabulary follows the v2 docs. System prompt =
> role card + universal rules U1–U3. This file is the user/task message. Source and target
> frameworks are **parameters** (this run: {{sourceFramework}} → {{targetFramework}}, e.g.
> Angular 2+ → React). Your `critic-verdict` is the evidence for gate **G5**.

---

A unit passed behavioral parity. You review the CODE. Parity proves behavior; you protect the
codebase the team lives in afterward. You cannot demand behavior changes that contradict a
green `BehaviorScenario` — file scenario-gap notes for those.

## 1. Unit under review
- id: `{{unitId}}` | recipe: {{recipeId}} | `Patch`: {{patchId}} | diff: {{diffPath}}
{{targetDiff}}

## 2. Checklist — evaluate each, cite file:line for findings
1. **Conventions** (the target conventions doc, {{conventionsMd}}): layout, naming,
   query/forms/error patterns, flag usage.
2. **Recipe conformance:** deviations from {{recipeId}} steps — justified in notes, or drift?
3. **Reactive-emulation smells:** derived state that is synchronized instead of computed; a
   mutable shared-object "bag" standing in for real state; synchronization chains ≥2 deep; a
   subscription/listener registered without cleanup.
   - _Example (Angular 2+ → React): a `useEffect` writing state whose deps are other state; a
     `useRef` used as a mutable bag; effect chains ≥2 deep; an RxJS/DOM subscription with no
     teardown._
4. **Slop:** dead code, commented-out source, unused exports/imports, untyped escape hatches
   (`any`), non-null assertions, source-framework naming copied verbatim into the target,
   pointless abstraction layers, components >300 lines without a decomposition reason.
   - _Example (Angular 2+ → React): leftover `$scope`/`vm.`/`this.` idioms or Angular
     lifecycle names carried into React code._
5. **A11y floor (beyond scenarios):** labels on inputs, roles on interactive non-semantic
   elements, focus management on modals/menus, keyboard operability of custom widgets.
6. **Test honesty:** tests assert outcomes (not implementation, not snapshots-only for logic);
   selectors are user-facing; no test weakened/skipped/deleted anywhere in the diff.
7. **Seam hygiene** (if element-bridge): properties in / events out with `detail` payloads,
   light DOM, manifest registration, no function props across the boundary.
8. **Event-bus discipline:** no NEW event-façade events; existing usage typed.

## 3. Verdict format (structured output — becomes the `critic-verdict` evidence item)
```json
{ "verdict": "approve" | "request-changes",
  "findings": [{ "file": "", "line": 0, "category": "conventions|recipe-drift|reactive-emulation|slop|a11y|tests|seam|bus", "severity": "blocker|major|minor", "description": "", "suggestedFix": "" }],
  "scenarioGaps": [{ "description": "", "suggestedScenario": "" }],
  "recipeGaps": [{ "recipeId": "", "observation": "" }] }
```
Blockers/majors must be fixed; minors are fixed if trivial, else recorded. You get ONE
re-review round — converging on style nits across rounds is a failure mode; batch everything
into the first pass. A finding you choose to absorb rather than block on may be routed to a
`DecisionRecord` (via `decision.draft`) instead.
