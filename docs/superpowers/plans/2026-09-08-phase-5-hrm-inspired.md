# Phase 5 HRM-inspired Hierarchical Recurrence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `executing-plans` task-by-task with tests and review checkpoints.

**Goal:** Add a small, deterministic, observable HRM-inspired hierarchical recurrent research mode without altering the Phase 1–4 recurrent baseline.

**Architecture:** A separate Python runner executes a low-level state every requested step and a high-level state every two low-level steps. A Node adapter validates and maps its actual telemetry into the existing contract; the browser conditionally renders hierarchy-specific telemetry while retaining generic state support.

**Tech stack:** Native ES modules, Node HTTP API, Python 3/PyTorch CPU float64, native HTML/CSS/JS, `node:test`.

**Spec:** `docs/superpowers/specs/2026-09-08-phase-5-hrm-inspired-design.md`

## Global constraints

- Do not modify `recurrent-runner.py`, `recurrent-latent-backend.js`, its seed, weights, task, recurrence, output head, or reference solver.
- Name the new mode `HRM-inspired hierarchical recurrence`; never describe it as a HRM reproduction.
- The local runner is `LIVE`; diagrams/equations are `ILLUSTRATIVE`; source descriptions are `PUBLISHED`; synthetic remains `SYNTHETIC`.
- Do not train, add adaptive halting, use published benchmarks, external inference, or semantic labels for latent dimensions.
- A local baseline/hierarchy comparison must disclose the separate architecture parameters.

---

### Task 1: Deterministic hierarchical local runner

**Files:** create `src/reasoning/hrm-inspired-runner.py`, `test/hrm-inspired-runner.test.js`.

**Produces:** a stdin/stdout JSON runner accepting `{ inputVector, reasoningBudget, seed }` and returning actual initial/per-step high and low states, `highUpdated`, high-state output logits/prediction, finite metrics, environment, and latency.

1. Write tests that invoke the runner twice and assert exact repeatability, valid H/L sizes, exactly budget observations, H updates only on every second low update, high-state-derived prediction, and controlled invalid/non-finite errors.
2. Run the runner tests and observe failure because the runner does not exist.
3. Implement fixed-seed CPU float64 input, low, high, and output tensors, equations from the spec, finite checks, and JSON-only error output.
4. Re-run the focused runner test and review the raw output: it must be produced by tensors, not a solver or fabricated sequence.

### Task 2: Hierarchical backend and safe registry integration

**Files:** create `src/reasoning/hrm-inspired-backend.js`, `test/hrm-inspired-backend.test.js`; modify `src/reasoning/backend-registry.js`, `test/api.test.js`, `package.json`.

**Consumes:** Task 1 JSON runner and `encodeLineNavigationTask`/`solveLineNavigationTask`.

**Produces:** registered selector `hrm-inspired`, additive contract records with `hierarchicalStateObservationsByStep`, `hierarchicalInitialState`, actual H-head prediction and independent truth.

1. Write failing adapter/API tests for validation, LIVE identity, deterministic state/prediction, actual H/L telemetry/cadence, independent ground truth, unsupported selector error, and unchanged recurrent regression fixture.
2. Run focused tests and observe registration/import failures.
3. Implement adapter validation, process execution, strict runner-result validation, configuration/provenance, and registry entry. Keep generic latent observations mapped to actual low state for old clients, and expose high/low state separately.
4. Add runner syntax check to `npm run build`; run focused adapter/API/recurrent regression tests. Review that no branch invokes synthetic execution.

### Task 3: Minimal hierarchical laboratory view

**Files:** modify `public/index.html`, `public/app.js`, `public/styles.css`, `test/frontend-shell.test.js`, `test/phase3-experience.test.js` where necessary.

**Consumes:** Task 2's additive response fields.

**Produces:** an explicit backend choice and conditional H/L timeline/inspector using only returned values; textual cadence, output/truth, controlled-comparison and limitation context.

1. Write failing client-level tests for the HRM-inspired selector/copy, safe response validation, rendered actual H/L dimensions/update flags, no semantic labels, no LIVE illustrative equations, and graceful malformed hierarchy handling.
2. Run the focused frontend test and observe the missing hierarchy UI/assertion failure.
3. Add the smallest hierarchy panel and rendering helpers. It must only render when the validated response supplies actual `hierarchical...` telemetry, must not rerun on state selection, and must state H output drives the local hierarchical prediction.
4. Run focused frontend and Phase 3 tests. Review keyboard semantics, non-colour text, reduced-motion inheritance, and narrow-screen stacking.

### Task 4: Research traceability and documentation

**Files:** modify `README.md`, `docs/ARCHITECTURE.md`, `docs/EXPERIMENT-CONTRACT.md`, `docs/PROVENANCE.md`, `research/references/README.md`, `test/phase3-documentation.test.js` or create `test/phase5-documentation.test.js`.

**Produces:** verified HRM bibliography, paper-to-local mapping, exact-vs-simplified boundary, fixed/variable comparison conditions, evidence meanings, and limitations.

1. Write failing documentation assertions for the HRM primary source URL, explicit simplified/untrained boundary, and no reproduction/benchmark claims.
2. Run the documentation test and observe it fail before documentation is updated.
3. Update the listed documents with source-backed facts only and document omitted training/ACT/benchmark work.
4. Run documentation tests and inspect copy for unsupported superiority, efficiency, or semantic claims.

### Task 5: End-to-end verification

**Files:** no planned feature files; modify only if a tested factual defect is found.

1. Run Phase 5 tests, all existing tests, and `npm run build`.
2. Start the server and POST valid recurrent and `hrm-inspired` runs at budgets 1/2/4/8; verify IDs, LIVE evidence, independent truth, actual trajectory lengths/cadence, and explicit invalid-backend failure.
3. Inspect the full file tree and git status equivalent. Attempt browser interaction only if controllable browser tooling exists; otherwise report it as NOT VERIFIED.
4. Review Phase 5 against the spec: no baseline mutation, fake state, silent fallback, named-architecture reproduction claim, benchmark claim, Phase 6 work, or dimension semantics.
