import test, { after } from 'node:test'; import assert from 'node:assert/strict'; import { runBdhCqDemonstrationSweep } from '../src/experiments/bdh-cq-demonstration-sweep.js'; import { executeBdhCqInspired } from '../src/reasoning/bdh-cq-inspired-backend.js';
import { pythonWorker } from '../src/reasoning/worker-client.js';
// `node --test` isolates each file into its own process, so stopping the worker here only affects this file's process.
after(() => pythonWorker.stop());
test('sweeps actual live demonstration counts while retaining fixed workspace budget',async()=>{const s=await runBdhCqDemonstrationSweep({task:'1,0,1,1',reasoningBudget:4,execute:executeBdhCqInspired});assert.deepEqual(s.runs.map(r=>r.configuration.demonstrationCount),[1,2,3]);assert.ok(s.runs.every(r=>r.workspaceTrajectory.length===4&&r.metadata.evidenceLevel==='LIVE'));assert.equal(new Set(s.runs.map(r=>r.experimentId)).size,3)});
