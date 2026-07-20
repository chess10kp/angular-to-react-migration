"""codemod-harness driver — the Jac brain.

This is the Angular 17 -> React codemod's orchestration layer, ported from the
former `src/cli.ts` + `src/transform*.ts`. All decision logic lives here:
file walking, template resolution, coverage counting, dispatch and reporting.
The irreducibly-JS AST steps (Angular/TS parse, JSX emit, prettier) are called
out to a thin Node worker over JSON — see `worker_client.jac` / `src/worker.ts`.

Modes (matching the old CLI):
  jac run codemod.jac -- <path...>               templates: .html   -> .jsx
  jac run codemod.jac -- --components <path...>   *.component.ts     -> .tsx
  jac run codemod.jac -- --services <path...>     *.service.ts       -> .service.react.ts
Flags: --dry-run (write nothing), --report (recurse + aggregate, implies dry-run)
       --ledger  (also write residue.jsonl — a stable, resumable per-residue record)
       --scaffold[=<dir>] (also emit a compilable Vite+React+TS project to compile
                           the migrated output against; default dir ./react-app)
       --recipes=<file>   (recipes ledger consults for suggested fixes; default recipes.jsonl)
       --learn=<spec.json> (capture a fix into recipes.jsonl and exit — see docs/recipe-schema.md)
"""

import sys;
import os;
import re;
import json;
import hashlib;
import from worker_client { Worker }

glob WK: Worker = Worker();


# ---------------------------------------------------------------------------
# Coverage walk over the Template IR (ported from transform.ts `walk`/`coverageOf`)
# ---------------------------------------------------------------------------

def walk_visit(nodes: list, counts: dict) {
    for n in nodes {
        counts["total"] += 1;
        t = n["type"];
        counts["byType"][t] = counts["byType"].get(t, 0) + 1;
        if t == "todo" {
            counts["todoNodes"] += 1;
        }
        if t == "element" {
            walk_visit(n["children"], counts);
        } elif t == "if" {
            for b in n["branches"] {
                walk_visit(b["children"], counts);
            }
        } elif t == "for" {
            walk_visit(n["children"], counts);
            if n.get("empty") {
                walk_visit(n["empty"], counts);
            }
        }
    }
}

def coverage_of(nodes: list, todo_reasons: list) -> dict {
    counts = {"total": 0, "byType": {}, "todoNodes": 0};
    walk_visit(nodes, counts);
    return {
        "nodes": counts["total"],
        "byType": counts["byType"],
        "todoNodes": counts["todoNodes"],
        "todoReasons": list(todo_reasons)
    };
}


# ---------------------------------------------------------------------------
# Template transform (ported from transform.ts)
# ---------------------------------------------------------------------------

def transform_template_to_expr(source: str, file_name: str) -> dict {
    parsed = WK.call("parseTemplate", {"source": source, "fileName": file_name});
    coverage = coverage_of(parsed["nodes"], parsed["todos"]);
    if len(parsed["errors"]) > 0 {
        return {
            "ok": False, "jsxExpr": "", "errors": parsed["errors"], "imports": [],
            "coverage": coverage, "usesTranslate": False, "helpers": []
        };
    }
    emitted = WK.call("emitTemplate", {"nodes": parsed["nodes"]});
    if len(emitted["todos"]) > 0 {
        coverage["todoReasons"] = coverage["todoReasons"] + emitted["todos"];
        coverage["todoNodes"] += len(emitted["todos"]);
    }
    return {
        "ok": True, "jsxExpr": emitted["code"], "errors": [],
        "imports": list(emitted["imports"]), "coverage": coverage,
        "usesTranslate": parsed["usesTranslate"], "helpers": parsed["helpers"]
    };
}

def transform_template(source: str, file_name: str) -> dict {
    raw = transform_template_to_expr(source, file_name);
    if not raw["ok"] {
        return {
            "ok": False, "jsx": "", "errors": raw["errors"], "imports": [],
            "coverage": raw["coverage"], "usesTranslate": False, "helpers": []
        };
    }
    wrapped = "const __template = " + raw["jsxExpr"] + ";\n";
    fmt = WK.call("format", {"code": wrapped, "parser": "babel-ts"});
    if not fmt["ok"] {
        return {
            "ok": False, "jsx": "", "errors": ["prettier failed: " + str(fmt["error"])],
            "imports": raw["imports"], "coverage": raw["coverage"],
            "usesTranslate": raw["usesTranslate"], "helpers": raw["helpers"]
        };
    }
    return {
        "ok": True, "jsx": fmt["code"], "errors": [], "imports": raw["imports"],
        "coverage": raw["coverage"], "usesTranslate": raw["usesTranslate"], "helpers": raw["helpers"]
    };
}


# ---------------------------------------------------------------------------
# Component transform (ported from transform-component.ts)
# ---------------------------------------------------------------------------

def transform_component(ts_source: str, ts_path: str) -> dict {
    parsed = WK.call("parseComponent", {"source": ts_source, "fileName": ts_path});
    if not parsed["model"] {
        return {
            "ok": False, "tsx": "", "errors": parsed["errors"], "todos": [],
            "templateCoverage": None, "templateSource": "none"
        };
    }
    model = parsed["model"];

    template_html = None;
    template_source = "none";
    if model["templateUrl"] {
        abs_path = os.path.normpath(os.path.join(os.path.dirname(ts_path), model["templateUrl"]));
        if os.path.exists(abs_path) {
            template_html = read_file(abs_path);
            template_source = "external";
        } else {
            return {
                "ok": False, "tsx": "",
                "errors": ["templateUrl not found: " + model["templateUrl"] + " (resolved " + abs_path + ")"],
                "todos": [], "templateCoverage": None, "templateSource": "none"
            };
        }
    } elif model["inlineTemplate"] {
        template_html = model["inlineTemplate"];
        template_source = "inline";
    }

    jsx_expr = "null";
    template_imports = [];
    template_coverage = None;
    uses_translate = False;
    helpers = [];
    todos = [];

    if template_html is not None {
        tname = model["templateUrl"] if model["templateUrl"] else (ts_path + "#inline");
        raw = transform_template_to_expr(template_html, tname);
        if not raw["ok"] {
            return {
                "ok": False, "tsx": "", "errors": raw["errors"], "todos": [],
                "templateCoverage": raw["coverage"], "templateSource": template_source
            };
        }
        jsx_expr = raw["jsxExpr"];
        template_imports = raw["imports"];
        template_coverage = raw["coverage"];
        uses_translate = raw["usesTranslate"];
        helpers = raw["helpers"];
        todos += raw["coverage"]["todoReasons"];
    } else {
        todos.append("no template (templateUrl/template) found on @Component");
    }

    emitted = WK.call("emitComponent", {
        "model": model,
        "opts": {
            "jsxExpr": jsx_expr, "templateImports": template_imports,
            "usesTranslate": uses_translate, "helpers": helpers
        }
    });
    todos += emitted["todos"];

    fmt = WK.call("format", {"code": emitted["code"], "parser": "babel-ts"});
    if not fmt["ok"] {
        return {
            "ok": False, "tsx": emitted["code"],
            "errors": ["prettier failed: " + str(fmt["error"])],
            "todos": todos, "templateCoverage": template_coverage, "templateSource": template_source
        };
    }
    return {
        "ok": True, "tsx": fmt["code"], "errors": [], "todos": todos,
        "templateCoverage": template_coverage, "templateSource": template_source
    };
}


# ---------------------------------------------------------------------------
# File helpers (ported from cli.ts `collect` + fs)
# ---------------------------------------------------------------------------

def read_file(path: str) -> str {
    with open(path, "r") as f {
        return f.read();
    }
}

def write_file(path: str, content: str) {
    with open(path, "w") as f {
        f.write(content);
    }
}

def collect(paths: list, kind: str) -> list {
    out = [];
    for p in paths {
        if os.path.isdir(p) {
            for (dirpath, dirs, files) in os.walk(p) {
                for name in files {
                    fp = os.path.join(dirpath, name);
                    if matches(fp, kind) {
                        out.append(fp);
                    }
                }
            }
        } elif matches(p, kind) {
            out.append(p);
        }
    }
    return sorted(out);
}

def matches(p: str, kind: str) -> bool {
    if kind == "html" {
        return p.endswith(".html");
    } elif kind == "component" {
        return p.endswith(".component.ts");
    } elif kind == "service" {
        return p.endswith(".service.ts") and not p.endswith(".service.spec.ts");
    }
    return False;
}


# ---------------------------------------------------------------------------
# Report (ported from cli.ts `printReport`)
# ---------------------------------------------------------------------------

def by_count(item: tuple) -> int {
    return item[1];
}

def print_report(outcomes: list, opts: dict) {
    agg = {};
    total_todo = 0;
    failed = 0;
    reason_counts = {};

    for o in outcomes {
        if not o["ok"] {
            failed += 1;
        }
        total_todo += o["todoNodes"];
        for (k, v) in o["byType"].items() {
            agg[k] = agg.get(k, 0) + v;
        }
        for reason in o["todoReasons"] {
            norm = re.sub(r"`[^`]*`", "`…`", reason);
            reason_counts[norm] = reason_counts.get(norm, 0) + 1;
        }
    }

    if opts["servicesMode"] {
        print("\n=== codemod-harness: service (@Injectable .service.ts) -> .service.react.ts ===");
    } elif opts["componentMode"] {
        print("\n=== codemod-harness: component (.component.ts + template) -> .tsx ===");
    } else {
        print("\n=== codemod-harness: template control-flow -> JSX ===");
    }
    print("files:        " + str(len(outcomes)));
    print("parsed ok:    " + str(len(outcomes) - failed));
    print("parse-failed: " + str(failed));
    print("residue (MIGRATION_TODO) nodes: " + str(total_todo));
    print("\nIR node coverage (by type):");
    for (k, v) in sorted(agg.items(), key=by_count, reverse=True) {
        print("  " + k.ljust(14) + " " + str(v));
    }

    if len(reason_counts) > 0 {
        print("\nResidue reasons (normalized):");
        for (k, v) in sorted(reason_counts.items(), key=by_count, reverse=True) {
            print("  " + str(v).rjust(4) + "  " + k);
        }
    }

    failed_files = [o for o in outcomes if not o["ok"]];
    if len(failed_files) > 0 {
        print("\nParse failures:");
        for o in failed_files {
            print("  " + o["file"] + "\n    " + "\n    ".join(o["errors"]));
        }
    }

    if opts["servicesMode"] {
        ext = ".service.react.ts";
    } elif opts["componentMode"] {
        ext = ".tsx";
    } else {
        ext = ".jsx";
    }
    if opts["dryRun"] {
        print("\n(dry-run: no files written)");
    } elif not opts["reportOnly"] {
        print("\nWrote sibling " + ext + " files.");
    }
}


# ---------------------------------------------------------------------------
# Residue ledger (`--ledger` -> residue.jsonl) — see docs/residue-schema.md
#
# A second pass over the already-assembled `outcomes` list. No worker calls,
# no re-parsing: it re-serializes the residue the codemod already computed into
# a stable, structured, resumable per-residue record. The reason strings that
# reach the driver are the bare `todos.push(...)` strings (NOT the inline
# `MIGRATION_TODO(cat)` comments), so `category` is derived from their stable
# prefixes. Component/service residue carries no span, so `span` is null and the
# stable id falls back to an in-file+category ordinal (schema §4).
# ---------------------------------------------------------------------------

def normalize_reason(reason: str) -> str {
    # identical to the reporter's cluster key (print_report / cli.ts:143)
    return re.sub(r"`[^`]*`", "`…`", reason);
}

def residue_category(reason: str) -> str {
    # component/service residue — stable prefixes from the emitters
    if reason.startswith("DI:") { return "di"; }
    if reason.startswith("async pipe") { return "async"; }
    if reason.startswith("state:") { return "state"; }
    if reason.startswith("rxjs:") { return "rxjs"; }
    if reason.startswith("forms:") { return "forms"; }
    if reason.startswith("viewchild:") { return "viewchild"; }
    if reason.startswith("pipe helpers referenced:") { return "helpers"; }
    if reason.startswith("generated OpenAPI client") { return "openapi"; }
    if reason.startswith("method ") {
        return "rename" if "is a JS reserved word" in reason else "this";
    }
    if reason.startswith("lifecycle ") {
        # `lifecycle X runs every change-detection cycle` is the one true
        # `lifecycle` residue; the ngOnInit/ngOnChanges/... ones become effects.
        return "lifecycle" if "runs every change-detection cycle" in reason else "effect";
    }
    # template residue — the driver lost the producing call site (all funnel to
    # string[]), so key off the emitter's fixed reason text where we can.
    if reason.startswith("expression not translatable to JS:") { return "tpl-expr"; }
    if reason.startswith("could not parse inline style") { return "tpl-style"; }
    if reason.startswith("unmappable event") { return "tpl-event"; }
    return "tpl-node";
}

def residue_fix_shape(category: str, reason: str) -> str {
    if category == "di" {
        return "di-provider" if "provide via a use" in reason else "di-hook";
    }
    shapes = {
        "effect": "effect-verify", "lifecycle": "effect-verify",
        "rxjs": "rxjs-subscribe", "state": "state-verify", "derived": "derived-verify",
        "forms": "form-port", "rename": "rename-callsites", "this": "this-rewire",
        "viewchild": "viewchild-ref", "helpers": "helper-impl", "async": "async-unwrap",
        "field": "field-init", "openapi": "openapi-regen"
    };
    return shapes.get(category, "tpl-manual");
}

def first_backtick(reason: str) -> str {
    m = re.search(r"`([A-Za-z0-9_$]+)`", reason);
    return m.group(1) if m else None;
}

def di_token(reason: str) -> str {
    m = re.search(r"inject\(([A-Za-z0-9_$]+)\)", reason);
    if m { return m.group(1); }
    m = re.search(r"`[A-Za-z0-9_$]+:\s*([A-Za-z0-9_$]+)`", reason);
    return m.group(1) if m else None;
}

def di_symbol(reason: str) -> str {
    # the injected property name — `account = inject(...)` or `router: Router`.
    m = re.search(r"`([A-Za-z0-9_$]+)\s*(?:=|:)", reason);
    return m.group(1) if m else None;
}

def this_members(reason: str) -> list {
    # member names in the `this.X` refs a `this`-residue still needs rewired,
    # e.g. "unresolved `this.account`, `this.router` (…)" -> [account, router].
    return re.findall(r"`this\.([A-Za-z0-9_$]+)`", reason);
}

def residue_reason_fields(category: str, reason: str) -> dict {
    # `text` is always the raw prose; the sub-fields are best-effort extractions
    # of data still recoverable from the string (schema §5, minimum-viable v1).
    out = {"text": reason};
    if category == "di" {
        sym = di_symbol(reason);
        tok = di_token(reason);
        if sym { out["symbol"] = sym; }
        if tok { out["token"] = tok; }
        out["via"] = "inject" if "inject(" in reason else "constructor";
    } elif category == "helpers" {
        m = re.search(r"referenced:\s*(.+?)\s+—", reason);
        if m { out["helpers"] = [h.strip() for h in m.group(1).split(",")]; }
    } elif category in ["rxjs", "state", "forms", "async", "viewchild", "rename", "this"] {
        sym = first_backtick(reason);
        if sym { out["symbol"] = sym; }
    }
    return out;
}

def residue_priority(category: str, token: str, token_fanout: dict) -> int {
    # "fix once, unblocks many": a DI token injected across N files scores N.
    if category == "openapi" { return 9; }
    if category == "di" and token and (token in token_fanout) {
        return max(1, len(token_fanout[token]));
    }
    return 1;
}

# ---------------------------------------------------------------------------
# Recipe induction (`--recipes` / `--learn`) — see docs/recipe-schema.md
#
# The agent's residue fixes are ephemeral: lost at session end, redone per app.
# A *recipe* captures the canonical fix for a residue cluster once, keyed by
# `category`/`fix_shape`/`cluster_id`, as a template with `$holes`. `--ledger`
# then renders the matching recipe for each residue occurrence into a `recipe`
# field, so a fix established (or learned via `--learn`) in one session is
# replayed as a concrete suggestion in the next. Generalization is deliberately
# split: the capable agent authors the template (or the mechanical anti-unifier
# below induces one from a before/after pair by blanking the cluster's backtick
# tokens — the exact spans `cluster_id` already normalizes). Recipes never edit
# the emitted `.tsx` (that stays byte-identical); they annotate the ledger only.
# ---------------------------------------------------------------------------

def seed_recipes() -> list {
    # Bundled base recipes distilled from the migrate-residue skill's canonical
    # fixes. Learned recipes in `recipes.jsonl` overlay these by `recipe_id`.
    return [
        {"recipe_id": "di-provider", "match": {"category": "di", "fix_shape": "di-provider"},
         "title": "Provide a ported service via a use<Token>() hook",
         "template": "// src/hooks/use$token.ts\nexport function use$token() {\n  // return the ported $token (context value / axios-backed client)\n}\n// in the component:\nconst $symbol = use$token();",
         "holes": ["symbol", "token"], "occurrences": 0, "examples": [], "source": "seed"},
        {"recipe_id": "di-hook", "match": {"category": "di", "fix_shape": "di-hook"},
         "title": "Replace an Angular DI token with its React hook",
         "template": "// $symbol was Angular DI; the emitter wrote the mapped hook\n// (Router->useNavigate, ActivatedRoute->useParams/useSearchParams,\n//  TranslateService->useTranslation, ElementRef->useRef). Rewrite call sites.",
         "holes": ["symbol"], "occurrences": 0, "examples": [], "source": "seed"},
        {"recipe_id": "async-unwrap", "match": {"category": "async", "fix_shape": "async-unwrap"},
         "title": "Unwrap an | async Observable into state",
         "template": "// $symbol was bound via `| async`. Unwrap once at component scope:\nconst [value, setValue] = useState<unknown>();\nuseEffect(() => {\n  const sub = $symbol.subscribe(setValue);\n  return () => sub.unsubscribe();\n}, []);\n// render {value} instead of the async pipe.",
         "holes": ["symbol"], "occurrences": 0, "examples": [], "source": "seed"},
        {"recipe_id": "rxjs-subscribe", "match": {"category": "rxjs", "fix_shape": "rxjs-subscribe"},
         "title": "Move a .subscribe() into a useEffect with teardown",
         "template": "// $symbol involves .subscribe(). Move it into an effect and unsubscribe:\nuseEffect(() => {\n  const sub = $symbol.subscribe((v) => {\n    /* land v in useState */\n  });\n  return () => sub.unsubscribe();\n}, []);",
         "holes": ["symbol"], "occurrences": 0, "examples": [], "source": "seed"},
        {"recipe_id": "state-verify", "match": {"category": "state", "fix_shape": "state-verify"},
         "title": "Verify a signal()->useState rewrite",
         "template": "// signal $symbol became useState. Verify call-site rewrites:\n//   $symbol()      -> $symbol\n//   $symbol.set(x) -> setter(x)\n//   $symbol.update(f) -> setter(f)",
         "holes": ["symbol"], "occurrences": 0, "examples": [], "source": "seed"},
        {"recipe_id": "effect-verify", "match": {"category": "effect", "fix_shape": "effect-verify"},
         "title": "Verify a lifecycle-hook useEffect",
         "template": "// $1 was an Angular lifecycle hook, emitted as useEffect. Verify the deps\n// array (defaults to []) and the timing, then remove this TODO.",
         "holes": ["$1"], "occurrences": 0, "examples": [], "source": "seed"},
        {"recipe_id": "viewchild-ref", "match": {"category": "viewchild", "fix_shape": "viewchild-ref"},
         "title": "Attach a ref for a @ViewChild",
         "template": "// @ViewChild $symbol -> useRef. In the component:\nconst ref = useRef<HTMLElement>(null);\n// attach ref={ref} in JSX; read ref.current (was $symbol.nativeElement).",
         "holes": ["symbol"], "occurrences": 0, "examples": [], "source": "seed"},
        {"recipe_id": "rename-callsites", "match": {"category": "rename", "fix_shape": "rename-callsites"},
         "title": "Update call sites of a renamed reserved-word method",
         "template": "// method $1 was renamed to $2 (JS reserved word). Update every template /\n// handler call site to the new name.",
         "holes": ["$1", "$2"], "occurrences": 0, "examples": [], "source": "seed"},
        {"recipe_id": "helper-impl", "match": {"category": "helpers", "fix_shape": "helper-impl"},
         "title": "Provide the referenced pipe helpers",
         "template": "// Provide implementations for the referenced pipe helpers: $helpers\n// (date->formatDate, number, currency, percent, titlecase).",
         "holes": ["helpers"], "occurrences": 0, "examples": [], "source": "seed"},
        {"recipe_id": "form-port", "match": {"category": "forms", "fix_shape": "form-port"},
         "title": "Port a reactive form to react-hook-form",
         "template": "// $symbol is an Angular reactive form. Port to react-hook-form:\nconst { register, handleSubmit, watch } = useForm();\n// map .get('x') to the registered field / watch('x').",
         "holes": ["symbol"], "occurrences": 0, "examples": [], "source": "seed"},
        {"recipe_id": "openapi-regen", "match": {"category": "openapi", "fix_shape": "openapi-regen"},
         "title": "Regenerate an OpenAPI client (do not hand-migrate)",
         "template": "// Regenerate this client from the OpenAPI spec as an axios client.\n// Do NOT hand-migrate; the Angular source is left for reference only.",
         "holes": [], "occurrences": 0, "examples": [], "source": "seed"},
        {"recipe_id": "tpl-manual", "match": {"fix_shape": "tpl-manual"},
         "title": "Hand-author JSX for an unsupported template construct",
         "template": "// Hand-author the JSX for this construct (unsupported node / expression /\n// event / inline style). Context: $1",
         "holes": ["$1"], "occurrences": 0, "examples": [], "source": "seed"}
    ];
}

def load_recipes(path: str) -> list {
    if not os.path.exists(path) { return []; }
    out = [];
    for line in read_file(path).splitlines() {
        if line.strip() { out.append(json.loads(line)); }
    }
    return out;
}

def recipe_set(explicit_path: str) -> list {
    # Bundled seeds are the base; learned recipes overlay them by `recipe_id`.
    by_id = {};
    ordered = [];
    for r in seed_recipes() + load_recipes(explicit_path) {
        rid = r.get("recipe_id");
        if rid in by_id {
            by_id[rid] = r;  # later (learned) wins
        } else {
            by_id[rid] = r;
            ordered.append(rid);
        }
    }
    return [by_id[rid] for rid in ordered];
}

def recipe_matches(recipe: dict, rec: dict) -> int {
    # Precedence score, higher = more specific. 0 = no match.
    m = recipe.get("match", {});
    if m.get("cluster_id") {
        return 3 if m["cluster_id"] == rec["cluster_id"] else 0;
    }
    if m.get("category") and (m["category"] != rec["category"]) { return 0; }
    if m.get("fix_shape") {
        return 2 if m["fix_shape"] == rec["fix_shape"] else 0;
    }
    return 1 if m.get("category") == rec["category"] else 0;
}

def backtick_tokens(reason: str) -> list {
    return re.findall(r"`([^`]+)`", reason);
}

def render_template(tpl: str, rec: dict) -> str {
    out = tpl;
    reason = rec["reason"];
    if reason.get("symbol") { out = out.replace("$symbol", reason["symbol"]); }
    if reason.get("token") { out = out.replace("$token", reason["token"]); }
    if reason.get("helpers") { out = out.replace("$helpers", ", ".join(reason["helpers"])); }
    # positional holes $1..$n from the raw backtick tokens, high-to-low so $10
    # is filled before $1.
    toks = backtick_tokens(reason["text"]);
    idx = len(toks);
    while idx > 0 {
        out = out.replace("$" + str(idx), toks[idx - 1]);
        idx -= 1;
    }
    return out;
}

def best_recipe(recipes: list, rec: dict) -> dict {
    best = None;
    best_score = 0;
    for r in recipes {
        s = recipe_matches(r, rec);
        if s > best_score {
            best = r;
            best_score = s;
        }
    }
    if not best { return None; }
    match_kind = "cluster_id" if best_score == 3 else ("category+fix_shape" if best_score == 2 else "category");
    return {
        "recipe_id": best.get("recipe_id"),
        "match": match_kind,
        "title": best.get("title", ""),
        "fix": render_template(best.get("template", ""), rec)
    };
}


# ---------------------------------------------------------------------------
# `--learn=<spec.json>` — capture an agent fix into recipes.jsonl
# ---------------------------------------------------------------------------

def induce_recipe(spec: dict) -> dict {
    # Two capture modes:
    #   agent-authored: {category?, fix_shape?, cluster_id?, template, ...}
    #   induced:        {reason, after, ...} -> anti-unify backtick tokens to $1..$n
    if "template" in spec {
        cluster = spec.get("cluster_id");
        rid = spec.get("recipe_id");
        if not rid { rid = spec.get("fix_shape"); }
        if not rid { rid = "learned-" + hashlib.sha1((cluster if cluster else spec.get("category", "")).encode("utf-8")).hexdigest()[0:8]; }
        crit = {};
        if cluster { crit["cluster_id"] = cluster; }
        if spec.get("category") { crit["category"] = spec["category"]; }
        if spec.get("fix_shape") { crit["fix_shape"] = spec["fix_shape"]; }
        return {
            "recipe_id": rid, "match": crit, "title": spec.get("title", ""),
            "holes": spec.get("holes", []), "template": spec["template"],
            "notes": spec.get("notes", ""), "occurrences": 1,
            "examples": spec.get("examples", []), "source": "learned"
        };
    }
    reason = spec["reason"];
    after = spec["after"];
    cluster = normalize_reason(reason);
    toks = backtick_tokens(reason);
    tpl = after;
    i = 0;
    for t in toks {
        i += 1;
        tpl = re.sub(r"\b" + re.escape(t) + r"\b", "$" + str(i), tpl);
    }
    cat = residue_category(reason);
    return {
        "recipe_id": "learned-" + hashlib.sha1(cluster.encode("utf-8")).hexdigest()[0:8],
        "match": {"cluster_id": cluster, "category": cat, "fix_shape": residue_fix_shape(cat, reason)},
        "title": spec.get("title", ""), "holes": ["$" + str(k + 1) for k in range(len(toks))],
        "template": tpl, "notes": spec.get("notes", ""), "occurrences": 1,
        "examples": spec.get("examples", []), "source": "learned"
    };
}

def upsert_recipe(recipes: list, new: dict) -> list {
    out = [];
    found = False;
    for r in recipes {
        if r.get("recipe_id") == new["recipe_id"] {
            merged = dict(r);
            merged["occurrences"] = r.get("occurrences", 1) + 1;
            ex = list(r.get("examples", []));
            for e in new.get("examples", []) {
                if e not in ex { ex.append(e); }
            }
            merged["examples"] = ex;
            merged["template"] = new["template"];
            merged["match"] = new["match"];
            if new.get("title") { merged["title"] = new["title"]; }
            if new.get("notes") { merged["notes"] = new["notes"]; }
            out.append(merged);
            found = True;
        } else {
            out.append(r);
        }
    }
    if not found { out.append(new); }
    return out;
}

def recipe_id_key(r: dict) -> str {
    return r.get("recipe_id", "");
}

def learn(spec_path: str, recipes_path: str) {
    raw = json.loads(read_file(spec_path));
    specs = raw if isinstance(raw, list) else [raw];
    recipes = load_recipes(recipes_path);
    learned = 0;
    for spec in specs {
        recipes = upsert_recipe(recipes, induce_recipe(spec));
        learned += 1;
    }
    ordered = sorted(recipes, key=recipe_id_key);
    write_file(recipes_path, "\n".join([json.dumps(r) for r in ordered]) + ("\n" if len(ordered) > 0 else ""));
    print("Learned " + str(learned) + " recipe(s); " + recipes_path + " now holds " + str(len(ordered)) + ".");
}


def build_ledger(outcomes: list, mode: str, recipes: list) -> list {
    # First pass: DI token fan-out across all files (the one cross-file signal).
    token_fanout = {};
    for o in outcomes {
        for reason in o["todoReasons"] {
            if residue_category(reason) == "di" {
                tok = di_token(reason);
                if tok {
                    if tok not in token_fanout { token_fanout[tok] = {}; }
                    token_fanout[tok][o["file"]] = True;
                }
            }
        }
    }

    records = [];
    for o in outcomes {
        file = o["file"].replace("\\", "/");
        ordinals = {};  # (category) -> next ordinal within this file
        for reason in o["todoReasons"] {
            cat = residue_category(reason);
            norm = normalize_reason(reason);
            ordinal = ordinals.get(cat, 0);
            ordinals[cat] = ordinal + 1;
            key = " ".join([file, "#" + str(ordinal), cat, norm]);
            rid = hashlib.sha1(key.encode("utf-8")).hexdigest()[0:8];
            tok = di_token(reason) if cat == "di" else None;
            record = {
                "id": rid,
                "file": file,
                "span": None,
                "category": cat,
                "fix_shape": residue_fix_shape(cat, reason),
                "reason": residue_reason_fields(cat, reason),
                "cluster_id": norm,
                "deps": [],
                "priority": residue_priority(cat, tok, token_fanout),
                "status": "open",
                "mode": mode
            };
            # Recipe induction (#2): a past/curated fix for this cluster, rendered
            # for this occurrence, so the agent's work compounds across sessions.
            hint = best_recipe(recipes, record);
            if hint { record["recipe"] = hint; }
            records.append(record);
        }
    }

    # deps (#3, driver-side): a `this` residue is blocked until the di/state
    # residue in the SAME file that provides each member it still references is
    # fixed (the skill's "fix the provider first" rule, made machine-readable).
    # Scoped to `this` -> di/state joins in v1; span stays null (needs emitter
    # offsets — a worker change that would break byte-identical output).
    provider = {};  # file -> {symbol -> id}; first provider of a symbol wins.
    for rec in records {
        if rec["category"] in ["di", "state"] {
            sym = rec["reason"].get("symbol");
            if sym {
                if rec["file"] not in provider { provider[rec["file"]] = {}; }
                if sym not in provider[rec["file"]] { provider[rec["file"]][sym] = rec["id"]; }
            }
        }
    }
    for rec in records {
        if rec["category"] == "this" {
            idx = provider.get(rec["file"], {});
            deps = [];
            for mname in this_members(rec["reason"]["text"]) {
                if (mname in idx) and (idx[mname] not in deps) { deps.append(idx[mname]); }
            }
            if deps { rec["deps"] = sorted(deps); }
        }
    }
    return records;
}

def by_ledger_key(rec: dict) -> tuple {
    return (rec["file"], rec["category"], rec["id"]);
}

def write_ledger(records: list, mode: str, path: str) {
    # Stable merge (schema §7): preserve `status` for ids that reappear this run,
    # drop current-mode ids no longer produced (that IS burn-down), and leave
    # other-mode records untouched so a full ledger accumulates across modes.
    kept = [];
    prior_status = {};
    if os.path.exists(path) {
        for line in read_file(path).splitlines() {
            if not line.strip() { continue; }
            old = json.loads(line);
            if old.get("mode") == mode {
                prior_status[old["id"]] = old.get("status", "open");
            } else {
                kept.append(old);
            }
        }
    }
    for rec in records {
        if rec["id"] in prior_status {
            rec["status"] = prior_status[rec["id"]];
        }
    }
    merged = sorted(kept + records, key=by_ledger_key);
    lines = [json.dumps(rec) for rec in merged];
    write_file(path, "\n".join(lines) + ("\n" if len(lines) > 0 else ""));
    print("\nWrote " + path + " (" + str(len(records)) + " residue records this run, " + str(len(merged)) + " total).");
}


# ---------------------------------------------------------------------------
# Compilable scaffold (`--scaffold[=<dir>]`) — see docs/scaffold.md
#
# The codemod writes sibling `.tsx`/`.service.react.ts` files into the Angular
# tree, but there is nothing to compile them against — so the operator agent's
# superpower (run `tsc --noEmit` / tests itself) has no target. This pass emits
# a minimal, self-contained Vite + React + TS project whose `tsconfig` `include`s
# the migrated files. The remaining residue then surfaces as *real compiler
# errors* the agent can burn down against a green build. Static content only —
# no worker calls; a new sidecar behind a new flag (same shape as `--ledger`).
# ---------------------------------------------------------------------------

def scaffold_includes(dir: str, paths: list) -> list {
    # tsconfig `include` globs: the scaffold's own src + the migrated output.
    globs = ["src"];
    for p in paths {
        rel = os.path.relpath(p, dir).replace("\\", "/");
        if os.path.isfile(p) {
            globs.append(rel);
        } else {
            globs.append(rel + "/**/*.tsx");
            globs.append(rel + "/**/*.service.react.ts");
        }
    }
    return globs;
}

def scaffold_files(dir: str, paths: list) -> dict {
    # Returns {relative-path: contents}. Deps match the migration target
    # (React-Bootstrap, react-router, react-i18next, axios).
    pkg = {
        "name": "migrated-react-app",
        "private": True,
        "version": "0.0.0",
        "type": "module",
        "scripts": {
            "dev": "vite",
            "build": "tsc && vite build",
            "typecheck": "tsc --noEmit",
            "preview": "vite preview"
        },
        "dependencies": {
            "axios": "^1.7.0",
            "bootstrap": "^5.3.0",
            "i18next": "^23.11.0",
            "react": "^18.3.0",
            "react-bootstrap": "^2.10.0",
            "react-dom": "^18.3.0",
            "react-i18next": "^14.1.0",
            "react-router-dom": "^6.23.0"
        },
        "devDependencies": {
            "@types/react": "^18.3.0",
            "@types/react-dom": "^18.3.0",
            "@vitejs/plugin-react": "^4.3.0",
            "typescript": "^5.4.5",
            "vite": "^5.2.0"
        }
    };
    tsconfig = {
        "compilerOptions": {
            "target": "ES2020",
            "useDefineForClassFields": True,
            "lib": ["ES2020", "DOM", "DOM.Iterable"],
            "module": "ESNext",
            "skipLibCheck": True,
            "moduleResolution": "Bundler",
            "baseUrl": ".",
            # The migrated files are emitted in-place in the Angular tree, i.e.
            # OUTSIDE this scaffold — so Node resolution can't walk up to this
            # project's node_modules. Route every bare import back here. Relative
            # imports (sibling migrated files) are untouched; unresolved app deps
            # like `@angular/*` still fail (correctly — that IS residue). `@types`
            # is tried first so `react` resolves to its declaration package.
            "paths": {"*": ["./node_modules/@types/*", "./node_modules/*"]},
            "resolveJsonModule": True,
            "isolatedModules": True,
            "noEmit": True,
            "jsx": "react-jsx",
            "strict": True,
            "noUnusedLocals": False,
            "esModuleInterop": True,
            "forceConsistentCasingInFileNames": True
        },
        "include": scaffold_includes(dir, paths),
        "references": [{"path": "./tsconfig.node.json"}]
    };
    tsconfig_node = {
        "compilerOptions": {
            "composite": True,
            "skipLibCheck": True,
            "module": "ESNext",
            "moduleResolution": "Bundler",
            "allowSyntheticDefaultImports": True,
            "strict": True
        },
        "include": ["vite.config.ts"]
    };
    vite_config = "import { defineConfig } from 'vite';\n"
        + "import react from '@vitejs/plugin-react';\n\n"
        + "// https://vitejs.dev/config/\n"
        + "export default defineConfig({ plugins: [react()] });\n";
    index_html = "<!doctype html>\n<html lang=\"en\">\n  <head>\n"
        + "    <meta charset=\"UTF-8\" />\n"
        + "    <meta name=\"viewport\" content=\"width=device-width, initial-scale=1.0\" />\n"
        + "    <title>Migrated React app</title>\n  </head>\n  <body>\n"
        + "    <div id=\"root\"></div>\n"
        + "    <script type=\"module\" src=\"/src/main.tsx\"></script>\n"
        + "  </body>\n</html>\n";
    main_tsx = "import React from 'react';\n"
        + "import { createRoot } from 'react-dom/client';\n"
        + "import { BrowserRouter } from 'react-router-dom';\n"
        + "import 'bootstrap/dist/css/bootstrap.min.css';\n"
        + "import './i18n';\n"
        + "import { App } from './App';\n\n"
        + "createRoot(document.getElementById('root')!).render(\n"
        + "  <React.StrictMode>\n"
        + "    <BrowserRouter>\n"
        + "      <App />\n"
        + "    </BrowserRouter>\n"
        + "  </React.StrictMode>,\n"
        + ");\n";
    app_tsx = "export function App() {\n"
        + "  return (\n"
        + "    <div className=\"container\">\n"
        + "      {/* MIGRATION_TODO: wire migrated routes / components in here. */}\n"
        + "      <h1>Migrated app shell</h1>\n"
        + "    </div>\n"
        + "  );\n}\n";
    i18n_ts = "import i18n from 'i18next';\n"
        + "import { initReactI18next } from 'react-i18next';\n\n"
        + "// Minimal init so `useTranslation()` works in migrated components.\n"
        + "// Load real resource bundles (the Angular assets/i18n JSON) here.\n"
        + "i18n.use(initReactI18next).init({\n"
        + "  resources: {},\n"
        + "  lng: 'en',\n"
        + "  fallbackLng: 'en',\n"
        + "  interpolation: { escapeValue: false },\n"
        + "});\n\n"
        + "export default i18n;\n";
    vite_env = "/// <reference types=\"vite/client\" />\n";
    gitignore = "node_modules\ndist\n*.local\n";
    readme = "# Migrated React app (codemod scaffold)\n\n"
        + "Generated by `codemod-harness --scaffold`. It exists so you can **compile\n"
        + "and test the migrated output** — the codemod writes sibling `.tsx` /\n"
        + "`.service.react.ts` files into the Angular tree, and this project's\n"
        + "`tsconfig.json` `include`s them (see the globs there).\n\n"
        + "```sh\n"
        + "npm install\n"
        + "npm run typecheck   # tsc --noEmit — this is the residue gate\n"
        + "npm run dev         # Vite dev server\n"
        + "```\n\n"
        + "The remaining `MIGRATION_TODO`s surface here as **real compiler errors**\n"
        + "(unresolved `use<Service>()` hooks, unwrapped Observables, etc.). Burn them\n"
        + "down until `npm run typecheck` is green; that green build is what the old\n"
        + "\"verify by inspection\" step could never give you.\n\n"
        + "Notes:\n"
        + "- Template-mode `.jsx` fragments are **not** included (they are partial JSX\n"
        + "  expressions, not modules). Component `.tsx` and `.service.react.ts` are.\n"
        + "- `src/i18n.ts` is a stub — point it at the real translation bundles.\n"
        + "- `src/App.tsx` is an empty shell — wire the migrated routes/components in.\n";
    return {
        "package.json": json.dumps(pkg, indent=2) + "\n",
        "tsconfig.json": json.dumps(tsconfig, indent=2) + "\n",
        "tsconfig.node.json": json.dumps(tsconfig_node, indent=2) + "\n",
        "vite.config.ts": vite_config,
        "index.html": index_html,
        "src/main.tsx": main_tsx,
        "src/App.tsx": app_tsx,
        "src/i18n.ts": i18n_ts,
        "src/vite-env.d.ts": vite_env,
        ".gitignore": gitignore,
        "README.md": readme
    };
}

def write_scaffold(dir: str, paths: list) {
    files = scaffold_files(dir, paths);
    wrote = 0;
    skipped = 0;
    for (rel, content) in files.items() {
        target = os.path.join(dir, rel);
        parent = os.path.dirname(target);
        if parent and (not os.path.exists(parent)) {
            os.makedirs(parent);
        }
        # Never clobber operator edits: skip files that already exist.
        if os.path.exists(target) {
            skipped += 1;
            continue;
        }
        write_file(target, content);
        wrote += 1;
    }
    print("\nScaffold: wrote " + str(wrote) + " file(s) to " + dir
        + (" (" + str(skipped) + " kept — already present)" if skipped > 0 else "")
        + ".\n  cd " + dir + " && npm install && npm run typecheck");
}


# ---------------------------------------------------------------------------
# Output path helpers (ported from cli.ts writeFileSync targets)
# ---------------------------------------------------------------------------

def out_path(file: str, src_ext: str, dst_ext: str) -> str {
    base = os.path.basename(file);
    if base.endswith(src_ext) {
        stem = base[: len(base) - len(src_ext)];
    } else {
        stem = base;
    }
    return os.path.join(os.path.dirname(file), stem + dst_ext);
}


# ---------------------------------------------------------------------------
# Entry (ported from cli.ts `run`)
# ---------------------------------------------------------------------------

with entry {
    argv = sys.argv[1:];
    component_mode = "--components" in argv;
    services_mode = "--services" in argv;
    dry_run = "--dry-run" in argv;
    report_only = "--report" in argv;
    ledger = "--ledger" in argv;
    scaffold_dir = None;
    recipes_path = "recipes.jsonl";
    learn_spec = None;
    for a in argv {
        if a == "--scaffold" { scaffold_dir = "react-app"; }
        elif a.startswith("--scaffold=") { scaffold_dir = a[len("--scaffold="):]; }
        elif a.startswith("--recipes=") { recipes_path = a[len("--recipes="):]; }
        elif a.startswith("--learn=") { learn_spec = a[len("--learn="):]; }
    }

    # `--learn` is a standalone action: capture a fix into recipes.jsonl and exit.
    if learn_spec {
        learn(learn_spec, recipes_path);
        WK.close();
        sys.exit(0);
    }

    paths = [a for a in argv if not a.startswith("--")];

    if len(paths) == 0 {
        print("usage: codemod [--components|--services] [--dry-run|--report] <path...>", file=sys.stderr);
        WK.close();
        sys.exit(2);
    }

    outcomes = [];

    if services_mode {
        for file in collect(paths, "service") {
            r = WK.call("transformService", {"source": read_file(file), "path": file});
            # A .service.ts without an @Injectable class is not a service; skip.
            if (not r["ok"]) and (r["model"] is None) {
                continue;
            }
            gen = r["model"] and r["model"]["generated"];
            reasons = ["generated OpenAPI client (regenerate, not migrated)"] if gen else r["todos"];
            outcomes.append({
                "file": file, "ok": r["ok"], "errors": r["errors"],
                "todoNodes": len(r["todos"]), "todoReasons": reasons, "byType": {}
            });
            if r["ok"] and (not dry_run) and (not report_only) {
                write_file(out_path(file, ".service.ts", ".service.react.ts"), r["ts"]);
            }
        }
    } elif component_mode {
        for file in collect(paths, "component") {
            r = transform_component(read_file(file), file);
            cov = r["templateCoverage"];
            by_type = cov["byType"] if cov else {};
            outcomes.append({
                "file": file, "ok": r["ok"], "errors": r["errors"],
                "todoNodes": len(r["todos"]), "todoReasons": r["todos"], "byType": by_type
            });
            if r["ok"] and (not dry_run) and (not report_only) {
                write_file(out_path(file, ".component.ts", ".tsx"), r["tsx"]);
            }
        }
    } else {
        for file in collect(paths, "html") {
            r = transform_template(read_file(file), file);
            cov = r["coverage"];
            outcomes.append({
                "file": file, "ok": r["ok"], "errors": r["errors"],
                "todoNodes": cov["todoNodes"], "todoReasons": cov["todoReasons"], "byType": cov["byType"]
            });
            if r["ok"] and (not dry_run) and (not report_only) {
                write_file(out_path(file, ".html", ".jsx"), r["jsx"]);
            }
        }
    }

    print_report(outcomes, {
        "dryRun": dry_run, "reportOnly": report_only,
        "componentMode": component_mode, "servicesMode": services_mode
    });

    if ledger {
        mode = "service" if services_mode else ("component" if component_mode else "template");
        recipes = recipe_set(recipes_path);
        write_ledger(build_ledger(outcomes, mode, recipes), mode, "residue.jsonl");
    }

    if scaffold_dir {
        write_scaffold(scaffold_dir, paths);
    }

    WK.close();

    failed_any = False;
    for o in outcomes {
        if not o["ok"] {
            failed_any = True;
        }
    }
    if failed_any {
        sys.exit(1);
    }
}
