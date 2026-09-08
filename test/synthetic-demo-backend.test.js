import test from 'node:test';
import assert from 'node:assert/strict';

import {
  executeSyntheticDemo,
  validateExperimentRequest,
} from '../src/reasoning/synthetic-demo-backend.js';

test('executes the deterministic synthetic demonstration with contract-shaped output', async () => {
  const result = await executeSyntheticDemo({ task: '17 + 28', reasoningBudget: 4 });

  assert.equal(result.status, 'COMPLETE');
  assert.equal(result.metadata.evidenceLevel, 'SYNTHETIC');
  assert.equal(result.reasoningBudget, 4);
  assert.equal(result.latentStateObservationsByStep.length, 4);
  assert.equal(result.finalPrediction, 45);
  assert.equal(result.groundTruth, 45);
  assert.equal(result.finalScore, true);
  assert.equal(result.provenance.kind, 'OUR_IMPLEMENTATION');
});

test('the synthetic backend uses the budget to determine observation count', async () => {
  const result = await executeSyntheticDemo({ task: '17 + 28', reasoningBudget: 1 });
  assert.equal(result.latentStateObservationsByStep.length, 1);
  assert.equal(result.predictionsByStep.length, 1);
});

test('rejects missing, empty, invalid, negative, non-numeric, and excessive requests', () => {
  for (const request of [
    {},
    { task: '   ', reasoningBudget: 2 },
    { task: '17 + 28', reasoningBudget: 0 },
    { task: '17 + 28', reasoningBudget: -1 },
    { task: '17 + 28', reasoningBudget: 'four' },
    { task: '17 + 28', reasoningBudget: 9 },
  ]) {
    assert.equal(validateExperimentRequest(request).valid, false);
  }
});
