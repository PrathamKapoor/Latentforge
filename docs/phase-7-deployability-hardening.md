# Phase 7 — Deployability + Evidence Hardening

## Status

**Engineering: IMPLEMENTED AND VERIFIED.** **Deployment artifacts: CREATED, RUNTIME NOT VERIFIED** (this development environment has no `docker` binary and no CI runner — see [Verification](#verification) below). **Scientific characterization: IMPLEMENTED AND VERIFIED**, real (not fabricated) local data below.

This phase does not add a new research mode and does not change the canonical recurrent substrate's math, seed, architecture, or the example the submission is built around. It replaces the execution mechanism underneath the three live backends, adds resource limits and health/readiness signals, adds a deployment path that does not require a judge to install Python or PyTorch, and adds a small controlled seed characterization alongside the existing budget experiment.

## What changed: persistent worker, not a new model

Before this phase, every `POST /api/experiment` spawned a fresh `python` process that re-imported PyTorch and rebuilt that backend's fixed parameters from scratch — a real, measured ~4.2–6s of process/import overhead per call, before the ~1–10ms of actual computation ever ran (`docs/phase-7-baseline-evidence.md` records the measurements). The UI's automatic budget-comparison table used to make four additional such calls after every run.

`src/reasoning/worker-server.py` is a persistent Python process, spawned once when the Node server starts, that imports PyTorch once and builds every backend's fixed parameters once — reusing each backend's own unmodified `build_parameters()`/`execute()` functions from `recurrent-runner.py`, `hrm-inspired-runner.py`, and `bdh-cq-inspired-runner.py` (loaded by file path via `importlib`, not reimplemented). It then serves an unbounded number of requests over stdin/stdout, one JSON line in, one JSON line out, until the Node process shuts it down. `src/reasoning/worker-client.js` (`PythonWorkerClient`) is the Node-side counterpart: it owns the worker's lifecycle (start/ready/stop/crash-restart), a bounded FIFO job queue (`LATENTFORGE_MAX_QUEUE`, default 8), and a fixed single active slot (`LATENTFORGE_MAX_ACTIVE = 1` — CPU-bound PyTorch work is deliberately not parallelized without measurement first).

The three backend adapters (`recurrent-latent-backend.js`, `hrm-inspired-backend.js`, `bdh-cq-inspired-backend.js`) no longer spawn their own child processes; they call `pythonWorker.enqueue(...)`, which normalizes errors across all three (fixing a pre-existing bug where the BDH-CQ-inspired adapter collapsed every failure to `EXECUTION_ERROR` while the other two distinguished `RUNTIME_UNAVAILABLE`, timeouts, and passthrough runner errors). `bdh-cq-inspired-runner.py` and its backend adapter were also rewritten from single-line dense code into normally formatted code matching the other two backends' style — the math is unchanged, verified by running the file's own tests before and after and by a byte-for-byte diff against the pre-rewrite baseline (`docs/phase-7-baseline-evidence.md`).

**One experiment is one job.** `enqueue(jobFn)` queues one job; once it becomes active, `jobFn` receives a `send(backend, payload)` function that talks directly to the worker without re-entering the queue. `POST /api/experiment` uses this to compute the primary result and, when a budget sweep is requested (the default, matching the existing always-on comparison table), the three *remaining* budgets — never the primary budget twice — inside that same job. This means one HTTP request now produces exactly one queued job, not up to five independent ones; two different visitors' experiments cannot interleave mid-sweep.

## Resource limits

All named in `src/server/config.js`, every default matching what was previously an unnamed hardcoded value:

| Env var | Default | Meaning |
| --- | --- | --- |
| `LATENTFORGE_MAX_QUEUE` | 8 | Jobs waiting behind the single active slot before new requests are rejected `OVERLOADED` (503) |
| `LATENTFORGE_MAX_ACTIVE` | 1 | Simultaneous active jobs — fixed; see above |
| `LATENTFORGE_REQUEST_TIMEOUT_MS` | 20000 | (reserved; documents the intended HTTP-level budget) |
| `LATENTFORGE_WORKER_START_TIMEOUT_MS` | 30000 | How long the worker has to report readiness after being spawned |
| `LATENTFORGE_WORKER_EXECUTION_TIMEOUT_MS` | 20000 | How long a single Python round-trip may take before the worker is treated as hung, killed, and restarted |
| `LATENTFORGE_MAX_WORKER_RESTART_ATTEMPTS` | 3 | Consecutive crash/restart attempts before the service reports `UNAVAILABLE` rather than restart-looping forever |
| `LATENTFORGE_MAX_TASK_LENGTH` | 4 | Matches the canonical task's fixed move count |
| `LATENTFORGE_MAX_REASONING_BUDGET` | 8 | Matches `ALLOWED_BUDGETS`'s maximum |
| `LATENTFORGE_MAX_BODY_BYTES` | 65536 | Existing request-body cap, now named |

## Health and readiness

`GET /health` reports process liveness only (200 as long as the HTTP server itself is answering). `GET /ready` reports whether the persistent worker has finished starting (`{"status":"ready","worker":"ready"}`, 200) or not (`{"status":"not_ready","worker":"starting"|"restarting"|"unavailable"}`, 503). The `synthetic` backend never depends on the worker and stays available in either state.

## Deployment

`Dockerfile` packages Node 24 and a Python 3 virtualenv with the CPU-only PyTorch wheel (`requirements.txt`, pinned to `torch==2.13.0`, the version verified against this repository's fixed-seed outputs — see `docs/phase-7-baseline-evidence.md`) into one image; `.dockerignore` excludes tests/docs/dev artifacts. No CUDA toolkit, GPU driver, or model download is needed or included. `.github/workflows/ci.yml` runs `npm test`/`npm run build` on every push, then attempts a container build and an HTTP smoke test (`/health`, `/ready`, a live experiment) as a separate job.

## Local seed characterization — LOCAL CHARACTERIZATION, NOT A BENCHMARK

The canonical example (task `1,0,1,1`, seed `20260907`) shows a specific non-monotonic pattern: budgets 1 and 8 predict `2`; budgets 2 and 4 predict the true answer `4`. `src/experiments/seed-characterization.js` asks whether that pattern is representative of this architecture or a property of one hand-picked seed, by running the *same* recurrent architecture and task across a small, fixed, pre-declared set of additional seeds (`1, 42, 2024, 90210`, alongside the canonical `20260907` — declared once in `recurrent-runner.py` and mirrored in `recurrent-latent-backend.js`, with a contract-drift test keeping the two lists in sync). Every run is recorded, including wrong and non-monotonic ones; nothing is filtered or excluded.

Actual local result for task `1,0,1,1` (captured this phase, not fabricated — see `docs/phase-7-baseline-evidence.md` for the raw dump):

| Seed | B1 | B2 | B4 | B8 | Correct / 4 |
| --- | --- | --- | --- | --- | --- |
| 20260907 (canonical) | 2 | **4** | **4** | 2 | 2 |
| 1 | **4** | 2 | 2 | 2 | 1 |
| 42 | 1 | 1 | 2 | 2 | 0 |
| 2024 | 3 | 3 | 3 | 3 | 0 |
| 90210 | 0 | 1 | 0 | 0 | 0 |

Ground truth is `4` in every row. Across all 20 seed×budget combinations, 3 were correct (15% — near chance for this 5-way output, and lower than the canonical seed's own 50%). This strengthens rather than weakens the project's own stated lesson: the canonical seed's partial correctness is not representative of an untrained network's typical behavior, and additional recurrent computation is computation, not a guarantee of a better answer — for most seeds tried, more budget did not produce the correct answer at all. This is exposed in the UI (`#characterization` section) via `POST /api/characterization`, clearly labeled `LOCAL CHARACTERIZATION — NOT A BENCHMARK`, and kept visually and structurally separate from the canonical budget experiment.

Scoped to the `recurrent` backend only for this phase; `hrm-inspired`/`bdh-cq-inspired` characterization is noted as future work, not implemented here.

## Deferred out of this phase

- **Variable-length task family** (spec item on task variety): the neural nets' weight matrices are fixed-shape (`INPUT_SIZE = 4`), tied to the fixed-seed determinism story. Supporting variable-length tasks would require either padding (changing the canonical task's encoded semantics) or per-length parameter sets (multiplying what counts as "canonical"). Left for a future phase.
- **Worker concurrency > 1**: not enabled without measurement, per the spec's own guidance.
- **Characterization for `hrm-inspired`/`bdh-cq-inspired`**: architecture supports it (the same `enqueue`/`send` job pattern generalizes), not built this phase to keep scope bounded.

## Verification

See `docs/phase-7-baseline-evidence.md` for the full before/after record and the final structured report delivered at the end of this phase for what is VERIFIED vs. NOT VERIFIED vs. BLOCKED, including the honest limitation that Docker build/run and CI execution could not be run in this development sandbox (no `docker` binary, no CI runner available here) and are therefore created but not runtime-verified.
