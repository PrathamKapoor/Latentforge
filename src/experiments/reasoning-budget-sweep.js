const BUDGETS = Object.freeze([1, 2, 4, 8]);

/**
 * `budgets` defaults to the full canonical set (unchanged behavior for every
 * existing caller/test). The server passes a narrower list — the budgets
 * NOT already computed as the caller's primary request — so one HTTP
 * request's combined primary+sweep job never recomputes the same budget
 * twice.
 */
export async function runReasoningBudgetSweep({ task, backend, execute, budgets = BUDGETS }) {
  const runs = [];
  for (const reasoningBudget of budgets) {
    try {
      const result = await execute({ task, backend, reasoningBudget });
      if (result?.metadata?.evidenceLevel !== 'LIVE') throw new Error('Expected a live recurrent result.');
      runs.push({ ...result, status: 'COMPLETE', evidenceLevel: 'LIVE' });
    } catch (error) {
      runs.push({ reasoningBudget, status: 'ERROR', evidenceLevel: 'LIVE_ERROR', error: { message: 'The live recurrent run failed.' } });
    }
  }
  return { id: `sweep-${backend}-${task.replaceAll(',', '')}-20260907`, task, backend, budgets: [...budgets], evidenceLevel: 'LIVE', runs };
}
