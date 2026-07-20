// Files-are-the-database (ORCHESTRATOR.md §1). All state lives under a workspace
// root as JSON / NDJSON. Path sandboxing mirrors evidenceRef: no absolute paths,
// no `..` escaping the workspace. Content is addressed by sha256.

import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync, existsSync, appendFileSync } from "node:fs";
import { dirname, join, resolve, relative, isAbsolute } from "node:path";

export function sha256(content) {
  return createHash("sha256").update(content).digest("hex");
}

export class Store {
  constructor(workspaceRoot) {
    this.root = resolve(workspaceRoot);
  }

  // Reject absolute paths and any path that escapes the workspace (§0 sandbox).
  resolve(rel) {
    if (isAbsolute(rel)) throw new Error(`absolute path rejected: ${rel}`);
    const abs = resolve(this.root, rel);
    const r = relative(this.root, abs);
    if (r.startsWith("..")) throw new Error(`path escapes workspace: ${rel}`);
    return abs;
  }

  exists(rel) {
    return existsSync(this.resolve(rel));
  }

  readText(rel) {
    return readFileSync(this.resolve(rel), "utf8");
  }

  readJson(rel) {
    return JSON.parse(this.readText(rel));
  }

  // Content-addressed write. Optional expectedSha256 enforces optimistic
  // concurrency at the file level (fs.write CONFLICT in TOOL-CONTRACTS §1).
  writeText(rel, content, expectedSha256) {
    const abs = this.resolve(rel);
    if (expectedSha256 !== undefined && existsSync(abs)) {
      const cur = sha256(readFileSync(abs, "utf8"));
      if (cur !== expectedSha256) {
        const e = new Error(`CONFLICT: ${rel} changed`);
        e.code = "CONFLICT";
        throw e;
      }
    }
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, content);
    return sha256(content);
  }

  writeJson(rel, obj, expectedSha256) {
    return this.writeText(rel, JSON.stringify(obj, null, 2) + "\n", expectedSha256);
  }

  // Append one NDJSON line (ledger). Returns the appended object unchanged.
  appendNdjson(rel, obj) {
    const abs = this.resolve(rel);
    mkdirSync(dirname(abs), { recursive: true });
    appendFileSync(abs, JSON.stringify(obj) + "\n");
    return obj;
  }

  readNdjson(rel) {
    if (!this.exists(rel)) return [];
    return this.readText(rel)
      .split("\n")
      .filter((l) => l.trim())
      .map((l) => JSON.parse(l));
  }

  // Verify a content-addressed evidenceRef against what's on disk (§4 step 2).
  verifyEvidence(ref) {
    const abs = this.resolve(ref.path); // also runs the sandbox check
    if (!existsSync(abs)) return { ok: false, reason: "missing" };
    const actual = sha256(readFileSync(abs));
    if (actual !== ref.sha256) return { ok: false, reason: "sha256-mismatch", actual };
    return { ok: true };
  }

  unitPath(unitId) {
    return join("migration", "units", encodeURIComponent(unitId) + ".json");
  }
}
