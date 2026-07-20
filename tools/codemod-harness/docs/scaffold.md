# Compilable scaffold (`--scaffold`)

**Status:** implemented (`jac/codemod.jac` `scaffold_files`/`write_scaffold`;
run `jac run jac/codemod.jac -- … --scaffold[=<dir>]`). This is item #3 of the
migration-system plan (see [`migration-system-rationale.md`](./migration-system-rationale.md)).

## The gap it closes

The codemod writes sibling `.tsx` / `.service.react.ts` files **into the Angular
tree**. There is no React project around them, so the operator agent's single
biggest advantage — running `tsc --noEmit` / tests itself — has no target. Until
now "verified" meant *residue-gone + reviewed-by-inspection*, never *compiled*.

`--scaffold` emits a minimal, self-contained **Vite + React + TypeScript** project
whose `tsconfig.json` `include`s the migrated output. Once you `npm install`, the
remaining residue surfaces as **real compiler errors** — an unresolved
`use<Service>()` provider hook, an unwrapped `user$` Observable, a leftover
`@angular/common/http` import — and burning residue down *is* turning the build
green.

## What it writes

Into `<dir>` (default `./react-app`; existing files are never clobbered):

| File | Purpose |
|---|---|
| `package.json` | React-side deps matching the target: `react`, `react-dom`, `react-router-dom`, `react-i18next` + `i18next`, `react-bootstrap` + `bootstrap`, `axios`; `vite` toolchain. Scripts: `dev`, `build`, **`typecheck` (`tsc --noEmit`)**, `preview`. |
| `tsconfig.json` | `jsx: react-jsx`, `strict`, `noEmit`. `include` = the scaffold's `src` **plus a relative glob to each migrated path** (`<rel>/**/*.tsx`, `<rel>/**/*.service.react.ts`). See the `paths` note below. |
| `tsconfig.node.json` | Vite config typecheck project. |
| `vite.config.ts` | `@vitejs/plugin-react`. |
| `index.html`, `src/main.tsx` | Entry: `BrowserRouter`, bootstrap CSS, `./i18n`, `<App/>`. |
| `src/App.tsx` | Empty shell with a `MIGRATION_TODO` — wire migrated routes/components in. |
| `src/i18n.ts` | Minimal `react-i18next` init so `useTranslation()` resolves; point it at the real translation bundles. |
| `src/vite-env.d.ts`, `.gitignore`, `README.md` | Boilerplate + how-to. |

## The one non-obvious decision: `paths`

The migrated files live **outside** `<dir>`, so Node/TS module resolution can't
walk up to the scaffold's `node_modules`. The scaffold's tsconfig routes every
bare import back with:

```jsonc
"baseUrl": ".",
"paths": { "*": ["./node_modules/@types/*", "./node_modules/*"] }
```

`@types` is tried first so `react` resolves to its **declaration** package (else
TS finds `react/index.js` and reports an implicit-`any` module). Relative imports
between sibling migrated files are untouched, and genuinely-missing app deps
(`@angular/*`) still fail — which is correct, that failure *is* residue.

Proven end-to-end: after `npm install`, `tsc --noEmit` on migrated output emits
**only** residue errors (`useAccountService`, `ElementRef`, `user$`,
`@angular/common/http`) — no framework noise.

## Honest limits

- **Template-mode `.jsx` is not included.** Those are partial JSX expressions
  (`const __template = …`), not modules; a component `.tsx` references its
  template inline. Component and service output *is* included.
- `src/i18n.ts` ships **empty resources** and `src/App.tsx` is an **empty shell** —
  both are starting points, not wired apps.
- The scaffold is generated once and then owned by the operator; re-running
  `--scaffold` **skips files that already exist** (never overwrites your edits).
