import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import childProcess from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import { executeRecurrentLatent, validateRecurrentRequest } from '../src/reasoning/recurrent-latent-backend.js';
import { getBackend, validateBackendId } from '../src/reasoning/backend-registry.js';
import { validateExperimentContract } from '../src/contracts/reasoning-backend.js';
import { pythonWorker, PythonWorkerClient } from '../src/reasoning/worker-client.js';

const task = '1,0,1,1'; // 2 -> 3 -> 2 -> 3 -> 4; independently known answer is 4.
const results = new Map();
let repeated;
let direct;
let elapsed;

before(async () => {
  for (const reasoningBudget of [1, 2, 4, 8]) {
    const started = performance.now();
    results.set(reasoningBudget, await executeRecurrentLatent({ task, reasoningBudget }));
    if (reasoningBudget === 1) elapsed = performance.now() - started;
  }
  repeated = await executeRecurrentLatent({ task, reasoningBudget: 1 });
  direct = await new Promise((resolve, reject) => {
    const child = childProcess.execFile(process.env.PYTHON ?? 'python', [fileURLToPath(new URL('../src/reasoning/recurrent-runner.py', import.meta.url))],
      { windowsHide: true, timeout: 30000 }, (error, stdout) => error ? reject(error) : resolve(JSON.parse(stdout)));
    child.stdin.end(JSON.stringify({ inputVector: [1, 0, 1, 1], reasoningBudget: 8, seed: 20260907 }));
  });
});

// `node --test` isolates each file into its own process, so stopping the
// shared worker singleton here only affects this file's process and lets
// it exit cleanly instead of the child process keeping the event loop alive.
after(() => pythonWorker.stop());

const norm = (values) => Math.hypot(...values);
const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-12, `${actual} differs from ${expected}`);
const argmax = (values) => values.indexOf(Math.max(...values));
const withoutLatency = ({ latencyMs, ...stable }) => stable;

test('live contract preserves actual h0, runner observations, and untrained runtime provenance', () => {
  const result = results.get(1);
  assert.equal(validateExperimentContract(result).valid, true);
  assert.equal(result.backend.id, 'recurrent-latent-toy-v1');
  assert.match(result.backend.displayName, /local toy recurrent neural substrate/i);
  assert.match(result.provenance.description, /deterministically initialized/i);
  assert.match(result.provenance.description, /not trained/i);
  assert.equal(result.metadata.evidenceLevel, 'LIVE');
  assert.equal(result.backend.provenance.evidenceLevel, 'LIVE');
  assert.equal(result.provenance.kind, 'OUR_IMPLEMENTATION');
  assert.equal(result.status, 'COMPLETE');
  assert.equal(result.randomSeed, 20260907);
  assert.deepEqual(result.input, { task });
  assert.equal(result.configuration.hiddenSize, 8);
  assert.equal(result.configuration.inputSize, 4);
  assert.equal(result.configuration.outputSize, 5);
  assert.equal(result.configuration.dtype, 'float64');
  assert.equal(result.configuration.activation, 'tanh');
  assert.equal(result.configuration.sharedTransition, true);
  assert.equal(result.configuration.training, 'none');
  assert.equal(result.configuration.initialization.seed, 20260907);
  assert.deepEqual(result.initialState.values, direct.initialState);
  assert.deepEqual(result.provenance.runtime, direct.runtime.environment);
  assert.match(result.provenance.runtime.pythonVersion, /^\d+\.\d+\.\d+/);
  assert.match(result.provenance.runtime.torchVersion, /^\d+\./);
  assert.equal(result.provenance.runtime.device, 'cpu');
  assert.equal(typeof result.provenance.runtime.cudaAvailable, 'boolean');
  assert.equal(result.tokenCount, null);
  assert.equal(result.error, null);
  assert.ok(result.latencyMs > 0 && result.latencyMs <= elapsed);
  assert.ok(!JSON.stringify(result).includes(fileURLToPath(new URL('../src/', import.meta.url))));
  assert.equal(direct.observations.length, 8);
  const mapped = results.get(8).latentStateObservationsByStep;
  assert.equal(mapped.length, direct.observations.length);
  for (const [index, observation] of mapped.entries()) {
    assert.deepEqual(observation.stateObservation.values, direct.observations[index].state, `h${index + 1} matches the runner`);
    assert.deepEqual(observation.logits, direct.observations[index].logits, `h${index + 1} logits match the runner`);
    assert.equal(observation.prediction, direct.observations[index].prediction, `h${index + 1} prediction matches the runner`);
  }
});

test('repeated requests are deterministic except for measured backend latency', () => {
  assert.deepEqual(withoutLatency(results.get(1)), withoutLatency(repeated));
});

test('each supported budget returns exactly h1 through hN with stable trajectory prefixes', () => {
  for (const [budget, result] of results) {
    assert.equal(result.reasoningBudget, budget);
    assert.equal(result.latentStateObservationsByStep.length, budget);
    assert.equal(result.predictionsByStep.length, budget);
    assert.equal(result.metrics.computationSteps, budget);
    assert.deepEqual(result.initialState, results.get(8).initialState);
    assert.deepEqual(result.latentStateObservationsByStep, results.get(8).latentStateObservationsByStep.slice(0, budget));
  }
});

test('all step metrics and norm/change trajectories agree with the actual states', () => {
  const result = results.get(8);
  let previous = result.initialState.values;
  for (const [index, observation] of result.latentStateObservationsByStep.entries()) {
    const state = observation.stateObservation.values;
    const mean = state.reduce((sum, value) => sum + value, 0) / state.length;
    assert.equal(observation.step, index);
    assert.equal(state.length, 8);
    assert.equal(observation.confidence, null);
    assert.equal(observation.metadata.evidenceLevel, 'LIVE');
    close(observation.metrics.stateNorm, norm(state));
    close(observation.metrics.mean, mean);
    close(observation.metrics.standardDeviation, Math.sqrt(state.reduce((sum, value) => sum + (value - mean) ** 2, 0) / 8));
    close(observation.metrics.deltaFromPrevious, norm(state.map((value, i) => value - previous[i])));
    close(observation.metrics.cosineSimilarityToPrevious, state.reduce((sum, value, i) => sum + value * previous[i], 0) / (norm(state) * norm(previous)));
    assert.equal(result.metrics.stateNormTrajectory[index], observation.metrics.stateNorm);
    assert.equal(result.metrics.stateChangeTrajectory[index], observation.metrics.deltaFromPrevious);
    previous = state;
  }
});

test('predictions come from output-head logits even when they disagree with independent ground truth', () => {
  for (const result of results.values()) {
    assert.equal(result.groundTruth, 4);
    for (const observation of result.latentStateObservationsByStep) {
      assert.equal(observation.prediction, argmax(observation.logits));
      assert.deepEqual(result.predictionsByStep[observation.step], { step: observation.step, prediction: observation.prediction });
    }
    assert.equal(result.finalPrediction, result.latentStateObservationsByStep.at(-1).prediction);
    assert.equal(result.finalScore, result.finalPrediction === 4);
  }
  assert.equal(results.get(8).finalPrediction, direct.finalPrediction);
  assert.equal(results.get(1).finalPrediction, direct.observations[0].prediction);
  assert.notEqual(results.get(1).finalPrediction, 4);
  assert.equal(results.get(1).finalScore, false);
});

test('rejects invalid budgets and malformed requests before execution', async () => {
  for (const request of [null, [], {}, { task, reasoningBudget: 0 }, ...[3, 5, 6, 7, 9, -1, 1.5, '2', true, NaN, Infinity].map((reasoningBudget) => ({ task, reasoningBudget }))]) {
    assert.equal(validateRecurrentRequest(request).valid, false);
    await assert.rejects(executeRecurrentLatent(request), { code: 'VALIDATION_ERROR' });
  }
  for (const invalidTask of ['17 + 28', '', ' 1,0,1,1', '1,0,1', null]) {
    assert.equal(validateRecurrentRequest({ task: invalidTask, reasoningBudget: 1 }).valid, false);
    await assert.rejects(executeRecurrentLatent({ task: invalidTask, reasoningBudget: 1 }), { code: 'UNSUPPORTED_TASK' });
  }
});

test('registry defaults only omitted selectors and safely rejects unsupported identifiers', async () => {
  assert.equal(getBackend().execute, executeRecurrentLatent);
  assert.equal(getBackend('recurrent').validateRequest, validateRecurrentRequest);
  assert.equal(validateBackendId('recurrent').valid, true);
  assert.equal(validateBackendId('synthetic').valid, true);
  for (const id of [undefined, null, '', 'Recurrent', 'toString', 'constructor', '__proto__', '../recurrent-runner.py', {}, ['recurrent'], 0]) {
    assert.equal(validateBackendId(id).valid, false);
    if (id !== undefined) assert.throws(() => getBackend(id), { code: 'VALIDATION_ERROR' });
  }
  const synthetic = await getBackend('synthetic').execute({ task: '17 + 28', reasoningBudget: 2 });
  assert.equal(synthetic.metadata.evidenceLevel, 'SYNTHETIC');
  assert.equal(synthetic.finalPrediction, 45);
  assert.ok(Object.isFrozen(getBackend('recurrent')));
  assert.ok(!JSON.stringify(getBackend('recurrent')).includes('.py'));
});

// Under the persistent-worker architecture, a spawn failure only happens
// once — at worker startup, not per request. `process.env.PYTHON` changed
// after the shared singleton is already running (as it is by this point in
// the file, via the `before()` hook) has no further effect, so this test
// now constructs its own not-yet-started `PythonWorkerClient` pointed at a
// bogus interpreter and exercises ITS startup failure instead. The safety
// property under test — a structured, non-leaking error code — is
// unchanged; only the trigger point moved from "per call" to "per worker
// lifetime," which is the architecture change itself.
test('missing Python runtime rejects with a safe structured error without synthetic fallback', async () => {
  const isolatedWorker = new PythonWorkerClient({ pythonBin: 'latentforge-missing-python-runtime' });
  await assert.rejects(isolatedWorker.start(), (error) => {
    assert.equal(error.code, 'RUNTIME_UNAVAILABLE');
    assert.ok(!error.message.includes('latentforge-missing-python-runtime'));
    return true;
  });
  await assert.rejects(isolatedWorker.enqueue(async (send) => send('recurrent', {})), (error) => {
    assert.equal(error.code, 'SERVICE_UNAVAILABLE');
    return true;
  });
});

// Under the persistent-worker architecture the transport boundary is
// `pythonWorker.enqueue`, not `childProcess.execFile` (there is no longer a
// per-request child process to mock). This mocks only that boundary — the
// fake `send` stands in for one Python round-trip — so adapter parsing and
// `validateRunnerResult` still run for real against whatever the fixture
// returns, exactly as the original test's own comment intended. Malformed
// JSON on the wire is no longer a reachable failure mode (worker-server.py
// only ever emits well-formed protocol lines — see its docstring), so
// those two fixtures are replaced by the equivalent-severity case that IS
// still reachable: a well-formed but structurally invalid result object.
// `RUNNER_TIMEOUT` is renamed `WORKER_TIMEOUT` for the new failure class
// (a single hung round-trip inside an otherwise-healthy worker, distinct
// from the old "the one-shot process was killed" meaning) — a disclosed,
// intentional rename, not an accidental behavior change.
test('process failures and invalid runner payloads fail closed with structured safe errors', async (context) => {
  const valid = () => structuredClone(direct);
  const nonFinite = valid();
  nonFinite.observations[0].state[0] = null;
  const wrongPrediction = valid();
  wrongPrediction.finalPrediction = (direct.finalPrediction + 1) % 5;
  const missingSteps = valid();
  missingSteps.observations = [];
  const cases = [
    { result: nonFinite, code: 'INVALID_RUNNER_RESPONSE' },
    { result: wrongPrediction, code: 'INVALID_RUNNER_RESPONSE' },
    { result: missingSteps, code: 'INVALID_RUNNER_RESPONSE' },
    { rejection: { code: 'NON_FINITE_STATE', message: 'Recurrent state contained a non-finite value.' }, code: 'NON_FINITE_STATE' },
    { rejection: { code: 'EXECUTION_ERROR', message: 'The local worker could not complete execution.' }, code: 'EXECUTION_ERROR' },
    { rejection: { code: 'WORKER_TIMEOUT', message: 'The local worker did not respond in time.' }, code: 'WORKER_TIMEOUT' },
    { rejection: { code: 'RUNTIME_UNAVAILABLE', message: 'The local Python worker runtime is unavailable.' }, code: 'RUNTIME_UNAVAILABLE' },
  ];
  for (const fixture of cases) {
    const mocked = context.mock.method(pythonWorker, 'enqueue', async (jobFn) => {
      const send = async () => {
        if (fixture.rejection) throw Object.assign(new Error(fixture.rejection.message), { code: fixture.rejection.code });
        return fixture.result;
      };
      const result = await jobFn(send);
      return { result, telemetry: {} };
    });
    try {
      await assert.rejects(executeRecurrentLatent({ task, reasoningBudget: 8 }), (error) => {
        assert.equal(error.code, fixture.code);
        assert.ok(!error.message.includes('private'));
        assert.ok(!error.message.includes('latentforge-missing-python-runtime'));
        return true;
      });
    } finally { mocked.mock.restore(); }
  }
});
