import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { runHierarchicalComparison } from '../src/experiments/hierarchical-comparison.js';
import { getBackend } from '../src/reasoning/backend-registry.js';
import { pythonWorker } from '../src/reasoning/worker-client.js';

// `node --test` isolates each file into its own process, so stopping the
// shared worker singleton here only affects this file's process.
after(() => pythonWorker.stop());

test('comparison executes both live backends on one task and preserves actual run identities', async () => {
  const comparison = await runHierarchicalComparison({ task: '1,0,1,1', reasoningBudget: 2, execute: (request) => getBackend(request.backend).execute(request) });
  assert.equal(comparison.single.input.task, comparison.hierarchical.input.task);
  assert.equal(comparison.single.groundTruth, comparison.hierarchical.groundTruth);
  assert.equal(comparison.single.metadata.evidenceLevel, 'LIVE');
  assert.equal(comparison.hierarchical.metadata.evidenceLevel, 'LIVE');
  assert.notEqual(comparison.single.experimentId, comparison.hierarchical.experimentId);
});
