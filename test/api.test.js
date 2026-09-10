import test, { after } from 'node:test';
import assert from 'node:assert/strict';

import { createServer } from '../src/server/server.js';
import { pythonWorker } from '../src/reasoning/worker-client.js';

// `node --test` isolates each file into its own process, so the worker
// singleton started here is private to this file's process; stopping it
// once, after all of this file's tests complete, lets the process exit
// cleanly instead of the child process keeping the event loop alive.
after(() => pythonWorker.stop());

async function withServer(run) {
  await pythonWorker.start(); // idempotent — a no-op if already started by an earlier test in this file
  const server = createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  try {
    await run(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

test('POST /api/experiment executes the selected live recurrent backend with actual state telemetry', async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/experiment`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ task: '1,0,1,1', reasoningBudget: 2, backend: 'recurrent' }),
    });
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.metadata.evidenceLevel, 'LIVE');
    assert.equal(body.backend.id, 'recurrent-latent-toy-v1');
    assert.equal(body.latentStateObservationsByStep.length, 2);
    assert.equal(body.groundTruth, 4);
    assert.equal(body.finalPrediction, body.predictionsByStep.at(-1).prediction);
    for (const observation of body.latentStateObservationsByStep) {
      assert.equal(observation.stateObservation.kind, 'RECURRENT_HIDDEN_STATE');
      assert.equal(observation.stateObservation.values.length, 8);
      assert.ok(observation.stateObservation.values.every(Number.isFinite));
      assert.equal(observation.prediction, body.predictionsByStep[observation.step].prediction);
    }
  });
});

test('POST /api/experiment defaults an omitted backend to the live recurrent backend', async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/experiment`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ task: '1,0,1,1', reasoningBudget: 1 }),
    });
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.metadata.evidenceLevel, 'LIVE');
    assert.equal(body.backend.id, 'recurrent-latent-toy-v1');
    assert.equal(body.latentStateObservationsByStep.length, 1);
  });
});

test('POST /api/experiment preserves the explicit synthetic arithmetic demonstration', async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/experiment`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ task: '17 + 28', reasoningBudget: 2, backend: 'synthetic' }),
    });
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.metadata.evidenceLevel, 'SYNTHETIC');
    assert.equal(body.latentStateObservationsByStep.length, 2);
    assert.equal(body.groundTruth, 45);
  });
});

test('POST /api/experiment executes the explicitly selected live HRM-inspired hierarchical mode', async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/experiment`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ task: '1,0,1,1', reasoningBudget: 2, backend: 'hrm-inspired' }) });
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.metadata.evidenceLevel, 'LIVE');
    assert.equal(body.backend.id, 'hrm-inspired-hierarchical-recurrence-v1');
    assert.equal(body.hierarchicalStateObservationsByStep.length, 2);
    assert.equal(body.groundTruth, 4);
  });
});

test('POST /api/experiment executes the live BDH-CQ-inspired mode with memory and workspace telemetry', async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/experiment`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ task: '1,0,1,1', reasoningBudget: 2, demonstrationCount: 3, backend: 'bdh-cq-inspired' }) });
    const body = await response.json();
    assert.equal(response.status, 200); assert.equal(body.metadata.evidenceLevel, 'LIVE'); assert.equal(body.memoryTrajectory.length, 3); assert.equal(body.workspaceTrajectory.length, 2); assert.equal(body.reasoningBudget, 2); assert.equal(body.groundTruth, 4); assert.equal(body.finalScore, body.finalPrediction === body.groundTruth);
  });
});

test('GET / serves the browser application shell', async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/`);
    const body = await response.text();
    assert.equal(response.status, 200);
    assert.match(body, /LatentForge/);
  });
});

test('POST /api/experiment rejects unknown backend selections without falling back', async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/experiment`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ task: '1,0,1,1', reasoningBudget: 1, backend: 'does-not-exist' }),
    });
    const body = await response.json();

    assert.equal(response.status, 400);
    assert.equal(body.error.code, 'VALIDATION_ERROR');
    assert.match(body.error.message, /backend/i);
  });
});

test('POST /api/experiment validates the task against the explicitly selected backend', async () => {
  await withServer(async (baseUrl) => {
    for (const request of [
      { task: '17 + 28', reasoningBudget: 1, backend: 'recurrent' },
      { task: '1,0,1,1', reasoningBudget: 1, backend: 'synthetic' },
    ]) {
      const response = await fetch(`${baseUrl}/api/experiment`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(request),
      });
      const body = await response.json();

      assert.equal(response.status, 400);
      assert.equal(body.error.code, 'UNSUPPORTED_TASK');
    }
  });
});

test('POST /api/experiment returns structured validation errors for malformed JSON and invalid recurrent input', async () => {
  await withServer(async (baseUrl) => {
    for (const body of [
      '{',
      JSON.stringify({ task: '', reasoningBudget: -1, backend: 'recurrent' }),
    ]) {
      const response = await fetch(`${baseUrl}/api/experiment`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body,
      });
      const result = await response.json();

      assert.equal(response.status, 400);
      assert.equal(result.error.code, 'VALIDATION_ERROR');
    }
  });
});

test('POST /api/experiment enforces the body-size cap on real bytes, not decoded string length', async () => {
  await withServer(async (baseUrl) => {
    // '€' is 1 UTF-16 code unit but 3 UTF-8 bytes. 40,000 of them is a
    // ~40KB *string length* (comfortably under the 64KB default cap) but a
    // ~120KB *byte* payload (well over it) — this only rejects if the body
    // reader accounts real received bytes rather than `decodedString.length`.
    const oversizedMultibyte = JSON.stringify({ task: '€'.repeat(40000), reasoningBudget: 4, backend: 'recurrent' });
    assert.ok(Buffer.byteLength(oversizedMultibyte, 'utf8') > 65536, 'test payload must actually exceed the default byte cap');
    assert.ok(oversizedMultibyte.length < 65536, 'test payload must stay under the cap by decoded character count, to distinguish the two accounting methods');

    const response = await fetch(`${baseUrl}/api/experiment`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: oversizedMultibyte,
    });
    const result = await response.json();

    assert.equal(response.status, 400);
    assert.equal(result.error.code, 'VALIDATION_ERROR');
    assert.match(result.error.message, /too large/i);
  });
});
