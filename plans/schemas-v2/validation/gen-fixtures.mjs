// Generates the schemas-v2 fixture corpus under ./fixtures.
// Each artifact gets valid/ (minimal + full) and invalid/ (targeted violations).
// Invalid fixtures use {"$doc": <value>, "$why": "..."} to document what they probe.
// Re-run any time the schemas change: `node gen-fixtures.mjs`.
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "fixtures");
rmSync(root, { recursive: true, force: true });

const SHA = "a".repeat(64);
const TS = "2026-07-17T12:00:00Z";
let n = 0;
function put(rel, obj) {
  const path = join(root, rel);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(obj, null, 2) + "\n");
  n++;
}
const bad = (value, why) => ({ $doc: value, $why: why });

// ============================================================ run-request
put("run-request/valid/minimal.json", {
  schemaVersion: "2.0.0",
  source: { framework: { id: "angular", version: "17.3.0", role: "source" } },
  target: { framework: { id: "react", version: "18.2.0", role: "target" } },
  serving: { howToServe: "ng serve", instrumentationInjection: "proxy-html-rewrite" },
  strategy: { defaultSeam: "route-shell", unitOrdering: "leaves-first" },
  budgets: {},
  oracle: {},
  approval: { approvedBy: "jac", at: TS },
});
put("run-request/valid/full.json", {
  schemaVersion: "2.0.0",
  runId: "run-001",
  app: {
    name: "invoices",
    sizeMetrics: { sourceFiles: 900, components: 120, services: 40, routes: 25, modules: 12, templates: 110, linesOfCode: 88000 },
    testSurface: { unitTests: "jest", e2eTests: "playwright" },
    i18n: "ngx-translate",
    showstoppers: ["multiple app roots"],
  },
  source: {
    framework: { id: "angular", version: "17.3.0", role: "source" },
    adapter: {
      adapterId: "angular2plus", adapterVersion: "2.0.0",
      data: { angularVersion: "17.3.0", bootstrapStyle: "standalone", buildSystem: "angular-cli-esbuild", stateManagement: ["signals", "rxjs-services"], zoneful: false, usesSignals: true, router: "angular-router", moduleFederation: true, inventorySummary: { ngModules: 12, standaloneComponents: 80, pipes: 15, injectables: 40, guards: 6 } },
    },
  },
  target: { framework: { id: "react", version: "18.2.0", role: "target" } },
  serving: { howToServe: "ng serve --port 4200", baseUrl: "http://localhost:4200", instrumentationInjection: "playwright-route-intercept", authStrategy: "seeded-cookie", backendStrategy: "record-replay-mock" },
  strategy: { defaultSeam: "element-bridge", shellDirection: "legacy-hosts-target", unitOrdering: "services-first", normalizationPrepass: true, soakPolicy: { lowRisk: "1d", highRisk: "7d" } },
  budgets: { contextPackTokenBudget: 60000, modelRouting: { high: { tier: "strong" } } },
  oracle: { minKillRate: { high: 0.8, critical: 0.95 }, flakeScreenRuns: 3 },
  evidence: [{ claim: "serves locally", probe: "curl", artifactPath: "evidence/serve.log" }],
  approval: { approvedBy: "jac", at: TS, notes: "ok" },
});
put("run-request/invalid/missing-required.json", bad(
  { schemaVersion: "2.0.0", source: { framework: { id: "angular" } }, target: { framework: { id: "react" } }, serving: { howToServe: "x", instrumentationInjection: "index-copy" }, strategy: { defaultSeam: "route-shell", unitOrdering: "x" }, budgets: {}, oracle: {} },
  "missing required 'approval'"));
put("run-request/invalid/bad-schemaversion.json", bad(
  { schemaVersion: "1.0.0", source: { framework: { id: "angular" } }, target: { framework: { id: "react" } }, serving: { howToServe: "x", instrumentationInjection: "index-copy" }, strategy: { defaultSeam: "route-shell", unitOrdering: "x" }, budgets: {}, oracle: {}, approval: {} },
  "schemaVersion const must be '2.0.0'"));
put("run-request/invalid/bad-instrumentation-enum.json", bad(
  { schemaVersion: "2.0.0", source: { framework: { id: "angular" } }, target: { framework: { id: "react" } }, serving: { howToServe: "x", instrumentationInjection: "monkeypatch" }, strategy: { defaultSeam: "route-shell", unitOrdering: "x" }, budgets: {}, oracle: {}, approval: {} },
  "instrumentationInjection not in enum"));
put("run-request/invalid/source-missing-framework.json", bad(
  { schemaVersion: "2.0.0", source: {}, target: { framework: { id: "react" } }, serving: { howToServe: "x", instrumentationInjection: "index-copy" }, strategy: { defaultSeam: "route-shell", unitOrdering: "x" }, budgets: {}, oracle: {}, approval: {} },
  "source.framework required ($ref frameworkDescriptor)"));

// ============================================================ unit
const unitBase = {
  schemaVersion: "2.0.0", id: "unit:component:invoiceTable", kind: "component", rev: 0,
  state: "DISCOVERED", stateSince: TS, deps: [],
  risk: { score: 42, tier: "high", factors: ["signal-effect-chain"] },
  attempts: { convert: 0, repair: 0 },
  budget: { maxConvertAttempts: 3, maxRepairAttempts: 5, tokenCap: 200000, tokensSpent: 0 },
  artifacts: {},
};
put("unit/valid/minimal.json", unitBase);
put("unit/valid/full.json", {
  ...unitBase, id: "unit:service:InvoiceService", kind: "service", rev: 4, state: "CONVERTING",
  dependents: ["unit:component:invoiceTable"], motifs: ["http-cache"], recipes: ["r-004"], scenarios: ["inv.list"],
  seam: { type: "element-bridge", flag: "ff.invoiceService" }, modelTier: "strong",
  artifacts: { legacyPaths: ["src/app/invoice.service.ts"], targetPaths: ["target/invoiceService.ts"], stories: [], tests: ["target/invoiceService.test.ts"] },
  sourceAdapter: { adapterId: "angular2plus", adapterVersion: "2.0.0", data: { construct: "injectable", className: "InvoiceService", injectables: [{ token: "HttpClient", api: "inject-function" }] } },
  assignee: { role: "converter", agentId: "a1", leaseId: "l1", leaseExpiresAt: TS },
  waivers: [], openCounterexamples: [], notes: "core service",
});
put("unit/invalid/bad-id-pattern.json", bad({ ...unitBase, id: "unit:widget:foo" }, "kind 'widget' not in unitId pattern vocabulary"));
put("unit/invalid/bad-kind-enum.json", bad({ ...unitBase, kind: "hook" }, "kind 'hook' not in neutral enum"));
put("unit/invalid/bad-state.json", bad({ ...unitBase, state: "DONE" }, "state 'DONE' not in state enum"));
put("unit/invalid/risk-score-range.json", bad({ ...unitBase, risk: { score: 150, tier: "high", factors: [] } }, "risk.score > 100"));
put("unit/invalid/extra-prop.json", bad({ ...unitBase, owner: "jac" }, "additionalProperties:false rejects 'owner'"));

// ============================================================ inventory-graph
const invBase = {
  schemaVersion: "2.0.0",
  sourceFramework: { id: "angular", version: "17.3.0", role: "source" },
  generatedAt: TS, sourceRoots: ["src/app"],
  nodes: [{ nodeId: "component:invoiceTable", kind: "component", declaredIn: "src/app/invoice-table.component.ts" }],
  edges: [{ from: "component:invoiceTable", to: "service:InvoiceService", kind: "depends-on", foundBy: "static-ast" }],
  unaccounted: [],
};
put("inventory-graph/valid/minimal.json", invBase);
put("inventory-graph/valid/full.json", {
  ...invBase, scannerVersion: "1.4.2",
  nodes: [{
    nodeId: "component:invoiceTable", kind: "component", declaredIn: "src/app/invoice-table.component.ts",
    lines: [1, 200], dependencyInjection: { injects: ["service:InvoiceService"] }, templateRefs: ["invoices/list.html"],
    usageCount: { static: 3, runtime: null }, unitId: "unit:component:invoiceTable",
    sourceAdapter: { adapterId: "angular2plus", adapterVersion: "2.0.0", data: { construct: "component", selector: "app-invoice-table", standalone: true, changeDetection: "OnPush" } },
  }],
  edges: [{ from: "component:invoiceTable", to: "service:InvoiceService", kind: "depends-on", foundBy: "static-ast", site: "constructor", sourceAdapter: { adapterId: "angular2plus", adapterVersion: "2.0.0", data: { relation: "di-inject", tokenName: "InvoiceService" } } }],
  unaccounted: [],
});
put("inventory-graph/invalid/bad-node-kind.json", bad({ ...invBase, nodes: [{ nodeId: "x", kind: "hook", declaredIn: "y" }] }, "node kind 'hook' not in neutral enum"));
put("inventory-graph/invalid/bad-edge-kind.json", bad({ ...invBase, edges: [{ from: "a", to: "b", kind: "di-inject", foundBy: "static-ast" }] }, "edge kind 'di-inject' is framework-specific; must be neutralized"));
put("inventory-graph/invalid/bad-foundby.json", bad({ ...invBase, edges: [{ from: "a", to: "b", kind: "depends-on", foundBy: "guess" }] }, "foundBy 'guess' not in enum"));
put("inventory-graph/invalid/node-missing-required.json", bad({ ...invBase, nodes: [{ nodeId: "x", kind: "component" }] }, "node missing 'declaredIn'"));

// ============================================================ migration-plan
const planBase = {
  schemaVersion: "2.0.0", planId: "plan-001", generatedAt: TS,
  waves: [{ waveIndex: 0, units: [{ unitId: "unit:service:InvoiceService" }] }],
};
put("migration-plan/valid/minimal.json", planBase);
put("migration-plan/valid/full.json", {
  ...planBase, runId: "run-001", orderingPolicy: "services-leaves-first",
  waves: [{ waveIndex: 0, rationale: "leaves", units: [{ unitId: "unit:service:InvoiceService", seam: "none-internal", flag: "ff.invsvc", blockedBy: [], recipeHints: ["r-004"], riskTier: "medium" }] }],
  bridgePlan: [{ flag: "ff.invoiceTable", seamType: "element-bridge", shellDirection: "legacy-hosts-target", retireWhen: "unit INTEGRATED" }],
  targetAdapter: { adapterId: "angular2plus", adapterVersion: "2.0.0", data: { scaffolding: "prefer-standalone" } },
});
put("migration-plan/invalid/bad-wave-unitid.json", bad({ ...planBase, waves: [{ waveIndex: 0, units: [{ unitId: "InvoiceService" }] }] }, "wave unitId fails unitId pattern"));
put("migration-plan/invalid/bad-seam-enum.json", bad({ ...planBase, waves: [{ waveIndex: 0, units: [{ unitId: "unit:service:InvoiceService", seam: "iframe" }] }] }, "seam 'iframe' not in enum"));
put("migration-plan/invalid/negative-waveindex.json", bad({ ...planBase, waves: [{ waveIndex: -1, units: [] }] }, "waveIndex minimum 0"));

// ============================================================ decision-record
const decBase = { schemaVersion: "2.0.0", decisionId: "d-0001", type: "waiver", unitIds: ["unit:component:invoiceTable"], justification: "legacy bug", status: "approved" };
put("decision-record/valid/minimal.json", decBase);
put("decision-record/valid/full.json", {
  ...decBase, type: "escalation-resolution", scenarioIds: ["inv.list"], category: "legacy-bug-fixed",
  match: { divergenceKinds: ["dom-mismatch"], semanticKeyPattern: "^dom:", stepIndexRange: [2, 5] },
  expectedNewBehavior: "no phantom row", approvedBy: "jac", approvedAt: TS, expiresAtPhase: "P7",
  resolution: { action: "reset budgets", budgetsReset: true, evidence: [{ path: "evidence/x.log", sha256: SHA, kind: "log" }] },
});
put("decision-record/invalid/bad-decisionid.json", bad({ ...decBase, decisionId: "d-1" }, "decisionId must match ^d-[0-9]{4}$"));
put("decision-record/invalid/bad-type.json", bad({ ...decBase, type: "override" }, "type 'override' not in enum"));
put("decision-record/invalid/bad-status.json", bad({ ...decBase, status: "granted" }, "status 'granted' not in enum"));
put("decision-record/invalid/bad-evidence-sha.json", bad({ ...decBase, resolution: { evidence: [{ path: "x", sha256: "xyz" }] } }, "evidenceRef.sha256 pattern"));

// ============================================================ patch
const patchBase = {
  schemaVersion: "2.0.0", patchId: "p-001", unitId: "unit:component:invoiceTable",
  author: { role: "converter" }, intent: { kind: "initial-conversion" },
  changes: [{ path: "target/InvoiceTable.tsx", changeType: "add" }],
};
put("patch/valid/minimal.json", patchBase);
put("patch/valid/full.json", {
  ...patchBase, author: { role: "repairer", agentId: "a2", leaseId: "l2" },
  intent: { kind: "repair", targetsCounterexample: "ce-000123", appliedRecipe: "r-004", summary: "fix ordering" },
  changes: [{ path: "target/InvoiceTable.tsx", changeType: "modify", diffRef: { path: "diffs/p-001.diff", sha256: SHA, kind: "diff" }, afterSha256: SHA }],
  generatedArtifacts: { tests: ["target/InvoiceTable.test.tsx"], stories: [] },
  targetAdapter: { adapterId: "angular2plus", adapterVersion: "2.0.0", data: { construct: "component", standalone: true, usesSignals: true } },
});
put("patch/invalid/empty-changes.json", bad({ ...patchBase, changes: [] }, "changes minItems 1"));
put("patch/invalid/bad-author-role.json", bad({ ...patchBase, author: { role: "reviewer" } }, "author.role 'reviewer' not in enum"));
put("patch/invalid/bad-changetype.json", bad({ ...patchBase, changes: [{ path: "x", changeType: "patch" }] }, "changeType 'patch' not in enum"));
put("patch/invalid/bad-unitid.json", bad({ ...patchBase, unitId: "invoiceTable" }, "unitId pattern"));

// ============================================================ behavior-scenario
const scenBase = {
  schemaVersion: "2.0.0", scenarioId: "inv.list", unitIds: ["unit:component:invoiceTable"], route: "/invoices",
  preconditions: { fixtureProfile: "invoices-default" },
  userSteps: [{ action: "navigate", url: "/invoices" }],
  expected: {}, status: { greenOnLegacy: true },
};
put("behavior-scenario/valid/minimal.json", scenBase);
put("behavior-scenario/valid/full.json", {
  ...scenBase, title: "list invoices", priority: "critical-path", source: "trace-mined",
  preconditions: { auth: "user", fixtureProfile: "invoices-default", viewport: "1280x800", clock: "fixed", seed: 7, localStorage: { theme: "dark" } },
  userSteps: [
    { action: "navigate", url: "/invoices" },
    { action: "click", role: "button", name: "Filter" },
    { action: "fill", selector: "#q", value: "paid" },
    { action: "waitForSettle" },
    { action: "assertCheckpoint", checkpoint: "list-loaded" },
  ],
  expected: {
    aria: [{ role: "table", name: "Invoices", count: 1 }],
    dom: [{ selector: "tr.invoice", count: 12, visible: true }],
    network: [{ method: "GET", path: "/api/invoices", query: { status: "paid" }, orderMatters: false }],
    semantic: [{ event: "invoiceFilterChanged", payload: { status: "paid" } }],
    url: { path: "/invoices", query: { status: "paid" } },
    consoleErrors: 0,
    checkpoints: { "list-loaded": { dom: [{ selector: "tr.invoice", count: 12 }] } },
  },
  legacyTraceRefs: ["traces/inv.list.legacy.ndjson"],
  status: { greenOnLegacy: true, lastLegacyRun: TS, calibration: { mutantsInjected: 10, mutantsKilled: 9, acceptedGaps: ["tooltip-timing"] }, flakeScreen: { runs: 3, passes: 3 } },
});
put("behavior-scenario/invalid/bad-scenarioid.json", bad({ ...scenBase, scenarioId: "Inv List" }, "scenarioId pattern ^[a-z0-9][a-z0-9.-]+$"));
put("behavior-scenario/invalid/bad-action.json", bad({ ...scenBase, userSteps: [{ action: "swipe" }] }, "action 'swipe' not in enum"));
put("behavior-scenario/invalid/missing-fixtureprofile.json", bad({ ...scenBase, preconditions: {} }, "preconditions.fixtureProfile required"));
put("behavior-scenario/invalid/consoleerrors-nonzero.json", bad({ ...scenBase, expected: { consoleErrors: 2 } }, "consoleErrors const 0"));
put("behavior-scenario/invalid/empty-usersteps.json", bad({ ...scenBase, userSteps: [] }, "userSteps minItems 1"));

// ============================================================ semantic-trace
const traceBase = { schemaVersion: "2.0.0", seq: 1, t: 12.5, kind: "user.click", layer: "raw" };
put("semantic-trace/valid/minimal.json", traceBase);
put("semantic-trace/valid/net.json", { schemaVersion: "2.0.0", seq: 2, t: 40, layer: "normalized", stepIndex: 1, kind: "net.request", payload: { method: "GET", path: "/api/invoices" }, semanticKey: "net:GET:/api/invoices?status=paid" });
put("semantic-trace/valid/framework-event.json", { schemaVersion: "2.0.0", seq: 3, t: 41, layer: "raw", kind: "framework.event", frameworkEvent: { adapterId: "angular2plus", side: "source", type: "change-detection", detail: { componentId: "invoiceTable" } } });
put("semantic-trace/invalid/bad-kind.json", bad({ ...traceBase, kind: "user.scroll" }, "kind 'user.scroll' not in enum"));
put("semantic-trace/invalid/bad-layer.json", bad({ ...traceBase, layer: "cooked" }, "layer 'cooked' not in enum"));
put("semantic-trace/invalid/framework-event-missing-side.json", bad({ schemaVersion: "2.0.0", seq: 4, t: 1, layer: "raw", kind: "framework.event", frameworkEvent: { adapterId: "angular2plus", type: "commit" } }, "frameworkEvent missing required 'side'"));

// ============================================================ evidence-bundle
const evBase = {
  schemaVersion: "2.0.0", bundleId: "eb-001", unitId: "unit:component:invoiceTable", gate: "G3",
  items: [{ path: "evidence/build.log", sha256: SHA }],
};
put("evidence-bundle/valid/minimal.json", evBase);
put("evidence-bundle/valid/full.json", {
  ...evBase, submittedBy: { role: "converter", agentId: "a1", leaseId: "l1" }, submittedAt: TS,
  items: [{ path: "evidence/build.log", sha256: SHA, kind: "log", role: "build-log" }, { path: "evidence/parity.json", sha256: SHA, kind: "report", role: "parity-report" }],
  checks: [{ name: "tsc", passed: true, exitCode: 0 }, { name: "trace-diff-empty", passed: true, artifact: { path: "evidence/diff.json", sha256: SHA } }],
  targetAdapter: { adapterId: "angular2plus", adapterVersion: "2.0.0", data: { buildTool: "ng-build-esbuild", aotClean: true, strictTemplatesClean: true } },
});
put("evidence-bundle/valid/item-with-role.json", {
  ...evBase, items: [{ path: "evidence/build.log", sha256: SHA, role: "build-log" }],
});
put("evidence-bundle/invalid/bad-gate.json", bad({ ...evBase, gate: "gate3" }, "gate must match gateId pattern ^G[0-9]+$"));
put("evidence-bundle/invalid/empty-items.json", bad({ ...evBase, items: [] }, "items minItems 1"));
put("evidence-bundle/invalid/bad-item-sha.json", bad({ ...evBase, items: [{ path: "x", sha256: "nope" }] }, "item sha256 pattern (via evidenceRefBase)"));
put("evidence-bundle/invalid/item-bad-role.json", bad(
  { ...evBase, items: [{ path: "evidence/build.log", sha256: SHA, role: "explosion" }] },
  "item.role 'explosion' not in enum"));
put("evidence-bundle/invalid/item-extra-prop.json", bad(
  { ...evBase, items: [{ path: "evidence/build.log", sha256: SHA, bogus: true }] },
  "item seal (unevaluatedProperties:false) rejects unknown 'bogus' — extension point still closed"));

// ============================================================ counterexample
const ceBase = {
  schemaVersion: "2.0.0", ceId: "ce-000123", unitId: "unit:component:invoiceTable", scenarioId: "inv.list",
  status: "open", fingerprint: SHA,
  divergence: { kind: "order", stepIndex: 3, legacyEvidence: { tracePath: "t/legacy.ndjson", seqRange: [10, 20] }, targetEvidence: { tracePath: "t/target.ndjson", seqRange: [10, 22] } },
};
put("counterexample/valid/minimal.json", ceBase);
put("counterexample/valid/full.json", {
  ...ceBase, status: "analyzing", reopenCount: 1,
  divergence: { kind: "payload-mismatch", stepIndex: 3, firstDivergentSemanticKey: "net:GET:/api/invoices", legacyEvidence: { tracePath: "t/legacy.ndjson", seqRange: [10, 20], excerpt: [] }, targetEvidence: { tracePath: "t/target.ndjson", seqRange: [10, 22], excerpt: [] }, reproducibility: { runs: 5, reproduced: 5 } },
  analysis: {
    minimalRepro: [], suspectedConstruct: "derived-state-ordering", explanation: "signal glitch",
    sourceAdapter: { adapterId: "angular2plus", adapterVersion: "2.0.0", data: { cause: "signal-glitch-ordering", detail: "computed reads stale" } },
    repairDirective: { targetArtifact: "target/InvoiceTable.tsx", fixDirection: "memoize", expectedObservable: "stable order", relevantLessons: [] },
    waiverRecommended: false,
  },
  resolution: { kind: "fixed", evidence: [{ path: "x", sha256: SHA }], decisionId: "d-0001", lessonId: "les-1" },
});
put("counterexample/invalid/bad-ceid.json", bad({ ...ceBase, ceId: "ce-12" }, "ceId must match ^ce-[0-9]{6}$"));
put("counterexample/invalid/bad-divergence-kind.json", bad({ ...ceBase, divergence: { ...ceBase.divergence, kind: "flaky" } }, "divergence.kind 'flaky' not in enum"));
put("counterexample/invalid/bad-status.json", bad({ ...ceBase, status: "wontfix" }, "status 'wontfix' not in enum"));
put("counterexample/invalid/extra-prop.json", bad({ ...ceBase, severity: "high" }, "additionalProperties:false rejects 'severity'"));
put("counterexample/invalid/divergence-missing-required.json", bad({ ...ceBase, divergence: { kind: "order", stepIndex: 3 } }, "divergence missing legacyEvidence/targetEvidence"));

// ============================================================ recipe
const recBase = {
  schemaVersion: "2.0.0", id: "r-004", status: "verified", version: 1,
  motifs: ["http-cache"], appliesTo: {}, exemplar: { unitId: "unit:service:InvoiceService" },
};
put("recipe/valid/minimal.json", recBase);
put("recipe/valid/full.json", {
  ...recBase, id: "r-012-signal-input", title: "signal input port",
  appliesTo: {
    sourceFramework: { id: "angular", version: "17.x", role: "source" },
    targetFramework: { id: "react", version: "18.x", role: "target" },
    unitKinds: ["component", "presentation"], signature: "grep input\\(",
    sourceAdapter: { adapterId: "angular2plus", adapterVersion: "2.0.0", data: { construct: "component", inputs: [{ name: "value", api: "signal-input" }] } },
    preconditions: ["OnPush"],
  },
  exemplar: { unitId: "unit:component:invoiceTable", beforePaths: ["src/x.ts"], afterPaths: ["target/x.tsx"], verifiedAtLedgerSeq: 42 },
  codemod: { script: "codemods/signal-input.ts", coverage: "partial-scaffold" },
  pitfalls: ["two-way binding"], verificationEmphasis: ["aria"],
  stats: { applied: 5, firstPassParity: 4, avgRepairLoops: 0.6, escalations: 0 },
});
put("recipe/invalid/bad-id.json", bad({ ...recBase, id: "recipe-4" }, "id must match ^r-[0-9]{3}[a-z0-9-]*$"));
put("recipe/invalid/bad-status.json", bad({ ...recBase, status: "final" }, "status 'final' not in enum"));
put("recipe/invalid/bad-unitkind.json", bad({ ...recBase, appliesTo: { unitKinds: ["hook"] } }, "unitKinds 'hook' not in neutral enum"));
put("recipe/invalid/empty-motifs.json", bad({ ...recBase, motifs: [] }, "motifs minItems 1"));
put("recipe/invalid/version-zero.json", bad({ ...recBase, version: 0 }, "version minimum 1"));

// ============================================================ run-manifest
const rmBase = {
  schemaVersion: "2.0.0", packId: "pk-1", role: "converter", taskType: "convert", unitId: "unit:component:invoiceTable",
  items: [{ kind: "role-card", ref: "roles/converter.md", sha256: SHA }],
  tokenEstimate: 12000, budget: 60000,
};
put("run-manifest/valid/minimal.json", rmBase);
put("run-manifest/valid/full.json", {
  ...rmBase, runId: "run-001",
  sourceFramework: { id: "angular", version: "17.3.0", role: "source" }, targetFramework: { id: "react", version: "18.2.0", role: "target" },
  promptTemplate: "converter.md", modelTier: "strong",
  items: [{ kind: "role-card", ref: "roles/converter.md", sha256: SHA, tokens: 800 }, { kind: "legacy-source", ref: "src/x.ts", sha256: SHA, tokens: 4000 }, { kind: "scenario", ref: "scen/inv.list.json", sha256: SHA }],
  overflowed: false, createdAt: TS,
});
put("run-manifest/invalid/bad-item-kind.json", bad({ ...rmBase, items: [{ kind: "screenshot", ref: "x", sha256: SHA }] }, "item kind 'screenshot' not in enum"));
put("run-manifest/invalid/item-missing-sha.json", bad({ ...rmBase, items: [{ kind: "role-card", ref: "x" }] }, "item missing 'sha256'"));
put("run-manifest/invalid/missing-budget.json", bad({ schemaVersion: "2.0.0", packId: "pk-1", role: "converter", taskType: "convert", unitId: "unit:x", items: [{ kind: "other", ref: "x", sha256: SHA }], tokenEstimate: 1 }, "missing required 'budget'"));

// ============================================================ run-result
const rrBase = { schemaVersion: "2.0.0", runId: "run-001", generatedAt: TS, unitStateCounts: { DISCOVERED: 10, ACCEPTED: 3 } };
put("run-result/valid/minimal.json", rrBase);
put("run-result/valid/full.json", {
  ...rrBase, latestLedgerSeq: 420,
  ratchets: { legacyFileCount: 880, paritySuiteSize: 240, bridgeCount: 3, waiverCountByCategory: { "legacy-bug-fixed": 2 }, escalationRate: 0.05 },
  recentEvents: [
    { seq: 419, ts: TS, actor: { role: "converter", agentId: "a1" }, unitId: "unit:component:invoiceTable", type: "patch-submitted", payload: { patchId: "p-001" } },
    { seq: 420, ts: TS, actor: { role: "orchestrator" }, type: "transition", from: "CONVERTING", to: "BUILT", gate: "G3" },
  ],
});
put("run-result/invalid/bad-event-type.json", bad({ ...rrBase, recentEvents: [{ seq: 1, ts: TS, actor: { role: "x" }, type: "waiver-granted" }] }, "ledger type 'waiver-granted' was renamed to 'decision-granted'"));
put("run-result/invalid/event-missing-actor.json", bad({ ...rrBase, recentEvents: [{ seq: 1, ts: TS, type: "note" }] }, "ledgerEvent missing required 'actor'"));
put("run-result/invalid/bad-gate-pattern.json", bad({ ...rrBase, recentEvents: [{ seq: 1, ts: TS, actor: { role: "x" }, type: "gate-fail", gate: "G-3" }] }, "ledgerEvent.gate pattern ^G[0-9]+$"));

// ============================================================ adapter-ref (support)
put("adapter-ref/valid/minimal.json", { adapterId: "angular2plus", adapterVersion: "2.0.0", data: {} });
put("adapter-ref/invalid/bad-version.json", bad({ adapterId: "angular2plus", adapterVersion: "v2", data: {} }, "adapterVersion semver pattern"));
put("adapter-ref/invalid/missing-data.json", bad({ adapterId: "angular2plus", adapterVersion: "2.0.0" }, "missing required 'data'"));
put("adapter-ref/invalid/extra-prop.json", bad({ adapterId: "x", adapterVersion: "1.0.0", data: {}, foo: 1 }, "additionalProperties:false rejects 'foo'"));

// ============================================================ adapter $defs
put("adapters/angular2plus/appProfile/valid/full.json", { angularVersion: "17.3.0", bootstrapStyle: "standalone", buildSystem: "nx", stateManagement: ["ngrx-store", "signals"], zoneful: false, usesSignals: true, router: "angular-router", moduleFederation: true, inventorySummary: { ngModules: 5, standaloneComponents: 40, pipes: 10, injectables: 30, guards: 4, resolvers: 2, interceptors: 1 } });
put("adapters/angular2plus/appProfile/invalid/bad-buildsystem.json", bad({ buildSystem: "vite" }, "buildSystem 'vite' not in enum"));
put("adapters/angular2plus/appProfile/invalid/extra-prop.json", bad({ angularVersion: "17.0.0", ssr: true }, "additionalProperties:false rejects 'ssr'"));

put("adapters/angular2plus/nodeDescriptor/valid/full.json", { construct: "component", className: "InvoiceTable", selector: "app-invoice-table", standalone: true, changeDetection: "OnPush", inputs: [{ name: "rows", api: "signal-input", required: true }], outputs: [{ name: "select", api: "output-function" }], signals: [{ name: "count", kind: "computed", effects: 1 }], injectables: [{ token: "InvoiceService", api: "inject-function" }], template: { inline: false, templateUrl: "x.html", controlFlow: "builtin-control-flow", contentProjectionSlots: ["header"] } });
put("adapters/angular2plus/nodeDescriptor/valid/route.json", { construct: "route-config", route: { path: "invoices/:id", loadKind: "lazy-loadComponent", guards: ["authGuard"], resolvers: ["invoiceResolver"] } });
put("adapters/angular2plus/nodeDescriptor/invalid/missing-construct.json", bad({ selector: "app-x" }, "missing required 'construct'"));
put("adapters/angular2plus/nodeDescriptor/invalid/bad-construct.json", bad({ construct: "hook" }, "construct 'hook' not in enum"));
put("adapters/angular2plus/nodeDescriptor/invalid/bad-input-api.json", bad({ construct: "component", inputs: [{ name: "x", api: "prop" }] }, "input api 'prop' not in enum"));
put("adapters/angular2plus/nodeDescriptor/invalid/bad-changedetection.json", bad({ construct: "component", changeDetection: "onpush" }, "changeDetection must be 'Default' or 'OnPush'"));

put("adapters/angular2plus/edgeDescriptor/valid/full.json", { relation: "content-projection", contentProjectionSelector: "[header]", tokenName: "InvoiceService" });
put("adapters/angular2plus/edgeDescriptor/invalid/bad-relation.json", bad({ relation: "imports" }, "relation 'imports' not in enum"));

put("adapters/angular2plus/producedCode/valid/full.json", { construct: "component", standalone: true, changeDetection: "OnPush", usesSignals: true, moduleFederationExposedAs: "./InvoiceTable" });
put("adapters/angular2plus/producedCode/invalid/bad-construct.json", bad({ construct: "guard" }, "producedCode construct 'guard' not in its enum"));

put("adapters/angular2plus/rootCauseClass/valid/full.json", { cause: "onpush-change-detection-miss", detail: "markForCheck missing" });
put("adapters/angular2plus/rootCauseClass/invalid/bad-cause.json", bad({ cause: "race-condition" }, "cause 'race-condition' not in enum"));

put("adapters/angular2plus/buildEvidence/valid/full.json", { buildTool: "ng-build-esbuild", bundleBytes: 512000, bundleBytesDelta: -2048, aotClean: true, strictTemplatesClean: true, moduleFederationRemoteWired: true });
put("adapters/angular2plus/buildEvidence/invalid/bad-buildtool.json", bad({ buildTool: "rollup" }, "buildTool 'rollup' not in enum"));

put("adapters/angular2plus/planningHints/valid/full.json", { moduleFederation: { remotes: [{ name: "invoices", exposedModule: "./InvoiceTable", remoteEntry: "http://x/remoteEntry.js", loadedBy: "route" }], shellName: "shell" }, scaffolding: "prefer-standalone" });
put("adapters/angular2plus/planningHints/invalid/remote-missing-name.json", bad({ moduleFederation: { remotes: [{ exposedModule: "./X" }] } }, "remote missing required 'name'"));

console.log(`wrote ${n} fixtures`);
