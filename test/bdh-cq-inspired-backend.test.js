import test, { after } from 'node:test'; import assert from 'node:assert/strict';
import { executeBdhCqInspired } from '../src/reasoning/bdh-cq-inspired-backend.js';
import { pythonWorker } from '../src/reasoning/worker-client.js';
// `node --test` isolates each file into its own process, so stopping the worker here only affects this file's process.
after(() => pythonWorker.stop());
const request=(demonstrationCount,reasoningBudget)=>({task:'1,0,1,1',demonstrationCount,reasoningBudget});
test('honors each requested workspace budget without changing memory count',async()=>{for(const b of [1,2,4,8]){const r=await executeBdhCqInspired(request(2,b));assert.equal(r.reasoningBudget,b);assert.equal(r.configuration.latentBudget,b);assert.equal(r.memoryTrajectory.length,2);assert.equal(r.workspaceTrajectory.length,b);assert.equal(r.latentStateObservationsByStep.length,b);assert.equal(r.metadata.evidenceLevel,'LIVE')}});
test('separates demonstration-memory updates from workspace updates',async()=>{const a=await executeBdhCqInspired(request(1,4)),b=await executeBdhCqInspired(request(3,4));assert.equal(a.workspaceTrajectory.length,b.workspaceTrajectory.length);assert.equal(a.memoryTrajectory.length,1);assert.equal(b.memoryTrajectory.length,3);assert.equal(a.groundTruth,b.groundTruth);assert.equal(a.randomSeed,b.randomSeed);assert.equal(a.configuration.dtype,b.configuration.dtype)});
test('rejects invalid budget rather than substituting four',async()=>{await assert.rejects(executeBdhCqInspired(request(2,3)),{code:'VALIDATION_ERROR'})});
