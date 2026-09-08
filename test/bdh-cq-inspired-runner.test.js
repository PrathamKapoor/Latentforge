import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const runnerPath = fileURLToPath(new URL('../src/reasoning/bdh-cq-inspired-runner.py', import.meta.url));

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

function executeRunner(query, demonstrationCount, reasoningBudget) {
  return executeRawRunner(JSON.stringify({ query, demonstrationCount, reasoningBudget, seed: 20260909 }));
}

function reconstructOutputHeadLogits(finalWorkspaceState) {
  const reconstruction = `
import json
import math
import sys
import torch

torch.manual_seed(20260909)
dtype = torch.float64
torch.randn((8, 4), dtype=dtype) / math.sqrt(4)
torch.randn(8, dtype=dtype) * 0.1
torch.randn((8, 8), dtype=dtype) / math.sqrt(8)
torch.randn((8, 4), dtype=dtype) / math.sqrt(4)
torch.randn((8, 8), dtype=dtype) / math.sqrt(8)
torch.randn((8, 8), dtype=dtype) / math.sqrt(8)
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
    child.stdin.end(JSON.stringify(finalWorkspaceState));
  });
}

function argmax(values) {
  return values.reduce((bestIndex, value, index) => value > values[bestIndex] ? index : bestIndex, 0);
}

test('returns a deterministic real S/H trajectory for a repeated fixed request', async () => {
  const once = await executeRunner([1, 0, 1, 1], 2, 4);
  const twice = await executeRunner([1, 0, 1, 1], 2, 4);

  assert.deepEqual(once, twice);
  assert.equal(once.memoryTrajectory.length, 2);
  assert.equal(once.workspaceTrajectory.length, 4);
});

test('demonstration count changes only memory updates; reasoning budget changes only workspace updates', async () => {
  for (const demonstrationCount of [1, 2, 3]) {
    const result = await executeRunner([1, 0, 1, 1], demonstrationCount, 4);
    assert.equal(result.memoryTrajectory.length, demonstrationCount);
    assert.equal(result.workspaceTrajectory.length, 4);
  }
  for (const reasoningBudget of [1, 2, 4, 8]) {
    const result = await executeRunner([1, 0, 1, 1], 2, reasoningBudget);
    assert.equal(result.memoryTrajectory.length, 2);
    assert.equal(result.workspaceTrajectory.length, reasoningBudget);
    assert.equal(result.effectiveReasoningBudget, reasoningBudget);
  }
});

test('derives each workspace prediction and final prediction from returned output-head logits', async () => {
  const result = await executeRunner([1, 1, 0, 0], 2, 4);
  const finalStep = result.workspaceTrajectory.at(-1);

  for (const step of result.workspaceTrajectory) {
    assert.equal(step.prediction, argmax(step.logits));
  }
  assert.deepEqual(result.finalLogits, finalStep.logits);
  assert.equal(result.finalPrediction, argmax(result.finalLogits));
  assert.deepEqual(result.finalState, finalStep.state);
});

test('computes the final logits from the final workspace state with independently reconstructed output parameters', async () => {
  const result = await executeRunner([1, 1, 0, 0], 2, 4);
  const expectedLogits = await reconstructOutputHeadLogits(result.finalState);

  assert.equal(result.finalLogits.length, expectedLogits.length);
  for (const [index, expectedLogit] of expectedLogits.entries()) {
    assert.ok(Math.abs(result.finalLogits[index] - expectedLogit) < 1e-12);
  }
  assert.equal(result.finalPrediction, argmax(expectedLogits));
});

test('returns a structured error for a non-finite query instead of running a fallback', async () => {
  const result = await executeRawRunner('{"query":[1e309,0,1,1],"demonstrationCount":2,"reasoningBudget":4,"seed":20260909}');

  assert.equal(result.error.code, 'NON_FINITE_INPUT');
  assert.equal(result.error.message, 'query must contain only finite numbers.');
});

test('rejects an unsupported demonstration count with a structured validation error', async () => {
  for (const rawCount of ['0', '4', '"2"']) {
    const result = await executeRawRunner(`{"query":[1,0,1,1],"demonstrationCount":${rawCount},"reasoningBudget":4,"seed":20260909}`);
    assert.equal(result.error?.code, 'INVALID_DEMONSTRATION_COUNT');
  }
});

test('rejects an unsupported reasoning budget with a structured validation error', async () => {
  for (const rawBudget of ['3', '0', '"4"']) {
    const result = await executeRawRunner(`{"query":[1,0,1,1],"demonstrationCount":2,"reasoningBudget":${rawBudget},"seed":20260909}`);
    assert.equal(result.error?.code, 'INVALID_REASONING_BUDGET');
  }
});
