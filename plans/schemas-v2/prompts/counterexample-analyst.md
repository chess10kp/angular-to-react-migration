# Prompt template — counterexample-analyst (v2, framework-neutral)

> **Orchestrator:** fill the `{{…}}` mustache variables and assemble the analyst pack per
> `ORCHESTRATOR.md §8` (role-card, the `Counterexample`, both traces, recipe, directive
> template). The role card stays in `plans/03-AGENT-ROLES.md §counterexample-analyst`;
> operational vocabulary follows the v2 docs. System prompt = role card + universal rules
> U1–U3. This file is the user/task message. Source and target frameworks are **parameters**
> (this run: {{sourceFramework}} → {{targetFramework}}, e.g. Angular 2+ → React).

---

A parity run found a reproducible divergence between the source app and the target candidate
(a `Counterexample`, `counterexample.schema.json`). Your job: produce the narrowest actionable
`analysis.repairDirective`. You do not fix code. A directive that says "make it match" is a
failure; a directive that names the mechanism, the target artifact, and the expected post-fix
change **in the trace** is success.

## 1. The divergence
{{counterexampleJson}}

## 2. Procedure
1. Call `trace.bisect` to shrink to the first divergent step if `analysis.minimalRepro` is
   empty. The divergence carries a stable `divergence.kind` (one of the neutral kinds:
   `missing-event | extra-event | order | payload-mismatch | aria-mismatch | dom-mismatch |
   url-mismatch | console-error | timing-semantic | focus-order | visual`) and a
   `firstDivergentSemanticKey` — anchor your analysis on those.
2. Read BOTH raw `SemanticTrace`s around the divergence point (excerpts below; request more
   via `fs.read` on the trace files if needed). The `framework.event` channels usually name the
   mechanism. Work through these neutral root-cause hints, in order — each maps to a candidate
   `analysis.suspectedConstruct` value:
   - **Derived-state ordering** (`suspectedConstruct: "derived-state-ordering"`): did a domain
     event fire before a request on one side but after state settlement on the other? (commonest
     class)
   - **Debounced model update** (`"debounced-model-update"`): input debounce / update-on
     timing differs between the two implementations.
   - **Batched vs intermediate rendering** (`"batched-vs-intermediate-render"`): one side
     coalesces N changes into one settled render; the other exposes intermediate states.
   - **Identity / keying** (`"list-identity-key"`): list tracking/key mismatch → focus loss,
     remount, animation restart.
   - **Content projection / slot** (`"content-projection-slot"`): projected slot order or
     wrapping changed focus order or the ARIA tree.
   - **Plugin lifecycle** (`"third-party-plugin-lifecycle"`): a third-party DOM plugin
     init/destroy on the source side with no target-side counterpart (missing re-init/destroy
     in the wrapper).
   - **Transform semantics** (`"transform-semantics"`): edge cases of a source-side transform
     (null handling, locale, bounds) vs the converted utility.
   - _Example (Angular 2+ → React): an `@Output` emitting inside a change-detection pass before
     an HTTP call maps to `derived-state-ordering`; `[ngModelOptions]` debounce vs a controlled
     `onChange` maps to `debounced-model-update`; `trackBy` vs React `key` maps to
     `list-identity-key`._
3. Set `analysis.suspectedConstruct` (free-text neutral hint from the list above). If a
   framework-specific classification is warranted, put it in `analysis.sourceAdapter` (e.g.
   Angular 2+ `onpush-change-detection-miss` / `rxjs-subscription-leak` /
   `zone-vs-microtask-timing`) — never inline framework specifics into the neutral fields. Cite
   recipe pitfalls/lessons that match ({{recipePitfalls}}, {{matchedLessons}}) via
   `repairDirective.relevantRecipeSection` / `relevantLessons`.
4. Decide the route:
   - **Target code wrong** → write `analysis.repairDirective` with `targetArtifact` (the file
     to change), `fixDirection`, and `expectedObservable` = the specific change in the trace
     that will prove the fix (the observable event/assertion that must appear or disappear).
     Set `status: directed`.
   - **Scenario over-specified / asserting non-semantic detail** → route to scenario-author
     with the exact assertion to reconsider (do NOT weaken it yourself).
   - **Source behavior is the bug** → set `analysis.waiverRecommended = true` and draft a
     `DecisionRecord` (`type: waiver`) via `decision.draft` with justification and
     `expectedNewBehavior`.
5. Anti-loop: if this `fingerprint` has reopened before (`reopenCount` = {{reopenCount}} ≥ 2):
   recommend escalation (`escalate`) and summarize why prior fixes failed — do not issue
   another same-fingerprint directive.

## 3. Constraints
- One directive per `Counterexample`; if you find a second independent cause, open a second
  `Counterexample` via `counterexample.open` (it must pass the flake screen).
- Directives must be executable by an agent who has NOT read the traces — self-contained.
- Max 2000 chars in `analysis.explanation`; put depth into `analysis.minimalRepro` and
  `repairDirective.expectedObservable`.

## 4. Materials
Source trace excerpt: {{sourceTraceExcerpt}}
Target trace excerpt: {{targetTraceExcerpt}}
Unit record: {{unitRecordJson}}
Recipe: {{recipeRef}}
