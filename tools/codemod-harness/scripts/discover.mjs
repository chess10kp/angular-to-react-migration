#!/usr/bin/env node
/**
 * discover.mjs — Angular codebase layer inventory.
 *
 * Walks a target Angular project and emits a per-layer "dependency manifest":
 * for each of the 29 migration layers, what the app actually plugs into the
 * socket, with counts and concrete hits. The point is to collapse
 * "every app is different" into a fixed manifest for ONE codebase, so the
 * harness can be made deterministic instead of guessing.
 *
 * Zero dependencies — pure fs + regex. Run against any Angular repo:
 *
 *   node scripts/discover.mjs <project-root> [--json] [--out manifest.json]
 *
 * --json   print the machine-readable manifest to stdout (default: human report)
 * --out    also write the JSON manifest to a file
 *
 * Exit code is 0 always; this is a read-only survey.
 */

import { readFileSync, readdirSync, statSync, writeFileSync, existsSync } from 'node:fs';
import { join, extname, relative, basename } from 'node:path';

const args = process.argv.slice(2);
const root = args.find((a) => !a.startsWith('--')) ?? '.';
const asJson = args.includes('--json');
const outIdx = args.indexOf('--out');
const outFile = outIdx >= 0 ? args[outIdx + 1] : null;

const IGNORE = new Set(['node_modules', 'dist', '.git', '.angular', 'coverage', 'out-tsc']);

/** Recursively collect files, skipping build/vendor dirs. */
function walk(dir, acc = []) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return acc;
  }
  for (const e of entries) {
    if (e.name.startsWith('.') && e.name !== '.') continue;
    const full = join(dir, e.name);
    if (e.isDirectory()) {
      if (IGNORE.has(e.name)) continue;
      walk(full, acc);
    } else if (e.isFile()) {
      acc.push(full);
    }
  }
  return acc;
}

if (!existsSync(root)) {
  console.error(`path not found: ${root}`);
  process.exit(0);
}

const files = walk(root);
const rel = (f) => relative(root, f);

// Bucket files by kind and cache contents.
const bucket = { ts: [], html: [], scss: [], json: [] };
const content = new Map();
for (const f of files) {
  const ext = extname(f).toLowerCase();
  const kind =
    ext === '.ts' ? 'ts' : ext === '.html' ? 'html' : ext === '.scss' || ext === '.css' ? 'scss' : ext === '.json' ? 'json' : null;
  if (!kind) continue;
  if (f.endsWith('.d.ts')) continue;
  try {
    content.set(f, readFileSync(f, 'utf8'));
    bucket[kind].push(f);
  } catch {
    /* unreadable — skip */
  }
}

/** Count regex hits across a file bucket; return {count, files:[{file,n}], samples:[]}. */
function scan(kind, re, { sampleCap = 8 } = {}) {
  let count = 0;
  const perFile = [];
  const samples = [];
  for (const f of bucket[kind]) {
    const src = content.get(f);
    const m = src.match(new RegExp(re, re.flags.includes('g') ? re.flags : re.flags + 'g'));
    if (m && m.length) {
      count += m.length;
      perFile.push({ file: rel(f), n: m.length });
      if (samples.length < sampleCap) {
        for (const s of m.slice(0, 2)) {
          if (samples.length < sampleCap) samples.push(s.trim().slice(0, 80));
        }
      }
    }
  }
  perFile.sort((a, b) => b.n - a.n);
  return { count, files: perFile.length, topFiles: perFile.slice(0, 10), samples: [...new Set(samples)] };
}

/** Extract the "name" that follows a decorator/keyword, e.g. class X, @Pipe name. */
function names(kind, re, group = 1) {
  const found = new Set();
  const r = new RegExp(re, 'g');
  for (const f of bucket[kind]) {
    let m;
    const src = content.get(f);
    while ((m = r.exec(src))) if (m[group]) found.add(m[group]);
  }
  return [...found].sort();
}

// ---- package.json dependency read ----
let pkgDeps = {};
for (const f of bucket.json) {
  if (basename(f) === 'package.json') {
    try {
      const p = JSON.parse(content.get(f));
      pkgDeps = { ...pkgDeps, ...(p.dependencies || {}), ...(p.devDependencies || {}) };
    } catch {}
  }
}
const hasDep = (name) => Object.keys(pkgDeps).some((d) => d === name || d.startsWith(name));
const depsMatching = (re) => Object.keys(pkgDeps).filter((d) => re.test(d)).sort();

// ============================================================
// LAYERS
// ============================================================
const L = [];
const layer = (id, name, data) => L.push({ id, name, ...data });

// 1. App shell / bootstrap
layer(1, 'App shell / bootstrap', {
  bootstrapModule: scan('ts', /bootstrapModule\s*\(/),
  bootstrapApplication: scan('ts', /bootstrapApplication\s*\(/),
  appInitializer: scan('ts', /APP_INITIALIZER/),
  ngModules: names('ts', /@NgModule[\s\S]{0,40}?class\s+(\w+)/),
});

// 2. Module system / build
layer(2, 'Build / module federation', {
  angularJson: bucket.json.some((f) => basename(f) === 'angular.json'),
  moduleFederation: scan('ts', /ModuleFederation|@angular-architects\/module-federation|loadRemoteModule/),
  federationConfig: files.filter((f) => /webpack.*federation|module-federation.*config/i.test(rel(f))).map(rel),
  environments: files.filter((f) => /environments?\/environment/i.test(rel(f))).map(rel),
  nx: hasDep('@nx') || hasDep('nx'),
});

// 3. Routing
layer(3, 'Routing', {
  routerModule: scan('ts', /RouterModule\.for(Root|Child)/),
  routerOutlet: scan('html', /<router-outlet/),
  guards: scan('ts', /(CanActivate|CanDeactivate|CanActivateChild|CanLoad|CanMatch)\b/),
  resolvers: scan('ts', /\bResolve<|implements\s+Resolve/),
  lazyLoad: scan('ts', /loadChildren|loadComponent/),
  routerLink: scan('html', /routerLink/),
});

// 4. Dependency injection — the service catalog (BIGGEST surface)
layer(4, 'DI / service catalog', {
  services: names('ts', /@Injectable[\s\S]{0,60}?class\s+(\w+)/),
  injectionTokens: names('ts', /(?:const|let)\s+(\w+)\s*=\s*new\s+InjectionToken/),
  injectFn: scan('ts', /\binject\s*\(/),
  providedIn: scan('ts', /providedIn\s*:/),
});

// 5. State / reactivity
layer(5, 'State / reactivity', {
  signals: scan('ts', /\b(signal|computed|effect)\s*\(/),
  behaviorSubjects: scan('ts', /new\s+(BehaviorSubject|ReplaySubject|Subject)\b/),
  ngrx: hasDep('@ngrx'),
  ngrxStore: scan('ts', /createReducer|createAction|createSelector|Store\b/),
  ngxsAkita: hasDep('@ngxs') || hasDep('@datorama/akita'),
});

// 6. Async / RxJS
layer(6, 'Async / RxJS', {
  httpClient: scan('ts', /HttpClient\b/),
  subscribe: scan('ts', /\.subscribe\s*\(/),
  pipe: scan('ts', /\.pipe\s*\(/),
  asyncPipe: scan('html', /\|\s*async/),
  operators: names('ts', /['"]rxjs\/operators['"]|rxjs['"];?\s*$/) , // fallback
  rxjsImports: (() => {
    const ops = new Set();
    for (const f of bucket.ts) {
      const m = content.get(f).match(/import\s*\{([^}]+)\}\s*from\s*['"]rxjs(?:\/operators)?['"]/g);
      if (m) for (const line of m) line.replace(/[{}]/g, '').split('from')[0].split(',').forEach((o) => {
        const n = o.replace(/import\s*/, '').trim();
        if (n) ops.add(n);
      });
    }
    return [...ops].sort();
  })(),
});

// 7. HTTP interceptors / cross-cutting
layer(7, 'HTTP interceptors', {
  interceptors: names('ts', /class\s+(\w+)\s+implements\s+HttpInterceptor/),
  interceptorToken: scan('ts', /HTTP_INTERCEPTORS|withInterceptors/),
  errorHandler: scan('ts', /class\s+\w+\s+implements\s+ErrorHandler|ErrorHandler\b/),
});

// 8. Template layer (harness already covers — report volume)
layer(8, 'Template control-flow', {
  structuralNew: scan('html', /@(if|for|switch|defer)\b/),
  structuralClassic: scan('html', /\*ng(If|For|Switch)/),
  ngContainer: scan('html', /<ng-container/),
  ngTemplate: scan('html', /<ng-template/),
  ngContent: scan('html', /<ng-content/),
});

// 9. Custom directives (needs hand-written adapter each)
layer(9, 'Custom directives', {
  directives: names('ts', /@Directive[\s\S]{0,120}?class\s+(\w+)/),
  selectors: names('ts', /@Directive\s*\(\s*\{[\s\S]{0,80}?selector:\s*['"]([^'"]+)['"]/),
});

// 10. UI component library
layer(10, 'UI component library', {
  ngBootstrap: hasDep('@ng-bootstrap'),
  primeng: hasDep('primeng'),
  material: hasDep('@angular/material'),
  cdk: hasDep('@angular/cdk'),
  uiDeps: depsMatching(/bootstrap|primeng|material|cdk|clarity|nebular|taiga|zorro|ng-zorro/),
  ngbModal: scan('ts', /NgbModal|NgbActiveModal/),
  customElements: scan('html', /<(app|jhi|ngb|p|mat|clr)-[a-z]/),
});

// 11. Forms
layer(11, 'Forms', {
  reactive: scan('ts', /new\s+FormGroup|new\s+FormControl|FormBuilder|new\s+FormArray/),
  templateDriven: scan('html', /\[\(ngModel\)\]|ngModel\b/),
  validators: scan('ts', /Validators\.|ValidatorFn|AsyncValidator/),
});

// 12. i18n
layer(12, 'i18n', {
  ngxTranslate: hasDep('@ngx-translate'),
  translatePipe: scan('html', /\|\s*translate|jhiTranslate/),
  translateService: scan('ts', /TranslateService/),
  localize: scan('html', /i18n[=-]|\$localize/),
  transloco: hasDep('@ngneat/transloco') || hasDep('@jsverse/transloco'),
});

// 13. Auth / authorization
layer(13, 'Auth / authz', {
  authGuards: scan('ts', /hasAnyAuthority|hasAuthority|isAuthenticated|AuthGuard|UserRouteAccessService/),
  keycloakOidc: hasDep('keycloak') || hasDep('angular-oauth2-oidc') || hasDep('angular-auth-oidc'),
  authDirective: scan('html', /jhiHasAnyAuthority|\*hasAuthority|hasAnyAuthority/),
});

// 14. Styling
layer(14, 'Styling', {
  scssFiles: bucket.scss.length,
  hostSelector: scan('scss', /:host\b/),
  viewEncapsulation: scan('ts', /ViewEncapsulation/),
  ngClass: scan('html', /\[ngClass\]|\[ngStyle\]/),
  tailwind: hasDep('tailwindcss'),
});

// 15. Testing
layer(15, 'Testing', {
  testBed: scan('ts', /TestBed\b/),
  specFiles: bucket.ts.filter((f) => f.endsWith('.spec.ts')).length,
  jasmineKarma: hasDep('jasmine') || hasDep('karma'),
  jest: hasDep('jest') || hasDep('@angular-builders/jest'),
  cypressPlaywright: hasDep('cypress') || hasDep('@playwright'),
  protractor: hasDep('protractor'),
});

// 16. Child component graph
layer(16, 'Component graph', {
  components: names('ts', /@Component[\s\S]{0,160}?class\s+(\w+)/).length,
  inputs: scan('ts', /@Input\(|input\s*(<|\()/),
  outputs: scan('ts', /@Output\(|output\s*(<|\()/),
  contentProjection: scan('html', /<ng-content/),
});

// 17. Change detection / zone.js
layer(17, 'Change detection', {
  onPush: scan('ts', /ChangeDetectionStrategy\.OnPush/),
  changeDetectorRef: scan('ts', /ChangeDetectorRef|markForCheck|detectChanges/),
  ngZone: scan('ts', /NgZone|runOutsideAngular/),
  zoneless: scan('ts', /provideExperimentalZonelessChangeDetection|ngZoneEventCoalescing/),
});

// 18. DOM / renderer / imperative view APIs
layer(18, 'DOM / renderer / refs', {
  renderer2: scan('ts', /Renderer2\b/),
  elementRef: scan('ts', /ElementRef\b/),
  viewChild: scan('ts', /@ViewChild|@ViewChildren|viewChild\s*\(/),
  contentChild: scan('ts', /@ContentChild|@ContentChildren/),
  viewContainer: scan('ts', /ViewContainerRef|createComponent|ComponentFactoryResolver|TemplateRef/),
});

// 19. Custom pipes
layer(19, 'Custom pipes', {
  pipes: names('ts', /@Pipe\s*\(\s*\{[\s\S]{0,60}?name:\s*['"](\w+)['"]/),
  pipeClasses: names('ts', /@Pipe[\s\S]{0,80}?class\s+(\w+)/),
});

// 20. Animations
layer(20, 'Animations', {
  animationsDep: hasDep('@angular/animations'),
  triggers: scan('ts', /trigger\s*\(|state\s*\(|transition\s*\(|animate\s*\(/),
  animationBindings: scan('html', /\[@\w+\]|@\w+\.(enter|leave|start|done)/),
});

// 21. SSR / hydration / PWA
layer(21, 'SSR / PWA', {
  universal: hasDep('@angular/ssr') || hasDep('@nguniversal'),
  transferState: scan('ts', /TransferState|makeStateKey/),
  serviceWorker: hasDep('@angular/service-worker') || scan('ts', /ServiceWorkerModule/).count > 0,
  manifest: files.some((f) => /manifest\.webmanifest|ngsw-config/.test(rel(f))),
});

// 22. Runtime config / feature flags
layer(22, 'Runtime config / flags', {
  appInitializerConfig: scan('ts', /APP_INITIALIZER[\s\S]{0,200}?(config|Config)/),
  configJson: files.filter((f) => /assets?\/.*config.*\.json|\/config\.json/i.test(rel(f))).map(rel),
  featureFlags: hasDep('launchdarkly') || hasDep('unleash') || scan('ts', /featureFlag|FeatureFlag|isFeatureEnabled/).count > 0,
});

// 23. Logging / telemetry / error tracking
layer(23, 'Telemetry / logging', {
  sentry: hasDep('@sentry'),
  appinsights: hasDep('@microsoft/applicationinsights'),
  analytics: hasDep('angulartics') || hasDep('@angular/fire') || scan('ts', /gtag|analytics\.track|Amplitude/).count > 0,
  loggerService: scan('ts', /class\s+\w*Log\w*Service|LoggerService|NGXLogger/),
});

// 24. Locale / formatting
layer(24, 'Locale / formatting', {
  localeId: scan('ts', /LOCALE_ID|registerLocaleData/),
  intlPipes: scan('html', /\|\s*(date|currency|number|percent)\b/),
  dateLib: depsMatching(/date-fns|moment|dayjs|luxon/),
});

// 25. Browser API wrappers
layer(25, 'Browser APIs', {
  storage: scan('ts', /localStorage|sessionStorage|ngx-webstorage|CookieService/),
  websocket: scan('ts', /WebSocket|Stomp|SockJS|EventSource|socket\.io/),
  fileIo: scan('ts', /FileReader|new\s+Blob|FormData|download|URL\.createObjectURL/),
  clipboardPrint: scan('ts', /Clipboard|navigator\.clipboard|window\.print/),
});

// 26. CDK-style primitives
layer(26, 'CDK primitives', {
  overlay: scan('ts', /OverlayModule|Overlay\b|CdkOverlay/),
  dragDrop: scan('ts', /DragDrop|CdkDrag|cdkDropList/),
  virtualScroll: scan('html', /cdk-virtual-scroll|cdkVirtualFor/),
  a11y: scan('ts', /FocusTrap|LiveAnnouncer|A11yModule|FocusMonitor/),
});

// 27. Generated API clients (SKIP — regenerate, don't port)
layer(27, 'Generated API clients', {
  openapiGen: hasDep('ng-openapi-gen') || hasDep('@openapitools'),
  generatedDirs: files.filter((f) => /\/(api|generated|openapi|swagger)\//i.test(rel(f)) && f.endsWith('.ts')).length,
  markerComments: scan('ts', /THIS FILE IS AUTO GENERATED|DO NOT EDIT|openapi-generator/),
});

// 28. Interop / strangler bridge (STRATEGIC — decides incremental vs big-bang)
layer(28, 'Interop / strangler bridge', {
  angularElements: hasDep('@angular/elements') || scan('ts', /createCustomElement/).count > 0,
  singleSpa: hasDep('single-spa'),
  moduleFederationBidirectional: scan('ts', /exposes\s*:|remotes\s*:/),
  webComponents: scan('ts', /customElements\.define/),
});

// 29. Monorepo / shared-lib topology
layer(29, 'Monorepo / topology', {
  nx: hasDep('@nx') || hasDep('nx'),
  workspaceLibs: files.filter((f) => /\/(libs|packages)\/.+\/(public-api|index)\.ts$/.test(rel(f))).map(rel),
  tsPathAliases: (() => {
    for (const f of bucket.json) {
      if (basename(f) === 'tsconfig.json' || basename(f) === 'tsconfig.base.json') {
        try {
          const p = JSON.parse(content.get(f).replace(/\/\/.*$/gm, ''));
          const paths = p.compilerOptions?.paths;
          if (paths) return Object.keys(paths);
        } catch {}
      }
    }
    return [];
  })(),
});

// ============================================================
// OUTPUT
// ============================================================
const manifest = {
  root,
  scannedAt: null, // stamp externally; Date.now() intentionally omitted for reproducibility
  fileCounts: { ts: bucket.ts.length, html: bucket.html.length, scss: bucket.scss.length },
  angularDeps: depsMatching(/^@angular/),
  layers: L,
};

if (outFile) {
  writeFileSync(outFile, JSON.stringify(manifest, null, 2));
  console.error(`manifest written to ${outFile}`);
}

if (asJson) {
  console.log(JSON.stringify(manifest, null, 2));
  process.exit(0);
}

// ---- human report ----
const H = (s) => `\n\x1b[1m${s}\x1b[0m`;
const dim = (s) => `\x1b[2m${s}\x1b[0m`;
console.log(H(`Angular layer inventory — ${root}`));
console.log(dim(`  files: ${bucket.ts.length} ts / ${bucket.html.length} html / ${bucket.scss.length} scss`));

/** Summarize one layer's data object into a compact status line. */
function summarize(data) {
  const parts = [];
  for (const [k, v] of Object.entries(data)) {
    if (k === 'id' || k === 'name') continue;
    if (v == null) continue;
    if (typeof v === 'boolean') {
      if (v) parts.push(`${k}=yes`);
    } else if (typeof v === 'number') {
      if (v) parts.push(`${k}=${v}`);
    } else if (Array.isArray(v)) {
      if (v.length) parts.push(`${k}[${v.length}]${v.length <= 6 ? '=' + v.join(',') : ''}`);
    } else if (typeof v === 'object' && 'count' in v) {
      if (v.count) parts.push(`${k}=${v.count}${v.files > 1 ? `/${v.files}f` : ''}`);
    }
  }
  return parts;
}

const RISK = { 4: '⚠', 9: '⚠', 10: '⚠', 19: '⚠', 28: '★', 29: '★' };
for (const l of L) {
  const parts = summarize(l);
  const mark = RISK[l.id] ? ` ${RISK[l.id]}` : '';
  const head = `${String(l.id).padStart(2)}. ${l.name}${mark}`;
  if (!parts.length) {
    console.log(`${head} ${dim('— (none detected)')}`);
  } else {
    console.log(`${head}`);
    console.log(dim('    ' + parts.join('  ')));
  }
}

console.log(H('Legend'));
console.log(dim('  ⚠ per-app adapter surface (one mapping per item — inventory fully)'));
console.log(dim('  ★ strategic decision (shapes whether harness runs incremental vs big-bang)'));
console.log(dim('\n  Full detail (top files + samples per layer):  --json  or  --out manifest.json'));
