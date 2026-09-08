# Phase 2 Recurrent Substrate Design

## Goal

Add a local, reproducible recurrent latent-state computation backend alongside the Phase 1 synthetic backend. The system must expose real state telemetry and permit the same input and parameters to be evaluated with budgets 1, 2, 4, and 8.

## Scope and boundaries

The existing Node HTTP server, static browser client, Phase 0 contract, and `synthetic-arithmetic-demo-v1` remain in place. A new `recurrent` backend selector resolves only to a safe local backend. No external model service, API key, download, agentic loop, chain-of-thought, benchmark claim, or named research architecture is included.

The implementation is a toy recurrent neural system inspired by recurrent latent reasoning, not HRM, URM, CODI, Coconut, or BDH-CQ.

## Runtime choice

The host has Python 3.13 and locally discoverable PyTorch. The recurrent backend will call a checked-in local Python program through a bounded Node child process, using CPU PyTorch only. It will report the exact Python, PyTorch, and CPU/CUDA availability in provenance. There is no training and no model download.

## Task family

The live backend accepts a compact line-navigation task, for example `1,0,1,1`, where each value is a move (`0` = left, `1` = right) on a bounded line of positions 0 through 4, starting at 2. The independently implemented reference solver applies the moves and clamps each result to the bounds. Its final position is ground truth.

This task is deterministic, has a fixed-size numeric encoding, and has iterative structure without presenting the latent vector as a sequence of human-readable thoughts. Phase 1 arithmetic remains exclusive to the synthetic backend.

## Computation

The input vector `x` encodes four moves. A fixed-seed, deterministically initialized small neural substrate uses hidden size 8 and `tanh` activation:

`h0 = tanh(W_encode x + b_encode)`

`h(t+1) = tanh(W_h h(t) + W_x x + b_h)`

`logits(t) = W_out h(t) + b_out`

`prediction(t) = argmax(logits(t))`

The same `W_h`, `W_x`, and `b_h` are reused for every update. The model output comes exclusively from the output head over the actual final recurrent state. The reference solver is not invoked by the model or output path.

With budget `n`, the substrate executes exactly `n` transitions and returns observations for `h1` through `hn`; `h0` is returned separately as the actual initial state. Parameters, input, seed, output head, and transition are fixed across budget comparisons.

## Telemetry and errors

Each observation contains the actual state vector, L2 state norm, mean, population standard deviation, L2 delta from the previous state, cosine similarity to the previous state where defined, prediction, and `confidence: null`. The backend detects non-finite states/logits and returns a structured execution error without falling back to the synthetic backend. Execution time is measured in the local backend and reported as `latencyMs`.

## Integration

`POST /api/experiment` accepts optional `backend` with values `recurrent` or `synthetic`; omitted resolves to `recurrent`. Server-side backend mapping validates identifiers and retains existing request validation. Results preserve the Phase 0 experiment shape, with actual fields filled for live runs.

The UI adds explicit backend selection, updates labels from returned evidence, visualizes signed real state values, provides an inspector for the selected step, and renders a genuine four-budget comparison based on independently requested executions. It validates required contract fields before rendering and displays controlled API/structure errors.

## Testing and documentation

Node tests will cover reference-solver known cases, deterministic recurrent output, exact 1/2/4/8 transition counts, state metric consistency, output-head relationship, API backend selection/invalid backend behavior, and synthetic regression. Documentation will record runtime versions, fixed initialization seed, no-training status, task encoding, mathematical formulation, evidence classification, and reproducibility commands.
