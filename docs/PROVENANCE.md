# Provenance

## Our implementation

Code and documentation written specifically for LatentForge. Phase 1 adds the native browser UI, Node HTTP API, synthetic arithmetic demonstration backend, generic state-observation visualization, tests, and application architecture. The synthetic demonstration is our implementation and is marked `SYNTHETIC`; it is not a trained model or research result.

Phase 2 adds a local toy recurrent neural substrate (`recurrent-latent-toy-v1`). It uses PyTorch `2.13.0+cpu` under Python `3.13.14`, CPU only, with hidden size 8, `tanh`, seed `20260907`, and no training. Parameters are created deterministically at inference time; they are not trained weights. The checked-in runner performs the shared recurrence and reports its actual state vectors. The line-navigation reference solver independently computes ground truth and is never called by the model output path.

Phase 3 adds a guided educational interface, state timeline, scrubber, signed state heatmap, numerical inspection, and derived visual summaries. These views consume state from local PyTorch CPU execution; teaching equations and lesson diagrams are marked `ILLUSTRATIVE` rather than `LIVE`.

Phase 5 adds `hrm-inspired-hierarchical-recurrence-v1`, a local PyTorch CPU float64, fixed-seed (`20260908`), untrained educational substrate. LIVE results contain actual H/L state telemetry. The verified primary source is Guan Wang et al., *Hierarchical Reasoning Model*, arXiv:2506.21734v3. The paper's distinct L/H timing and H-state output readout motivate the simplified local mechanism. Its learned modules, training, deep supervision, one-step gradient approximation, adaptive computation time, datasets, and benchmarks are not implemented. PUBLISHED paper claims, LIVE local records, and ILLUSTRATIVE explanations must not be conflated.

Phase 7 adds no new research mechanism. It replaces per-request Python process spawning with a persistent worker (`src/reasoning/worker-server.py`, `src/reasoning/worker-client.js`) that reuses the existing runners' own `execute()`/`build_parameters()` functions unchanged, adds deployment artifacts (`Dockerfile`, `requirements.txt`, CI), and adds a local seed characterization (`src/experiments/seed-characterization.js`) that runs the existing `recurrent` architecture across a small, fixed additional-seed set — not a new model or a benchmark claim. See `docs/phase-7-deployability-hardening.md` and `docs/CLAIM-AUDIT.md`.

## External research

Potential research references include HRM, URM, CODI, BDH, BDH-CQ, Coconut, and other references added only after verification. The registry records verification status; no bibliographic details, licensing, code-reuse status, weights, or data availability are assumed.

## External infrastructure

OmniRoute is prospective execution-routing infrastructure. No integration is present in Phase 1. No external inference service is required.

## External datasets

To be populated only after exact datasets are selected.

## External weights

No external weights are used in Phase 1. Populate only after exact model artifacts are selected.

## External visualization/assets

No external visualization assets are used in Phase 1. Populate when assets are actually selected.

## AI assistance

AI-assisted development may be used, but every generated component must be understood, verified, and disclosed according to competition requirements. Licensing is never inferred: a license is stated only after it is verified from the relevant source repository or artifact.
