import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const runnerPath = fileURLToPath(new URL('../src/reasoning/recurrent-runner.py', import.meta.url));

function executeRawRunner(input) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.env.PYTHON ?? 'python', [runnerPath], {
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve(JSON.parse(stdout));
      else reject(new Error(`Runner exited with code ${code}: ${stderr}`));
    });
    child.stdin.end(input);
  });
}

function executeRunner(inputVector, reasoningBudget) {
  return executeRawRunner(JSON.stringify({ inputVector, reasoningBudget, seed: 20260907 }));
}

function reconstructOutputHeadLogits(state) {
  const reconstruction = `
import json
import math
import sys
import torch

torch.manual_seed(20260907)
dtype = torch.float64
torch.randn((8, 4), dtype=dtype) / math.sqrt(4)
torch.randn(8, dtype=dtype) * 0.1
torch.randn((8, 8), dtype=dtype) / math.sqrt(8)
torch.randn((8, 4), dtype=dtype) / math.sqrt(4)
torch.randn(8, dtype=dtype) * 0.1
output_weight = torch.randn((5, 8), dtype=dtype) / math.sqrt(8)
output_bias = torch.randn(5, dtype=dtype) * 0.1
final_state = torch.tensor(json.loads(sys.stdin.read()), dtype=dtype)
print(json.dumps([float(value) for value in (output_weight @ final_state + output_bias).tolist()]))
`;
  return new Promise((resolve, reject) => {
    const child = spawn(process.env.PYTHON ?? 'python', ['-c', reconstruction], {
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve(JSON.parse(stdout));
      else reject(new Error(`Output-head reconstruction exited with code ${code}: ${stderr}`));
    });
    child.stdin.end(JSON.stringify(state));
  });
}

function withoutDuration(result) {
  const { runtime: _runtime, ...stableResult } = result;
  return stableResult;
}

function l2(vector) {
  return Math.sqrt(vector.reduce((total, value) => total + value ** 2, 0));
}

function populationStandardDeviation(vector) {
  const mean = vector.reduce((total, value) => total + value, 0) / vector.length;
  return Math.sqrt(vector.reduce((total, value) => total + (value - mean) ** 2, 0) / vector.length);
}

function cosine(left, right) {
  const denominator = l2(left) * l2(right);
  return denominator === 0
    ? null
    : left.reduce((total, value, index) => total + value * right[index], 0) / denominator;
}

function argmax(values) {
  return values.reduce((bestIndex, value, index) => value > values[bestIndex] ? index : bestIndex, 0);
}

test('returns a deterministic real trajectory for a repeated fixed request', async () => {
  const once = await executeRunner([1, 0, 1, 1], 4);
  const twice = await executeRunner([1, 0, 1, 1], 4);

  assert.deepEqual(withoutDuration(once), withoutDuration(twice));
  assert.equal(once.initialState.length, 8);
  assert.equal(once.observations.length, 4);
});

test('returns exactly one eight-dimensional transition observation per requested budget', async () => {
  for (const reasoningBudget of [1, 2, 4, 8]) {
    const result = await executeRunner([0, 1, 0, 1], reasoningBudget);
    assert.equal(result.observations.length, reasoningBudget);
    assert.equal(result.initialState.length, 8);
    for (const observation of result.observations) {
      assert.equal(observation.state.length, 8);
    }
  }
});

test('reports telemetry calculated from the actual vectors at every transition', async () => {
  const result = await executeRunner([1, 0, 1, 1], 2);

  for (const [index, observation] of result.observations.entries()) {
    const previousState = index === 0 ? result.initialState : result.observations[index - 1].state;
    assert.ok(Math.abs(observation.stateNorm - l2(observation.state)) < 1e-12);
    assert.ok(Math.abs(observation.mean - (observation.state.reduce((total, value) => total + value, 0) / 8)) < 1e-12);
    assert.ok(Math.abs(observation.standardDeviation - populationStandardDeviation(observation.state)) < 1e-12);
    assert.ok(Math.abs(observation.deltaFromPrevious - l2(observation.state.map((value, dimension) => value - previousState[dimension]))) < 1e-12);
    assert.ok(Math.abs(observation.cosineSimilarityToPrevious - cosine(observation.state, previousState)) < 1e-12);
  }
});

test('derives each prediction and final prediction from returned output-head logits', async () => {
  const result = await executeRunner([1, 1, 0, 0], 4);
  const finalObservation = result.observations.at(-1);

  for (const observation of result.observations) {
    assert.equal(observation.prediction, argmax(observation.logits));
    assert.equal(observation.confidence, null);
  }
  assert.deepEqual(result.finalLogits, finalObservation.logits);
  assert.equal(result.finalPrediction, argmax(result.finalLogits));
  assert.deepEqual(result.finalState, finalObservation.state);
});

test('computes every final logit from the final state with independently reconstructed output parameters', async () => {
  const result = await executeRunner([1, 1, 0, 0], 4);
  const expectedLogits = await reconstructOutputHeadLogits(result.finalState);

  assert.equal(result.finalLogits.length, expectedLogits.length);
  for (const [index, expectedLogit] of expectedLogits.entries()) {
    assert.ok(Math.abs(result.finalLogits[index] - expectedLogit) < 1e-12);
  }
  assert.equal(result.finalPrediction, argmax(expectedLogits));
});

test('returns a structured error for a non-finite input instead of running a fallback', async () => {
  const result = await executeRawRunner('{"inputVector":[1e309,0,1,1],"reasoningBudget":1,"seed":20260907}');

  assert.equal(result.error.code, 'NON_FINITE_INPUT');
  assert.equal(result.error.message, 'inputVector must contain only finite numbers.');
});

test('rejects non-integral and non-scalar reasoning budgets with a structured validation error', async () => {
  for (const rawBudget of ['1.0', '[]', '{}']) {
    const result = await executeRawRunner(`{"inputVector":[1,0,1,1],"reasoningBudget":${rawBudget},"seed":20260907}`);
    assert.equal(result.error?.code, 'INVALID_REASONING_BUDGET');
  }
});
