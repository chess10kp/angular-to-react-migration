# Out-of-Distribution Extensions

> Ideas NOT present in REPORT.md (or substantially extended beyond it). Some are already woven
> into the core plan (marked **[adopted]** with pointers); the rest are optional modules with
> feasibility notes. Section numbers are stable — phase docs cross-reference them.

Note on the report's own eight proposals: three are adopted directly into the core plan —
Template Shape Enumerator (P2 §6), RootScope Event Tombstoning (P4 §7 + P7 §4), Contrastive
Recipe Distillation (P5 entirely). Watcher Differential Fingerprinting is adapted below (§4).
Compile-Link Continuation IR and Digest-Clock Harness were evaluated and deliberately demoted:
both emulate AngularJS internals on the React side, which violates design principle P5 more
than it helps — their use cases are covered by island quarantine + the analyst's `ngjs.*`
diagnostics.

---

## §1. Session-replay-grounded scenario mining + traffic-weighted verification

**What.** Instead of agents inventing scenarios from source, record real user sessions on the
legacy production app (rrweb or an existing analytics/replay stream), cluster them into
canonical flows (sequence-similarity over normalized event streams), and generate Behavior IR
drafts from the top clusters. Each scenario carries a **traffic weight**.

**Why it's out-of-distribution.** Every published migration harness generates tests from
source or from an engineer's idea of the flows. Grounding the oracle in observed production
behavior (a) prioritizes verification effort by actual usage, (b) surfaces flows nobody on the
team remembers exist (the killer risk in decade-old apps), and (c) gives decommission evidence
("this feature had 0 sessions in 90 days") that static analysis can never give.

**Mechanics.** rrweb script added via the same zero-touch injection as the shim (P2 §3) on a
staging/canary slice → session store → clustering job (embed step sequences; k-medoids;
medoid = candidate scenario) → scenario-author converts medoids to Behavior IR
(`source: "recorded-session"`). Traffic weight feeds: scenario priority, soak duration,
mutation-calibration requirement, and the order of the conversion queue.

**Feasibility:** high (rrweb is mature; clustering is boring engineering). **Risk:** PII in
recordings — needs masking config before anything leaves production; keep replay data out of
agent context (agents see derived Behavior IR only).

## §2. Legacy normalization pre-pass ("compile the dialect down before translating")

**What.** Before conversion, run behavior-preserving codemods ON THE LEGACY side to shrink the
motif space: `.controller()+$scope` → `.component()+controllerAs`; implicit DI → explicit
array annotation (port of ng-annotate logic); inline template extraction; `$broadcast` between
parent/child scopes → explicit bindings where statically provable. Each normalization commit
is gated by the SAME oracle (scenarios green before/after — the harness verifies its own
pre-pass).

**Why.** Recipes cover clusters; the long tail of stylistic variance is what makes weak agents
fail. Normalizing the source dialect converts long-tail units into recipe-covered units. This
inverts the usual "never touch legacy" instinct — but with the oracle already built, legacy
edits are exactly as safe as target edits, and each normalization is thousands of times
cheaper than a bespoke conversion. (Prior art in spirit: pre-LLM migration prep guides; as an
agentic, oracle-gated phase it appears in no published system.)

**Activation rule** (charter `strategy.normalizationPrepass`): enable when >60% of controllers
are `$scope`-style. Run as a P1.5 wave with its own tiny recipe set. **Constraint:** this is
the ONLY exception to rule U1, executed by a dedicated role with the decommissioner's
evidence discipline.

## §3. Dark-launch dual rendering (Scientist for UIs)

**What.** During soak of high-risk units, production serves the legacy implementation while
ALSO mounting the React island off-DOM/hidden with the same props/state feed; a comparator
diffs semantic outputs (emitted domain events, ARIA tree of the hidden mount, network intents
— intercepted and dropped for the shadow) and reports divergence telemetry. GitHub's
Scientist pattern, applied to components; per the research sweep, no published frontend
framework migration has done this end-to-end.

**Mechanics.** Only feasible for units whose inputs cross the seam as data (islands with
`ng-prop` inputs — the seam already serializes their inputs). Shadow mounts run in the page
(cheap) with network + storage + analytics side-effects stubbed by a shadow-mode MSW worker.
Divergences become counterexamples with a production-trace payload (T20).

**Feasibility:** medium — side-effect containment is the hard part; restrict to
read-mostly display units (tables, dashboards) where it's also most valuable. **Payoff:**
catches fixture-vs-reality gaps that no amount of staging verification can.

## §4. Watcher Differential Fingerprinting as a diagnostic layer **[adopted, adapted]**

The report proposes comparing watcher-firing fingerprints between twins. Adopted with one
correction: watcher traces are **never parity requirements** (React must not reproduce digest
mechanics — principle P5); they are the analyst's diagnostic channel (P3 §5 normalizer keeps
`ngjs.*` out of the diff but in the raw trace; P6 §3 step 1 uses them to name divergence
mechanisms). The fingerprint store additionally powers the mutation catalog: motifs whose
watcher graphs are dense get the `watch-derived-state` mutants (P3 §6) automatically.

## §5. Counterexample shrinking via trace bisection **[adopted]**

Delta-debugging applied to UI parity: when a 40-step scenario diverges, `trace.bisect`
(02 §3) replays binary-searched prefixes of the step list against both twins to find the
minimal divergent prefix, then snapshots both apps' observable state at that point. Borrowed
from property-based testing shrinkers; not present in any published migration harness. This is
what makes counterexamples cheap enough for weak repairers — a repair directive pointing at
step 3 of 4 beats one pointing at step 37 of 40.

## §6. Performance-parity budgets (digest pressure → commit pressure)

**What.** Behavioral parity can hide pathological translations (a deep `$watch` becoming an
effect cascade that commits 50× per keystroke). The verifier records per-scenario: interaction
latency at settle points, React commit counts (profiler hook), long-task counts, JS heap after
settle. Baseline = legacy digest metrics from the shim. Budget rule (charter-tunable):
interaction latency ≤ legacy×1.25, commits per interaction ≤ watch-fires per interaction ×2,
heap non-monotonic across remounts (leak screen).

**Why OOB.** Migration literature verifies function, occasionally pixels — never translated
*reactivity efficiency*. The watcher→effect slop class is invisible to every other gate yet is
the #1 long-term regret in AngularJS→React rewrites. **Feasibility:** high (all signals already
captured); make it a G5-adjacent soft gate that hard-fails only at >3× budget.

## §7. N-version conversion cross-check (agreement as cheap confidence)

**What.** For `high`-risk units (or when a recipe is young), run TWO independent cheap
conversions (different agents/seeds/prompt orderings), then diff their *state classification
tables* (P6 §1 step 2) and public component APIs — not their code text. Agreement → proceed
with either, confidence boosted, possibly skip one verification tier. Disagreement → the
disagreement description itself is routed to a strong model as a decision task (much cheaper
than a strong-model full conversion).

**Why.** N-version programming as a *triage* signal, not a reliability mechanism: it prices
unit difficulty empirically, catching "recipe silently doesn't fit this unit" before the
expensive parity loop. Two cheap runs cost ~20% of one strong run (HeroDevs' published cost
ratios support ~9× cheap:strong pricing). **Feasibility:** high; purely an orchestrator
routing policy (02 §8).

## §8. Contract-first API extraction (one source of truth for network parity)

**What.** Extend P3 §3/P4 §6: HAR corpus → inferred OpenAPI spec (schema inference over
observed payloads + endpoint clustering) → generate BOTH the typed client + TanStack Query
hooks AND the MSW handlers from that single spec. Drift between mocks and client becomes
impossible by construction; the spec doubles as the network-semantics section of the
Behavior IR and as documentation the backend team can correct (their corrections =
fixture-vs-reality patches caught before soak, cheaply).

**Feasibility:** high (har-to-openapi tooling exists; agent-assisted schema naming makes it
pleasant). This also future-proofs: post-migration, the app owns a real API contract it never
had.

## §9. ARIA-constrained property-based fuzzing of the twins

**What.** Beyond authored scenarios: a seeded random walker reads the accessibility snapshot,
enumerates affordances (buttons, links, inputs with valid-value generators per role), and
performs identical randomized-but-seeded interaction sequences against BOTH twins under the
same fixtures, diffing normalized traces at each settle point. Failures shrink via §5. Run
nightly on INTEGRATED units as regression insurance; run pre-integration on `critical` units.

**Why.** Authored scenarios encode expected flows; fuzzing finds the unexpected ones
(WebTestBench's "latent constraints" warning, answered mechanically). The twin makes this
uniquely cheap: you need NO correctness model at all — legacy IS the property
(`∀ seed: trace(legacy, seed) ≡ trace(react, seed)`). **Feasibility:** medium-high; the
denylist from P2 §5 and MSW write-safety make it safe. Flakiness discipline: any
non-reproducible fuzz divergence (per seed replay) is a determinism bug in the harness and
gets fixed first — a flaky fuzzer is worse than none.

## §10. Economics telemetry & confidence-priced routing **[partially adopted]**

Charter model routing (P0 §5) is static. The extension: make routing adaptive from ledger
telemetry — per (motif × tier) track cost-per-accepted-unit, first-pass parity, escalation
rate; re-price monthly: motifs where cheap-tier cost-per-accepted exceeds standard-tier
(retries are not free) auto-promote; motifs with >90% cheap-tier first-pass auto-demote a
tier. Publish the routing table in the dashboard so humans can see the harness learning where
intelligence is actually needed. **Feasibility:** high — it's a fold over data the ledger
already holds; the discipline is refusing to hand-tune what the telemetry can decide.

---

## If you build only three extensions

1. **§1 session-replay mining** — it upgrades the oracle from "what agents think the app does"
   to "what users actually do," which improves every downstream phase at once.
2. **§7 N-version cross-check** — the cheapest large quality gain for a weak-agent fleet.
3. **§6 perf-parity budgets** — the only gate that catches the failure class you will
   otherwise discover six months after cutover, when it's a rewrite-the-rewrite problem.
