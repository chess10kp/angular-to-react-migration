# Phase 2 — Runtime Tracing

> **Role:** tracer. **Input:** charter, inventory, serveable legacy app. **Output:** working
> shim; baseline semantic traces for the scenario corpus; runtime usage counters folded back
> into the inventory. **Exit gate:** shim inertness proven; every trace-event kind demonstrated
> or explained; ≥1 recorded trace per critical-path flow.

## 1. Why this phase exists

Static analysis cannot see: which watchers actually fire, which `$rootScope` events have live
listeners, which `$compile`d template variants are ever realized, plugin DOM mutation timing,
or true digest boundaries. These are exactly the AngularJS semantics that break naive
conversion. Everything here observes; nothing modifies app behavior (rule U1 + inertness gate).

## 2. Instrumentation module (`shim/tracer.js`) — the official mechanism

AngularJS has a **documented, purpose-built hook for adding a module to a running app without
touching its source**: deferred bootstrap. (Verified against AngularJS 1.8.3 docs/source; the
canonical prior art is `angular-hint`'s `hint.js`.)

```js
// shim/loader.js — must execute BEFORE angular.js loads
window.name = 'NG_DEFER_BOOTSTRAP!' + window.name;   // angular sees this and pauses bootstrap
document.addEventListener('DOMContentLoaded', function () {
  // after all app scripts have registered their modules:
  angular.resumeBootstrap(['mxTracer']);              // injects our module into the DI registry
});
```

```js
// shim/tracer.js — the mxTracer module (sketch; implement fully)
angular.module('mxTracer', [])
  .config(['$provide', '$httpProvider', function ($provide, $httpProvider) {
    $provide.decorator('$rootScope', ['$delegate', function ($delegate) {
      const proto = Object.getPrototypeOf($delegate);
      wrap(proto, '$watch',      e => emit('ngjs.watch-register', e));
      wrap(proto, '$emit',       e => emit('ngjs.scope-event', {direction: 'emit', ...e}));
      wrap(proto, '$broadcast',  e => emit('ngjs.scope-event', {direction: 'broadcast', ...e}));
      wrapDigest(proto);         // time digests; emit ngjs.digest {durationMs, watchFires}
      return $delegate;
    }]);
    $provide.decorator('$compile', ['$delegate', function ($delegate) {
      return function mxCompile(el, ...rest) {
        emit('ngjs.compile', {templateHash: hash(outerHtml(el)), source: typeofInput(el)});
        return $delegate.apply(this, [el, ...rest]);
      };
    }]);
    $provide.decorator('$timeout', …); $provide.decorator('$interval', …);
    $httpProvider.interceptors.push(mxHttpInterceptor);   // request/response with correlation ids
  }])
  .run(['$rootScope', '$injector', function ($rootScope, $injector) {
    hookRouteEvents($rootScope, $injector);  // $routeChangeSuccess OR ui-router transitions.onSuccess
    exposeSettleSignal();                    // window.__mxSettled(): no pending $http, $timeout, digest
    exposeDomainEventProbe();                // window.__mxDomainEvent(name, payload) for semantic events
    installUsageCounters();                  // per inventory-node runtime hit counters
  }]);
```

Key implementation notes (each is a known failure mode — see RISKS doc):
- **Watch-fire tracking:** decorating `$watch` registration lets you wrap listener fns to emit
  `ngjs.watch-fire` with `{expr, oldHash, newHash}`. Hash payloads (do not serialize whole
  objects — cycles, size).
- **jQuery plugin calls:** for each plugin in the charter census, wrap `$.fn.<plugin>` to emit
  `ngjs.element-plugin-call`. Do this in `shim/loader.js` after jQuery loads, before app scripts.
- **Manual-bootstrap apps** (`angular.bootstrap(el, mods)`): deferred bootstrap also pauses
  manual bootstraps in 1.6+; verify per app. Fallback: monkey-patch `angular.bootstrap` in
  loader.js to append `'mxTracer'` to the module list.
- **Protractor conflict:** if legacy e2e uses Protractor, it also calls `resumeBootstrap` —
  copy angular-hint's coexistence patch.

## 3. Zero-touch injection

Never edit legacy HTML/source. Inject at serve time — pick per charter
`serving.instrumentationInjection`:

**Preferred: Playwright route interception** (works even against a remote staging URL):

```ts
await context.route('**/*.html', async route => {
  const resp = await route.fetch();
  let html = await resp.text();
  html = html.replace(/<script/i,
    `<script src="/__mx/loader.js"></script><script src="/__mx/tracer.js"></script><script`);
  await route.fulfill({ response: resp, body: html });
});
await context.route('/__mx/*', route => route.fulfill({ path: shimFile(route) }));
```

Alternatives: a local reverse proxy doing the same rewrite (needed if humans browse the
instrumented app outside Playwright); a copied `index.instrumented.html` (script-tag apps);
build-hook injection (only if CSP/checksums force it).

**Trace transport:** shim buffers events in a ring buffer; Playwright drains via
`page.exposeBinding('__mxSink', …)` or periodic `page.evaluate(() => window.__mxDrain())`.
Every event gets `seq` (monotonic in-page) and the harness stamps `stepIndex` by correlating
with the scenario runner's current step.

## 4. Inertness gate (must pass before any trace is trusted)

1. Run the P0 smoke flow 3× uninstrumented, 3× instrumented (record console errors, final
   ARIA snapshot, network request list).
2. PASS iff: identical pass/fail, identical console-error count, identical network semantic
   keys, ARIA snapshots equal, and total wall time within 25%.
3. Store the report as evidence in the ledger.

## 5. Building the scenario corpus (what to record)

Priority order for scenario sources (tag each Behavior IR with its `source`):
1. **Recorded human flows** — the harness owner (or a session-replay corpus, EXTENSIONS-OOB §1)
   walks critical paths once; recorder captures steps + traces. Highest trust.
2. **Trace-mined flows** — from route-change events + usage counters, enumerate the top-N
   navigations and in-page interactions per route.
3. **ARIA-guided crawler** — Playwright MCP-style accessibility-snapshot crawl: visit every
   route from the route table, enumerate interactive elements (role button/link/textbox…),
   exercise safe interactions (no destructive verbs — see denylist below), record traces.
   Crawler scenarios are breadth insurance, tagged `crawler`, priority `edge`.
4. **Coverage gaps** — inventory nodes with `usageCount.runtime == 0` after 1–3: either dead
   code (candidate `dead`) or unreached flows → targeted scenario tasks for scenario-author.

Crawler interaction denylist: any control whose accessible name matches
`/(delete|remove|pay|send|submit\b(?!.*search)|confirm|approve)/i` unless fixtures are
write-safe (MSW replay mode makes writes safe — then allow all).

## 6. Template Shape Enumerator (for `dynamic-compile-html` motif units)

For every `ngjs.compile` event, store `{templateHash → first-seen outerHTML, count, unitId}`
in `traces/template-shapes.json`. This is the ground-truth set of realized template variants —
P3 turns each distinct shape into a story/scenario; P6 converters treat the shape list as the
spec for what the React component must render.

## 7. Usage counters → inventory backfill

After the corpus run, write `usageCount.runtime` for every inventory node (watch registrations
are attributable via registration-site stack capture; events via name; templates via hash;
services via decorated method-call counters on high-risk services only — decorating every
service is too invasive). Nodes still at 0 runtime hits AND low static confidence → flag
`suspected-dead` for human triage (deletion candidates = free migration wins).
