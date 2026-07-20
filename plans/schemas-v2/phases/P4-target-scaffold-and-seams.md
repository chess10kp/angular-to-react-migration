# Phase 4 — Target Scaffold & Coexistence Seams (v2, framework-neutral)

> **Status: normative.** v2 successor to `plans/phases/P4-target-scaffold-and-seams.md`, rewritten
> so the **source and target frameworks are parameters, not assumptions**
> (`RunRequest.source.framework` / `RunRequest.target.framework`). Angular 2+ → React is only the
> worked example; nothing in the scaffold procedure or the two seam mechanisms depends on that
> pairing. Concrete stack choices, bridge mechanisms, and tool names are resolved from the
> **target adapter** and appear only in "Adapter notes" callouts — never in the neutral flow.
>
> **Role:** scaffolder. **Input:** `RunRequest`. **Output:** bootable `target/` app; a seam
> library proven end-to-end with a hello-world unit (gate G3 passes on it); `target/CONVENTIONS.md`;
> the network-fixture pipeline; CI. Runs in parallel with P2/P3.

---

## 1. Target stack

The scaffolder resolves the concrete stack from `RunRequest.target` (build system, package
manager, typechecker, linter, unit-test runner, browser-driver) and the target adapter; the
harness contract is neutral (`TOOL-CONTRACTS.md §1`, `shell.run` allowlist). Choose one option per
layer and record it in `target/CONVENTIONS.md` (§9):

| Layer | Neutral requirement |
|---|---|
| Runtime | The target framework at a version whose seam mechanism (custom-element / mount host) is load-bearing and verified |
| Language | Statically typed, strict mode on |
| Build | The target ecosystem's standard bundler/dev server |
| Routing | A router supporting data loading and history ownership handoff (needed for the route-shell seam, §3) |
| Server state | A query/cache library to replace the source app's HTTP/resource layer |
| Forms | A form library + schema validation to replace the source app's form/validation model |
| Unit/component tests | The target's unit-test runner + component testing utilities |
| Browser tests | A browser-driver with ARIA-snapshot, trace, and HAR support (parity evidence engine) |
| Workbench | A component-story tool wired to the same network-fixture layer as e2e/unit |
| Network fixtures | One mock-handler layer shared across e2e, stories, and unit (§6) |
| Compiler/optimizer | Optional; enable only once the app builds cleanly — do not fight it during migration |

Deliberately excluded (framework-independent rationale): SSR frameworks (architectural blast
radius), state-management megastores (introduce a small store/context per-need, recipe-driven),
and a CSS-system rewrite (preserve source CSS behind component boundaries; see §8).

> **Adapter notes (Angular 2+ → React).** Verified July 2026 (re-verify at implementation time):
> React 19.2.x (custom-element support is the load-bearing seam feature); TypeScript strict; Vite;
> React Router v7/v8 (v8 requires React ≥19.2.7 + Node ≥22.22 and is ESM-only — take v7 if CI
> can't guarantee that); TanStack Query v5; React Hook Form + Zod; Vitest + React Testing Library;
> Playwright 1.61+ (`toMatchAriaSnapshot`, trace, HAR); Storybook 10.5+ with the MSW addon; MSW 2.x
> everywhere; React Compiler v1 optional. These are `angular2plus`→`react` target-adapter choices.

## 2. Seam A — `element-bridge` (target components embedded in the source app) — DEFAULT for shared widgets

Each migrated leaf/widget is embedded into the still-running source app through the
**`element-bridge`** seam (`Unit.seam` = `element-bridge`, `MigrationPlan.bridgePlan`). The seam
library exposes one registration entry point; every embedded unit is registered from a single
manifest file, tag-prefixed `mx-`, and flag-guarded so the source app shows it only when the unit's
`Unit.seam.flag` is on. Data flows **in as properties, out as events** — never as stringly-typed
attributes, and never as raw function props across the boundary. Small static config may pass as a
serialized attribute; real data passes as a property.

Rules (framework-independent):
- Outbound signals from an embedded unit are structured events carrying all data in a single
  payload; the source-side template binds a handler to them.
- Callback-style bindings on the source construct become **events**, not function props, at the
  seam boundary.
- Prefer property/event binding over attribute strings so complex data survives the boundary
  untouched.

> **Adapter notes (Angular 2+ → React).** Concrete bridge: `@r2wc/react-to-web-component` v2 (the
> only actively maintained, `createRoot`-based option) wrapping each React component as a custom
> element (`defineIsland(tag, Component, props)` in `target/src/seam/`, registered from
> `islands.manifest.ts`). The Angular 2+ host binds via property/event binding
> (`[rows]="…"` / `(rowSelected)="…"`) inside a flag-guarded `@if`/`*ngIf`; outbound signals are
> `CustomEvent`s with data in `detail`. Do **not** use the dead `react2angular`/`angular2react`
> packages; if a wrapper is unavoidable, vendor a `createRoot`-based fork (~150 LOC) into the seam
> library. (The historical AngularJS `ng-prop-*`/`ng-on-*` note applies only to an AngularJS source
> adapter, not Angular 2+.)

## 3. Seam B — `route-shell` (whole routes) — DEFAULT for pages

Whole routes migrate through the **`route-shell`** seam (`Unit.seam` = `route-shell`): one
framework owns the page shell and mounts the other's routes as guests. Direction is set by
`RunRequest.strategy.shellDirection` (`legacy-hosts-target` or `target-hosts-legacy`) and recorded
per unit in `MigrationPlan.bridgePlan[].shellDirection`.

**Shell direction over time.** Start `legacy-hosts-target` (the source app owns the outer page;
embedded units and flagged route replacements live inside it). At the **flip point** (default: >50%
of routes migrated) invert to `target-hosts-legacy`: the target router owns the URL and the
still-source routes are mounted as guests inside a single guest-route component. The flip is its own
`infra` unit (`unit:infra:route-shell-flip`) with its own scenarios: every route reachable,
back/forward history, deep links, and 404s.

**Routing coexistence rule (framework-independent):** exactly ONE router owns `history` at any
time. The non-owning side navigates by delegation (the seam library exposes an `mxNavigate(url)`
entry point), never through its own router. URL-scheme differences between frameworks are
normalized at the flip, with redirects preserving the source app's deep links permanently.

> **Adapter notes (Angular 2+ → React).** Guest-mounting the source app inside the target shell and
> vice versa is done with an Angular bootstrap/`ApplicationRef` mount adapter in the seam library;
> pick the mechanism per target router. Preserve any global-state flag the source runtime needs
> while source code remains on-page, and never nest two source-app bootstraps on one page. URL
> scheme normalization (e.g. hash vs pathname) happens at the flip. (The AngularJS-era
> `single-spa-angularjs` / `@uirouter/react-hybrid` options apply to an AngularJS source, not
> Angular 2+.)

## 4. Feature flags

`window.mxFlags`: a plain boolean map, set from localStorage/query-param, readable synchronously
before either framework boots, and mirrored into the source runtime by a tiny source-side run
block **loaded via the shim loader — never committed into the source checkout** (U1,
`ORCHESTRATOR.md §9`). Every `WIRED` unit gets exactly one flag (`Unit.seam.flag`); flags are
deleted at unit tombstone, and the `bridgeCount` ratchet counts live seams (`ORCHESTRATOR.md §11`).

## 5. Hello-world seam proof (exit gate for this phase)

Create the trivial unit `unit:infra:seam-proof`: one target hello-world component embedded via
`element-bridge` on the least-risky source page, plus one trivial `route-shell` replacement. The
G3 script (T5, `ORCHESTRATOR.md §3.2`) checks: source app boots flag-off (zero diff vs baseline —
`seam-off-unchanged`), flag-on shows target content and mounts cleanly (`seam-on-mounts`), zero new
console errors (`console-errors-zero`), and mount/unmount on route change leaks no listeners
(heap/listener probe). One `BehaviorScenario` passes against the `hybrid` app. This exercises the
ENTIRE machinery (flags, both seams, verifier) before any real unit depends on it.

## 6. API layer

From the P3 endpoint inventory (§3 of P3): generate `target/`'s API layer — a typed client (one
module per API area) + server-state query hooks + response schemas. The network-fixture handlers
derive from the **same** endpoint inventory, so client and mocks cannot drift. Source HTTP
semantics that must be preserved are recipe-encoded (P5): request/response interceptor equivalents
(auth header, error toasts) become client middleware; resource/class abstractions map to hook
families, not class emulation.

> **Adapter notes (Angular 2+ → React).** `target/src/api/` = typed fetch client + TanStack Query
> hooks (`useInvoices(params)`) + Zod response schemas; MSW handlers derive from the same endpoint
> inventory. Angular `HttpClient` interceptors → fetch-client middleware; `HttpResource`/service
> classes → hook families.

## 7. Event façade (`unit:infra:event-facade`) — build early if `RunRequest` flags a bus

If the source app uses an event bus, generate a typed event contract from the inventory's event
census (P2 runtime-confirmed publishers/listeners). The seam library bridges both directions during
coexistence (source bus ↔ a namespaced `mx:` `window` `CustomEvent` layer), with per-event
publish/subscribe counters feeding the decommission evidence (event tombstoning, G8). Target
consumers use a typed subscription helper. New target↔target communication MUST NOT use the bus (a
conventions rule) — it exists only to talk to the source app during coexistence.

> **Adapter notes (Angular 2+ → React).** A generated `target/src/seam/events.ts` `MxEvents`
> interface (one entry per live source bus event); the source side is a shared RxJS
> `Subject`/service rather than AngularJS `$rootScope.$emit/$broadcast`; target consumers use
> `useMxEvent('invoice:filterChanged', handler)`.

## 8. CSS strategy

Preserve the source app's stylesheets globally during coexistence — this is why embedded units
render into light DOM (a shadow root would break global CSS). New target components use co-located
scoped styles; design tokens are extracted from repeated source-CSS literals as CSS variables (a
recipe-level task, not a program). Screenshot-based visual parity checks run at the `standard` diff
policy only on units whose motif implies layout risk (tables, modals, drag-drop) — matching the
`visual` divergence kind in `counterexample.schema.json`.

## 9. `target/CONVENTIONS.md` (the target conventions doc — contract for converters, keep ≤300 lines)

Must contain, each with ONE canonical example: file/folder layout per feature; component naming;
props typing style; server state = the query library only (no ad-hoc fetching in components);
forms = the form-library + schema pattern; error/loading/empty-state pattern; event-façade usage;
seam registration (embedded-unit definition + manifest); flag reading; unit test file pattern;
component-story file pattern (+ network-fixture usage); accessibility floor (roles/names/labels
required — assertions will check these, matching the P3 ARIA floor); and a forbidden list (no
source-framework reactive-mechanic emulation, no mutable service-bag state, no direct DOM mutation
outside refs, no new bus events, no untyped escapes). This is the `conventions` item every
converter receives in its `RunManifest` (`ORCHESTRATOR.md §8`).

## 10. CI (ratchet home)

Pipeline over `target/` + `migration/`: typecheck, lint, unit tests, story/render smoke, the
`seam-proof` G3 scenario, the changed-unit parity subset, ratchet checks (`ORCHESTRATOR.md §11`),
and schema validation of every `migration/**` artifact against `schemas-v2/`. The full parity suite
(all scenarios, both twins) runs nightly and publishes the `RunResult` rollup
(`migration/reports/run-result.json`).

---

### Provenance

Ports `plans/phases/P4-target-scaffold-and-seams.md`. Cross-references: `ARCHITECTURE.md §2`
(P6/P7 coexistence), `ORCHESTRATOR.md §3.2`/`§8`/`§11` (G3/T5, context packs, ratchets),
`TOOL-CONTRACTS.md §1`/`§2`/`§6` (`shell.run` allowlist, `app.start` `hybrid`, `fixtures.*`), and
schemas `run-request.schema.json`, `migration-plan.schema.json`, `unit.schema.json`,
`counterexample.schema.json`.
