# Phase 2 Recurrent Substrate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a local LIVE recurrent latent-state substrate, independently evaluated task, telemetry, backend selection, and minimal UI inspection to LatentForge.

**Architecture:** A Node adapter validates and selects backends. The live backend invokes one checked-in local PyTorch CPU runner that deterministically creates an 8-dimensional `tanh` recurrent neural substrate, executes the shared transition the requested number of times, and returns actual states. Node owns task parsing/reference ground truth, contract shaping, and HTTP behavior; the browser renders only contract-level result data.

**Tech Stack:** Node.js 24 ESM, native `node:test`, native HTTP server, browser JavaScript/CSS, Python 3.13, local PyTorch CPU.

**Spec:** `docs/superpowers/specs/2026-09-07-phase-2-recurrent-substrate-design.md`

## Global Constraints

- Preserve `POST /api/experiment`, the Phase 0 contract, server, UI, synthetic backend, and existing tests.
- Default to `backend: "recurrent"`; only `recurrent` and `synthetic` are permitted.
- Maximum budget is exactly 8; no fallback from recurrent to synthetic is permitted.
- Use deterministic initialization seed 20260907; no training, downloads, APIs, external weights, chain-of-thought, or unsupported research-architecture claims.
- All UI state graphics derive from returned backend state; `LIVE` only identifies current recurrent execution and `SYNTHETIC` remains explicit.

---

### Task 1: Independent line-navigation task and reference solver

**Files:**
- Create: `src/reasoning/line-navigation-task.js`
- Create: `test/line-navigation-task.test.js`

**Interfaces:**
- Produces `parseLineNavigationTask(task)`, `solveLineNavigationTask(task)`, and `encodeLineNavigationTask(task)`.
- `parseLineNavigationTask("1,0,1,1")` returns `{ moves: [1,0,1,1] }` or throws `UNSUPPORTED_TASK`.
- `solveLineNavigationTask(task)` returns a position in `[0, 4]` without importing any model module.

- [ ] **Step 1: Write the failing test**

```js
test('solves bounded line navigation independently', () => {
  assert.equal(solveLineNavigationTask('1,1,1,1'), 4);
  assert.equal(solveLineNavigationTask('0,0,0,0'), 0);
  assert.deepEqual(encodeLineNavigationTask('1,0,1,1'), [1, 0, 1, 1]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/line-navigation-task.test.js`

Expected: FAIL because the task module does not exist.

- [ ] **Step 3: Write minimal implementation**

```js
export const LIVE_TASK_EXAMPLE = '1,0,1,1';
export function parseLineNavigationTask(task) { return { moves: task.split(',').map(Number) }; }
export function encodeLineNavigationTask(task) { return parseLineNavigationTask(task).moves; }
export function solveLineNavigationTask(task) { return encodeLineNavigationTask(task).reduce((position, move) => Math.max(0, Math.min(4, position + (move ? 1 : -1))), 2); }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/line-navigation-task.test.js`

Expected: PASS.

### Task 2: Deterministic PyTorch recurrent runner

**Files:**
- Create: `src/reasoning/recurrent-runner.py`
- Create: `test/recurrent-runner.test.js`

**Interfaces:**
- Consumes one JSON stdin request `{ inputVector: number[4], reasoningBudget: 1|2|4|8, seed: 20260907 }`.
- Produces one JSON stdout result `{ initialState, observations, finalPrediction, runtime }`.
- Each observation has `{ state, stateNorm, mean, standardDeviation, deltaFromPrevious, cosineSimilarityToPrevious, prediction }`.

- [ ] **Step 1: Write the failing test**

```js
test('the runner returns one real state per requested transition deterministically', async () => {
  const once = await executeRunner([1, 0, 1, 1], 4);
  const twice = await executeRunner([1, 0, 1, 1], 4);
  assert.deepEqual(once, twice);
  assert.equal(once.observations.length, 4);
  assert.equal(once.initialState.length, 8);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/recurrent-runner.test.js`

Expected: FAIL because the runner is absent.

- [ ] **Step 3: Write minimal implementation**

```py
torch.manual_seed(seed)
h0 = torch.tanh(encode_weight @ x + encode_bias)
for step in range(budget):
    next_h = torch.tanh(hidden_weight @ h + input_weight @ x + hidden_bias)
    logits = output_weight @ next_h + output_bias
    assert torch.isfinite(next_h).all() and torch.isfinite(logits).all()
    # serialize h, L2 norm, mean, population std, L2 delta, cosine, argmax
    h = next_h
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/recurrent-runner.test.js`

Expected: PASS and byte-for-byte equivalent repeated JSON result excluding measured duration.

### Task 3: Live backend adapter and backend registry

**Files:**
- Create: `src/reasoning/recurrent-latent-backend.js`
- Create: `src/reasoning/backend-registry.js`
- Create: `test/recurrent-latent-backend.test.js`
- Modify: `src/reasoning/synthetic-demo-backend.js`

**Interfaces:**
- Produces `executeRecurrentLatent(request)` and `validateRecurrentRequest(request)`.
- Produces `getBackend(id)` and `validateBackendId(id)`.
- Recurrent result uses `createExperimentContract`, `metadata.evidenceLevel === "LIVE"`, and final prediction from the runner final state.

- [ ] **Step 1: Write the failing test**

```js
test('live backend has exact state telemetry and a final-state prediction', async () => {
  const result = await executeRecurrentLatent({ task: '1,0,1,1', reasoningBudget: 4 });
  assert.equal(result.metadata.evidenceLevel, 'LIVE');
  assert.equal(result.latentStateObservationsByStep.length, 4);
  assert.equal(result.finalPrediction, result.predictionsByStep.at(-1).prediction);
  assert.equal(result.groundTruth, 3);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/recurrent-latent-backend.test.js`

Expected: FAIL because the live backend is absent.

- [ ] **Step 3: Write minimal implementation**

```js
export const RECURRENT_BACKEND_ID = 'recurrent-latent-toy-v1';
export async function executeRecurrentLatent(request) {
  const inputVector = encodeLineNavigationTask(request.task);
  const groundTruth = solveLineNavigationTask(request.task);
  const runnerResult = await executeRunner(inputVector, request.reasoningBudget, RECURRENT_SEED);
  return createLiveExperiment(request, groundTruth, runnerResult);
}
export function getBackend(id = 'recurrent') { return BACKENDS[id] || null; }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/recurrent-latent-backend.test.js test/synthetic-demo-backend.test.js`

Expected: PASS; synthetic behavior remains intact.

### Task 4: HTTP selection and integration tests

**Files:**
- Modify: `src/server/server.js`
- Modify: `test/api.test.js`

**Interfaces:**
- `POST /api/experiment` accepts `{ task, reasoningBudget, backend? }`.
- Defaults omitted backend to `recurrent`; invalid identifiers return `400 VALIDATION_ERROR`.

- [ ] **Step 1: Write the failing tests**

```js
assert.equal(recurrentBody.metadata.evidenceLevel, 'LIVE');
assert.equal(recurrentBody.latentStateObservationsByStep.length, 2);
assert.equal(syntheticBody.metadata.evidenceLevel, 'SYNTHETIC');
assert.equal(invalidResponse.status, 400);
assert.match(invalidBody.error.message, /backend/i);
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test test/api.test.js`

Expected: FAIL because the server always invokes synthetic execution.

- [ ] **Step 3: Write minimal implementation**

```js
const selection = getBackend(body.backend);
if (!selection.valid) return sendJson(response, 400, validationError(selection.errors[0]));
const result = await selection.backend.execute(body);
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test test/api.test.js`

Expected: PASS for live, synthetic, malformed input, and invalid backend paths.

### Task 5: Contract-consuming UI and visual inspection

**Files:**
- Modify: `public/index.html`
- Modify: `public/app.js`
- Modify: `public/styles.css`

**Interfaces:**
- UI sends `backend`, renders only validated result fields, and runs budget comparison requests for the selected task/backend.
- State inspector selection is client-only and reads `stateObservation.values` supplied by the backend.

- [ ] **Step 1: Write the failing structural check**

```js
test('browser shell exposes explicit backend choice and state inspector', async () => {
  const html = await loadPublicHtml();
  assert.match(html, /Live recurrent substrate/);
  assert.match(html, /Synthetic contract demo/);
  assert.match(html, /State inspector/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/frontend-shell.test.js`

Expected: FAIL because the Phase 1 page has no backend choice or inspector.

- [ ] **Step 3: Write minimal implementation**

```js
function assertRenderableExperiment(result) { return Array.isArray(result?.latentStateObservationsByStep) && ['LIVE', 'SYNTHETIC'].includes(result?.metadata?.evidenceLevel) && result.finalPrediction !== null && result.groundTruth !== null; }
function renderStateInspector(observation) { return observation.stateObservation.values.map((value, dimension) => ({ dimension, value })); }
async function runComparison() { return Promise.all([1, 2, 4, 8].map((reasoningBudget) => requestExperiment({ reasoningBudget }))); }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/frontend-shell.test.js && npm run build`

Expected: PASS; browser script syntax check succeeds.

### Task 6: Documentation and full verification

**Files:**
- Modify: `README.md`
- Modify: `docs/ARCHITECTURE.md`
- Modify: `docs/DEVELOPMENT.md`
- Modify: `docs/EXPERIMENT-CONTRACT.md`
- Modify: `docs/PROVENANCE.md`
- Modify: `package.json`

**Interfaces:**
- Build script syntax-checks each new JavaScript module.
- Documentation records exact runtime/machine facts measured during implementation and makes no benchmark/training/research reproduction claims.

- [ ] **Step 1: Write documentation assertions**

```js
assert.match(readme, /live recurrent latent-state computational substrate/i);
assert.match(provenance, /deterministically initialized/i);
assert.match(architecture, /Shared Recurrent Transition/);
```

- [ ] **Step 2: Run checks to verify they fail**

Run: `node --test test/documentation.test.js`

Expected: FAIL because Phase 1 documentation describes only synthetic execution.

- [ ] **Step 3: Update documentation and build configuration**

```text
Document PyTorch CPU runner version, seed 20260907, hidden size 8, tanh recurrence,
no training, independent line-navigation solver, LIVE/SYNTHETIC policy, local commands,
and no claim of HRM/URM/CODI/Coconut/BDH-CQ reproduction.
```

- [ ] **Step 4: Run complete verification**

Run: `npm test; npm run build; npm run dev`

Expected: all tests pass; build exits 0; local API requests at budgets 1, 2, 4, and 8 return LIVE trajectories with exact counts; repeated request matches state vectors and predictions.
