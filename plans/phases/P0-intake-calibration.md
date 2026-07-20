# Phase 0 — Intake & Calibration

> **Role:** intake-analyst. **Input:** `legacy/` checkout + whatever serving knowledge exists.
> **Output:** `migration/charter.json` (schema: `charter.schema.json`) + `charter-summary.md`,
> human-approved. **Exit gate:** charter schema-valid, every field evidence-backed, approval recorded.

The charter is the calibration layer that makes this harness generic: every later phase reads
its decisions instead of hardcoding them. Do not skip probes because the answer "seems obvious."

## 1. Version & runtime fingerprinting

Run these probes and record command + output path in `charter.evidence[]`:

| Probe | How | Charter field |
|---|---|---|
| AngularJS version | `grep -rE "(full|code\.angularjs).*angular(\.min)?\.js" legacy/ --include=*.html`; check `package.json`/`bower.json` for `"angular"`; definitive: serve app, evaluate `angular.version.full` in the browser | `app.angularjsVersion` |
| Angular 2+ false positive check | Look for `@angular/core`, `ng-version` attribute, decorators. If found → **STOP, escalate**: wrong harness | `app.showstoppers` |
| jQuery real vs jqLite | Serve app, evaluate `!!window.jQuery && angular.element === jQuery` ; also check script order (jQuery must load before angular.js to be adopted) | `app.jqueryPresent` |
| strict DI | `grep -r "ng-strict-di" legacy/`; check manual `angular.bootstrap(..., {strictDi:` | `app.strictDi` |
| Router | `grep -rl "ui.router\|\$stateProvider" legacy/` vs `ngRoute\|\$routeProvider`; record ui-router version (0.x vs 1.x — matters for seam teardown: only 1.x has `$uiRouter.dispose()`) | `app.router` |
| Bootstrap style | `ng-app` attribute (where, how many — **more than one root = showstopper flag**) vs manual `angular.bootstrap` | `app.showstoppers`, feeds P2 injection design |
| Module system / build era | Presence of `bower.json`, `Gruntfile`, `gulpfile`, `webpack.config`; are sources concatenated script tags or bundled? | `app.buildEra`, `app.moduleSystem` |
| Component-era usage | `grep -rc "\.component(" legacy/src` vs `\.directive(` vs `\.controller(` — a 1.5+ `.component()`-heavy app is much cheaper to migrate | `app.sizeMetrics` |

## 2. Serve probe (hard requirement)

Goal: a repeatable command that serves the app locally against deterministic data.

1. Try documented dev workflow (README, npm scripts, Grunt/gulp `serve` tasks).
2. If build tooling is bit-rotted (common: Node-version-locked gulp 3, dead bower registry):
   do NOT fix the legacy toolchain. Fallback ladder:
   a. Serve a previously built `dist/` with any static server;
   b. Static-serve the source tree if it's script-tag style;
   c. Ask the human for a staging URL (record `serving.baseUrl` as remote).
3. Backend: decide `record-replay-msW` (preferred: capture HAR against staging once, replay
   forever — deterministic) vs `live-staging` (only if the API is stable and side-effect-safe).
4. Record exact steps in `serving.howToServe` such that `app.start("legacy")` can be
   implemented from that field alone.

**Definition of done:** the app boots, a human-nameable core flow works, and the boot is
repeatable from a clean checkout by following only what the charter says.

## 3. Size & risk census

Count with the P1 scanner in "cheap mode" (regex-level is acceptable at this phase):
controllers, components, directives (split: template-only / link / compile / transclude),
services/factories, filters, routes, templates, `$watch*` call sites, `$emit/$broadcast/$on`
call sites, `$compile` call sites, jQuery plugin invocations (census by `$.fn.<name>` and
`.plugin(` grep against a known-plugin list + unknowns).

Produce the **risk histogram** (counts per factor) — this drives calibration:

| Factor observed | Calibration consequence |
|---|---|
| >30% of directives have `compile`/`link` | Raise oracle thresholds; plan wrapper-first recipes; budget more analyst time |
| Heavy `$rootScope` event use (>50 distinct event names) | Schedule the typed event façade (P4 §7) as an early `infra` unit |
| jQuery plugins > 5 distinct | Each becomes its own `infra`/wrapper unit; check for React-native replacements per plugin |
| `$compile` with dynamic HTML strings | Enable Template Shape Enumerator (P2 §6); mark owning units high-risk |
| No existing e2e tests | Increase `oracle.minScenariosPerUnit`; enable mutation calibration for `medium` tier too |
| `.component()`-dominant, 1.7/1.8, ui-router 1.x | Best case: consider more aggressive per-route ordering and cheaper model tiers |

## 4. Strategy decisions (write reasoning into charter-summary.md)

**Default seam** — decision rule:
- App has ≤ ~15 routes with low cross-route shared UI → `route-shell`.
- Rich shared chrome (nav, modals, notifications used everywhere) → `element-bridge` for
  primitives + `route-shell` for pages (both; `strategy.defaultSeam` = the majority choice).

**Shell direction** — start `legacy-hosts-react` (React islands inside the AngularJS page).
Plan the **flip point**: when >50% of routes are React, invert to `react-hosts-legacy`
(React Router owns the URL; remaining AngularJS routes mount inside a React wrapper via
single-spa-angularjs). Record the intended flip trigger in the charter.

**Unit ordering default:** leaf services → shared primitives/design-system → filters →
low-risk template-only components → routes by ascending risk × descending traffic → directive
islands (plugins) last unless they block routes.

**Normalization pre-pass** (EXTENSIONS-OOB §2): enable when `.controller()`+`$scope` style
dominates (>60% of controllers) AND the team accepts legacy-side commits gated by the same
oracle. Otherwise skip.

## 5. Budgets & model routing

Fill `budgets.modelRouting` (risk tier × role → model tier). Suggested defaults:

| | converter | repairer | scenario-author | analyst | critic |
|---|---|---|---|---|---|
| low | cheap | cheap | standard | standard | cheap |
| medium | standard | standard | standard | standard | standard |
| high | standard (+cross-check, OOB §7) | strong | strong | strong | standard |
| critical | strong | strong | strong | strong | strong + human |

Attempt caps (`low/med/high/critical`): convert 3/3/4/2, repair 5/6/8/4 (critical escalates
early by design). Context pack budget: 60k tokens standard tier.

## 6. Showstopper checklist (each found → charter + human decision before P1)

- Multiple `ng-app` roots or multiple bootstraps per page
- Server-rendered pages that inline AngularJS templates (template source not in repo)
- CSP or bundle checksums that block script injection (breaks P2 shim → need build-hook injection)
- AngularJS < 1.5 (no `.component()`, old directive semantics; harness works but recipes shift — flag)
- Frames/iframes hosting separate Angular apps
- Flash/applet/ActiveX islands (yes, still real in legacy fleets)
- Authentication that can't be fixtured (hardware tokens, SSO redirects that can't be stubbed)

## 7. Human approval

Present `charter-summary.md`: profile, risk histogram, chosen strategy + why, budgets, list of
showstoppers + proposed handling, and the first 10 units you'd migrate. Approval is recorded in
`charter.approval` and as a ledger `note` event. **No P1 work before approval.**
