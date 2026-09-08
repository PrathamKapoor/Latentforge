import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { PythonWorkerClient } from '../src/reasoning/worker-client.js';

const client = new PythonWorkerClient();
after(() => client.stop());

// `runtime.latencyMs`/`workerLatencyMs` are genuine measured timings, not
// part of the deterministic computation — strip them before comparing two
// results for scientific/state equality.
function withoutTiming(result) {
  const { runtime, workerLatencyMs, ...rest } = result;
  const strippedRuntime = runtime ? { ...runtime, latencyMs: undefined } : runtime;
  return { ...rest, runtime: strippedRuntime };
}

test('starts, reports ready with a real environment, and exposes status', async () => {
  await client.start();
  assert.equal(client.isReady(), true);
  const status = client.getStatus();
  assert.equal(status.status, 'READY');
  assert.match(status.environment.pythonVersion, /^\d+\.\d+\.\d+/);
  assert.match(status.environment.torchVersion, /^\d+\./);
  assert.equal(status.environment.device, 'cpu');
});

test('a single-send job returns the exact canonical result', async () => {
  const { result } = await client.enqueue((send) => send('recurrent', { inputVector: [1, 0, 1, 1], reasoningBudget: 4, seed: 20260907 }));
  assert.equal(result.finalPrediction, 4);
});

test('a multi-send job holds the active slot for its entire lifetime — a concurrently enqueued job waits for the whole thing, not just the first send', async () => {
  const order = [];
  const jobA = client.enqueue(async (send) => {
    order.push('A-start');
    await send('recurrent', { inputVector: [1, 0, 1, 1], reasoningBudget: 1, seed: 20260907 });
    await send('recurrent', { inputVector: [1, 0, 1, 1], reasoningBudget: 2, seed: 20260907 });
    order.push('A-end');
    return 'A';
  });
  const jobB = client.enqueue(async (send) => {
    order.push('B-start');
    await send('recurrent', { inputVector: [1, 0, 1, 1], reasoningBudget: 1, seed: 20260907 });
    order.push('B-end');
    return 'B';
  });
  const [{ result: a }, { result: b }] = await Promise.all([jobA, jobB]);
  assert.equal(a, 'A');
  assert.equal(b, 'B');
  assert.deepEqual(order, ['A-start', 'A-end', 'B-start', 'B-end']);
});

test('state is isolated across alternating backends and budgets on the same warm worker', async () => {
  const recurrentB1 = await client.enqueue((send) => send('recurrent', { inputVector: [1, 0, 1, 1], reasoningBudget: 1, seed: 20260907 }));
  const hrm = await client.enqueue((send) => send('hrm-inspired', { inputVector: [1, 0, 1, 1], reasoningBudget: 4, seed: 20260908 }));
  const bdhCq = await client.enqueue((send) => send('bdh-cq-inspired', { query: [1, 0, 1, 1], demonstrationCount: 2, reasoningBudget: 4, seed: 20260909 }));
  const recurrentB1Again = await client.enqueue((send) => send('recurrent', { inputVector: [1, 0, 1, 1], reasoningBudget: 1, seed: 20260907 }));

  assert.deepEqual(withoutTiming(recurrentB1.result), withoutTiming(recurrentB1Again.result), 'identical requests on a warm worker must be bit-for-bit deterministic, unaffected by interleaved calls to other backends');
  assert.equal(hrm.result.finalPrediction, 2);
  assert.equal(bdhCq.result.finalPrediction, 2);
});

test('repeated identical requests are deterministic on a warm worker', async () => {
  const results = await Promise.all(Array.from({ length: 4 }, () =>
    client.enqueue((send) => send('recurrent', { inputVector: [0, 1, 0, 1], reasoningBudget: 8, seed: 20260907 }))));
  for (const { result } of results.slice(1)) assert.deepEqual(withoutTiming(result), withoutTiming(results[0].result));
});

test('an unknown backend is rejected with a structured error, not silently ignored', async () => {
  await assert.rejects(
    client.enqueue((send) => send('not-a-real-backend', {})),
    (error) => { assert.equal(error.code, 'UNKNOWN_BACKEND'); return true; },
  );
});

test('rejects an unavailable interpreter cleanly, without leaking the interpreter name', async () => {
  const bad = new PythonWorkerClient({ pythonBin: 'latentforge-does-not-exist' });
  await assert.rejects(bad.start(), (error) => {
    assert.equal(error.code, 'RUNTIME_UNAVAILABLE');
    assert.ok(!error.message.includes('latentforge-does-not-exist'));
    return true;
  });
  await bad.stop();
});

test('the queue rejects new jobs once LATENTFORGE_MAX_QUEUE is exceeded', async () => {
  const isolatedClient = new PythonWorkerClient();
  await isolatedClient.start();
  try {
    // Occupy the active slot with a slow-ish multi-send job, then flood the queue past its bound.
    const blocker = isolatedClient.enqueue(async (send) => {
      for (let i = 0; i < 3; i += 1) await send('recurrent', { inputVector: [1, 0, 1, 1], reasoningBudget: 8, seed: 20260907 });
      return 'blocker-done';
    });
    const overflowAttempts = Array.from({ length: 20 }, () =>
      isolatedClient.enqueue((send) => send('recurrent', { inputVector: [1, 0, 1, 1], reasoningBudget: 1, seed: 20260907 })));
    const settled = await Promise.allSettled([blocker, ...overflowAttempts]);
    const overloaded = settled.filter((entry) => entry.status === 'rejected' && entry.reason?.code === 'OVERLOADED');
    assert.ok(overloaded.length > 0, 'expected at least one request to be rejected as OVERLOADED once the bounded queue filled up');
  } finally {
    await isolatedClient.stop();
  }
});

test('stop() shuts the worker down cleanly and it can be started again', async () => {
  const isolatedClient = new PythonWorkerClient();
  await isolatedClient.start();
  await isolatedClient.enqueue((send) => send('recurrent', { inputVector: [1, 0, 1, 1], reasoningBudget: 1, seed: 20260907 }));
  await isolatedClient.stop();
  assert.equal(isolatedClient.getStatus().status, 'STOPPED');
  await isolatedClient.start();
  const { result } = await isolatedClient.enqueue((send) => send('recurrent', { inputVector: [1, 0, 1, 1], reasoningBudget: 4, seed: 20260907 }));
  assert.equal(result.finalPrediction, 4);
  await isolatedClient.stop();
});
