import { performance } from 'node:perf_hooks';
import { createExperimentContract } from '../contracts/reasoning-backend.js';
import { encodeLineNavigationTask, solveLineNavigationTask } from './line-navigation-task.js';
import { pythonWorker } from './worker-client.js';
import { MAX_REASONING_BUDGET } from '../server/config.js';

export const BDH_CQ_INSPIRED_BACKEND_ID = 'bdh-cq-inspired-local-v1';
export const BDH_CQ_SEED = 20260909;

const ALLOWED_DEMONSTRATION_COUNTS = [1, 2, 3];
// This backend's S/H update schedule is only validated at these four
// points, so LATENTFORGE_MAX_REASONING_BUDGET can only narrow this set.
const ALLOWED_BUDGETS = [1, 2, 4, 8].filter((budget) => budget <= MAX_REASONING_BUDGET);

function fail(code, message) {
  return Object.assign(new Error(message), { code });
}

const isFiniteVector = (values) => Array.isArray(values) && values.length === 8 && values.every(Number.isFinite);

export function validateBdhCqRequest(request) {
  if (!request || typeof request !== 'object' || Array.isArray(request)) {
    return { valid: false, errors: ['Request body must be a JSON object.'], code: 'VALIDATION_ERROR' };
  }
  if (!ALLOWED_DEMONSTRATION_COUNTS.includes(request.demonstrationCount) || !ALLOWED_BUDGETS.includes(request.reasoningBudget)) {
    return { valid: false, errors: ['demonstrationCount must be 1, 2, or 3 and reasoningBudget must be supported.'], code: 'VALIDATION_ERROR' };
  }
  try {
    encodeLineNavigationTask(request.task);
  } catch (error) {
    return { valid: false, errors: [error.message], code: 'UNSUPPORTED_TASK' };
  }
  return { valid: true, errors: [] };
}

/** Defense-in-depth: re-validate the shape the worker returned before trusting it. */
function validateRunnerResult(result, request) {
  const memoryValid = Array.isArray(result?.memoryTrajectory) && result.memoryTrajectory.length === request.demonstrationCount;
  const workspaceValid = Array.isArray(result?.workspaceTrajectory) && result.workspaceTrajectory.length === request.reasoningBudget;
  const valid = result
    && result.effectiveReasoningBudget === request.reasoningBudget
    && isFiniteVector(result.initialWorkspace)
    && memoryValid
    && workspaceValid;
  if (!valid) throw fail('INVALID_RUNNER_RESPONSE', 'The local BDH-CQ-inspired runner returned an invalid response.');
}

/**
 * Pure computation core: given a worker `send` function (already holding the
 * job's active slot) and a validated request, runs one BDH-CQ-inspired
 * experiment (sequential memory updates, then workspace updates) and
 * returns the full contract-shaped result. See
 * recurrent-latent-backend.js's `buildRecurrentResult` for why this is
 * split out from the job-owning `executeBdhCqInspired`.
 */
export async function buildBdhCqInspiredResult(send, request) {
  const validation = validateBdhCqRequest(request);
  if (!validation.valid) throw fail(validation.code, validation.errors[0]);

  const query = encodeLineNavigationTask(request.task);
  const groundTruth = solveLineNavigationTask(request.task);
  const result = await send('bdh-cq-inspired', {
    query,
    demonstrationCount: request.demonstrationCount,
    reasoningBudget: request.reasoningBudget,
    seed: BDH_CQ_SEED,
  });
  validateRunnerResult(result, request);

  const provenance = {
    kind: 'OUR_IMPLEMENTATION',
    evidenceLevel: 'LIVE',
    description: 'BDH-CQ-inspired simplified local implementation; not a BDH-CQ reproduction.',
    researchSource: { evidenceLevel: 'PUBLISHED', url: 'https://arxiv.org/abs/2608.09888' },
  };
  const backend = { id: BDH_CQ_INSPIRED_BACKEND_ID, displayName: 'BDH-CQ-inspired — simplified local implementation', provenance };
  const base = createExperimentContract({
    experimentId: `bdh-cq-inspired-${request.task.replaceAll(',', '')}-${request.demonstrationCount}-${request.reasoningBudget}-${BDH_CQ_SEED}`,
    taskId: 'bounded-line-navigation-v1',
    backend,
    input: { task: request.task },
  });

  const observations = result.workspaceTrajectory.map((step, index) => ({
    step: index,
    stateObservation: {
      kind: 'BDH_CQ_INSPIRED_WORKSPACE',
      values: step.state,
      description: 'Actual local query workspace state.',
    },
    prediction: step.prediction,
    logits: step.logits,
    confidence: null,
    metrics: { computationStep: index + 1, ...step.metrics },
    metadata: { evidenceLevel: 'LIVE' },
  }));

  return {
    ...base,
    configuration: {
      mode: 'bdh-cq-inspired-simplified-local',
      seed: BDH_CQ_SEED,
      dtype: 'float64',
      device: 'cpu',
      stateSize: 8,
      latentBudget: request.reasoningBudget,
      demonstrationCount: request.demonstrationCount,
      manipulatedVariable: 'demonstrationCount',
      training: 'none',
    },
    reasoningBudget: request.reasoningBudget,
    effectiveReasoningBudget: result.effectiveReasoningBudget,
    randomSeed: BDH_CQ_SEED,
    initialState: { kind: 'BDH_CQ_WORKSPACE_INITIAL_STATE', values: result.initialWorkspace },
    memoryTrajectory: result.memoryTrajectory,
    workspaceTrajectory: result.workspaceTrajectory,
    groundTruth,
    predictionsByStep: observations.map(({ step, prediction }) => ({ step, prediction })),
    latentStateObservationsByStep: observations,
    finalPrediction: result.finalPrediction,
    finalScore: result.finalPrediction === groundTruth,
    metrics: {
      computationSteps: observations.length,
      stateNormTrajectory: observations.map(({ metrics }) => metrics.stateNorm),
      stateChangeTrajectory: observations.map(({ metrics }) => metrics.deltaFromPrevious),
    },
    provenance,
    metadata: { evidenceLevel: 'LIVE', displayLabel: 'LIVE local BDH-CQ-inspired memory/workspace recurrence' },
    status: 'COMPLETE',
  };
}

/** Execute the local BDH-CQ-inspired substrate as its own queued job. */
export async function executeBdhCqInspired(request) {
  const validation = validateBdhCqRequest(request);
  if (!validation.valid) throw fail(validation.code, validation.errors[0]);
  const { result } = await pythonWorker.enqueue((send) => buildBdhCqInspiredResult(send, request));
  return result;
}
