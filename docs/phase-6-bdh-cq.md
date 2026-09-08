# Phase 6 — BDH-CQ Design Contract

## Status

**Design status: IMPLEMENTED AS A SIMPLIFIED LOCAL CONTRACT.**

**Implementation status: PARTIALLY VERIFIED.** The deterministic CPU runner and
backend are real local computations. They remain BDH-CQ-inspired, not a
reproduction of the published system.

## Primary source

Björn Engdahl, Adrian Kosowski, Jan Chorowski, Zuzanna Stamirowska,
Przemysław Uznański, Junlin Jiang, Rohan Phadke, Remigiusz Kinas, and Richard
Zhong, [*BDH-CQ: In-Context Learning with Recurrent Latent Reasoning*](https://arxiv.org/abs/2608.09888), arXiv:2608.09888v1, 10 August 2026.

The source’s Sections 3.2–3.3 define the system-level interface used here:
demonstrations update recurrent memory, then a query is processed in a latent
workspace. The paper states that exact dimensions, update rules, and internal
implementation details are proprietary (Section 3.3).

## Learner question and falsifiable claim

**Question:** What changes when demonstrations update a recurrent memory before
a query receives recurrent latent computation?

**Claim:** With task, query, fixed local parameters, seed, precision, and
reference solver held fixed, increasing the number of sequential local memory
updates changes the returned memory state and can change the final latent
trajectory and prediction. This is falsified if distinct valid demonstration
counts leave the actual memory state and resulting trajectory unchanged.

## Published mechanism

For demonstrations `D_t` and query `x*`, the paper gives:

`S_t = U_θ(S_(t-1), D_t)` (Eq. 1)

`H_0 = E_θ(x*, S_K)` (Eq. 2)

`H_(r+1) = F_θ(H_r, S_K)` (Eq. 3)

`ŷ = G_θ(H_R)` (Eq. 4)

`S` is contextual recurrent memory and `H` is query-specific reasoning
workspace. Parameters remain fixed during inference (Sections 1 and 3.2).

## Local BDH-CQ-inspired contract

**Retained:** sequential memory update; memory-conditioned query encoding;
shared recurrent latent workspace update; decoding only from final workspace;
no textual intermediate reasoning; independent reference truth.

**Local design choices:** CPU float64 PyTorch, deterministic seed, tiny state
dimension, bounded line-navigation demonstrations/query, and a small fixed
nonlinear update. These choices are not claimed to be BDH-CQ dimensions or
rules.

**Omitted:** BDH layers, high-dimensional positive activations, low-rank
communication, proprietary update rules/dimensions, trained 150M parameters,
ARC data mixture, candidate construction/ranking, pass@2, benchmark and cost
evaluation, and all published training details.

## Actual local computation

`demonstration sequence → S_0 → S_1 … S_K → H_0(query,S_K) → H_1 … H_R → prediction`

`src/reasoning/bdh-cq-inspired-runner.py` runs CPU PyTorch float64, seed
`20260909`, with local state dimension 8. For `K∈{1,2,3}` demonstrations and
`R∈{1,2,4,8}` workspace updates, it uses local design choices:

`S_t = tanh(W_s S_(t-1) + W_d roll(x,t))`

`H_0 = tanh(W_i x + b_i + W_hs S_K)`

`H_(r+1) = tanh(W_hh H_r + W_hs S_K + b_h)`

`prediction = argmax(W_o H_R + b_o)`.

`src/reasoning/bdh-cq-inspired-backend.js` independently obtains truth from the
line-navigation solver and returns LIVE S trajectory, memory-conditioned H₀,
H trajectory, logits, prediction, truth, correctness, run ID, and requested /
effective budget. Invalid output is rejected; no synthetic fallback exists.

## Manipulation and experiment

The sole learner control will be **demonstration count** `K`, a source-supported
memory-ingestion variable. It changes how many actual recurrent-memory updates
run. Query, latent-reasoning budget `R`, local parameters, seed, precision,
task family, and independent reference solver remain fixed. The learner
inspects memory trajectory, workspace trajectory, prediction, and truth.

The baseline is the Phase 2 single recurrent backend on the same bounded task
and reference. It is an educational architectural contrast, not a controlled
accuracy benchmark: parameter structures necessarily differ. Each run retains
its own ID. A falsifying observation is unchanged memory/workspace telemetry
across different `K`; non-monotonic correctness is an allowed result.

## Guided/evidence plan

Phase 6 extends the canonical `createGuidedExperience()` module: run LIVE
memory ingestion, inspect returned `S` and `H`, change `K`, compare a LIVE
baseline, inspect independent truth, then read the limitation. PUBLISHED labels
the source/equations; LIVE labels returned local execution; ILLUSTRATIVE labels
teaching diagrams; SYNTHETIC remains exclusive to the arithmetic demo.

## Limitations and non-claims

The local experiment will not reproduce BDH-CQ, its training, ARC evaluation,
150M model, cost/accuracy claims, or proprietary update rules. It will not
establish efficiency, token savings, superiority, general accuracy, or that
latent coordinates are human-readable thoughts. A formal ablation is deferred:
removing local memory would introduce a new arbitrary toy regime; the planned
contrast is demonstration count with all local design choices fixed.

## Relationship to prior phases

Phase 2 supplies deterministic latent recurrence and independent truth; Phase
3 supplies inspection/guidance; Phase 4 supplies controlled budget comparison;
Phase 5 supplies evidence discipline and canonical guided-state integration.
