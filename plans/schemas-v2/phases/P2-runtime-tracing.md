# Phase 2 — Runtime Tracing (v2, framework-neutral)

> **Status: normative.** v2 successor to `plans/phases/P2-runtime-tracing.md`, rewritten against
> `schemas-v2/`. The **source and target frameworks are parameters, not assumptions**. Framework
> internals never appear in the neutral flow: every framework-internal lifecycle signal collapses
> into the single neutral `framework.event` kind and carries its type/detail in the
> `frameworkEvent` adapter slot (`semantic-trace.schema.json`), side-tagged `source`/`target`. The
> concrete instrumentation mechanism for the worked example (**Angular 2+ → React**) lives in the
> "Adapter notes (Angular 2+)" callouts. Provenance: ported from `plans/phases/P2`.

> **Role:** tracer. **Input:** `RunRequest`, `InventoryGraph`, serveable source app. **Output:**
> working shim (`shim/**`); baseline `SemanticTrace`s for the scenario corpus; runtime usage
> counters folded back into the inventory. **Exit gate:** shim inertness proven; every neutral
> trace-event kind demonstrated or explained; ≥1 recorded `SemanticTrace` per critical-path flow.

## 1. Why this phase exists

Static analysis cannot see which reactive subscriptions actually fire, which app-event-bus events
have live listeners, which runtime-compiled template variants are ever realized, third-party
plugin DOM-mutation timing, or true change-detection/settle boundaries. These are exactly the
runtime semantics that break naive conversion (`ARCHITECTURE.md §1` — execution is the oracle).
Everything here **observes; nothing modifies app behavior** (principle P6 + the inertness gate,
§4). The tracer is the only writer of `shim/**`; it never edits `legacy/**`.

## 2. Instrumentation module (`shim/tracer.*`) — the mechanism

The tracer registers itself into the running source app **without touching its source**, by
hooking the source framework's own bootstrap and its internal lifecycle surface, then emitting
**normalized neutral events**. It must produce, at minimum:

- **User/network/DOM/ARIA/URL/console/domain** events — the neutral core kinds
  (`semantic-trace.schema.json`), which are framework-independent.
- **`framework.event`** — one neutral kind for *every* framework-internal signal (change
  detection / digest / commit / effect / subscription emit / route transition). The concrete type
  and payload go in `frameworkEvent {adapterId, side, type, detail}`; the normalizer aligns on
  `semanticKey`, so these never leak into parity comparison unless a diff policy opts in.
- **A settle signal** — `window.__mxSettled()`: no pending network, no pending timers, framework
  quiescent (the "settle point" of `ARCHITECTURE.md §8`), so scenario steps can assert
  deterministically.
- **A domain-event probe** — `window.__mxDomainEvent(name, payload)` for semantic
  (`domain.event`) milestones.
- **Per-inventory-node runtime usage counters** — folded back in §7.

Key implementation notes (each is a known failure mode):

- **Reactive-subscription/watch tracking:** wrap the source framework's subscription/watch
  registration so listener invocations emit a `framework.event` with hashed payloads
  (`{expr, oldHash, newHash}`) — **hash, do not serialize whole objects** (cycles, size).
- **Third-party DOM-plugin calls:** for each plugin in the census, wrap its invocation entrypoint
  to emit a `framework.event` (plugin call) — install this **before** app scripts run so no call
  is missed.
- **Bootstrap variants:** the injection must survive whatever bootstrap style P0 recorded
  (declarative single-root, manual, or multi-step). If the framework's deferred-bootstrap hook
  does not cover a variant, fall back to intercepting the bootstrap call at the proxy/driver
  layer.
- **Existing e2e harness conflicts:** if the source app's own e2e tooling also hooks bootstrap,
  adopt a coexistence patch so both can attach.

> **Adapter notes (Angular 2+).** Concrete `frameworkEvent.type`s (side `source`):
> `change-detection` (tick/`ApplicationRef.tick`), `zone-task` (Zone.js macro/microtask),
> `signal-write`/`computed`, `rxjs-emit` (`{stream, valueHash}`), `router-events`. Hook points
> without editing source: patch `Zone.js` at load, read Angular's dev global
> (`window.ng` / `ɵ` debug APIs / `ApplicationRef`) after bootstrap, subscribe to `Router.events`,
> and wrap RxJS operators for timing-sensitive streams. For a **zoneless** app
> (`appProfile.zoneful == false`) there are no zone tasks — settle on scheduler drain + pending
> effects instead. Target-side (`side: 'target'`) React internals use the same slot
> (`commit`, `error-boundary`). All of this is `adapterId: 'angular2plus'` payload; the core
> tracer schema stays neutral.

## 3. Zero-touch injection

Never edit source HTML/code. Inject at serve time — pick per
`RunRequest.serving.instrumentationInjection`
(`proxy-html-rewrite` | `playwright-route-intercept` | `index-copy` | `build-hook`). The
orchestrator implements serving; `app.start("source", {instrumented: true})`
(`TOOL-CONTRACTS.md §2`) turns it on.

**Preferred: browser-driver route interception** (works even against a remote staging URL) —
intercept HTML responses and prepend the shim loader + tracer script tags before the app's own
scripts, and serve the shim files from a reserved path. Alternatives: a local reverse proxy doing
the same rewrite (needed if humans browse the instrumented app outside the driver); a copied
`index.instrumented.html` (script-tag apps); build-hook injection (only if CSP/checksums force it,
i.e. the P0 showstopper path).

**Trace transport:** the shim buffers events in a ring buffer; the browser-driver drains via an
exposed binding or a periodic `window.__mxDrain()`. Every event gets a monotonic in-page `seq`;
the harness stamps `stepIndex` by correlating with the scenario runner's current step. Output is
`SemanticTrace` NDJSON under `migration/traces/source/<scenario>/<run>.ndjson`, side-tagged
`source`.

## 4. Inertness gate (must pass before any trace is trusted)

1. Run the P0 smoke flow 3× uninstrumented, 3× instrumented (record console errors, final ARIA
   snapshot, network request list).
2. PASS iff: identical pass/fail, identical console-error count, identical network semantic keys,
   ARIA snapshots equal, and total wall time within 25%.
3. Store the report as an `EvidenceBundle` referenced from a ledger event.

## 5. Building the scenario corpus (what to record)

Priority order for scenario sources (tag each `BehaviorScenario` with its `source`):

1. **Recorded human flows** — the harness owner (or a session-replay corpus,
   `plans/EXTENSIONS-OOB.md §1`) walks critical paths once; the recorder captures steps + traces.
   Highest trust.
2. **Trace-mined flows** — from route-change events + usage counters, enumerate the top-N
   navigations and in-page interactions per route.
3. **ARIA-guided crawler** — an accessibility-snapshot crawl (via the browser-driver): visit every
   route from the route table, enumerate interactive elements (role button/link/textbox…),
   exercise safe interactions (no destructive verbs — denylist below), record traces. Crawler
   scenarios are breadth insurance, tagged `crawler`, priority `edge`.
4. **Coverage gaps** — inventory nodes with `usageCount.runtime == 0` after 1–3: either dead code
   (candidate `dead`) or unreached flows → targeted scenario tasks for scenario-author.

Crawler interaction denylist: any control whose accessible name matches
`/(delete|remove|pay|send|submit\b(?!.*search)|confirm|approve)/i` unless fixtures are write-safe
(mock-replay mode makes writes safe — then allow all).

## 6. Dynamic-template enumerator (for `dynamic-template` motif units)

For every runtime-template-compilation `framework.event`, store
`{templateHash → first-seen outerHTML, count, unitId}` in `traces/template-shapes.json`. This is
the ground-truth set of realized template variants — P3 turns each distinct shape into a
story/scenario; P6 converters treat the shape list as the spec for what the target component must
render.

> **Adapter notes (Angular 2+).** The runtime-compilation event corresponds to
> `ngComponentOutlet` / `ViewContainerRef.createComponent` / dynamic component loading; the
> enumerator keys on the resolved component type + projected content, not on a template string.

## 7. Usage counters → inventory backfill

After the corpus run, write `usageCount.runtime` for every inventory node (subscription/watch
registrations attributable via registration-site stack capture; events via name; templates via
hash; services via decorated method-call counters on high-risk services only — decorating every
service is too invasive). Nodes still at 0 runtime hits AND low static confidence → flag
`suspected-dead` for human triage (deletion candidates = free migration wins;
`node.usageCount.runtime` upgrades `foundBy` from `inferred`/`string-match` to `runtime-trace`).
