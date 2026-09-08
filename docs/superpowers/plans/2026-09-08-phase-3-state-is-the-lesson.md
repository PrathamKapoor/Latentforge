# Phase 3 State Is the Lesson Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the existing live Phase 2 recurrent experiment into a guided, state-first learning experience with an honest live preset, real state scrubbing, budget manipulation, visible failure, and a gated sandbox.

**Architecture:** Preserve the Phase 2 backend/API contract and implement Phase 3 as a client-side experience controller over actual returned experiment records. The live preset calls `POST /api/experiment` on load; the controller stores returned runs, selects states without recomputation, and unlocks sandbox controls only after the learner performs a live budget change, passes the knowledge check, and submits an explanation.

**Tech Stack:** Existing Node 24 ESM server, browser JavaScript/CSS/HTML, native `node:test`, existing PyTorch CPU runner unchanged unless additive telemetry is proven necessary.

**Spec:** `docs/superpowers/specs/2026-09-08-phase-3-state-is-the-lesson-design.md`

## Global Constraints

- Preserve all Phase 0–2 backends, contracts, tests, seed `20260907`, task semantics, recurrence, and observed budget outcomes.
- The preset must execute `POST /api/experiment` with live recurrent backend, task `1,0,1,1`, budget `4`; never hardcode a result or label cached data `LIVE`.
- The same task/backend/seed/configuration must be used for budget comparison; only reasoning budget changes.
- h₀ and h₁…hₙ must come from returned state vectors; no visualization-only state, latent-dimension semantic labels, chain-of-thought, or synthetic fallback.
- Equation/diagram is `ILLUSTRATIVE` and invariant; selecting a state may highlight a reference but must not change the rule.
- Preserve and explain the actual local failure pattern; do not change model parameters or task to force monotonic improvement.
- Guided mode is default; at least one step requires a real live budget manipulation before progression; sandbox unlock requires manipulation, quiz, and explanation submission.
- Evidence labels remain `LIVE`, `SYNTHETIC`, and `ILLUSTRATIVE` with their existing meanings.
- Do not add HRM, URM, CODI, Coconut, BDH-CQ, OmniRoute, agentic planning, benchmarks, token-saving claims, or efficiency claims.

## Traceability matrix

| Specification requirement | Implementation task | Acceptance test |
| --- | --- | --- |
| Live preset executes on load | Task 1 | Browser controller test observes a POST with recurrent/task/budget and renders returned run; no fixture is used as initial result. |
| h₀…hₙ and raw values | Task 2 | State selection test renders every returned dimension and exact numeric strings. |
| Norm/mean/std/delta/cosine | Task 2 | Metrics test recomputes each value from fixture vectors and checks selected state. |
| Signed heatmap, shared scale | Task 2 | DOM test checks negative/positive classes, shared scale text, and raw-value preservation. |
| Scrubber/timeline without recompute | Task 2 | Selecting h₃ changes inspector/prediction/metrics and request count remains unchanged. |
| Invariant equation | Task 3 | State selection leaves equation text unchanged and only updates selected-state marker; evidence is `ILLUSTRATIVE`. |
| Prediction vs truth/failure visibility | Task 3 | Known budget fixture shows 1/2/4/8 outcomes and explicit incorrect states/limitation copy. |
| Real budget manipulation gates lesson | Task 4 | Guided progression remains blocked until a budget-change request completes with `LIVE` evidence and extra/different trajectory. |
| Quiz and explanation | Task 4 | Correct option unlocks next step; explanation submission reveals reference explanation and contributes to completion. |
| Sandbox gating and controls | Task 4 | Sandbox is unavailable before completion and exposes only task/backend/budget/Run after completion. |
| Same config comparison | Task 5 | Comparison requests preserve task/backend/seed/configuration and vary only budget. |
| Error/evidence integrity | Tasks 1–5 | Malformed/missing/non-live responses fail controlled; no synthetic fallback; evidence labels match source. |
| Documentation and claims | Task 5 | Documentation tests find live preset, failure limitation, evidence definitions, and no unsupported claims. |

---

### Task 1: Experience state model and live preset controller

**Files:**
- Create: `src/ui/phase3-experience-controller.js`
- Create: `test/phase3-experience-controller.test.js`
- Modify: `public/app.js`

**Flow:** Runs before the learner sees the lesson; starts the real live preset and owns Guided/Sandbox state. **Why:** prevents a blank canvas and prevents hardcoded “live” data. **Evidence:** returned experiment remains `LIVE`; controller metadata is explanatory UI state only.

**Interfaces:**
- `createPhase3Experience({ requestExperiment, renderRun, renderError })` returns `{ state, startPreset(), submitBudgetChange(budget), answerCheck(choice), submitExplanation(text), unlockSandbox() }`.
- `startPreset()` calls `{ task: '1,0,1,1', reasoningBudget: 4, backend: 'recurrent' }` and refuses to render if result evidence is not `LIVE`.
- `submitBudgetChange(budget)` requires a supported budget different from the preset/current budget, executes it through the real request function, and records `manipulated: true` only after a successful live result.

- [ ] **Step 1: Write failing tests** for live request formation, no hardcoded initial result, non-LIVE rejection, and manipulation gating.
- [ ] **Step 2: Run `node --test test/phase3-experience-controller.test.js`** and confirm failure because the controller is absent.
- [ ] **Step 3: Implement the minimal controller** with explicit `mode: 'GUIDED'`, `lessonStep`, `presetRun`, `selectedRun`, `manipulated`, `quizPassed`, `explanationSubmitted`, and `sandboxUnlocked` state. Never create a result object in the controller.
- [ ] **Step 4: Run the focused controller tests and `npm test`**; require all prior Phase 0–2 tests to remain green.

### Task 2: First-class state timeline, scrubber, inspector, and heatmap

**Files:**
- Create: `src/ui/state-observability.js`
- Create: `test/state-observability.test.js`
- Modify: `public/index.html`
- Modify: `public/app.js`
- Modify: `public/styles.css`

**Flow:** Used in Guided lesson steps 2–4 and sandbox. **Why:** makes the actual eight-dimensional state the lesson. **Evidence:** state values and metrics are `LIVE` or `SYNTHETIC` according to the selected run; heatmap/equation visuals are `ILLUSTRATIVE`.

**Interfaces:**
- `createStateViewModel(result)` validates dimension consistency from `result.configuration.hiddenSize`, returns states `[h0, h1…hn]`, and preserves raw values/metrics.
- `selectState(viewModel, index)` returns the selected state without network calls or recomputation.
- `renderStateView(container, viewModel, selectedIndex, handlers)` renders timeline, range scrubber, signed heatmap, metrics, and all dimension/value rows.

- [ ] **Step 1: Write failing tests** for all states, exact numeric values, dimension validation, signed classes/shared scale, metrics, keyboard selection, and no request on scrub.
- [ ] **Step 2: Run the focused test and confirm failure.**
- [ ] **Step 3: Implement state view model/rendering.** h₀ has no fabricated prediction; h₁…hₙ use returned per-step prediction. Do not name dimensions semantically. The heatmap uses one symmetric max-absolute-value scale and displays raw values beside it.
- [ ] **Step 4: Run focused tests, frontend tests, and build.**

### Task 3: Equation, prediction/truth, comparison-row selection, and limitation copy

**Files:**
- Create: `src/ui/phase3-lesson-panels.js`
- Create: `test/phase3-lesson-panels.test.js`
- Modify: `public/index.html`
- Modify: `public/app.js`
- Modify: `public/styles.css`

**Flow:** Appears after state inspection and beside every budget result. **Why:** connects invariant mathematics to the selected actual state and keeps truth/error visible. **Evidence:** equation and explanatory text are `ILLUSTRATIVE`; model result/truth remain source-labelled `LIVE` or `SYNTHETIC`.

**Interfaces:**
- `renderEquationPanel(selectedLabel)` always renders the same three equations and only changes a selected-state marker.
- `renderTruthEstimate(result)` displays prediction, independent ground truth, correctness, and explicit `Prediction ≠ Ground Truth` on failure.
- `renderComparisonRows(results, onSelect)` displays actual budget/prediction/truth/correctness/steps and selects an existing returned run without recomputation.

- [ ] **Step 1: Write failing tests** for equation invariance, `ILLUSTRATIVE` label, known 1/2/4/8 result messaging, truth prominence, and comparison-row selection.
- [ ] **Step 2: Run focused tests and confirm failure.**
- [ ] **Step 3: Implement panels** without changing backend parameters or rewriting results. Include the exact limitation wording: this pattern is observed in the small untrained local substrate and is not a universal property of recurrent latent reasoning.
- [ ] **Step 4: Run focused/UI/regression tests and build.**

### Task 4: Guided lesson, knowledge check, explanation, and sandbox unlock

**Files:**
- Create: `src/ui/guided-lesson.js`
- Create: `test/guided-lesson.test.js`
- Modify: `public/index.html`
- Modify: `public/app.js`
- Modify: `public/styles.css`

**Flow:** Default experience before sandbox. **Why:** satisfies “guide, then sandbox” and ensures the learner reproduces the central claim rather than reading a slideshow. **Evidence:** instructional cards/equations are `ILLUSTRATIVE`; live manipulation/result remains `LIVE`.

**Interfaces:**
- `createGuidedLesson({ controller, render })` exposes `currentStep`, `next()`, `previous()`, `answer(choice)`, `submitExplanation(text)`, and `canEnterSandbox()`.
- Step 4 `next()` is disabled until `controller.state.manipulated === true` from a successful live budget-change request.
- Quiz correct choice is `B`; explanation submission requires non-empty text and reveals a reference explanation without grading semantics.

- [ ] **Step 1: Write failing tests** for default Guided mode, 5 lesson stages, manipulation gate, quiz, explanation, sandbox unlock, keyboard/focus behavior, and reduced-motion-safe status updates.
- [ ] **Step 2: Run focused tests and confirm failure.**
- [ ] **Step 3: Implement concise lesson UI**: question, state, invariant rule, live manipulation, limitation/takeaway. The completion prompt explicitly asks the learner to change budget, observe updates, inspect prediction, and compare truth in under a minute.
- [ ] **Step 4: Run focused/UI/regression tests and build.**

### Task 5: Documentation, contract checks, and final verification

**Files:**
- Create: `test/phase3-documentation.test.js`
- Modify: `README.md`
- Modify: `docs/ARCHITECTURE.md`
- Modify: `docs/DEVELOPMENT.md`
- Modify: `docs/EXPERIMENT-CONTRACT.md`
- Modify: `docs/PROVENANCE.md`

**Flow:** Supports learner-facing “what am I looking at?” copy and technical details throughout the experience. **Why:** documents evidence boundaries, reproducibility, limitations, and future BDH/BDH-CQ connection without implementing it. **Evidence:** documentation about equations is `ILLUSTRATIVE`; runtime provenance remains `LIVE` only for actual execution.

- [ ] **Step 1: Write failing documentation assertions** for guided/sandbox flow, live preset, invariant equation, failure limitation, evidence vocabulary, and explicit non-claims.
- [ ] **Step 2: Run the documentation test and confirm failure.**
- [ ] **Step 3: Update docs** with the Phase 3 learning journey and exact no-fabrication rules; do not add BDH implementation or unsupported research metadata.
- [ ] **Step 4: Run `npm test`, `npm run build`, and manual HTTP checks for budgets 1/2/4/8, repeatability, malformed responses, and synthetic regression. Attempt browser, responsive, and accessibility verification; report each as PASS/FAIL/NOT VERIFIED based on actual tooling.

## Self-review and coverage audit

The traceability matrix covers every requirement in the approved Phase 3 specification. No task changes the recurrent model, seed, task, output head, or observed failure pattern. The plan has no TODO/TBD placeholders, no new endpoint, no cache, no semantic latent-dimension interpretation, and no fallback path. Existing tests remain required in every task’s regression command.
