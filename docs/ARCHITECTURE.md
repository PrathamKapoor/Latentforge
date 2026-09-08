# LatentForge Architecture

## Current architecture (Phase 7 — what actually runs today)

```
                 ┌───────────────────────────────┐
                 │        LatentForge UI         │
                 │ Guided Lesson / Sandbox /     │
                 │ State Inspector / Experiments │
                 └───────────────┬───────────────┘
                                 │
                                 ▼
                 ┌───────────────────────────────┐
                 │          Node API             │
                 │ validation / queue / limits   │
                 │ experiment orchestration      │
                 │ GET /health, GET /ready       │
                 └───────────────┬───────────────┘
                                 │
                                 ▼
                 ┌───────────────────────────────┐
                 │  Persistent Python Worker      │
                 │         PyTorch CPU            │
                 └───────────────┬───────────────┘
                                 │
                        ┌────────┼────────┐
                        ▼        ▼        ▼
                   Recurrent   HRM-I    BDH-CQ-I
```

This diagram is the actual deployed shape — see `docs/phase-7-deployability-hardening.md` for the worker protocol and resource model. The "Future research modes" and "Future agent contract" sections further down this document describe conceptual, **not implemented**, extensions; they are kept separate from this section deliberately (see also `README.md`'s implementation status table).

## Scope and flow

This is a Phase 0 conceptual architecture, not an implementation claim. The intended flow is:

`User → Experience → Reasoning Experiment Agent → OmniRoute (only when external routing is required) → Reasoning Experiment Engine → Recurrent Latent Core → Evaluation → Observability → User`

The system does not reveal hidden chain-of-thought. It may expose safe state observations, computation budgets, selected mode, verification status, high-level decision rationale, and measurable telemetry.

## Phase 2 implementation

The live path (updated in Phase 7 — see below) is:

`Browser → POST /api/experiment → safe backend registry → recurrent adapter → persistent Python worker → h₀ → shared recurrent transition → h₁ … hₙ → output head → prediction`

Phase 2 originally spawned a fresh Python process per request; Phase 7 replaced that with the persistent worker shown in "Current architecture" above, without changing the recurrence math, seed, or the adapter's contract shape.

In parallel, the task is sent to an independent reference solver for ground truth. The adapter compares the two and returns the actual state trajectory and metrics through the preserved Phase 0 contract. The synthetic adapter remains available as an explicit alternative.

The live runner is a minimal local toy recurrent neural system, deterministically initialized with seed `20260907`, hidden size 8, CPU `float64`, and `tanh`. It is not HRM, URM, CODI, Coconut, or BDH-CQ. The UI renders h₀ and h₁..hₙ from the returned state vectors; it does not create a second visualization state and does not treat a vector as a human-readable thought.

## Phase 3 learning flow

`Guided lesson → live preset → state timeline/scrubber → live budget manipulation → prediction/truth comparison → limitation → learner explanation → sandbox`

## Phase 5 HRM-inspired hierarchical mode

`Browser → POST /api/experiment (hrm-inspired) → isolated adapter → local Python runner → L updates each low step; H updates every two low steps → H output head → prediction → independent line-navigation solver → truth`.

The existing `recurrent` path is unchanged. The hierarchical mode is a local, untrained educational simplification inspired by Wang et al.'s two-module cadence, not a reproduction of HRM. A controlled comparison runs both live backends with the same task/reference and budget, but separate fixed parameter structures; it is an architectural observation, not an accuracy benchmark.

The guided controller consumes existing experiment responses. State selection only changes the selected returned state; it does not issue a model request. Equation and teaching diagrams are `ILLUSTRATIVE`; actual recurrent state is `LIVE`; synthetic arithmetic remains `SYNTHETIC`.

## Phase 1 implementation

The implemented path is deliberately narrower than the conceptual flow:

`Browser client → POST /api/experiment → Synthetic demonstration backend → Phase 0 experiment result shape → Browser client`

`src/server/server.js` owns HTTP parsing, static assets, request validation handoff, and structured JSON errors. `src/reasoning/synthetic-demo-backend.js` is a replaceable `ReasoningBackend`-shaped adapter. It creates its result using the existing Phase 0 contract factory and populates actual synthetic-execution fields. `public/app.js` consumes generic `latentStateObservationsByStep`, evidence metadata, final prediction, and ground truth; it contains no synthetic-backend implementation logic.

The browser surface is a native HTML/CSS/JS client rather than a framework application. This was selected to avoid dependencies while retaining a real API boundary and a maintainable, small codebase.

### Implemented now

- Static browser shell and responsive, accessible experiment workspace.
- `POST /api/experiment` with server-side JSON and budget validation.
- Deterministic `17 + 28` synthetic demonstration with a configurable 1, 2, 4, or 8-step budget.
- Contract-compatible step observations, final prediction, ground truth, provenance, and evidence metadata.
- Explicit loading, empty, malformed-response, and API-error user states.

### Planned later

The Reasoning Experiment Agent, OmniRoute Gateway, real recurrent latent core, research modes, and publication-grade evaluation remain conceptual. Phase 2 should add another backend adapter; it must not make the UI depend on model internals or hidden chain-of-thought.

## Layers

| Layer | What / why | When / how | Inputs / outputs | Responsibilities / non-responsibilities | Error boundary / tests |
| --- | --- | --- | --- | --- | --- |
| Experience Layer | Learner-facing interaction surface; makes experiments understandable. | Used for every learner interaction; invokes the agent through a stable experiment request. | Input: learner task and controls. Output: clearly evidence-labelled results. | Presents controls/results; does not execute models or infer internals. | Render/input failures stay here. Test accessibility, evidence labels, and request formation. |
| Reasoning Experiment Agent | Policy coordinator for task interpretation and computation allocation. | Used when an experiment needs budget, mode, or backend selection. | Input: task/configuration. Output: an execution plan and safe telemetry. | Chooses and verifies at a high level; does not expose private reasoning text or implement model recurrence. | Policy/validation failures return structured decisions. Test decisions with deterministic fixtures. |
| OmniRoute Gateway | Optional adapter boundary for external model/provider/tool routing. | Only when execution requires external routing. | Input: provider-neutral route request. Output: normalized route response/error. | Routes and normalizes infrastructure concerns; is not a reasoning mode or topic. | Provider/network failures terminate here as typed errors. Test adapters with controlled transport fakes. |
| Reasoning Experiment Engine | Orchestrates one reproducible experiment run. | Used after an execution plan exists. | Input: experiment contract and backend. Output: per-step records, final result, metrics. | Applies budget and collects evidence; does not contain a research mechanism. | Invalid configuration/execution failures become experiment errors. Test orchestration and record completeness. |
| Recurrent Latent Core | Backend-specific computation boundary for recurrent latent-state updates. | Used by a selected future backend. | Input: task, initial state, step budget. Output: step observations and final prediction. | Performs backend computation behind an adapter; does not dictate UI or claim state readability. | Backend/model errors stay isolated. Test backend contracts and step sequencing. |
| Research Modes | Future boundaries: HRM-inspired, URM-inspired, CODI-inspired, and BDH-CQ. | Selected by future configuration after verified integration. | Input: mode config. Output: compatible backend/analysis configuration. | Define mechanisms and ablations; do not create separate competition topics. | Unsupported modes fail at selection. Test mode-to-adapter compatibility. |
| Observability / Evaluation | Measures, classifies, and communicates evidence. | Used during and after actual execution. | Input: step records and final outputs. Output: metrics, scores, telemetry, evidence labels. | Distinguishes LIVE, PRECOMPUTED, SYNTHETIC, PUBLISHED, ILLUSTRATIVE; does not manufacture results. | Missing/invalid measures are explicit, never inferred. Test label propagation and metric schemas. |
| Research / Provenance | Records what was built, sourced, and verified. | Used whenever a source, dataset, weight, asset, or claim enters the project. | Input: source metadata. Output: auditable provenance record. | Tracks evidence and licensing status; does not guess facts or licenses. | Unknown provenance blocks publication-grade claims. Test required provenance fields. |

## Future research modes

HRM-inspired, URM-inspired, CODI-inspired, and BDH-CQ are documented architecture boundaries only. No model, integration, results, or visual representation of those systems is implemented in Phase 0.

## Additive architecture rule

> Prefer additive architecture. Do not replace working components merely because a new research mechanism is being added.

Introduce future research through adapters, isolated modules, explicit interfaces, configuration, and feature flags where appropriate. The experiment engine consumes contracts, not a monolithic reasoning implementation.

## Learning journey

1. **WATCH** — A working reasoning example is already running.
2. **MANIPULATE** — Learner changes latent reasoning steps.
3. **COMPARE** — Learner compares explicit/token reasoning with latent reasoning.
4. **BREAK** — Learner intentionally pushes the system into failure.
5. **UNDERSTAND** — HRM and URM mechanisms explain recurrence and ablation.
6. **REPRESENT** — CODI explains the transition from explicit reasoning to continuous latent representation.
7. **CONNECT** — BDH-CQ shows recurrent latent reasoning in a real Pathway research system.
8. **DELEGATE** — The agent decides how much reasoning computation to allocate.
9. **ROUTE** — OmniRoute provides model/provider routing infrastructure.

This sequence is an intended future experience; Stage 1 and all later stages are not implemented in Phase 0.

## Future agent contract

`User task → task interpretation → difficulty/structure assessment → reasoning-budget decision → model/backend selection → execution → verification → additional computation if justified → final answer`

The agent may expose reasoning budget, selected mode, computation-step count, verification status, high-level decision rationale, and measurable telemetry. It must not expose hidden chain-of-thought text.
