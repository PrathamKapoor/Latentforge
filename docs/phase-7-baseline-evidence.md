# Phase 7 Baseline Evidence

Captured 2026-09-08, before any Phase 7 production-code changes, per the mandatory
pre-implementation invariants. This file is the deep-equivalence reference for the
persistent-worker migration: every number here must still be reproducible (bit-for-bit
for state/logits/predictions; behaviorally for error codes and test counts) after the
migration. Any mismatch found later is treated as a regression to explain, not to
silently accept.

## `npm test` (pre-migration)

```
tests 60
suites 0
pass 60
fail 0
cancelled 0
skipped 0
todo 0
duration_ms 64753.8639
```

Exit code 0.

## `npm run build` (pre-migration)

Exit code 0. All `node --check` syntax checks passed for every file the build script covers.

## Cold-start latency (per-request process spawn, current architecture)

Wall-clock, one call each, this machine, this session:

| Backend | Budget | Standalone runner (direct spawn) | HTTP (`POST /api/experiment`) |
| --- | --- | --- | --- |
| recurrent | 1 | 4320 ms | 4451 ms |
| recurrent | 2 | 4271 ms | 4319 ms |
| recurrent | 4 | 4244 ms | 4339 ms |
| recurrent | 8 | 4155 ms | 4325 ms |
| hrm-inspired | 1 | 4216 ms | 4319 ms |
| hrm-inspired | 2 | 4206 ms | 4324 ms |
| hrm-inspired | 4 | 4237 ms | 4293 ms |
| hrm-inspired | 8 | 4248 ms | 4245 ms |
| bdh-cq-inspired | demoCount=2, budget=4 | 4250 ms | 4415 ms |

Note: the runner's *self-reported* internal `runtime.latencyMs` (pure computation,
inside the already-cold process) was **~8ms** for recurrent b4 and **~8.7ms** for
hrm-inspired b4 — confirming the ~4.2-4.5s wall-clock cost is almost entirely Python
process startup + `torch` import, not the recurrence computation itself. This is the
exact bottleneck the persistent worker targets. (Earlier in this session, under
different background load, a single recurrent b4 HTTP call measured ~6055ms — same
phenomenon, different momentary system load; both numbers are cold-start-dominated.)

## Canonical example — must not change

Task `1,0,1,1` (moves 2→3→2→3→4, independent truth = 4), backend `recurrent`, seed `20260907`:

| Budget | Prediction | Truth | Correct |
| --- | --- | --- | --- |
| 1 | 2 | 4 | false |
| 2 | 4 | 4 | true |
| 4 | 4 | 4 | true |
| 8 | 2 | 4 | false |

This exact non-monotonic pattern (`2, 4, 4, 2`) is the pedagogical result documented in
the README and must be reproduced identically post-migration.

## Standalone-runner vs. HTTP-adapter equivalence (pre-migration, same architecture)

Verified by direct comparison of captured JSON, same request, same session:

- **recurrent**, budget 4: `initialState` values match exactly; final observation
  `state`/`logits`/`prediction` match exactly; `finalPrediction` 4 == 4.
- **hrm-inspired**, budget 4: `hierarchicalInitialState.lowState` matches
  `initialLowState` exactly; last observation's `highState` matches standalone
  `finalHighState` exactly; `finalPrediction` 2 == 2, truth 4 (incorrect — expected,
  not cherry-picked).
- **bdh-cq-inspired**, demoCount 2, budget 4: `finalState` matches the HTTP response's
  last `workspaceTrajectory` entry's `state` exactly; `finalPrediction` 2 == 2, truth 4
  (incorrect).

Since today's architecture already routes the HTTP path through a freshly-spawned copy
of the exact same runner file per request, this equivalence is expected — it establishes
the reference baseline the *persistent worker* must also satisfy after moving parameter
construction from per-request to once-at-startup.

## Current backend error-code table (pre-migration)

From `src/reasoning/*-backend.js` and `test/recurrent-latent-backend.test.js`'s mock
fixtures — the exact codes that must still be produced for the equivalent failure class
after the worker migration:

| Failure class | recurrent / hrm-inspired | bdh-cq-inspired (current, to be fixed) |
| --- | --- | --- |
| Interpreter not found (`ENOENT`) | `RUNTIME_UNAVAILABLE` | `EXECUTION_ERROR` (bug — collapsed) |
| Process killed / timeout | `RUNNER_TIMEOUT` | `EXECUTION_ERROR` (bug — collapsed) |
| Non-zero exit / other spawn error | `EXECUTION_ERROR` | `EXECUTION_ERROR` |
| Malformed/non-JSON stdout | `INVALID_RUNNER_RESPONSE` | `INVALID_RUNNER_RESPONSE` |
| Runner-reported structured error (e.g. `NON_FINITE_STATE`) | passthrough of runner's `error.code` | always rewritten to `INVALID_REQUEST` |
| Validation failure (bad task/budget) before execution | `VALIDATION_ERROR` / `UNSUPPORTED_TASK` | `VALIDATION_ERROR` / `UNSUPPORTED_TASK` |

The BDH-CQ inconsistency (right column) is the documented bug Phase 7 fixes by routing
all three backends through the same `PythonWorkerClient`.

## Raw fixture files

Captured verbatim, not reproduced in full here due to size (each 1-3 KB of JSON).
Retained for this session at:
`%TEMP%\claude\C--Projects-LatentForge\...\scratchpad\baseline\` —
`standalone-{recurrent,hrm}-b{1,2,4,8}.json`, `standalone-bdhcq-d2-b4.json`,
`http-{recurrent,hrm}-b{1,2,4,8}.json`, `http-bdhcq-d2-b4.json`, plus `npm-test.txt`
and `npm-build.txt` with full command output. These are session-scratch artifacts, not
committed to the repo; the tables above are the durable record.
