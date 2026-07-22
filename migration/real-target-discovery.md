# Real Target — Discovery Answers

> Captured 2026-07-21 from the migration-team questionnaire. This documents the **actual
> private codebase** we are migrating. Where an answer conflicts with an assumption in
> `PLAN.md`/`REPORT.md`, it is flagged **⚠ CONFLICT** — those assumptions were written for an
> OneCX profile and do **not** hold for this target. Unanswered items are marked **❓ OPEN**.

## Headline: this target is a completely different app; OneCX was only a stand-in

The stack below is Okta + Transloco + NgRx + Angular-CLI/webpack + LaunchDarkly, hosted by an
in-house `webcore` auth layer. **OneCX was never the real target** — it was borrowed as a generic
Angular stand-in to build the framework-general compiler *before* we had access to the real
codebase (still no access as of 2026-07-21; access is expected later). None of the OneCX
*specifics* (topics, slots, preloaders, scope-polyfill, Keycloak, ngx-translate, react-* packages)
apply. Per the migration team, OneCX-specific content should be **deleted**, keeping only the
framework-general Angular→React machinery.

### Confirmed facts (2026-07-21 follow-up)

- **`webcore` = the org's authentication layer / gateway host.** This application is a
  **micro-frontend hosted under `webcore`**, so the team can migrate it **without touching the
  global auth gateway.** Okta lives at the webcore layer.
- **"ally" = a vendor.** **metronome UI = an internal design system.**
- **Only UI component library = a vendor package that already ships React versions** — so UI
  component migration is **low-risk / out of scope for codemods**; adopt the vendor's React
  components directly.
- Templates use **`@if`/`@for`** (as far as known).
- **No global route bypass** (`window.location`/`history` hacks).
- The sibling **`admin` MFE does NOT need to be ported** — leave it alone.
- Real codebase **not yet accessible** — everything below the "confirmed" line stays hypothesis
  until we can inventory it.

## Build & config

- **Build system:** Angular CLI + webpack. **⚠ CONFLICT** — PLAN.md ("Retain the current Nx
  control plane", stack table row "Nx 22.7.x") assumes Nx. There is no Nx. Drop Nx-affected
  wave sequencing; use `ng build`/CLI project boundaries instead.
- **Environment config:** injected through **`webcore`** (in-house host), not `environments/*`
  build-time replacement or a plain runtime fetch. `webcore` also owns the **app router** for
  the micro-frontend composition.
- **Custom webpack:** yes — custom webpack plugins exist (details ❓ OPEN — need the config).

## Micro-frontends

- App-router lives in **`webcore`**.
- A sibling app **`admin`** (separate repo) configures "ally" people; it is its own MFE.
- **LaunchDarkly** provides feature flags. **⚠ CONFLICT** — PLAN.md §39/§151/§270 model a
  bespoke 3-mechanism flag subsystem (plain/cohort/tenant-UUID). Re-model the flag census
  around the LaunchDarkly SDK + its evaluation sites instead.

## Routing

- Guards/resolvers: **some** present; ❓ OPEN — exact counts, and whether any nested
  router-outlets exist.
- Lazy loading: **some** (`loadChildren` boundaries), rest eager.
- Runtime route mutation: **none** (no `router.resetConfig`, no dynamically pushed routes).
  Simpler than the OneCX `routes.service.ts` runtime-reset case in PLAN.md §73.

## DI / services

- **10+** `@Injectable` services, all **root-level** (`providedIn: 'root'`). No scoped/
  hierarchical providers.
- Custom `InjectionToken`s: ❓ OPEN.
- `APP_INITIALIZER`s and what they block on: ❓ OPEN.

## State / reactivity

- Dominant idiom: **NgRx** + direct mutations. **⚠ CONFLICT** — PLAN.md §93/§293 explicitly
  state "the source has no NgRx" and plan React state/reducer + Zustand only. This target DOES
  use NgRx → the React stack should map the bounded NgRx stores to **Redux Toolkit**, exactly
  the escape hatch PLAN.md deferred. Signal-based slices in the codemod harness are lower
  priority for this target.
- No global singleton state shared across many components.

## Async / RxJS

- **Mostly `HttpClient`** calls, **no complex `.pipe()` chains** — low RxJS-operator risk.
- Long-lived side-effecting subscriptions with ordering dependencies: ❓ OPEN.
- HTTP interceptors (auth token / error / spinner) and order: ❓ OPEN (Okta token refresh is
  likely interceptor-based — confirm).

## Templates / directives

- Control flow (`@if`/`@for` vs `*ngIf`/`*ngFor`): ❓ OPEN.
- Custom directives (structural / permission-gating): ❓ OPEN — each needs a hand-written adapter.
- Custom pipes / heavy `ng-content` / dynamic component creation: ❓ OPEN.

## Forms

- Reactive vs template-driven, custom validators: ❓ OPEN.

## i18n

- **Transloco**, configured via `webcore`. **⚠ CONFLICT** — the codemod harness's translation
  slice targets `@ngx-translate`/`jhiTranslate` (`| translate`, `TranslateService`). Transloco
  has a **different** API (`transloco` pipe/directive, `TranslocoService.translate`,
  `*transloco` structural directive, scoped translations). Needs a **new Transloco→react-i18next
  adapter**; the existing ngx-translate path will not match.

## Auth / permissions

- IdP: **Okta**. **⚠ CONFLICT** — PLAN.md §96 plans `@onecx/react-auth` + Keycloak. Use an
  Okta React SDK (`@okta/okta-react` / `okta-auth-js`) instead. Token refresh mechanism: ❓ OPEN.
- Permission-check API (directive / pipe / service — show one usage): ❓ OPEN.

## Cross-cutting traps

- NgZone/zone flags, manual change detection, Router-bypass (`window.location`/direct DOM),
  base-component inheritance, global monkey-patching: ❓ OPEN (rapid-fire yes/no still needed —
  inheritance especially, since codemods struggle with `extends BaseComponent`).
- Registered locales / `LOCALE_ID` overrides: ❓ OPEN.

## UI component library

- The only UI component library is a **vendor package that already ships React versions** →
  **not a codemod concern**; adopt the vendor's React components directly.
- Vendor ("ally") ecosystem context:
  - **UUIP** (UI package)
  - an **api client** (generated?)
  - **metronome UI** — an **internal design system**
  Described as complex and actively being built; treat versions/contracts as a moving target, but
  UI-component parity itself is handled by the vendor's own React packages.

## Testing / oracle

- Framework: **Jasmine/Karma**. **⚠ CONFLICT** — the fixture baseline and PLAN.md §98/§183/§210
  assume **Jest**→Vitest/RTL. Real target is Jasmine → the test-scaffolding codemod must map
  Jasmine specs (not Jest) to Vitest/RTL, and the parity oracle should account for Jasmine/Karma.
- E2E acceptance oracle (Cypress/Playwright): ❓ OPEN — none mentioned.

## Migration-team's own warning

- Codebase is "fairly straightforward" overall.
- The **vendor ("ally") external packages are the complex part** (UUIP, api client, metronome
  UI) — and they are still being built, i.e. a moving target.

## API client clarification (2026-07-21)

The "api client" is **not** an OpenAPI-generated client — it is the app's **hand-written Angular
service layer** (many `@Injectable` services over `HttpClient`). Migration ports each service to a
plain TS class/hook over the shared Axios instance, preserving method signatures/URLs/payloads —
**not** a codegen regeneration.

## Demo-driven assumptions (2026-07-21)

Demo due **2026-07-23**; codebase not yet accessible. We proceed on documented assumptions (see
PLAN.md "Working assumptions" table A1–A14) rather than block: guards→loaders, resolvers→loaders,
APP_INITIALIZERs block on webcore auth+env, Okta interceptor attaches/refreshes token, reactive
forms→RHF+Zod, permission service→`usePermission()`, base-class inheritance flagged for manual
review, no E2E oracle (build Playwright fresh; Jasmine unit suite is baseline), webcore gives a
basename, vendor React UI assumed ready. Each is a localized correction if wrong.

## Still-open questions (now tracked as assumptions A1–A14 in PLAN.md)

1. Guard/resolver counts; nested outlets?
2. Custom `InjectionToken`s; `APP_INITIALIZER`s and what they block on.
3. Interceptor list + order; Okta token-refresh location.
4. Control-flow style; custom directives/pipes; dynamic component creation.
5. Forms style + custom validators.
6. Permission-check API + one usage example.
7. Rapid-fire traps: zone, manual CD, Router-bypass, base-class inheritance, global patches, locales.
8. UI component library in app code (outside vendor packages).
9. Which vendor package versions/contracts are stable enough to target.
