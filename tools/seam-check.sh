#!/usr/bin/env bash
# tools/seam-check.sh — the seam is grep-provable. Any FAIL line = auto-fail.
# Single source of truth for the seam boundaries in HARNESS-EXECUTION-PLAN.md §5.
# Checks IMPORT statements (not comments or identifiers), matched to the ACTUAL seam.
# Exit non-zero if any check fails, so it can gate CI / a milestone GATE task.
set -uo pipefail
cd "$(dirname "$0")/.." || exit 2

fail=0
report() { if [ -n "$1" ]; then echo "$2"; echo "$1" | sed 's/^/    /'; fail=1; fi; }

# Grep only real import specifiers: `from '<pkg>'` (ts/js module imports).
imports_of() { grep -rlE "from ['\"]$1['\"]" "$2" 2>/dev/null; }

# --- Harness A: codemod-harness ---
# The true seam (verified against the tree, 2026-07):
#   @angular/compiler: templates in src/parse/, expressions in src/expr-ast.ts (the A.4 seam).
#   ts-morph:          components in src/parse/, services in src/transform-service.ts,
#                      and the Node worker src/worker.ts (JSON-RPC JS-AST steps).
#   @babel/*:          only src/emit/.
A=tools/codemod-harness/src
if [ -d "$A" ]; then
  report "$(imports_of '@angular/compiler' "$A" | grep -vE '/parse/|/expr-ast\.ts$')" \
    "A1 FAIL: @angular/compiler imported outside src/parse/ or src/expr-ast.ts"
  report "$(imports_of 'ts-morph' "$A" | grep -vE '/parse/|/transform-service\.ts$|/worker\.ts$')" \
    "A1 FAIL: ts-morph imported outside src/parse/, transform-service.ts, worker.ts"
  report "$(imports_of '@babel/[a-z-]*' "$A" | grep -vE '/emit/|/worker\.ts$')" \
    "A2 FAIL: @babel/* imported outside src/emit/ (worker re-exports emit)"
  report "$(grep -rlE "from ['\"]\.\./(parse|emit)/" "$A/ir" 2>/dev/null)" \
    "A3 FAIL: src/ir/ imports from parse/ or emit/"
  # Generality: fixture-specific tokens in transform LOGIC. jhiTranslate is KNOWN pre-existing
  # debt (slice 3) tracked as queue row A-DEBT-1 (move to a mapping table); allowlisted until then.
  report "$(grep -riE 'jhi|jhipster' "$A" | grep -viE 'jhitranslate|translatevalues')" \
    "A8 FAIL: fixture-specific token (jhi/jhipster) in src/ (jhiTranslate is tracked debt, see A-DEBT-1)"
fi

# --- Harness B: parity-harness ---
# The neutral core may NAME the react/angular sides as variables; it may not IMPORT frameworks.
B=tools/parity-harness/src
if [ -d "$B" ]; then
  core=""
  for f in runner diff gate normalize contract; do
    [ -f "$B/$f.ts" ] && core="$core $B/$f.ts"
  done
  if [ -n "$core" ]; then
    report "$(grep -lE "from ['\"](@angular/|react|react-dom)" $core 2>/dev/null)" \
      "B1 FAIL: framework import in the neutral core (runner/diff/gate/normalize/contract)"
  fi
  report "$(grep -rn 'innerHTML' "$B" | grep -v '/adapters/')" \
    "B3 FAIL: raw HTML/innerHTML comparison outside src/adapters/"
fi

# --- Harness C: migration loop (firewall is grep-provable) ---
# These activate once migration/loop/ exists; silent no-op before then.
C=migration
if [ -d "$C/loop" ]; then
  # C1: only the offline promote gate may write the 'promoted' status string.
  report "$(grep -rln "'promoted'" "$C/loop" 2>/dev/null | grep -vE '/(README|contracts|store\.mts|store\.test|quarantine)')" \
    "C1 FAIL: 'promoted' written outside evaluate-candidate.mts (promotion is offline-only)"
  # C2: the loop must never write the shared trusted artifacts directly.
  report "$(grep -rlnE "(writeFile|appendFile|createWriteStream)[^)]*facts\.md" "$C/loop" 2>/dev/null | grep -v store\.test)" \
    "C2 FAIL: loop writes facts.md directly (must go via facts-proposals.jsonl + offline PR)"
  report "$(grep -rlnE "(writeFile|appendFile|createWriteStream)[^)]*recipes/" "$C/loop" 2>/dev/null)" \
    "C2 FAIL: loop writes migration/recipes/ directly (promotion is a human step)"
  # C3: the driver depends on interfaces, not concrete impls (only contracts + std libs).
  if [ -f "$C/loop/driver.mts" ]; then
    report "$(grep -nE "from ['\"]\./(picker|store|committer|retry|oracles)" "$C/loop/driver.mts" 2>/dev/null)" \
      "C3 FAIL: driver.mts imports a concrete impl (must import only ./contracts + go via config.mts)"
  fi
fi

if [ "$fail" -eq 0 ]; then
  echo "seam-check: OK (the seam holds)"
else
  echo "seam-check: FAILED — fix the seam, not the check."
fi
exit "$fail"
