import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { executeTrainedRecurrent, validateTrainedRecurrentRequest, THINKING_STEPS_TRAIN } from '../src/reasoning/trained-recurrent-backend.js';
import { executeRecurrentLatent } from '../src/reasoning/recurrent-latent-backend.js';
import { validateExperimentContract } from '../src/contracts/reasoning-backend.js';
import { pythonWorker } from '../src/reasoning/worker-client.js';

after(() => pythonWorker.stop());

const task = '1,1,1,1,1,1,1,1,1,1,1,1'; // 12 right moves from center 5, grid 0-10 -> clamps at 10.

test('rejects malformed requests before touching the worker', () => {
  assert.equal(validateTrainedRecurrentRequest(null).valid, false);
  assert.equal(validateTrainedRecurrentRequest({ task, reasoningBudget: -1 }).valid, false);
  assert.equal(validateTrainedRecurrentRequest({ task, reasoningBudget: 1.5 }).valid, false);
  assert.equal(validateTrainedRecurrentRequest({ task, reasoningBudget: 25 }).valid, false);
  assert.equal(validateTrainedRecurrentRequest({ task: '1', reasoningBudget: 4 }).valid, false);
  assert.equal(validateTrainedRecurrentRequest({ task, reasoningBudget: 0 }).valid, true);
  assert.equal(validateTrainedRecurrentRequest({ task, reasoningBudget: 24 }).valid, true);
});

test('executes the real trained model end to end and produces a valid experiment contract', async () => {
  const result = await executeTrainedRecurrent({ task, reasoningBudget: THINKING_STEPS_TRAIN });
  const { valid, errors } = validateExperimentContract(result);
  assert.deepEqual(errors, []);
  assert.equal(valid, true);
  assert.equal(result.metadata.evidenceLevel, 'LIVE');
  assert.equal(result.groundTruth, 10);
  assert.equal(result.finalPrediction, result.predictionsByStep.at(-1).prediction);
  assert.equal(result.finalScore, result.finalPrediction === result.groundTruth);
  assert.equal(result.latentStateObservationsByStep.length, 12 + THINKING_STEPS_TRAIN);
  assert.equal(result.configuration.thinkingStepsTrain, THINKING_STEPS_TRAIN);
});

test('budget 0 skips the thinking phase entirely — exactly one observation per input move', async () => {
  const result = await executeTrainedRecurrent({ task: '1,0,1,0,1', reasoningBudget: 0 });
  assert.equal(result.latentStateObservationsByStep.length, 5);
});

test('repeated identical requests are deterministic (fixed trained weights)', async () => {
  const withoutTiming = ({ latencyMs, runtime, ...stable }) => stable;
  const a = await executeTrainedRecurrent({ task: '1,0,0,1,1,0', reasoningBudget: 4 });
  const b = await executeTrainedRecurrent({ task: '1,0,0,1,1,0', reasoningBudget: 4 });
  assert.deepEqual(withoutTiming(a), withoutTiming(b));
});

test('state is isolated from the untrained toy backend when alternating on the same warm worker', async () => {
  const trained1 = await executeTrainedRecurrent({ task: '1,1,0,0', reasoningBudget: 2 });
  const toy = await executeRecurrentLatent({ task: '1,0,1,1', reasoningBudget: 4 });
  const trained2 = await executeTrainedRecurrent({ task: '1,1,0,0', reasoningBudget: 2 });
  assert.equal(toy.backend.id, 'recurrent-latent-toy-v1');
  const withoutTiming = ({ latencyMs, runtime, ...stable }) => stable;
  assert.deepEqual(withoutTiming(trained1), withoutTiming(trained2), 'interleaving a different backend must not affect this backend\'s deterministic output');
});
