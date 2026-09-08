# Phase 6 BDH-CQ-inspired Implementation Plan

**Goal:** Add one deterministic, local BDH-CQ-inspired memory-plus-latent-workspace experiment without altering Phases 0–5.

**Spec:** `docs/phase-6-bdh-cq.md`

1. Test-first: create a CPU runner that ingests a bounded sequence of demonstrations into actual `S` memory, initializes query workspace `H`, applies shared nonlinear `H` updates, and emits telemetry. Test determinism, actual `K` memory updates, `R` workspace updates, finite failure, and output-head provenance.
2. Add a separate `bdh-cq-inspired` backend adapter and registry entry. Map actual S/H telemetry into the preserved contract, call the independent line-navigation solver only for truth, and test validation/no synthetic fallback.
3. Add an executor-injected comparison that holds query/task/reference/seed/precision fixed and varies the documented memory-ingestion mechanism. Test distinct IDs and actual backend records.
4. Extend the canonical guided module and browser with one real demonstration-count control, returned S/H inspector, comparison, and research explorer. Test canonical-state-machine gating and evidence labels.
5. Update README/architecture/contract/provenance; run focused tests, complete `npm test`, build, manual HTTP backend/comparison checks, Phase 4 regression, and browser verification if available.
