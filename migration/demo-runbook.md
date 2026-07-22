# Demo Runbook — Angular→React harness on a real-target-shaped fixture

> Target date: **2026-07-23**. Goal: show the migration harness converting an Angular 17 app that
> contains **every construct we know the real (private) target uses**, converting the
> deterministic parts and emitting **typed `MIGRATION_TODO` residue** for the semantic parts
> (never guessing). See [`real-target-discovery.md`](./real-target-discovery.md) for the profile.

## The one-line story

We enriched the JHipster Angular-17 fixture (`references/jhipster-ng17-fixture/`) with a
self-contained **`campaign/`** feature that exercises the real target's differentiators —
**Transloco, NgRx, Okta interceptor, LaunchDarkly, base-class inheritance, guards/resolvers,
permission directive + pipe, reactive forms + custom validator, hand-written HTTP services** — then
ran the harness against it. The fixture still **builds green and its Jasmine/Jest baseline still
passes** (the parity oracle), and the harness output shows exactly what is deterministic vs. what
needs an adapter.

## What's in the `campaign/` module (real-target construct → file)

| Real-target construct | File(s) |
|---|---|
| Hand-written HTTP service ("api client") | `campaign.service.ts` |
| NgRx store (actions/reducer/selectors/effects, feature-scoped) | `store/*.ts` |
| Transloco i18n (pipe, `*transloco`, `TranslocoService`, scope + loader) | `list/*.html`, `edit/*.html`, `list/*.ts`, `i18n/*` |
| Okta auth + token-refresh HTTP interceptor | `auth/okta-auth.service.ts`, `auth/okta.interceptor.ts` |
| LaunchDarkly flags (service + `*appFeatureFlag` directive + guard) | `feature-flags/*`, `campaign.guard.ts` |
| Base-class inheritance (`extends DestroyableComponent`) | `shared/base.component.ts`, `list/campaign-list.component.ts` |
| Route guard + resolver, lazy routes | `campaign.guard.ts`, `campaign.resolver.ts`, `campaign.routes.ts` |
| Permission service + structural directive + pipe | `shared/permission.service.ts`, `shared/has-permission.{directive,pipe}.ts` |
| Reactive form + custom validator | `edit/campaign-edit.component.ts`, `validators/slug.validator.ts` |
| `@if`/`@for`/`@empty`/`track` control flow | `list/campaign-list.component.html` |

Wired in `app.config.ts` (root `provideStore`/`provideEffects`/`provideTransloco` + Okta
interceptor) and `app.routes.ts` (lazy `campaign` route). Lazy + no specs → **cannot destabilize
the existing green suite.**

## Pre-demo checks (all verified green 2026-07-21)

```bash
cd references/jhipster-ng17-fixture
npx ng build --configuration development   # exit 0
npm run lint                               # exit 0
npm test                                   # 80 suites / 402 tests pass
```

> **Lint note:** `.eslintrc.json` has a scoped `overrides` block for `app/campaign/**/*.ts` that
> turns off five *stylistic/house* rules (component/directive-selector prefix, member-ordering,
> no-unsafe-return, no-unnecessary-condition). The campaign module intentionally follows the
> **real target's** conventions (NgRx effects/`inject()` pattern, non-`jhi` selectors, NgRx
> `store.select` generics), which fight JHipster house style. All *correctness* rules stay on.

## Demo commands (run from `tools/codemod-harness/`)

```bash
npm run build   # build the harness once
CAMP=../../references/jhipster-ng17-fixture/src/main/webapp/app/campaign

# A. Templates: @if/@for/@empty/track  ->  JSX
npm run cli -- --report $CAMP

# B. Components: .component.ts + template  ->  .tsx  (write siblings, then show, then clean up)
npm run cli -- --components $CAMP/list/campaign-list.component.ts
cat $CAMP/list/campaign-list.tsx
#   ...show it, then: find $CAMP -name '*.tsx' -delete

# C. Services: @Injectable .service.ts  ->  plain class
npm run cli -- --services $CAMP/campaign.service.ts
cat $CAMP/campaign.service.react.ts
#   ...show it, then: find $CAMP -name '*.react.ts' -delete

# D. Coverage report over the whole module (dry-run)
npm run cli -- --components --report $CAMP
npm run cli -- --services   --report $CAMP
```

## What the harness produces (talking points)

**Deterministic (converts cleanly):**
- Template `@if`/`@for`/`@empty`/`track` → JSX conditionals/`.map()`.
- `@Injectable` service → plain class; `inject()` → constructor params.
- `ngOnInit` → mount `useEffect`; component skeleton → function component.

**Typed residue (`MIGRATION_TODO` — never guessed), each mapping to a plan adapter:**
- `*transloco` structural directive → *"not deterministically supported"* → **Transloco→react-i18next adapter** (plan A-row / stack table).
- `inject(Store)` → `useStore()` hook TODO → **NgRx→Redux Toolkit** slice + hook.
- `inject(TranslocoService)` → `useTranslocoService()` TODO.
- `FormBuilder`/validators → *"useForm(); validators need a resolver"* → **React Hook Form + Zod**.
- `.subscribe()` in a lifecycle hook → *"call .unsubscribe() in the effect teardown"*.
- `extends DestroyableComponent` → base component has *no `@Component`* + `this.destroy$` flagged
  *"rewire by hand"* → **the inheritance case the plan calls out as non-automatable (A8).**

The headline: **the harness knows what it doesn't know.** Every semantic gap becomes a typed,
reviewable ticket that lines up 1:1 with the adapters in `PLAN.md`, not a silent wrong guess.

## Sample generated output (component)

`campaign-list.component.ts` → `campaign-list.tsx` (abridged):

```tsx
export function CampaignListComponent() {
  const store = useStore();            // MIGRATION_TODO(di): was inject(Store)
  const transloco = useTranslocoService(); // MIGRATION_TODO(di): was inject(TranslocoService)
  // MIGRATION_TODO(effect): ngOnInit -> mount effect; unresolved `this.destroy$` — rewire by hand
  // MIGRATION_TODO(rxjs): 1 .subscribe() — call .unsubscribe() in the returned cleanup
  useEffect(() => {
    store.dispatch(CampaignActions.load());
    transloco.selectTranslate('campaign.title').pipe(takeUntil(this.destroy$)).subscribe(...);
  }, []);
  return <>{/* MIGRATION_TODO: *transloco not deterministically supported */}</>;
}
```

## Cleanup

`.tsx`/`.react.ts` are demo outputs, not committed source — delete before re-running the Angular
build: `find $CAMP \( -name '*.tsx' -o -name '*.react.ts' \) -delete`.
