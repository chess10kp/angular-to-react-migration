"""JSON-RPC client for the Node parse/emit worker.

Spawns `node dist/worker.js` once and talks line-delimited JSON to it. The
worker owns only the JS-AST steps (Angular/TS parse, JSX emit, prettier); every
decision above that lives in Jac (see `codemod.jac`).
"""

import subprocess;
import json;
import os;
import from typing { Any }


obj Worker {
    has proc: Any = None;
    has next_id: int = 1;

    def start {
        # dist/worker.js sits one level up from this jac/ dir.
        here = os.path.dirname(os.path.abspath(__file__));
        worker_js = os.path.join(here, os.pardir, "dist", "worker.js");
        self.proc = subprocess.Popen(
            ["node", worker_js],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            text=True,
            bufsize=1
        );
    }

    def call(method: str, params: dict) -> dict {
        if self.proc is None {
            self.start();
        }
        req_id = self.next_id;
        self.next_id += 1;
        line = json.dumps({"id": req_id, "method": method, "params": params});
        self.proc.stdin.write(line + "\n");
        self.proc.stdin.flush();
        raw = self.proc.stdout.readline();
        if not raw {
            raise RuntimeError("worker exited unexpectedly");
        }
        resp = json.loads(raw);
        if not resp["ok"] {
            raise RuntimeError("worker error in " + method + ": " + str(resp.get("error")));
        }
        return resp["result"];
    }

    def close {
        if self.proc is not None {
            self.proc.stdin.close();
            self.proc.wait();
            self.proc = None;
        }
    }
}
