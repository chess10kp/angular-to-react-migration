# JHipster ng17 fixture (source JDL)

The codemod harness tests and reports against a generated Angular 17 app at
`references/jhipster-ng17-fixture/` (gitignored — too large to commit). This
directory holds the **JDL** used to produce that fixture so anyone can
regenerate it locally.

## Regenerate the fixture

From the repo root:

```bash
mkdir -p references/jhipster-ng17-fixture
cp fixtures/jhipster-ng17-fixture/app.jdl references/jhipster-ng17-fixture/
cd references/jhipster-ng17-fixture
npx generator-jhipster@8.5.0 jdl app.jdl
npm install
# Apply the differentiator retrofit (Transloco/NgRx/Okta/LaunchDarkly campaign module):
node ../fixtures/jhipster-ng17-fixture/retrofit/apply-retrofit.mjs
npm install            # picks up the 5 retrofit deps
npm run build
npm test
```

The retrofit is **idempotent** — safe to re-run. See
[`retrofit/README.md`](./retrofit/README.md) for exactly which real-target surfaces it
exercises and what it edits.

Expected outcome (as of the original generation):

- **JHipster** 8.5.0
- **Angular** 17.3.x (`@angular/core` in generated `package.json`)
- **54** components under `src/main/webapp/app/`
- **402** Jest tests / 80 suites passing on the generated app

## Run the codemod harness against it

```bash
cd tools/codemod-harness
npm install
npm run build
npm test
```

Tests read `references/jhipster-ng17-fixture/src/main/webapp/app/` directly, including the
retrofitted `campaign/` module (the differentiator exerciser — see `retrofit/`).
