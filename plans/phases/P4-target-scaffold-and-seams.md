# Phase 4 — Target Scaffold & Coexistence Seams

> **Role:** scaffolder. **Input:** charter. **Output:** bootable `target/` app; seam library
> proven end-to-end with a hello-world unit (gate G3 passes on it); `target/CONVENTIONS.md`;
> fixture pipeline; CI. Runs in parallel with P2/P3.

## 1. Target stack (versions verified July 2026 — re-verify at implementation time)

| Layer | Choice | Notes |
|---|---|---|
| Runtime | **React 19.2.x** | Custom-element support is the load-bearing feature for seams (100% on custom-elements-everywhere) |
| Language | TypeScript (current stable), `strict: true` | |
| Build | **Vite** (current major) | |
| Routing | **React Router v7 or v8** — decision rule: v8 requires React ≥19.2.7 AND Node ≥22.22 and is ESM-only; if the org's CI can't guarantee that, take v7 (still maintained) | Data mode; framework mode unnecessary for a brownfield SPA |
| Server state | **TanStack Query v5** | The `$http`/`$resource` replacement |
| Forms | **React Hook Form + Zod** | |
| Unit/component tests | **Vitest + React Testing Library** | |
| Browser tests | **Playwright 1.61+** (`toMatchAriaSnapshot`, trace, HAR) | Optionally `@playwright/mcp` for exploratory agents and `@playwright/cli` for token-cheap agent runs |
| Workbench | **Storybook 10.5+** + `msw-storybook-addon` + `@storybook/addon-vitest`; optionally `@storybook/addon-mcp` (official, pre-1.0, React-only) so agents can discover/run stories via MCP | |
| Mocking | **MSW 2.x** everywhere (browser + node) | Single fixture pipeline across e2e/stories/unit |
| Compiler | React Compiler v1 — optional; enable once app builds cleanly | Do not fight it during migration |

Deliberately excluded: SSR frameworks (architectural blast radius), state-management megastores
(introduce Zustand/context per-need, recipe-driven), CSS system rewrite (preserve legacy CSS
behind component boundaries; see §8).

## 2. Seam A — element bridge (React inside AngularJS) — DEFAULT for shared widgets

**Verified 2026 recommendation:** `@r2wc/react-to-web-component` v2 (the only actively
maintained bridge; React 19 `createRoot`-based). Each migrated leaf/widget ships as a custom
element the AngularJS templates can host:

```tsx
// target/src/seam/defineIsland.ts
import r2wc from '@r2wc/react-to-web-component';
export function defineIsland(tag: string, Component: React.FC<any>,
                             props: Record<string, 'string'|'number'|'boolean'|'json'|'function'>) {
  if (!customElements.get(tag)) customElements.define(tag, r2wc(Component, { props, shadow: undefined }));
}
// Every island tag is prefixed mx- and registered from one manifest file (islands.manifest.ts).
```

AngularJS side binds **properties and events, not string attributes** — AngularJS 1.7.3+ has
`ng-prop-*` / `ng-on-*` (underscores become camelCase: `ng-prop-row_data` → `rowData` property):

```html
<!-- inside a legacy template; flag-guarded by ng-if -->
<div ng-if="$root.mxFlags.invoiceTable">
  <mx-invoice-table ng-prop-rows="$ctrl.rows"
                    ng-on-rowselected="$ctrl.onSelect($event.detail)"></mx-invoice-table>
</div>
<div ng-if="!$root.mxFlags.invoiceTable"> <!-- legacy implementation … --> </div>
```

Rules: events dispatched by islands are `CustomEvent`s with all data in `detail`;
callback-props (`&`-style) become events, not function props, at seam boundaries; `json`-typed
attributes only for small config, real data flows via `ng-prop`. **Do not** use the dead
`react2angular`/`angular2react` packages; if a directive-style wrapper is unavoidable, vendor
a `createRoot`-based fork (~150 LOC) into the seam library.

## 3. Seam B — route shell (whole routes) — DEFAULT for pages

Two verified options; pick per charter:
- **`single-spa-angularjs` 4.3.1** (frozen but sound; uses only stable public API — works with
  1.8.3). Gotchas the seam library must handle: set `preserveGlobal: true` while any legacy
  code remains on-page; requires ui-router ≥1.x for clean `$uiRouter.dispose()` on unmount;
  never nest an AngularJS app inside a still-running AngularJS page (`ng:btstrpd`).
- **`@uirouter/react-hybrid` 2.0.0** — only if the app is ui-router-based and you accept
  landing temporarily on ui-router-for-React; a bridge, not a destination (final router is
  React Router).

Shell direction over time (from charter): start **legacy-hosts-react** (islands + flagged
route replacement inside the AngularJS shell). At the **flip point** (>50% routes migrated),
invert: a React Router app owns the URL; the still-legacy routes are mounted via
single-spa-angularjs inside a `<LegacyRoute/>` React component. The flip is its own `infra`
unit with its own scenarios (every route reachable, back/forward history, deep links, 404s).

**Routing coexistence rule:** exactly ONE router owns `history` at any time. The non-owning
side navigates by delegation (seam library exposes `mxNavigate(url)`), never by its own
router. URL scheme differences (hashbang `#!/` vs pathname) are normalized at the flip, with
redirects preserving legacy deep links permanently.

## 4. Feature flags

`window.mxFlags` (mirrored to `$rootScope.mxFlags` in a tiny legacy-side run block loaded via
the shim loader — not committed into legacy source): plain boolean map, set from
localStorage/query param, readable synchronously before either framework boots. Every WIRED
unit gets exactly one flag; flags are deleted at unit tombstone (ratchet counts them).

## 5. Hello-world seam proof (exit gate for this phase)

Create trivial unit `unit:infra:seam-proof`: a React `<MxHello who>` island placed on the
least-risky legacy page + one trivial route replacement. Gate G3 script: legacy boots flag-off
(zero diff vs baseline), flag-on shows React content, no console errors, unmount/remount on
route change leaks no listeners (heap/listener count probe), and a Behavior IR scenario passes
against the hybrid. This exercises the ENTIRE machinery (flags, bridge, shell, verifier)
before any real unit depends on it.

## 6. API layer

From the P3 endpoint inventory: generate `target/src/api/` — typed fetch client (one module
per API area) + TanStack Query hooks (`useInvoices(params)`) + Zod schemas for responses.
MSW handlers derive from the same endpoint inventory, so client and mocks cannot drift.
Legacy `$http` semantics to preserve deliberately (recipe-encoded): interceptor equivalents
(auth header, error toasts) become fetch-client middleware; `$resource` classes map to hook
families, not class emulation.

## 7. Event façade (`unit:infra:event-facade`) — build early if charter flags a bus

TypeScript event contract generated from the inventory's event census:

```ts
// target/src/seam/events.ts — generated, then curated
export interface MxEvents {
  'invoice:filterChanged': { status: string };
  // … one entry per live $rootScope event (P2 runtime-confirmed publishers/listeners)
}
```

Seam library bridges both directions during coexistence (legacy `$rootScope` ↔ `window`
CustomEvents, namespaced `mx:`), with per-event publish/subscribe counters feeding the
decommission evidence (RootScope Event Tombstoning). React consumers use a typed
`useMxEvent('invoice:filterChanged', handler)`; new React↔React communication must NOT use
the bus (conventions rule) — it exists only to talk to legacy.

## 8. CSS strategy

Preserve legacy stylesheets globally during coexistence (islands render into light DOM — that
is why `shadow: undefined` above; shadow roots would break legacy global CSS). New components
use CSS Modules co-located per component; design tokens extracted from legacy CSS as CSS
variables when repeated literals are detected (recipe-level task, not a program). Visual
parity checks (screenshot-based) run at `standard` policy only on units whose motif implies
layout risk (tables, modals, drag-drop).

## 9. `target/CONVENTIONS.md` (contract for converters — keep ≤300 lines)

Must contain, each with ONE canonical example: file/folder layout per feature; component
naming; props typing style; server state = TanStack Query only (no fetch in components);
forms = RHF+Zod pattern; error/loading/empty state pattern; event façade usage; island
definition + manifest registration; flag reading; test file pattern (RTL); story file pattern
(+ msw-storybook-addon usage); accessibility floor (roles/names/labels required — assertions
will check); forbidden list (no watcher emulation, no `$scope`-style mutable service bags, no
direct DOM mutation outside refs, no new bus events, no `any`).

## 10. CI (ratchet home)

Pipeline on `target/` + `migration/`: typecheck, lint, unit, stories smoke, seam-proof G3
scenario, changed-unit parity subset, ratchet checks (`01 §7`), schema validation of all
`migration/**` artifacts. Full parity suite runs nightly (all scenarios, both twins) —
publishes `reports/dashboard.json`.
