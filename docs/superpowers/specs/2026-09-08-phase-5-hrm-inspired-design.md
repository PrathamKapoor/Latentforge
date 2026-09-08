# Phase 5 — HRM-inspired Hierarchical Recurrence

## Purpose

Phase 5 adds one bounded local research mode beside the frozen single-state
recurrent substrate. Its learner-facing question is: *what changes when
recurrent computation is organized into interacting levels?*

The mode is named **HRM-inspired hierarchical recurrence**. It is not a
reproduction of Wang et al.'s Hierarchical Reasoning Model (HRM).

## Verified research source

The primary source is Guan Wang et al., *Hierarchical Reasoning Model*,
arXiv:2506.21734v3 (4 August 2025), Sections 2 and "Hierarchical
convergence". The paper describes an input network, a low-level recurrent
module that updates each timestep, a high-level recurrent module that updates
at cycle boundaries using the low-level state, and an output head read from the
high-level state. It describes training, deep supervision, one-step gradient
approximation, and adaptive computational time; none of those are implemented
here.

## Local mechanism

The local runner uses fixed seeded float64 CPU tensors, no training, and the
existing bounded line-navigation task. It creates input representation `x~`,
then actual numerical states `L` and `H`:

```text
x~ = tanh(W_I x + b_I)
L_i = tanh(W_LL L_(i-1) + W_LH H_(i-1) + W_Lx x~ + b_L)
H_i = tanh(W_HH H_(i-1) + W_HL L_i + b_H)  when i mod T = 0
      H_(i-1)                               otherwise
prediction = argmax(W_O H_N + b_O)
```

`T = 2`: each requested budget is the number of low-level updates; the
high-level state updates after every second low-level update. This preserves
the paper's observable slow/fast cadence while remaining a small educational
calculation. The local code does not reset L at cycle boundaries, use the
paper's modules, architecture sizes, training procedure, deep supervision,
one-step gradient approximation, adaptive halting, datasets, or evaluation.

## Evidence and invariants

`LIVE` means the local Python runner produced both state trajectories for that
request. Equations and timing diagrams are `ILLUSTRATIVE`; the HRM paper is
`PUBLISHED`; synthetic arithmetic is `SYNTHETIC`. No live mode may fall back to
synthetic data.

The existing `recurrent` backend remains mathematically and behaviorally
unchanged. The hierarchical mode has its own fixed configuration. In a
single-vs-hierarchical comparison, task, encoding, truth solver, numeric
precision, environment, and requested budget are held fixed. The state
structure and dedicated fixed parameters necessarily differ; therefore the
comparison demonstrates architectural and trajectory differences, not a fair
accuracy benchmark.

## Observability and limitation

Each execution returns actual initial H/L states and per-low-step H/L states,
high-update flags, update metrics, logits, prediction, independent ground
truth, score, run identity, seed, configuration, and provenance. Dimensions
remain neutral numerical coordinates.

The UI exposes H and L values, whether H updated at each low step, a compact
cadence timeline, prediction/truth, and a controlled comparison with the
existing recurrent backend. A limitation statement is based only on measured
local runs: a different hierarchical trajectory or prediction is not evidence
of general performance improvement. The local model is untrained and is not a
benchmark or an HRM reproduction.

## Errors and verification

Malformed inputs, runner output, non-finite data, and unsupported backends
fail explicitly. Tests cover registration, deterministic execution, actual
hierarchical state shape/cadence, independent truth, backend regression,
malformed data, evidence labels, and UI-safe handling. Existing Phase 1–4
tests, the build, and live HTTP checks remain required.
