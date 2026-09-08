import test from 'node:test';
import assert from 'node:assert/strict';

import {
  EVIDENCE_LEVELS,
  createExperimentContract,
  validateExperimentContract,
} from '../src/contracts/reasoning-backend.js';

test('exposes the Phase 0 evidence classifications', () => {
  assert.deepEqual(EVIDENCE_LEVELS, [
    'LIVE',
    'PRECOMPUTED',
    'SYNTHETIC',
    'PUBLISHED',
    'ILLUSTRATIVE',
  ]);
});

test('creates a contract-only experiment without fabricated runtime values', () => {
  const experiment = createExperimentContract({
    experimentId: 'contract-example',
    taskId: 'future-task',
    backend: { id: 'future-backend', displayName: 'Future backend' },
    input: { prompt: 'A future task input' },
  });

  assert.equal(experiment.status, 'CONTRACT_ONLY');
  assert.equal(experiment.predictionsByStep, null);
  assert.equal(experiment.finalPrediction, null);
  assert.equal(experiment.metrics, null);
  assert.equal(experiment.error, null);
  assert.equal(validateExperimentContract(experiment).valid, true);
});
