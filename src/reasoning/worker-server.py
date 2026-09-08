"""Persistent local Python worker for LatentForge's live backends.

This process is an execution optimization only, never a second
implementation of the model. It imports the three existing standalone
runner modules (recurrent-runner.py, hrm-inspired-runner.py,
bdh-cq-inspired-runner.py) by file path and reuses their own `execute()`
and `build_parameters()` functions unchanged — the math, seeds, parameter
draw order, and precision are exactly what those files already define and
what their own direct-spawn tests already cover.

Contract (line-delimited JSON over stdin/stdout):
  - stdout carries protocol messages ONLY, one JSON object per line, flushed
    immediately. All diagnostics go to stderr. A stray `print()` anywhere in
    the imported runner modules would corrupt this protocol, which is why
    every runner's own error paths already write structured errors rather
    than printing free text, and why this file is the only thing permitted
    to write to stdout after startup.
  - First line on success: {"ready": true, "environment": {...}}
  - First line on failure: {"ready": false, "error": {"code", "message"}}
    followed by a non-zero exit.
  - Each request line: {"requestId", "backend", "payload"}
  - Each response line: {"requestId", "ok": true, "backend", "result"}
    or {"requestId", "ok": false, "error": {"code", "message"}}

Each backend's fixed parameters are built exactly once here, at startup,
using that backend's own `build_parameters()` — reusing the same explicit
seed, `torch.manual_seed` call, and sequential `torch.randn` draw order the
standalone runner already uses. This is the one behavior change this file
introduces: parameter construction moves from "once per request" to "once
per worker lifetime." It is safe only because it is deterministic (same
seed, same draw order, same dtype) and is verified, not assumed, by
`test/worker-client.test.js`, which diffs a live persistent-worker response
against the same request run through the untouched standalone runner.

No per-request mutable mixing of state occurs across backends or across
calls: `execute()` in every runner allocates its own local state tensors
(`h`, `low`/`high`, `S`/`H`) fresh inside the call using only the shared
*parameters* (weights/biases, which are never mutated after being built).
"""

import importlib.util
import json
import platform
import sys
import time
from pathlib import Path

import torch

RUNNER_DIR = Path(__file__).resolve().parent


def _load_runner(module_name, filename):
    spec = importlib.util.spec_from_file_location(module_name, RUNNER_DIR / filename)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


recurrent_runner = _load_runner("latentforge_recurrent_runner", "recurrent-runner.py")
hrm_inspired_runner = _load_runner("latentforge_hrm_inspired_runner", "hrm-inspired-runner.py")
bdh_cq_inspired_runner = _load_runner("latentforge_bdh_cq_inspired_runner", "bdh-cq-inspired-runner.py")

BACKENDS = {
    "recurrent": {
        "runner": recurrent_runner,
        "seed": recurrent_runner.REQUIRED_SEED,
    },
    "hrm-inspired": {
        "runner": hrm_inspired_runner,
        "seed": hrm_inspired_runner.REQUIRED_SEED,
    },
    "bdh-cq-inspired": {
        "runner": bdh_cq_inspired_runner,
        "seed": bdh_cq_inspired_runner.REQUIRED_SEED,
    },
}


def write_line(payload):
    sys.stdout.write(json.dumps(payload, allow_nan=False, separators=(",", ":")) + "\n")
    sys.stdout.flush()


def log(message):
    print(message, file=sys.stderr, flush=True)


def build_all_parameters():
    """Build every backend's fixed parameters once, in a stable order.

    `recurrent-runner.build_parameters(seed)` takes an explicit seed
    argument; `hrm-inspired-runner.build_parameters()` and
    `bdh-cq-inspired-runner.build_parameters()` read their own module-level
    `REQUIRED_SEED` internally. Each call sets `torch.manual_seed` itself
    immediately before its own draws (unchanged from the standalone runners),
    so building all three sequentially here reproduces the exact per-request
    values each runner already produced on its own.

    The `recurrent` entry is a dict keyed by seed, not a single parameter
    set: the local seed-characterization experiment reuses the same
    `recurrent-runner` math across a small, fixed, pre-declared set of
    additional seeds (`recurrent_runner.CHARACTERIZATION_SEEDS`), built here
    once alongside the canonical seed rather than per-request.
    """
    parameters = {}
    parameters["recurrent"] = {
        seed: recurrent_runner.build_parameters(seed)
        for seed in sorted(recurrent_runner.ALLOWED_SEEDS)
    }
    parameters["hrm-inspired"] = hrm_inspired_runner.build_parameters()
    parameters["bdh-cq-inspired"] = bdh_cq_inspired_runner.build_parameters()
    return parameters


def dispatch(backend_id, payload, parameters):
    entry = BACKENDS.get(backend_id)
    if entry is None:
        raise ValueError(f"Unknown backend: {backend_id!r}")
    if backend_id == "recurrent":
        seed = payload.get("seed") if isinstance(payload, dict) else None
        selected = parameters["recurrent"].get(seed)
        if selected is None:
            # Let the runner's own validate_request produce the correct
            # structured INVALID_SEED error rather than raising here.
            return entry["runner"].execute(payload)
        return entry["runner"].execute(payload, selected)
    return entry["runner"].execute(payload, parameters[backend_id])


def main():
    try:
        torch.set_num_threads(1)
        parameters = build_all_parameters()
    except Exception as error:  # noqa: BLE001 - startup failure must be reported, not raised
        write_line({"ready": False, "error": {"code": "WORKER_STARTUP_FAILED", "message": str(error)}})
        sys.exit(1)

    write_line({
        "ready": True,
        "environment": {
            "pythonVersion": platform.python_version(),
            "torchVersion": torch.__version__,
            "cudaAvailable": torch.cuda.is_available(),
            "device": "cpu",
        },
    })
    log("LatentForge persistent Python worker ready.")

    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        started_at = time.perf_counter()
        try:
            request = json.loads(line)
            request_id = request.get("requestId")
            backend_id = request.get("backend")
            payload = request.get("payload")
        except Exception:
            write_line({"requestId": None, "ok": False, "error": {"code": "INVALID_JSON", "message": "Request must be valid JSON."}})
            continue

        try:
            result = dispatch(backend_id, payload, parameters)
            result_with_timing = dict(result)
            result_with_timing.setdefault("workerLatencyMs", (time.perf_counter() - started_at) * 1000)
            write_line({"requestId": request_id, "ok": True, "backend": backend_id, "result": result_with_timing})
        except ValueError as error:
            write_line({"requestId": request_id, "ok": False, "error": {"code": "UNKNOWN_BACKEND", "message": str(error)}})
        except Exception as error:
            code = getattr(error, "code", "EXECUTION_ERROR")
            message = getattr(error, "message", "The persistent worker could not complete execution.")
            write_line({"requestId": request_id, "ok": False, "error": {"code": code, "message": message}})

    log("LatentForge persistent Python worker exiting (stdin closed).")


if __name__ == "__main__":
    main()
