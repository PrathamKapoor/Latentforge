import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { solveVariableLengthNavigationTask } from '../src/reasoning/variable-length-navigation-task.js';

const runnerPath = fileURLToPath(new URL('../src/reasoning/trained-recurrent-runner.py', import.meta.url));

function executeRawRunner(input) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.env.PYTHON ?? 'python', [runnerPath], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
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

function executeRunner(moves, thinkingSteps) {
  return executeRawRunner(JSON.stringify({ moves, thinkingSteps }));
}

function argmax(values) {
  return values.reduce((bestIndex, value, index) => (value > values[bestIndex] ? index : bestIndex), 0);
}

test('returns exactly (moves.length + thinkingSteps) trajectory steps, encode then think', async () => {
  const result = await executeRunner([1, 0, 1, 1, 0], 3);
  assert.equal(result.steps.length, 8);
  assert.deepEqual(result.steps.slice(0, 5).map((s) => s.phase), Array(5).fill('encode'));
  assert.deepEqual(result.steps.slice(5).map((s) => s.phase), Array(3).fill('think'));
});

test('thinkingSteps of zero returns a prediction immediately after encoding, with no think-phase steps', async () => {
  const result = await executeRunner([1, 1, 0], 0);
  assert.equal(result.steps.length, 3);
  assert.ok(result.steps.every((s) => s.phase === 'encode'));
});

test('every step\'s prediction is the argmax of that step\'s own logits', async () => {
  const result = await executeRunner([1, 0, 1, 1, 1, 0, 0], 4);
  for (const step of result.steps) assert.equal(step.prediction, argmax(step.logits));
  assert.equal(result.finalPrediction, result.steps.at(-1).prediction);
});

test('repeated identical requests are bit-for-bit deterministic (fixed trained weights, no randomness at inference)', async () => {
  const once = await executeRunner([1, 0, 0, 1, 1], 4);
  const twice = await executeRunner([1, 0, 0, 1, 1], 4);
  const { runtime: _r1, ...a } = once;
  const { runtime: _r2, ...b } = twice;
  assert.deepEqual(a, b);
});

test('the Python runner\'s independently-duplicated solve() agrees with the JS solver across many random instances', async () => {
  // trained-recurrent-runner.py intentionally re-implements the same
  // clamped-navigation arithmetic rather than importing
  // variable-length-navigation-task.js (they're different languages) — this
  // is exactly the kind of cross-implementation drift a dedicated test must
  // catch, not assume away.
  const rng = (() => { let seed = 7; return () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; }; })();
  for (let trial = 0; trial < 15; trial += 1) {
    const length = 2 + Math.floor(rng() * 15);
    const moves = Array.from({ length }, () => (rng() < 0.5 ? 0 : 1));
    const result = await executeRunner(moves, 2);
    const expected = solveVariableLengthNavigationTask(moves.join(','));
    assert.equal(result.groundTruth, expected, `moves=${moves.join(',')}`);
  }
});

test('rejects a moves list shorter than 2 or longer than 24', async () => {
  const tooShort = await executeRunner([1], 0);
  assert.equal(tooShort.error.code, 'INVALID_TASK');
  const tooLong = await executeRunner(Array(25).fill(1), 0);
  assert.equal(tooLong.error.code, 'INVALID_TASK');
});

test('rejects moves containing anything other than 0 or 1', async () => {
  const result = await executeRawRunner(JSON.stringify({ moves: [1, 0, 2], thinkingSteps: 0 }));
  assert.equal(result.error.code, 'INVALID_TASK');
});

test('rejects a negative or out-of-range thinkingSteps', async () => {
  for (const thinkingSteps of [-1, 25, 1.5, '4']) {
    const result = await executeRawRunner(JSON.stringify({ moves: [1, 0, 1], thinkingSteps }));
    assert.equal(result.error?.code, 'INVALID_REASONING_BUDGET');
  }
});

test('rejects malformed JSON with a structured error, not a crash', async () => {
  const result = await executeRawRunner('{not json');
  assert.equal(result.error.code, 'INVALID_JSON');
});
