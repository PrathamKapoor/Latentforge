import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const runnerPath = fileURLToPath(new URL('../src/reasoning/hrm-inspired-runner.py', import.meta.url));

function runRaw(raw) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.env.PYTHON ?? 'python', [runnerPath], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    let stdout = ''; let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', (code) => code === 0 ? resolve(JSON.parse(stdout)) : reject(new Error(`runner exited ${code}: ${stderr}`)));
    child.stdin.end(raw);
  });
}

const run = (budget) => runRaw(JSON.stringify({ inputVector: [1, 0, 1, 1], reasoningBudget: budget, seed: 20260908 }));
const stable = ({ runtime, ...result }) => result;
const norm = (values) => Math.hypot(...values);
const argmax = (values) => values.indexOf(Math.max(...values));

test('runs a deterministic two-state hierarchy with real low-step cadence', async () => {
  const once = await run(4);
  const twice = await run(4);

  assert.deepEqual(stable(once), stable(twice));
  assert.equal(once.initialHighState.length, 8);
  assert.equal(once.initialLowState.length, 8);
  assert.equal(once.observations.length, 4);
  assert.deepEqual(once.observations.map(({ highUpdated }) => highUpdated), [false, true, false, true]);
  for (const observation of once.observations) {
    assert.equal(observation.highState.length, 8);
    assert.equal(observation.lowState.length, 8);
    assert.ok(observation.highState.every(Number.isFinite));
    assert.ok(observation.lowState.every(Number.isFinite));
  }
});

test('keeps all requested low-level updates and emits metrics calculated from returned states', async () => {
  for (const budget of [1, 2, 4, 8]) {
    const result = await run(budget);
    assert.equal(result.observations.length, budget);
    let previousLow = result.initialLowState;
    let previousHigh = result.initialHighState;
    for (const observation of result.observations) {
      assert.ok(Math.abs(observation.lowMetrics.stateNorm - norm(observation.lowState)) < 1e-12);
      assert.ok(Math.abs(observation.lowMetrics.deltaFromPrevious - norm(observation.lowState.map((value, index) => value - previousLow[index]))) < 1e-12);
      assert.ok(Math.abs(observation.highMetrics.stateNorm - norm(observation.highState)) < 1e-12);
      assert.ok(Math.abs(observation.highMetrics.deltaFromPrevious - norm(observation.highState.map((value, index) => value - previousHigh[index]))) < 1e-12);
      previousLow = observation.lowState;
      previousHigh = observation.highState;
    }
  }
});

test('derives predictions from actual high-level output logits', async () => {
  const result = await run(8);
  for (const observation of result.observations) assert.equal(observation.prediction, argmax(observation.logits));
  assert.deepEqual(result.finalHighState, result.observations.at(-1).highState);
  assert.deepEqual(result.finalLowState, result.observations.at(-1).lowState);
  assert.deepEqual(result.finalLogits, result.observations.at(-1).logits);
  assert.equal(result.finalPrediction, argmax(result.finalLogits));
});

test('fails safely for non-finite input and invalid hierarchy requests', async () => {
  const nonFinite = await runRaw('{"inputVector":[1e309,0,1,1],"reasoningBudget":1,"seed":20260908}');
  assert.equal(nonFinite.error.code, 'NON_FINITE_INPUT');
  const invalidBudget = await runRaw('{"inputVector":[1,0,1,1],"reasoningBudget":3,"seed":20260908}');
  assert.equal(invalidBudget.error.code, 'INVALID_REASONING_BUDGET');
});
