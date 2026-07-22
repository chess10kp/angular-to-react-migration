# Campaign retrofit overlay

This directory is the **differentiator exerciser** — a hand-authored Angular module that
covers the surfaces the real target uses but stock JHipster lacks. It is applied on top of a
freshly-generated JHipster ng17 fixture (see the parent [`README.md`](../README.md)).

## What it exercises

| Differentiator | Real-target stack | Exerciser (in `campaign/`) |
|---|---|---|
| i18n | **Transloco** | `i18n/transloco-loader.ts` + `en.json`, consumed in list/edit templates |
| State | **NgRx** | full store: `store/{actions,reducer,effects,selectors}.ts`, driving list + edit |
| Auth | **Okta** | `auth/okta-auth.service.ts` + `okta.interceptor.ts` (token-attach interceptor) |
| Feature flags | **LaunchDarkly** | `feature-flags/launch-darkly.service.ts` + `feature-flag.directive.ts`, gated in `campaign.guard.ts` |
| Base-class inheritance | (discovery trap) | `shared/base.component.ts` (`extends`) |
| Permission API | (discovery ❓#6) | `shared/permission.service.ts` + `has-permission.{directive,pipe}.ts` |
| Guards / resolvers | (discovery ❓#1) | `campaign.guard.ts` + `campaign.resolver.ts` |
| Forms + validators | (discovery ❓#5) | `validators/slug.validator.ts` |

**Not yet covered (Phase 2):** `webcore` / Module-Federation host mounting, and custom webpack
plugins. Both are `❓ OPEN` in `migration/real-target-discovery.md` (webcore contract unknown) —
do not synthesize them blindly.

## Files

- `campaign/` — the Angular module source (readable; this is what the codemod reads).
- `apply-retrofit.mjs` — idempotent apply script.

## Integration points (what the apply script edits)

The script does **not** overwrite JHipster-generated files wholesale. It makes targeted,
idempotent insertions so generator output can evolve without dropping JHipster's own content:

1. `package.json` — adds the 5 retrofit deps (sorted) if missing.
2. `src/main/webapp/app/app.config.ts` — adds the `provideStore` / `provideEffects` /
   `provideTransloco` imports + the `OktaInterceptor` / `TranslocoHttpLoader` imports; inserts
   the 4 providers before the `jhipster-needle-angular-add-module` needle.
3. `src/main/webapp/app/app.routes.ts` — mounts `{ path: 'campaign', loadChildren: ... }`
   before the `login` route.
4. Copies `campaign/` into `src/main/webapp/app/campaign/`.

All four are guarded by presence markers (`provideTransloco`, `./campaign/campaign.routes`,
dep version) so the script is safe to re-run.

## Why an overlay, not a committed full app

The generated fixture is ~1.5 GB and deliberately gitignored (see root `.gitignore`). This
overlay keeps the exerciser reproducible from committed artifacts — `app.jdl` (generator
input) + this overlay — without committing generated bulk. Any agent can read `campaign/`
directly here without materializing the 1.5 GB tree.
