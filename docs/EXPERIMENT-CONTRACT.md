# Experiment and Backend Contracts

## Backend contract

A future reasoning backend has a stable identity, display name, provenance, and an execution interface. Its request conceptually carries task input, initial state, reasoning-step count, configuration, and a random seed where applicable. Its output is an ordered stream of safe per-step observations (`step 0` through `step N`), then a final result or structured error.

Each step may provide a backend-safe state observation, prediction, confidence where available, metrics, metadata, and provenance. The interface deliberately does not require the UI to understand backend internals and must never require hidden chain-of-thought text.

The Phase 0 JavaScript contract is [reasoning-backend.js](../src/contracts/reasoning-backend.js). It creates only `CONTRACT_ONLY` records; it does not run a model or fill runtime values.

## Future experiment object

| Field | Contract |
| --- | --- |
| `experimentId`, `taskId` | Stable identifiers. |
| `backend`, `configuration` | Selected backend identity/provenance and exact configuration. |
| `reasoningBudget`, `randomSeed` | Requested computation budget and reproducibility seed where applicable. |
| `input`, `groundTruth` | Task input and ground truth if it exists. |
| `predictionsByStep`, `latentStateObservationsByStep` | Ordered observations keyed by recurrent step. |
| `finalPrediction`, `finalScore` | Final output and score only after real evaluation. |
| `latencyMs`, `tokenCount`, `metrics` | Measured telemetry only; token count is optional/applicable. |
| `provenance`, `metadata` | Sources, versions, evidence classification, and observation policy. |
| `error`, `status` | Structured failure or execution status. |

No Phase 0 record may fabricate runtime values.

The live backend uses `backend.id = recurrent-latent-toy-v1`, `metadata.evidenceLevel = LIVE`, `randomSeed = 20260907`, configuration describing the local PyTorch substrate, and a bounded `reasoningBudget` of 1, 2, 4, or 8. `initialState.values` is h₀; each observation contains the actual h₁..hₙ state, prediction, L2 norm, mean, standard deviation, delta, and cosine similarity. `groundTruth` comes from the independent line-navigation reference solver. Latency is measured local backend elapsed time; token count remains unmeasured.

Phase 3 uses `experimentId`, configuration, seed, and evidence metadata to distinguish runs. Client-side timelines, heatmaps, and equations must remain source-labelled: state values are derived from the returned experiment record; explanatory equations are `ILLUSTRATIVE`.

Phase 4 groups independent live records into a budget sweep. A sweep does not manufacture a combined result: each budget row retains its original experiment record and `experimentId`. Fixed conditions are task, seed, configuration, backend, and reference solver; only `reasoningBudget` varies.

## Phase 5 hierarchical telemetry

`hrm-inspired` is an additive LIVE backend with its own deterministic seed and configuration. It retains normal `latentStateObservationsByStep` as actual low-level states for generic consumers and adds `hierarchicalInitialState` and `hierarchicalStateObservationsByStep`. Every hierarchical observation includes actual `lowState`, `highState`, their measured metrics, `highUpdated`, logits, and H-head prediction. The independent solver supplies `groundTruth`; runner, validation, non-finite, and unsupported-backend failures fail explicitly without synthetic substitution. The temporal configuration states that two low-level updates form one high-level cycle.

## Phase 7 persistent worker protocol

`src/reasoning/worker-server.py` speaks line-delimited JSON over stdin/stdout. The first line it emits is `{"ready": true, "environment": {...}}` (or `{"ready": false, "error": {...}}` followed by a non-zero exit, on startup failure). Every subsequent line is one request, `{"requestId", "backend", "payload"}`, answered by exactly one response line, `{"requestId", "ok": true, "backend", "result"}` or `{"requestId", "ok": false, "error": {"code", "message"}}`. stdout carries protocol only; all diagnostics go to stderr. `src/reasoning/worker-client.js` (`PythonWorkerClient`) is the Node-side counterpart — see `docs/phase-7-deployability-hardening.md` for the full lifecycle/queue/error-normalization design.

## Phase 7 combined budget-sweep contract

`POST /api/experiment` computes one primary result plus (by default, `includeBudgetSweep: false` to opt out) the remaining three canonical budgets inside the same queued job, attaching a `budgetSweep` field: `{id, task, backend, budgets: [1,2,4,8], evidenceLevel: 'LIVE', runs: [...]}`, where each `runs` entry is either a full experiment result merged with `{status: 'COMPLETE', evidenceLevel: 'LIVE'}` or, on failure, `{reasoningBudget, status: 'ERROR', evidenceLevel: 'LIVE_ERROR', error: {message}}`. The primary budget's row is reused, never recomputed. This reuses the existing `runReasoningBudgetSweep` (`src/experiments/reasoning-budget-sweep.js`) unchanged for the non-primary budgets.

## Phase 7 local seed characterization contract

`POST /api/characterization` (`{task}`) returns `{id, task, backend: 'recurrent', seeds, budgets, evidenceLevel: 'LOCAL_CHARACTERIZATION', label: 'LOCAL CHARACTERIZATION — NOT A BENCHMARK', rows, bySeed, accuracyByBudget}`. Every `seeds x budgets` combination is recorded in `rows`, including failed and incorrect runs — nothing is filtered. `LOCAL_CHARACTERIZATION` joins the evidence taxonomy below as a label for controlled local exploration that is explicitly not a benchmark claim.

## Evidence classifications

| Label | Meaning |
| --- | --- |
| `LIVE` | Computed during the current interaction. |
| `PRECOMPUTED` | Computed previously and loaded from a stored artifact. |
| `SYNTHETIC` | Generated specifically for education and not claimed to be a published benchmark result. |
| `PUBLISHED` | Directly derived from a cited research source. |
| `ILLUSTRATIVE` | Simplified conceptual visualization, not a direct representation of model internals. |

Every future research-facing visualization must carry exactly one of these classifications.
