import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from '../src/server/server.js';
import { pythonWorker } from '../src/reasoning/worker-client.js';

test('a stalled live experiment returns a structured timeout instead of hanging', async () => {
  let release;
  const pending = new Promise((resolve) => { release = resolve; });
  const enqueue = mock.method(pythonWorker, 'enqueue', () => pending);
  const server = createServer({ requestTimeoutMs: 25 });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/experiment`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ task: '1,0,1,1', reasoningBudget: 4, backend: 'recurrent' }),
    });
    assert.equal(response.status, 504);
    assert.deepEqual(await response.json(), { error: { code: 'REQUEST_TIMEOUT', message: 'The experiment timed out. Please try again.' } });
  } finally {
    release({ result: {}, telemetry: {} });
    await new Promise((resolve) => setTimeout(resolve, 0));
    enqueue.mock.restore();
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});
