#!/usr/bin/env node
// apply-retrofit.mjs — idempotently apply the `campaign` retrofit overlay onto a
// freshly-generated JHipster ng17 fixture.
//
// Run AFTER:
//   npx generator-jhipster@8.5.0 jdl app.jdl   &&   npm install
//
// Safe to re-run: it detects already-applied markers and skips. Does NOT overwrite
// JHipster-generated content wholesale — it makes targeted, idempotent insertions, so
// generator output can evolve without silently dropping JHipster's own providers/routes.
//
// Usage:
//   node apply-retrofit.mjs [path-to-fixture-root]
//   (default target: <repo>/references/jhipster-ng17-fixture)
//
// What this overlay adds (the differentiator exerciser):
//   - Transloco (i18n), NgRx (state), Okta (auth + interceptor), LaunchDarkly (flags)
//   - base-class inheritance, permission API (directive+pipe+service), guard/resolver,
//     custom form validator — i.e. the surfaces the real target uses that stock JHipster lacks.

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const HERE = path.join(__dirname, 'campaign');
const DEFAULT_TARGET = path.resolve(__dirname, '..', '..', '..', 'references', 'jhipster-ng17-fixture');
const targetRoot = path.resolve(process.argv[2] || DEFAULT_TARGET);
const appDir = path.join(targetRoot, 'src', 'main', 'webapp', 'app');

const RETROFIT_DEPS = {
  '@jsverse/transloco': '7.5.0',
  '@ngrx/effects': '17.2.0',
  '@ngrx/store': '17.2.0',
  '@okta/okta-auth-js': '7.8.1',
  'launchdarkly-js-client-sdk': '3.5.0',
};

const log = (m) => console.log(`[apply-retrofit] ${m}`);

async function copyCampaign() {
  await fs.cp(HERE, path.join(appDir, 'campaign'), { recursive: true });
  log(`copied campaign/ -> src/main/webapp/app/campaign/`);
}

async function patchPackageJson() {
  const pkgPath = path.join(targetRoot, 'package.json');
  const pkg = JSON.parse(await fs.readFile(pkgPath, 'utf8'));
  pkg.dependencies = pkg.dependencies || {};
  let changed = 0;
  for (const [name, version] of Object.entries(RETROFIT_DEPS)) {
    if (pkg.dependencies[name] !== version) { pkg.dependencies[name] = version; changed++; }
  }
  if (!changed) { log('package.json: retrofit deps already present (skip)'); return; }
  pkg.dependencies = Object.fromEntries(
    Object.entries(pkg.dependencies).sort(([a], [b]) => a.localeCompare(b))
  );
  await fs.writeFile(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
  log(`package.json: ensured ${changed} retrofit dep(s)`);
}

async function patchAppConfig() {
  const p = path.join(appDir, 'app.config.ts');
  let s = await fs.readFile(p, 'utf8');
  if (s.includes('provideTransloco')) { log('app.config.ts: retrofit already present (skip)'); return; }

  const importBlock =
    `\nimport { provideStore } from '@ngrx/store';\n` +
    `import { provideEffects } from '@ngrx/effects';\n` +
    `import { provideTransloco } from '@jsverse/transloco';\n` +
    `\nimport { OktaInterceptor } from './campaign/auth/okta.interceptor';\n` +
    `import { TranslocoHttpLoader } from './campaign/i18n/transloco-loader';\n`;

  const httpImport = /import\s*\{\s*HTTP_INTERCEPTORS,\s*HttpClientModule\s*\}\s*from\s*'@angular\/common\/http';\n/;
  if (!httpImport.test(s)) throw new Error("can't find @angular/common/http import anchor in app.config.ts");
  s = s.replace(httpImport, `$&${importBlock}`);

  const providerBlock =
    `    { provide: HTTP_INTERCEPTORS, useClass: OktaInterceptor, multi: true },\n` +
    `    provideStore(),\n` +
    `    provideEffects(),\n` +
    `    provideTransloco({\n` +
    `      config: { availableLangs: ['en', 'fr'], defaultLang: 'en', reRenderOnLangChange: true, prodMode: false },\n` +
    `      loader: TranslocoHttpLoader,\n` +
    `    }),\n`;
  const needle = /(\s*\/\/ jhipster-needle-angular-add-module JHipster will add new module here\n)/;
  if (!needle.test(s)) throw new Error("can't find jhipster-needle-angular-add-module anchor in app.config.ts");
  s = s.replace(needle, `\n${providerBlock}$1`);

  await fs.writeFile(p, s);
  log('app.config.ts: applied retrofit imports + providers');
}

async function patchAppRoutes() {
  const p = path.join(appDir, 'app.routes.ts');
  let s = await fs.readFile(p, 'utf8');
  if (s.includes('./campaign/campaign.routes')) { log('app.routes.ts: campaign route already present (skip)'); return; }

  const routeBlock =
    `  {\n    path: 'campaign',\n    loadChildren: () => import('./campaign/campaign.routes'),\n  },\n`;
  const loginAnchor = /(\n  \{\n    path: 'login',)/;
  if (!loginAnchor.test(s)) throw new Error("can't find login route anchor in app.routes.ts");
  s = s.replace(loginAnchor, `\n${routeBlock}$1`);

  await fs.writeFile(p, s);
  log('app.routes.ts: mounted campaign lazy route');
}

async function main() {
  log(`target fixture: ${targetRoot}`);
  for (const rel of ['package.json', 'src/main/webapp/app/app.config.ts', 'src/main/webapp/app/app.routes.ts']) {
    await fs.access(path.join(targetRoot, rel)).catch(
      () => { throw new Error(`not a JHipster fixture root (missing ${rel}): ${targetRoot}`); }
    );
  }
  await copyCampaign();
  await patchPackageJson();
  await patchAppConfig();
  await patchAppRoutes();
  log('done. Next: npm install && npm run build && npm test');
}

main().catch((e) => { console.error(`[apply-retrofit] FAILED: ${e.message}`); process.exit(1); });
