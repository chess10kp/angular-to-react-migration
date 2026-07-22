#!/usr/bin/env bash
# migration/demo.sh — one-shot end-to-end demo: Angular before → loop → React after
# Usage:  bash migration/demo.sh
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ANGULAR_DIR="$REPO_ROOT/references/jhipster-ng17-fixture"
REACT_DIR="$REPO_ROOT/migration/app"

# ── helpers ──────────────────────────────────────────────────────────────────
wait_url() {
  local url="$1" label="$2" tries=60
  echo "  waiting for $label ($url)..."
  for _ in $(seq $tries); do
    curl -sf "$url" >/dev/null 2>&1 && { echo "  $label UP"; return 0; }
    sleep 1
  done
  echo "  ERROR: $label did not come up after ${tries}s" >&2; exit 1
}

kill_ports() { lsof -ti tcp:"$1" 2>/dev/null | xargs -r kill -9; }

# ── 0. cleanup any leftover servers ──────────────────────────────────────────
echo ""
echo "=== DEMO: Angular → agentic loop → React ==="
echo ""
kill_ports 4200; kill_ports 9000; kill_ports 5173; kill_ports 5174; kill_ports 5175

# ── A. Angular "before" ───────────────────────────────────────────────────────
echo "── A. Starting Angular dev server (port 9000 / 4200) ──"
( cd "$ANGULAR_DIR" && node_modules/.bin/ng serve --port 4200 ) &
NG_PID=$!
wait_url http://localhost:9000 "Angular"
echo ""
echo "  BEFORE: http://localhost:9000/campaign-demo"
echo "  (opens the campaign list — 3 mock campaigns, no auth required)"
echo ""

# ── B. React "after" ─────────────────────────────────────────────────────────
echo "── B. Starting React Vite dev server (port 5175) ──"
( cd "$REACT_DIR" && npm run dev ) &
VITE_PID=$!
wait_url http://localhost:5175 "React/Vite"
echo ""
echo "  AFTER:  http://localhost:5175/"
echo "  (same campaign list — migrated React component, same 3 campaigns)"
echo ""

# ── C. Loop narrative ─────────────────────────────────────────────────────────
echo "── C. Migration loop — residue status ──"
echo ""
echo "  Open residue items (all still open; the loop picks the highest-priority one):"
python3 -c "
import sys, json
for line in open('$REPO_ROOT/migration/residue.jsonl'):
    r = json.loads(line)
    if r['status'] == 'open':
        print(f\"    {r['id']} | {r['category']:12} | {r['file'].split('/')[-1]}\")
" 2>/dev/null || cat "$REPO_ROOT/migration/residue.jsonl" | grep '"open"' | head -10
echo ""
echo "  To run the agentic loop (requires authenticated 'claude' CLI on PATH):"
echo ""
echo "    cd $REPO_ROOT"
echo "    LOOP_APPLIER=agent npx tsx migration/loop/config.mts"
echo ""
echo "  Each iteration: pick → agent applies fix → tsc oracle verifies → commit"
echo "  See migration/RUN.md §Stage 3 for the full burndown protocol."
echo ""

# ── Done ──────────────────────────────────────────────────────────────────────
echo "── Both servers running. Press Ctrl-C to stop all. ──"
echo ""
echo "  BEFORE (Angular 17):  http://localhost:9000/campaign-demo"
echo "  AFTER  (React 18):    http://localhost:5175/"
echo ""
trap "kill $NG_PID $VITE_PID 2>/dev/null; exit 0" INT TERM
wait
