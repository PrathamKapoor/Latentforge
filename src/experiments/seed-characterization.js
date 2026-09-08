import { CHARACTERIZATION_SEEDS, RECURRENT_SEED } from '../reasoning/recurrent-latent-backend.js';

const BUDGETS = Object.freeze([1, 2, 4, 8]);

/** All seeds this characterization runs, canonical seed first. */
export const ALL_CHARACTERIZATION_SEEDS = Object.freeze([RECURRENT_SEED, ...CHARACTERIZATION_SEEDS]);

/**
 * LOCAL CHARACTERIZATION — NOT A BENCHMARK.
 *
 * Runs the same recurrent architecture and task across a small, fixed set
 * of deterministic parameter seeds (ALL_CHARACTERIZATION_SEEDS) at each of
 * the four canonical budgets, to show whether the canonical example's
 * non-monotonic budget/correctness pattern is a general property of this
 * tiny untrained substrate or an artifact of one hand-picked seed.
 *
 * Every run is recorded, including incorrect and non-monotonic ones —
 * failures are not filtered out, and no seed is excluded because its
 * results look worse. The single manipulated variable is the parameter
 * seed; task, budgets, architecture, and reference solver are held fixed.
 */
export async function runSeedCharacterization({ task, execute, seeds = ALL_CHARACTERIZATION_SEEDS, budgets = BUDGETS }) {
  const rows = [];
  for (const seed of seeds) {
    for (const reasoningBudget of budgets) {
      try {
        const result = await execute({ task, backend: 'recurrent', reasoningBudget, seed });
        if (result?.metadata?.evidenceLevel !== 'LIVE') throw new Error('Expected a live recurrent result.');
        rows.push({
          seed,
          reasoningBudget,
          prediction: result.finalPrediction,
          groundTruth: result.groundTruth,
          correct: result.finalScore,
          experimentId: result.experimentId,
          status: 'COMPLETE',
          evidenceLevel: 'LIVE',
        });
      } catch (error) {
        rows.push({ seed, reasoningBudget, status: 'ERROR', evidenceLevel: 'LIVE_ERROR', error: { message: 'The live characterization run failed.' } });
      }
    }
  }

  const bySeed = new Map();
  for (const row of rows) {
    if (!bySeed.has(row.seed)) bySeed.set(row.seed, []);
    bySeed.get(row.seed).push(row);
  }
  const accuracyByBudget = Object.fromEntries(budgets.map((budget) => {
    const atBudget = rows.filter((row) => row.reasoningBudget === budget);
    const correctCount = atBudget.filter((row) => row.correct === true).length;
    return [budget, { correctCount, totalCount: atBudget.length }];
  }));

  return {
    id: `seed-characterization-${task.replaceAll(',', '')}`,
    task,
    backend: 'recurrent',
    seeds: [...seeds],
    budgets: [...budgets],
    evidenceLevel: 'LOCAL_CHARACTERIZATION',
    label: 'LOCAL CHARACTERIZATION — NOT A BENCHMARK',
    rows,
    bySeed: Object.fromEntries(bySeed),
    accuracyByBudget,
  };
}
