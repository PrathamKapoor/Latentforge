# Development

## Phase 2 environment

The repository is a Node.js ESM web application with no npm dependencies. Verified runtime: Node.js `v24.19.0`, npm `12.0.2`, Python `3.13.14`, PyTorch `2.13.0+cpu`, CUDA unavailable. The package declares Node `>=24`. No API keys, model downloads, or external services are required. As of Phase 7, `requirements.txt` pins the Python worker's PyTorch version, and a small set of resource-limit environment variables is optionally overridable (see `src/server/config.js`).

## Commands

| Purpose | Command | Status |
| --- | --- | --- |
| Install | `npm install` | Installs the dependency-free package metadata in a clean environment. |
| Development server | `npm run dev` | Starts the local server at `http://127.0.0.1:4173` and the persistent Python worker. |
| Tests | `npm test` | Node built-in test runner (`--test-concurrency=4`; each test file runs in its own isolated process with its own worker instance). |
| Production start | `npm start` | Starts the same local server. |
| Production build / syntax check | `npm run build` | Syntax-checks every JS module plus `python -m py_compile` on the four runner/worker `.py` files. |
| Container build | `docker build -t latentforge .` | Builds the deployable image (Node + CPU-only PyTorch); not runtime-verified in this development sandbox. |
| Container run | `docker run -p 4173:4173 latentforge` | Runs the container; check `/health` and `/ready`. |

## Persistent worker environment variables (Phase 7)

All optional, all documented with their defaults in `src/server/config.js`: `LATENTFORGE_MAX_QUEUE`, `LATENTFORGE_MAX_ACTIVE`, `LATENTFORGE_REQUEST_TIMEOUT_MS`, `LATENTFORGE_WORKER_START_TIMEOUT_MS`, `LATENTFORGE_WORKER_EXECUTION_TIMEOUT_MS`, `LATENTFORGE_MAX_WORKER_RESTART_ATTEMPTS`, `LATENTFORGE_MAX_TASK_LENGTH`, `LATENTFORGE_MAX_REASONING_BUDGET`, `LATENTFORGE_MAX_BODY_BYTES`. `PYTHON` continues to select the interpreter the worker is spawned with.

The live backend runs the checked-in `src/reasoning/recurrent-runner.py` through Python. It uses seed `20260907`, hidden size 8, CPU `float64`, and budgets `1`, `2`, `4`, or `8`. It is deterministically initialized and not trained. To run one experiment, start `npm run dev`, then POST `{"task":"1,0,1,1","reasoningBudget":4,"backend":"recurrent"}` to `/api/experiment`. Select `backend:"synthetic"` with task `17 + 28` for the Phase 1 demo.

To add a backend, implement the existing contract-shaped execution and validation functions, register only a safe client-facing identifier in `src/reasoning/backend-registry.js`, add backend and HTTP tests, and preserve the evidence label/provenance rules. Never silently fall back between backends.

Phase 3 opens with a live preset request rather than stored result data. Guided progression requires a successful live budget-change request; state scrubbing uses the already returned trajectory and must not rerun the backend.
| Lint | `NOT ESTABLISHED IN PHASE 0` | No linter has been selected. |
| Type check | `NOT ESTABLISHED IN PHASE 0` | JavaScript/JSDoc contracts only; no type-checker has been selected. |
| Formatting | `NOT ESTABLISHED IN PHASE 0` | No formatter has been selected. |

## Project structure

| Path | Purpose |
| --- | --- |
| `public/` | Landing page (`index.html` → `/`), the interactive lab (`lab.html` → `/lab`), and their contract-consuming client scripts. |
| `public/css/` | Design system: `tokens.css` (OKLCH palette, type, spacing), `site.css` (shared chrome and components), `landing.css`, `lab.css`. |
| `src/server/` | Native Node HTTP server, static serving, and API boundary. |
| `src/reasoning/` | Replaceable synthetic demonstration backend. |
| `src/contracts/` | Preserved Phase 0 backend and experiment contracts. |
| `test/` | Phase 0 regression, backend, and API tests. |
| `docs/`, `research/` | Architecture, provenance, development, and research documentation. |

## API entry point

`POST /api/experiment` accepts JSON such as `{ "task": "17 + 28", "reasoningBudget": 4 }`. It validates that the task is non-empty and the budget is an integer from 1 through 8. Invalid requests receive a structured `400` error; values are never silently clamped.

## Synthetic backend

The backend supports only the deterministic Phase 1 task `17 + 28`. It returns exactly the requested number of synthetic step observations. Its output uses the existing experiment shape and is visibly labelled `SYNTHETIC`; it is not a model invocation, neural-state extraction, latency measurement, token measurement, or benchmark.

## Evidence labels

All future experiment-facing output follows the Phase 0 evidence policy. This implementation uses `SYNTHETIC`: generated for education and not presented as a published benchmark result. The browser renders that label in the hero, workspace, state visualizer, telemetry, and prediction context.

## Ports, environment, and troubleshooting

The local server uses port `4173` by default and can be changed with `PORT`. No environment variable is required. There is no database, external service, API key, model download, deployment configuration, or OmniRoute integration.

## Test framework choice

Node's built-in `node:test` runner was selected because the repository was empty and Node/npm were present. The native Node HTTP server and browser platform APIs use the same principle: a repeatable application foundation without adding a third-party dependency or fabricating an application stack.
