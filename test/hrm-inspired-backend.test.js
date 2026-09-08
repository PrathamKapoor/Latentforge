import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { executeHrmInspired, validateHrmInspiredRequest } from '../src/reasoning/hrm-inspired-backend.js';
import { getBackend } from '../src/reasoning/backend-registry.js';
import { pythonWorker } from '../src/reasoning/worker-client.js';

// `node --test` isolates each file into its own process, so stopping the
// shared worker singleton here only affects this file's process and lets
// it exit cleanly instead of the child process keeping the event loop alive.
after(() => pythonWorker.stop());

test('registered HRM-inspired backend returns live actual high and low trajectories with independent truth', async () => {
  const result = await executeHrmInspired({ task: '1,0,1,1', reasoningBudget: 4 });
  assert.equal(getBackend('hrm-inspired').execute, executeHrmInspired);
  assert.equal(result.backend.id, 'hrm-inspired-hierarchical-recurrence-v1');
  assert.equal(result.metadata.evidenceLevel, 'LIVE');
  assert.equal(result.groundTruth, 4);
  assert.equal(result.hierarchicalStateObservationsByStep.length, 4);
  assert.deepEqual(result.hierarchicalStateObservationsByStep.map((item) => item.highUpdated), [false, true, false, true]);
  assert.equal(result.finalPrediction, result.hierarchicalStateObservationsByStep.at(-1).prediction);
  assert.equal(result.finalScore, result.finalPrediction === result.groundTruth);
});

test('hierarchical malformed requests fail explicitly without synthetic fallback', async () => {
  assert.equal(validateHrmInspiredRequest({ task: '1,0,1,1', reasoningBudget: 3 }).valid, false);
  await assert.rejects(executeHrmInspired({ task: '1,0,1,1', reasoningBudget: 3 }), { code: 'VALIDATION_ERROR' });
  assert.throws(() => getBackend('not-a-backend'), { code: 'VALIDATION_ERROR' });
});
