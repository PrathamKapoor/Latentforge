# Phase 4 Reasoning Budget Experiment Implementation Plan

**Goal:** Add a real, deterministic, traceable budget sweep over the existing live recurrent backend.

**Spec:** `docs/superpowers/specs/2026-09-08-phase-4-budget-experiment-design.md`

1. Create `src/experiments/reasoning-budget-sweep.js` and `test/reasoning-budget-sweep.test.js`. Test first: verify four actual executor calls, fixed base request/configuration, preserved run IDs/trajectories/truth, failure surfacing, repeat determinism excluding latency, and no synthetic fallback. Implement a small executor-injected sweep abstraction.
2. Extend `public/index.html`, `public/app.js`, and `public/styles.css` with a laboratory sweep panel, reset/repeat button, selected-row state loading, textual controlled-variable statement, final metric/trajectory comparison, and learner questions. Add frontend tests for actual-row rendering, evidence labels, failure display, and no semantic dimension labels.
3. Update README, architecture, experiment contract, and provenance; add documentation tests. Run focused tests, full `npm test`, `npm run build`, live HTTP budgets 1/2/4/8, and browser verification when available.
