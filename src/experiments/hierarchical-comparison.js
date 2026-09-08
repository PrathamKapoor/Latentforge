export async function runHierarchicalComparison({ task, reasoningBudget, execute }) {
  const requests = [
    { task, reasoningBudget, backend: 'recurrent' },
    { task, reasoningBudget, backend: 'hrm-inspired' },
  ];
  const results = await Promise.all(requests.map(async (request) => {
    const result = await execute(request);
    if (result?.metadata?.evidenceLevel !== 'LIVE') throw new Error('Comparison requires actual live executions.');
    return result;
  }));
  if (results[0].input.task !== task || results[1].input.task !== task || results[0].groundTruth !== results[1].groundTruth) throw new Error('Comparison results did not retain the same task and independent reference.');
  return { task, reasoningBudget, evidenceLevel: 'LIVE', comparisonNote: 'Same task/reference; different recurrent architecture and fixed parameter structures.', single: results[0], hierarchical: results[1] };
}
