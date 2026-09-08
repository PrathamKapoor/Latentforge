import test from 'node:test';
import assert from 'node:assert/strict';

// This test specifies the client-side guided state machine independently of the DOM.
import { createGuidedExperience } from '../src/ui/guided-experience.js';

const live = (budget) => ({ metadata: { evidenceLevel: 'LIVE' }, reasoningBudget: budget, experimentId: `run-${budget}` });

test('starts the preset with an actual live request and gates sandbox on learner actions', async () => {
  const requests = [];
  const experience = createGuidedExperience({
    request: async (request) => { requests.push(request); return live(request.reasoningBudget); },
  });

  await experience.startPreset();
  assert.deepEqual(requests[0], { task: '1,0,1,1', reasoningBudget: 4, backend: 'recurrent' });
  assert.equal(experience.state.sandboxUnlocked, false);
  await experience.changeBudget(8);
  assert.equal(experience.state.manipulated, true);
  assert.equal(experience.answer('B'), true);
  assert.equal(experience.submitExplanation('The numerical state is updated again.'), true);
  assert.equal(experience.unlockSandbox(), true);
});

test('rejects non-live preset results and does not treat them as live state', async () => {
  const experience = createGuidedExperience({ request: async () => ({ metadata: { evidenceLevel: 'SYNTHETIC' } }) });
  await assert.rejects(experience.startPreset(), /live recurrent/i);
});

test('hierarchy lesson cannot unlock without live hierarchy run, H/L inspection, and live comparison', async () => {
  const experience = createGuidedExperience({ request: async (request) => request.backend === 'hrm-inspired' ? { ...live(request.reasoningBudget), hierarchicalStateObservationsByStep: [{}] } : live(request.reasoningBudget) });
  assert.equal(experience.completeHierarchyLesson(), false);
  await experience.runHierarchy();
  assert.equal(experience.completeHierarchyLesson(), false);
  experience.inspectHierarchy();
  assert.equal(experience.completeHierarchyLesson(), false);
  await experience.compareHierarchy();
  assert.equal(experience.completeHierarchyLesson(), true);
});

test('BDH-CQ lesson requires live run, S/H inspection, manipulation, comparison, and explanation', async () => {
  const bdh = (count) => ({ ...live(4), configuration: { demonstrationCount: count }, memoryTrajectory: Array.from({ length: count }, () => ({})), initialState: { values: [0] }, workspaceTrajectory: [{}] });
  const experience = createGuidedExperience({ request: async (request) => request.backend === 'bdh-cq-inspired' ? bdh(request.demonstrationCount) : live(request.reasoningBudget) });
  await experience.runBdhCq(2); assert.equal(experience.completeBdhLesson('x'), false);
  experience.inspectBdhMemory(); experience.inspectBdhWorkspace(); await experience.manipulateBdhDemonstrations(3); await experience.compareBdhCq();
  assert.equal(experience.completeBdhLesson('S changes with demonstrations.'), true);
});
