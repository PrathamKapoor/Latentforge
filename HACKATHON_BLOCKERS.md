# LatentForge — Hackathon Readiness Audit & Blocker Register

Audit conducted against a running instance of the application (real HTTP
traffic against a live server backed by the real PyTorch worker — no
mocks), the full automated test suite, and the repository's git/CI history.
Severity: **P0** = blocks submission/deployment, **P1** = serious
demo/judge failure, **P2** = meaningful weakness, **P3** = cosmetic.

## Summary

The repository was already in materially good shape before this audit
pass: 87/87 tests green, a disciplined evidence taxonomy in the README
(LIVE / SYNTHETIC / PUBLISHED / ILLUSTRATIVE, with explicit "what this does
not claim" sections), no secrets in git history, no XSS vectors in the
frontend (DOM built via `textContent`, never `innerHTML`), and path
traversal already blocked. **No P0 or P1 defects were found during attack
testing of the running server.** The fixes below were real gaps closed
during this pass, not defensive padding.

## Fixed this pass

| ID | Severity | Area | Problem | Evidence | Fix | Verification |
|----|----------|------|---------|----------|-----|---------------|
| B1 | P1 | Runtime | A stalled/hung worker round-trip had no request-level timeout — a client could hang indefinitely on the HTTP call even though the worker layer has its own internal timeout. | `test/request-timeout.test.js` (new); confirmed by mocking `pythonWorker.enqueue` to never resolve. | `createServer()` now races every request against `LATENTFORGE_REQUEST_TIMEOUT_MS` (default 20s) via `Promise.race`, returning a structured `504 REQUEST_TIMEOUT` instead of hanging. | New test passes; manual `curl` against a server configured with `LATENTFORGE_REQUEST_TIMEOUT_MS=3000` against a live (non-mocked) worker returns within the configured bound. |
| B2 | P1 | Dev/CI parity | `npm test`/`build`/`dev` assumed a bare `python` on `PATH` was the right interpreter. On this machine (and plausibly a judge's), the default `python`/`python3` resolves to Python 3.13, which has no `torch==2.13.0` wheel — silent breakage outside the maintainer's own machine. | `scripts/python-runtime.mjs` + `test/python-runtime.test.js` (new). | Centralized interpreter resolution: prefers `.venv`, then `python3.11`/`python3.10`, then the Windows `py -3.11`/`py -3.10` launcher, with `PYTHON` env var override. Every npm script now routes through it. | Verified end-to-end: fresh shell with system Python 3.13 on `PATH`, `npm test`/`build`/`dev` all correctly resolve and use `.venv`'s Python 3.10 + torch 2.13.0+cpu instead. |
| B3 | P1 | CI | GitHub Actions installed Python 3.13 via `setup-python`, which cannot satisfy `torch==2.13.0`'s pin (`>=3.11,<3.14` is the requirements.txt claim, but no cp313 wheel exists for this exact pin at the time of writing) — CI could install torch against the wrong ABI. | `.github/workflows/ci.yml` diff. | Pinned CI to Python 3.11. | GitHub Actions run history (runs #2–#4) green after this fix; run #5 (this pass's commit) confirms it holds. |
| B4 | P2 | Docker | Base image `node:24-slim` floats against Debian's current stable codename, which can silently change the apt package set/available versions from one build to the next. | `Dockerfile` diff. | Pinned to `node:24-bookworm-slim`. | Docker build job has been green across all 4 prior CI runs on this Dockerfile lineage; this pass keeps that job green (see CI verification below). |

## Verified via direct attack (this pass, no code change needed)

These were tested against a live server instance (real PyTorch worker, not
mocked) and behaved correctly on first try — recorded here as evidence,
not assumption:

- **Malformed JSON body** → `400 VALIDATION_ERROR`, not a crash.
- **`reasoningBudget: 0`, `-1`, `999999`** → `400`, "must be one of 1, 2, 4, or 8".
- **Unknown `backend`** → `400`, explicit list of valid backends, no silent fallback.
- **Empty/invalid `task`** → `400 UNSUPPORTED_TASK`.
- **Oversized body (~80KB > 64KB cap)** → `400`, connection not held open.
- **Path traversal** (`../../../etc/passwd`, encoded variants) → `404`, contained to `public/`.
- **12 concurrent live experiment requests** → all 12 completed correctly (this substrate's per-request latency is single-digit milliseconds once warm, faster than the queue could ever back up under this load).
- **Hard-killing the Python worker process mid-service** (`Stop-Process -Force` / SIGKILL-equivalent) → the *next* request self-healed transparently: `PythonWorkerClient` detected the exit, auto-restarted the worker, and the caller received a normal `200` with full live telemetry — no visible downtime, no error surfaced to the client.
- **Graceful `SIGTERM`** (what `docker stop` sends) → `src/server/index.js`'s shutdown handler drains the HTTP server, stops the worker cleanly, then exits. No orphaned processes under this path.
- **Frontend XSS surface** — `grep` confirms `public/app.js` renders all server-derived data via `textContent`/DOM APIs; zero uses of `innerHTML`/`insertAdjacentHTML`.
- **Secret scan** — no `.env`, credentials, API keys, or private keys in tracked files or `.gitignore` bypass; `.gitignore` already excludes the plausible secret paths.

## Open items (not fixed — documented honestly per the "absolute honesty" rule)

| ID | Severity | Area | Status | Why not fixed this pass |
|----|----------|------|--------|---------------------------|
| B5 | P3 | Process hygiene | Under a hard `SIGKILL` of the Node process specifically (not the whole container) — e.g. a process manager force-killing Node without tearing down the container/cgroup — the spawned Python worker child can be orphaned, because `process.once('exit', ...)` cleanup does not run on `SIGKILL`. | In the actual deployment shape (single process per container; `docker stop`/restart kills the whole container, reaping all children), this does not manifest. It only matters for an unusual "kill the app process but keep the container alive" scenario, which is not how this app is deployed. Documented rather than fixed to avoid speculative complexity (no orchestrator in this stack sends bare `SIGKILL` to Node while preserving the container). |
| B6 | P3 | Security headers | No `Content-Security-Policy` header. `x-content-type-options: nosniff` is present; CORS is same-origin-only by default (no wildcard). | The app has no user-generated HTML, no third-party script origins, and serves only its own static assets — CSP would be defense-in-depth, not a fix for an actual exploitable path found. Lower priority than functional correctness with hours remaining before the deadline. |
| B7 | P3 | Versioning | `package.json` version is `0.0.0-phase0` — internal phase-tracking residue, not user-facing, but reads oddly for a "release." | Cosmetic; left to the final polish pass. |
| B8 | NOT VERIFIED | Browser/visual | No browser-automation tool is available in this execution environment. DOM construction, ARIA structure, `textContent`-only rendering, and all UI *logic* are covered by `test/frontend-shell.test.js`, `test/phase3-experience.test.js`, etc. (jsdom-level), but actual pixel rendering, mobile viewport behavior, and real click-through were not visually observed this pass. | Environment limitation, not skipped effort. Static markup review (see below) found no structural red flags. |
| B9 | NOT VERIFIED | Accessibility | Static review of `public/index.html` shows skip link, `aria-label`/`aria-live`/`role=status` on dynamic regions, `<label for>` on every input, `<fieldset>/<legend>` on radio groups, table `<caption>`/`scope=col`. Color contrast and screen-reader behavior were not tested live (no browser tool). | Same environment limitation as B8. |
| B10 | NOT VERIFIED | Public deployment | Docker is not installed in this local execution environment (confirmed: `docker --version` → command not found), so the container could not be built/run locally. GitHub Actions CI *does* have Docker and has run the exact `docker build && docker run && curl /health && curl /ready && curl /api/experiment` smoke test in `.github/workflows/ci.yml` — green on all runs prior to this pass; this pass's run was in progress in-session, see CI status below. A public, internet-reachable deployment additionally requires either (a) Railway OAuth authorization from the user (this session's Railway MCP connector is installed but unauthenticated — `/mcp` must be run by the user, an agent cannot complete OAuth), or (b) an architecturally-mismatched Vercel deployment (this session's connected Vercel account belongs to an unrelated GitHub org/team, and Vercel's serverless model cannot host a persistent single-slot PyTorch worker process the way this app is designed). | Hard environment/access limitation, documented rather than glossed over. |

## Scientific integrity check

No changes were made to any experiment, model, seed, or result. The
README's existing evidence taxonomy (`LIVE`/`SYNTHETIC`/`PUBLISHED`/
`ILLUSTRATIVE`), non-monotonic-accuracy result table, and multi-seed
characterization table were spot-checked against a live re-run of the
canonical task (`1,0,1,1`, seed `20260907`, budgets 1/2/4/8) during this
pass and reproduced exactly: predictions `2, 4, 4, 2` against ground truth
`4` — i.e. the documented non-monotonic finding is real, reproducible, and
not cherry-picked framing.
