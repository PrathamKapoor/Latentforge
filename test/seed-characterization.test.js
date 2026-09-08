import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runSeedCharacterization, ALL_CHARACTERIZATION_SEEDS } from '../src/experiments/seed-characterization.js';
import { CHARACTERIZATION_SEEDS, RECURRENT_SEED, executeRecurrentLatent } from '../src/reasoning/recurrent-latent-backend.js';
import { pythonWorker } from '../src/reasoning/worker-client.js';

// `node --test` isolates each file into its own process, so stopping the worker here only affects this file's process.
after(() => pythonWorker.stop());

test('the JS and Python characterization seed lists have not drifted apart', async () => {
  const runnerSource = await readFile(new URL('../src/reasoning/recurrent-runner.py', import.meta.url), 'utf8');
  const match = runnerSource.match(/CHARACTERIZATION_SEEDS = \(([^)]+)\)/);
  assert.ok(match, 'recurrent-runner.py must declare CHARACTERIZATION_SEEDS');
  const pythonSeeds = match[1].split(',').map((value) => value.trim()).filter(Boolean).map(Number);
  assert.deepEqual(pythonSeeds, [...CHARACTERIZATION_SEEDS]);
});

test('records every seed x budget combination without cherry-picking, including failures', async () => {
  const calls = [];
  const characterization = await runSeedCharacterization({
    task: '1,0,1,1',
    seeds: [111, 222],
    budgets: [1, 2],
    execute: async (request) => {
      calls.push(request);
      if (request.seed === 222 && request.reasoningBudget === 2) throw new Error('simulated failure');
      return {
        metadata: { evidenceLevel: 'LIVE' },
        finalPrediction: request.seed === 111 ? 4 : 2,
        groundTruth: 4,
        finalScore: request.seed === 111,
        experimentId: `fake-${request.seed}-${request.reasoningBudget}`,
      };
    },
  });

  assert.equal(calls.length, 4);
  assert.equal(characterization.rows.length, 4);
  assert.equal(characterization.evidenceLevel, 'LOCAL_CHARACTERIZATION');
  assert.equal(characterization.label, 'LOCAL CHARACTERIZATION — NOT A BENCHMARK');

  const failedRow = characterization.rows.find((row) => row.seed === 222 && row.reasoningBudget === 2);
  assert.equal(failedRow.status, 'ERROR');
  assert.equal(failedRow.evidenceLevel, 'LIVE_ERROR');

  const correctRow = characterization.rows.find((row) => row.seed === 111 && row.reasoningBudget === 1);
  assert.equal(correctRow.correct, true);
  const incorrectRow = characterization.rows.find((row) => row.seed === 222 && row.reasoningBudget === 1);
  assert.equal(incorrectRow.correct, false);

  assert.equal(characterization.accuracyByBudget[1].totalCount, 2);
  assert.equal(characterization.accuracyByBudget[1].correctCount, 1);
  assert.equal(characterization.accuracyByBudget[2].totalCount, 2);
  assert.equal(characterization.accuracyByBudget[2].correctCount, 1); // seed 111 succeeded and was correct at budget 2; seed 222 errored (excluded from correctCount, still counted in totalCount)
});

test('runs the real live recurrent backend across all declared seeds and preserves the canonical seed default', async () => {
  assert.deepEqual(ALL_CHARACTERIZATION_SEEDS[0], RECURRENT_SEED);
  assert.equal(ALL_CHARACTERIZATION_SEEDS.length, CHARACTERIZATION_SEEDS.length + 1);

  const characterization = await runSeedCharacterization({
    task: '1,0,1,1',
    seeds: ALL_CHARACTERIZATION_SEEDS,
    budgets: [1, 4],
    execute: (request) => executeRecurrentLatent(request),
  });

  assert.equal(characterization.rows.length, ALL_CHARACTERIZATION_SEEDS.length * 2);
  assert.ok(characterization.rows.every((row) => row.status === 'COMPLETE'));

  // The canonical seed's row must exactly match the unmodified default (no seed field) path.
  const canonicalRow = characterization.rows.find((row) => row.seed === RECURRENT_SEED && row.reasoningBudget === 4);
  const defaultResult = await executeRecurrentLatent({ task: '1,0,1,1', reasoningBudget: 4 });
  assert.equal(canonicalRow.prediction, defaultResult.finalPrediction);
  assert.equal(canonicalRow.experimentId, defaultResult.experimentId);

  // Not a cherry-picked claim: different seeds are not required to agree
  // with each other or with the canonical example. This only asserts each
  // seed/budget combination produced its own independently computed,
  // distinctly identified run — proving the seed parameter actually reaches
  // the computation rather than being silently ignored.
  const distinctRunIds = new Set(characterization.rows.map((row) => row.experimentId)).size;
  assert.equal(distinctRunIds, characterization.rows.length, 'every seed/budget combination must produce a distinct run identity');
});
