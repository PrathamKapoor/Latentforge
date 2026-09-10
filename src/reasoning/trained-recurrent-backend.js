import { performance } from 'node:perf_hooks';
import { createExperimentContract } from '../contracts/reasoning-backend.js';
import { encodeVariableLengthNavigationTask, solveVariableLengthNavigationTask, GRID_SIZE, MIN_TASK_LENGTH } from './variable-length-navigation-task.js';
import { MAX_TASK_LENGTH, MAX_REASONING_BUDGET } from '../server/config.js';
import { pythonWorker } from './worker-client.js';

export const TRAINED_RECURRENT_BACKEND_ID = 'trained-recurrent-flagship-v1';
export const THINKING_STEPS_TRAIN = 4;

function fail(code, message) {
  return Object.assign(new Error(message), { code });
}

export function validateTrainedRecurrentRequest(request) {
  if (!request || typeof request !== 'object' || Array.isArray(request)) {
    return { valid: false, errors: ['Request body must be a JSON object.'], code: 'VALIDATION_ERROR' };
  }
  const budget = request.reasoningBudget;
  if (!Number.isInteger(budget) || budget < 0 || budget > MAX_REASONING_BUDGET) {
    return { valid: false, errors: [`Reasoning budget must be an integer from 0 to ${MAX_REASONING_BUDGET}.`], code: 'VALIDATION_ERROR' };
  }
  try {
    encodeVariableLengthNavigationTask(request.task);
  } catch (error) {
    return { valid: false, errors: [error.message], code: 'UNSUPPORTED_TASK' };
  }
  return { valid: true, errors: [] };
}

/**
 * Flagship backend: an actually-trained recurrent model (see
 * research/flagship/), not an untrained fixed-seed initialization. The
 * task's move-sequence length is variable (2-24, see
 * variable-length-navigation-task.js); `reasoningBudget` here means
 * additional post-input "thinking" steps — self-transitions of the same
 * trained recurrent cell fed no new information — independent of task
 * length. Ground truth is computed independently in JS
 * (`solveVariableLengthNavigationTask`) and cross-checked against the
 * Python runner's own independently-duplicated `solve()` — any
 * disagreement between the two is a real bug and fails loudly rather than
 * silently picking one.
 */
export async function buildTrainedRecurrentResult(send, request) {
  const validation = validateTrainedRecurrentRequest(request);
  if (!validation.valid) throw fail(validation.code, validation.errors[0]);

  const startedAt = performance.now();
  const moves = encodeVariableLengthNavigationTask(request.task);
  const groundTruth = solveVariableLengthNavigationTask(request.task);
  const result = await send('trained-recurrent', { moves, thinkingSteps: request.reasoningBudget });
  if (result.error) throw fail(result.error.code ?? 'EXECUTION_ERROR', result.error.message ?? 'The trained-recurrent runner reported an error.');
  if (result.groundTruth !== groundTruth) {
    throw fail('CONTRACT_DRIFT', 'The JS and Python ground-truth solvers disagreed — this is a bug, not a data issue.');
  }

  const provenance = {
    kind: 'OUR_IMPLEMENTATION',
    evidenceLevel: 'LIVE',
    version: TRAINED_RECURRENT_BACKEND_ID,
    description: 'A real trained recurrent model (GRU cell, hidden size 64), trained on variable-length instances of this task and evaluated on held-out unseen lengths. See research/flagship/ for the full training/evaluation pipeline and results/flagship-experiment.json for measured results.',
    runtime: {
      pythonVersion: result.runtime.environment.pythonVersion,
      torchVersion: result.runtime.environment.torchVersion,
      cudaAvailable: result.runtime.environment.cudaAvailable,
      device: result.runtime.environment.device,
    },
  };
  const backend = { id: TRAINED_RECURRENT_BACKEND_ID, displayName: 'Flagship: trained recurrent model', provenance };
  const experiment = createExperimentContract({
    experimentId: `trained-recurrent-${moves.length}moves-${request.reasoningBudget}budget`,
    taskId: 'variable-length-bounded-navigation-v1',
    backend,
    input: { task: request.task },
  });

  const observations = result.steps.map((step, index) => ({
    step: index,
    stateObservation: {
      kind: 'RECURRENT_HIDDEN_STATE',
      values: step.hidden,
      description: 'Actual trained-model hidden state; numerical telemetry, not human-readable reasoning.',
    },
    prediction: step.prediction,
    logits: step.logits,
    confidence: null,
    metrics: { computationStep: index + 1, phase: step.phase },
    metadata: { evidenceLevel: 'LIVE', observationPolicy: 'TRAINED_MODEL_STATE_TELEMETRY' },
  }));

  return {
    ...experiment,
    configuration: {
      mode: 'trained-recurrent-flagship',
      framework: 'PyTorch',
      device: 'cpu',
      dtype: 'float32',
      cellType: 'GRUCell',
      hiddenSize: 64,
      gridSize: GRID_SIZE,
      training: 'trained (see research/flagship/train.py)',
      thinkingStepsTrain: result.thinkingStepsTrain,
      trainingSeed: result.trainingSeed,
      encodingPhase: 'one GRUCell update per input move (length = task length, not a free variable)',
      thinkingPhase: 'reasoningBudget additional GRUCell self-transitions on a zero input (no new information)',
      outputHead: 'argmax(Linear(hidden))',
      minTaskLength: MIN_TASK_LENGTH,
      maximumTaskLength: MAX_TASK_LENGTH,
      maximumReasoningBudget: MAX_REASONING_BUDGET,
    },
    reasoningBudget: request.reasoningBudget,
    randomSeed: result.trainingSeed,
    initialState: null,
    groundTruth,
    predictionsByStep: observations.map(({ step, prediction }) => ({ step, prediction })),
    latentStateObservationsByStep: observations,
    finalPrediction: result.finalPrediction,
    finalScore: result.finalPrediction === groundTruth,
    latencyMs: performance.now() - startedAt,
    metrics: { computationSteps: observations.length, encodingSteps: moves.length, thinkingSteps: request.reasoningBudget },
    provenance,
    metadata: { evidenceLevel: 'LIVE', displayLabel: 'LIVE trained recurrent flagship model', latencyScope: 'Backend elapsed time including worker queue wait and execution' },
    status: 'COMPLETE',
    error: null,
  };
}

/** Execute the trained flagship model as its own queued job. */
export async function executeTrainedRecurrent(request) {
  const validation = validateTrainedRecurrentRequest(request);
  if (!validation.valid) throw fail(validation.code, validation.errors[0]);
  const { result } = await pythonWorker.enqueue((send) => buildTrainedRecurrentResult(send, request));
  return result;
}
