# Recipe store schema (`recipes.jsonl`)

**Status:** implemented (`jac/codemod.jac` — `seed_recipes`, `recipe_set`,
`best_recipe`, `render_template`, `induce_recipe`, `learn`). This is item #2 of
the migration-system plan (see [`migration-system-rationale.md`](./migration-system-rationale.md)):
**capture agent fixes so the work compounds** instead of being redone per app.

## Why

The agent's residue fixes are ephemeral — lost at session end, re-derived for the
next component, the next app. A *recipe* records the canonical fix for a residue
**cluster** once, as a template with named holes. `--ledger` then renders the
matching recipe for each residue occurrence into a `recipe` field, so a fix
established in one session is replayed as a concrete, specialized suggestion in
the next.

Recipes **never edit the emitted `.tsx`** — that output stays byte-identical
(same guarantee as `--ledger`/`--scaffold`). They annotate the ledger only; the
capable agent still applies the fix. The generalization split is deliberate:

- The **agent authors** the template (it generalizes better than any mechanical
  pass), or
- the **mechanical anti-unifier** induces one from a `before`/`after` pair by
  blanking the cluster's backtick tokens — the exact spans `cluster_id` already
  normalizes (`docs/residue-schema.md` §1).

## Record shape

One JSON object per line in `recipes.jsonl`:

```jsonc
{
  "recipe_id": "di-provider",        // stable key; learned ones: "learned-<sha1(cluster)[:8]>"
  "match": {                         // how a residue record is matched (precedence below)
    "category": "di",
    "fix_shape": "di-provider",
    "cluster_id": "…"                // optional; when present, an exact-cluster match
  },
  "title": "Provide a ported service via a use<Token>() hook",
  "template": "// src/hooks/use$token.ts\nexport function use$token() { … }\nconst $symbol = use$token();",
  "holes": ["symbol", "token"],      // documentation of the holes used
  "occurrences": 3,                  // bumped each --learn of the same recipe_id
  "examples": ["b4c2a4f6"],          // residue ids this was learned/confirmed from
  "source": "seed" | "learned"
}
```

### Holes

`render_template` fills, from the residue record's `reason` sub-fields and raw text:

| Hole | Filled from |
|---|---|
| `$symbol` | `reason.symbol` (e.g. the injected prop, signal name, form field) |
| `$token` | `reason.token` (the DI token / service class) |
| `$helpers` | `reason.helpers` joined with `, ` |
| `$1 … $n` | the ordered backtick tokens in `reason.text` (`$n` filled before `$1`) |

Unfilled holes are left verbatim (visible, not silently dropped).

## Matching & precedence

`best_recipe` scores every recipe against a residue record and takes the highest:

1. **`cluster_id`** exact match — score **3** (most specific).
2. **`category` + `fix_shape`** — score **2**.
3. **`category`** only, or **`fix_shape`** only — score **1**.

So a learned recipe keyed on the precise `cluster_id` overrides a broad seed for
the same `fix_shape`. Ties keep the first (seeds come before learned in the set).

## The recipe set

`recipe_set(path)` = **bundled seeds** (`seed_recipes()`, distilled from the
`migrate-residue` skill's canonical fixes — one per `fix_shape`) overlaid by
**learned recipes** from `recipes.jsonl` (matched by `recipe_id`; learned wins).
So seeds always provide a floor, and `--learn` refines them in place.

## `--learn=<spec.json>` — capture

`jac run jac/codemod.jac -- --learn=<spec.json> [--recipes=<file>]` reads a spec
(a single object or a list), upserts each into `recipes.jsonl` (default), then
exits. Two spec shapes:

**Agent-authored** — you write the generalized template:
```json
{ "category": "di", "fix_shape": "di-provider", "title": "Context-provider variant",
  "template": "const $symbol = useContext($tokenContext);", "holes": ["symbol","token"],
  "examples": ["af12c297"] }
```

**Induced** — the anti-unifier generalizes a concrete fix:
```json
{ "reason": "async pipe on `user$` — unwrap the Observable/Promise …",
  "after": "const user$Value = useObservable(user$);",
  "title": "Unwrap via useObservable hook", "examples": ["b4c2a4f6"] }
```
→ blanks the backtick token `user$` to `$1`, keys the recipe on the normalized
`cluster_id`, stores `const $1Value = useObservable($1);`.

Upsert semantics: same `recipe_id` → `occurrences++`, `examples` unioned, latest
`template`/`match`/`title`/`notes` win.

## Honest limits (v1)

- **Anti-unification is whole-word backtick-token replacement.** It is exactly as
  precise as the `cluster_id` normalization — no scope/binding analysis. A token
  that is a substring pattern of another identifier (`user$` inside `user$Value`)
  is templated too; it round-trips for that occurrence but review before trusting
  a learned template across clusters. Agent-authored templates avoid this.
- Recipes are **suggestions rendered into the ledger**, not auto-applied edits.
  Auto-application would require re-emitting through the worker (a later step).
- `$symbol`/`$token` extraction is the same best-effort string parse the ledger
  uses (`docs/residue-schema.md` §5); unextractable holes stay literal.
