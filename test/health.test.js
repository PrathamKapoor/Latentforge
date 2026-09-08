import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from '../src/server/server.js';
import { pythonWorker } from '../src/reasoning/worker-client.js';

after(() => pythonWorker.stop());

async function withServer(run) {
  await pythonWorker.start();
  const server = createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  try {
    await run(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

test('GET /health reports liveness independent of worker readiness', async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/health`);
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.status, 'ok');
  });
});

test('GET /ready reports worker readiness once the worker has started', async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/ready`);
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.status, 'ready');
    assert.equal(body.worker, 'ready');
  });
});

test('POST /api/characterization returns a LOCAL CHARACTERIZATION result, one job for the whole run', async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/characterization`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ task: '1,0,1,1' }),
    });
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.evidenceLevel, 'LOCAL_CHARACTERIZATION');
    assert.equal(body.label, 'LOCAL CHARACTERIZATION — NOT A BENCHMARK');
    assert.equal(body.rows.length, body.seeds.length * body.budgets.length);
    assert.ok(body.rows.every((row) => row.status === 'COMPLETE' || row.status === 'ERROR'));
  });
});

test('POST /api/characterization rejects an unsupported task', async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/characterization`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ task: 'not-a-task' }),
    });
    const body = await response.json();
    assert.equal(response.status, 400);
    assert.equal(body.error.code, 'UNSUPPORTED_TASK');
  });
});
