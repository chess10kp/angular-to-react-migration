// Context-pack assembly (ORCHESTRATOR.md §8): build the RunManifest — the audit
// record of *exactly* what one agent task receives. The pack is the ordered
// concatenation of items; the agent gets nothing else and must need nothing else.
// Deterministic orchestrator code, framework-neutral.
//
// Guarantees this module enforces:
//  - Deterministic item ordering (always-items first, then task-specific, then lessons).
//  - Every item is content-addressed (sha256) and token-estimated.
//  - packId = sha256 of the ordered item hashes → reproducible & auditable.
//  - Hard size budget (§8.3): never truncate silently. On overflow set
//    overflowed=true and route to a higher modelTier; the caller emits pack-overflow.

import { sha256 } from "./store.mjs";

const DEFAULT_BUDGET = 60_000; // RunRequest.budgets.contextPackTokenBudget default
const DEFAULT_LESSON_TOPK = 5; // §8.5
const TIER_LADDER = ["cheap", "standard", "strong", "human"];

// ~4 chars/token is the standard rough estimate; deterministic and dependency-free.
const estimateTokens = (text) => Math.ceil(Buffer.byteLength(text, "utf8") / 4);

// The per-role pack recipe (§8 table). `always` items ship for every task of the
// role; `taskType` names the work. Task-specific items are gathered by the
// collectors below. Deliberately-excluded items are simply never collected.
const ROLE_PACK = {
  "scenario-author": { taskType: "author-scenarios", always: ["role-card", "phase-doc"] },
  converter:         { taskType: "convert", always: ["role-card", "conventions"] },
  repairer:          { taskType: "repair", always: ["role-card", "conventions"] },
  verifier:          { taskType: "verify", always: ["role-card"] },
  critic:            { taskType: "audit", always: ["role-card", "conventions"] },
  integrator:        { taskType: "integrate", always: ["role-card"] },
  decommissioner:    { taskType: "decommission", always: ["role-card"] },
};

// Read an on-disk artifact into an item, or null if it does not exist. Optional
// artifacts (a unit with no recipe yet) are simply omitted — never faked.
function fileItem(store, kind, rel) {
  if (!rel || !store.exists(rel)) return null;
  const content = store.readText(rel);
  return { kind, ref: rel, content };
}

// Synthesize an always-present item (role-card, task instruction) whose content
// the orchestrator owns, and persist it so the `ref` resolves for audit/replay.
function synthItem(store, kind, role, taskType, body) {
  const rel = `migration/context-packs/synth/${role}.${kind}.md`;
  store.writeText(rel, body);
  return { kind, ref: rel, content: body };
}

// Task-specific collectors, keyed by role. Each returns an ordered item list
// (nulls filtered by the caller). Neutral: paths come from the unit record and
// the §7 artifact catalog, never from framework assumptions.
const COLLECTORS = {
  converter: collectConverterLike,
  repairer: collectConverterLike,
  verifier: (s, u) => [
    fileItem(s, "unit-record", s.unitPath(u.id)),
    ...scenarioItems(s, u),
  ],
  critic: (s, u) => [
    fileItem(s, "unit-record", s.unitPath(u.id)),
    fileItem(s, "patch", `migration/patches/${encodeURIComponent(u.id)}.json`),
    ...recipeItems(s, u),
    ...scenarioItems(s, u),
  ],
  "scenario-author": (s, u) => [
    fileItem(s, "unit-record", s.unitPath(u.id)),
    ...legacySourceItems(s, u),
  ],
  integrator: (s, u) => [fileItem(s, "unit-record", s.unitPath(u.id))],
  decommissioner: (s, u) => [fileItem(s, "unit-record", s.unitPath(u.id))],
};

function collectConverterLike(store, unit) {
  return [
    fileItem(store, "unit-record", store.unitPath(unit.id)),
    ...legacySourceItems(store, unit),
    ...recipeItems(store, unit),
    ...scenarioItems(store, unit),
  ];
}

const legacySourceItems = (s, u) =>
  (u.artifacts?.legacyPaths || []).map((p) => fileItem(s, "legacy-source", p));
const recipeItems = (s, u) =>
  (u.recipes || []).map((id) => fileItem(s, "recipe", `migration/recipes/${id}.md`));
const scenarioItems = (s, u) =>
  (u.scenarios || []).map((id) => fileItem(s, "scenario", `migration/behavior-ir/${id}.json`));

// Top-K lessons whose motif/failure tags intersect the unit's motifs, most
// recently reinforced first (§8.5). Lessons file is markdown, one `##` per lesson;
// we tag-match on the heading line. Never the whole file.
function lessonItems(store, unit, topK) {
  const rel = "migration/lessons.md";
  if (!store.exists(rel)) return [];
  const motifs = new Set(unit.motifs || []);
  if (motifs.size === 0) return [];
  const blocks = store.readText(rel).split(/^(?=## )/m).filter((b) => b.startsWith("## "));
  const matched = blocks.filter((b) => {
    const heading = b.slice(0, b.indexOf("\n"));
    return [...motifs].some((m) => heading.includes(m));
  });
  // Preserve file order but keep only the last `topK` (most-recently-appended).
  return matched.slice(-topK).map((body, i) => ({
    kind: "lesson",
    ref: `${rel}#lesson-${blocks.indexOf(body)}`,
    content: body,
  }));
}

/**
 * Assemble a RunManifest for (role, unit).
 * @returns {{ manifest, overflowed, items }} — manifest is schema-valid
 *          (run-manifest.schema.json). `items[].content` is stripped from the
 *          manifest (audit records the ref+sha, not the bytes).
 */
export function assembleContextPack(role, unit, {
  store,
  runId,
  strategy = {},
  sourceFramework,
  targetFramework,
  budget = DEFAULT_BUDGET,
  modelTier = unit.modelTier || "standard",
  retry = false,
  lessonTopK = DEFAULT_LESSON_TOPK,
  failureArtifactRef,
  createdAt = new Date(0).toISOString(),
} = {}) {
  const spec = ROLE_PACK[role] || { taskType: role, always: ["role-card"] };
  const taskType = spec.taskType;

  // 1. Always-include items (synthesized/owned by the orchestrator).
  const items = [];
  for (const kind of spec.always) {
    if (kind === "role-card") {
      items.push(synthItem(store, "role-card", role, taskType,
        `# Role card: ${role}\n\nUniversal rules: source is read-only; never self-certify ` +
        `(submit an EvidenceBundle, the orchestrator judges); escalate over guessing.\n`));
    } else if (kind === "conventions") {
      items.push(fileItem(store, "conventions", "migration/conventions.md") ||
        synthItem(store, "conventions", role, taskType, `# Target conventions\n(placeholder — scaffolder owns this)\n`));
    } else if (kind === "phase-doc") {
      items.push(synthItem(store, "phase-doc-section", role, taskType,
        `# Phase doc (${taskType})\n(placeholder section for ${role})\n`));
    }
  }

  // 2. The instantiated task instruction (prompt template), always present.
  items.splice(1, 0, synthItem(store, "task-instruction", role, taskType,
    `# Task: ${taskType} for unit ${unit.id}\nState: ${unit.state}. Risk: ${unit.risk?.tier}. ` +
    `Attempts convert/repair: ${unit.attempts?.convert}/${unit.attempts?.repair}.\n` +
    `Produce the deliverables for your role and submit the gate with an EvidenceBundle.\n`));

  // 3. Role-specific task items.
  const collect = COLLECTORS[role] || ((s, u) => [fileItem(s, "unit-record", s.unitPath(u.id))]);
  items.push(...collect(store, unit));

  // 4. On retry, the prior failure artifact so the agent can learn from it.
  if (retry && failureArtifactRef) {
    items.push(fileItem(store, "failure-artifact", failureArtifactRef));
  }

  // 5. Top-K matched lessons.
  items.push(...lessonItems(store, unit, lessonTopK));

  // Finalize: drop missing/optional (nulls), hash + token-estimate, order stable.
  const resolved = items.filter(Boolean).map((it) => {
    const sha = sha256(it.content);
    return { kind: it.kind, ref: it.ref, sha256: sha, tokens: estimateTokens(it.content) };
  });

  const tokenEstimate = resolved.reduce((n, it) => n + it.tokens, 0);
  const overflowed = tokenEstimate > budget;
  // §8.3: never truncate — keep every item, but route overflow to a stronger tier.
  const effectiveTier = overflowed ? bumpTier(modelTier) : modelTier;

  const packId = sha256(resolved.map((it) => it.sha256).join("\n"));

  const manifest = {
    schemaVersion: "2.0.0",
    packId,
    ...(runId && { runId }),
    ...(sourceFramework && { sourceFramework }),
    ...(targetFramework && { targetFramework }),
    role,
    taskType,
    unitId: unit.id,
    modelTier: effectiveTier,
    items: resolved,
    tokenEstimate,
    budget,
    overflowed,
    createdAt,
  };

  return { manifest, overflowed, effectiveTier };
}

function bumpTier(tier) {
  const i = TIER_LADDER.indexOf(tier);
  return i < 0 || i === TIER_LADDER.length - 1 ? "human" : TIER_LADDER[i + 1];
}

export { estimateTokens, DEFAULT_BUDGET };
