import { performance } from 'node:perf_hooks';
import { createExperimentContract } from '../contracts/reasoning-backend.js';
import { encodeLineNavigationTask, solveLineNavigationTask } from './line-navigation-task.js';
import { pythonWorker } from './worker-client.js';
import { MAX_REASONING_BUDGET } from '../server/config.js';

export const RECURRENT_BACKEND_ID = 'recurrent-latent-toy-v1';
export const RECURRENT_SEED = 20260907;
// This backend's architecture is only validated at these four points, so
// LATENTFORGE_MAX_REASONING_BUDGET can only ever narrow this set (e.g. to
// [1, 2, 4] if set to 5-7), never widen it — 8 stays the ceiling regardless
// of a higher configured value.
const ALLOWED_BUDGETS = Object.freeze([1, 2, 4, 8].filter((budget) => budget <= MAX_REASONING_BUDGET));

/**
 * A small, fixed, pre-declared set of additional seeds used ONLY by the
 * local seed-characterization experiment — never accepted from arbitrary
 * user input. Must stay in sync with CHARACTERIZATION_SEEDS in
 * recurrent-runner.py; test/seed-characterization.test.js checks the two
 * lists agree (contract-drift protection).
 */
export const CHARACTERIZATION_SEEDS = Object.freeze([1, 42, 2024, 90210]);
const ALLOWED_SEEDS = Object.freeze([RECURRENT_SEED, ...CHARACTERIZATION_SEEDS]);

function failure(code, message) {
  return Object.assign(new Error(message), { code });
}

export function validateRecurrentRequest(request) {
  if (!request || typeof request !== 'object' || Array.isArray(request)) {
    return { valid: false, errors: ['Request body must be a JSON object.'], code: 'VALIDATION_ERROR' };
  }
  if (!Number.isInteger(request.reasoningBudget) || !ALLOWED_BUDGETS.includes(request.reasoningBudget)) {
    return { valid: false, errors: [`Reasoning budget must be one of ${ALLOWED_BUDGETS.join(', ')}.`], code: 'VALIDATION_ERROR' };
  }
  try {
    encodeLineNavigationTask(request.task);
  } catch (error) {
    return { valid: false, errors: [error.message], code: 'UNSUPPORTED_TASK' };
  }
  return { valid: true, errors: [] };
}

const finiteVector = (values, length) => Array.isArray(values) && values.length === length && values.every(Number.isFinite);
const equalVector = (left, right) => Array.isArray(left) && left.length === right.length && left.every((value, index) => value === right[index]);
const argmax = (values) => values.indexOf(Math.max(...values));

function validateRunnerResult(result, budget) {
  const observations = result?.observations;
  const environment = result?.runtime?.environment;
  const valid = finiteVector(result?.initialState, 8)
    && Array.isArray(observations) && observations.length === budget
    && observations.every((observation) => observation && finiteVector(observation.state, 8)
      && finiteVector(observation.logits, 5)
      && Number.isInteger(observation.prediction) && observation.prediction === argmax(observation.logits)
      && observation.confidence === null
      && ['stateNorm', 'mean', 'standardDeviation', 'deltaFromPrevious'].every((key) => Number.isFinite(observation[key]))
      && (observation.cosineSimilarityToPrevious === null || Number.isFinite(observation.cosineSimilarityToPrevious)))
    && result.finalPrediction === observations.at(-1).prediction
    && equalVector(result.finalState, observations.at(-1).state)
    && equalVector(result.finalLogits, observations.at(-1).logits)
    && Number.isFinite(result.runtime?.latencyMs) && result.runtime.latencyMs >= 0
    && typeof environment?.pythonVersion === 'string' && /^\d+\.\d+\.\d+/.test(environment.pythonVersion)
    && typeof environment?.torchVersion === 'string' && /^\d+\./.test(environment.torchVersion)
    && environment?.device === 'cpu' && typeof environment.cudaAvailable === 'boolean';
  if (!valid) throw failure('INVALID_RUNNER_RESPONSE', 'The local recurrent runner returned an invalid response.');
}

/**
 * Pure computation core: given a worker `send` function (already holding the
 * job's active slot — see PythonWorkerClient.enqueue) and a validated
 * request, runs one recurrent experiment and returns the full Phase 0
 * contract-shaped result. Never enqueues its own job, so callers that need
 * several sequential sends within one job (e.g. the server's combined
 * primary+budget-sweep request) can call this directly with a shared `send`.
 */
export async function buildRecurrentResult(send, request) {
  const validation = validateRecurrentRequest(request);
  if (!validation.valid) throw failure(validation.code, validation.errors[0]);

  // `request.seed` is never supplied by the public experiment form (app.js
  // never sends it) — only the internal seed-characterization job passes an
  // explicit, pre-validated seed from CHARACTERIZATION_SEEDS. Any other
  // value silently falls back to the canonical seed, so the default
  // experiment path is byte-for-byte unaffected by this parameter existing.
  const seed = ALLOWED_SEEDS.includes(request.seed) ? request.seed : RECURRENT_SEED;

  const startedAt = performance.now();
  const inputVector = encodeLineNavigationTask(request.task);
  const groundTruth = solveLineNavigationTask(request.task);
  const result = await send('recurrent', { inputVector, reasoningBudget: request.reasoningBudget, seed });
  validateRunnerResult(result, request.reasoningBudget);

  const provenance = {
    kind: 'OUR_IMPLEMENTATION',
    evidenceLevel: 'LIVE',
    version: RECURRENT_BACKEND_ID,
    description: 'Local toy recurrent neural substrate; deterministically initialized, not trained. No external model weights or named research architecture reproduction.',
    runtime: {
      pythonVersion: result.runtime.environment.pythonVersion,
      torchVersion: result.runtime.environment.torchVersion,
      cudaAvailable: result.runtime.environment.cudaAvailable,
      device: result.runtime.environment.device,
    },
  };
  const backend = { id: RECURRENT_BACKEND_ID, displayName: 'Local toy recurrent neural substrate (not trained)', provenance };
  const experiment = createExperimentContract({
    experimentId: `recurrent-${request.task.replaceAll(',', '')}-${request.reasoningBudget}-${seed}`,
    taskId: 'bounded-line-navigation-v1',
    backend,
    input: { task: request.task },
  });
  const observations = result.observations.map((observation, step) => ({
    step,
    stateObservation: {
      kind: 'RECURRENT_HIDDEN_STATE',
      values: observation.state,
      description: 'Actual local recurrent hidden state; numerical telemetry, not human-readable reasoning.',
    },
    prediction: observation.prediction,
    logits: observation.logits,
    confidence: null,
    metrics: {
      computationStep: step + 1,
      stateNorm: observation.stateNorm,
      mean: observation.mean,
      standardDeviation: observation.standardDeviation,
      deltaFromPrevious: observation.deltaFromPrevious,
      cosineSimilarityToPrevious: observation.cosineSimilarityToPrevious,
    },
    metadata: { evidenceLevel: 'LIVE', observationPolicy: 'LOCAL_TOY_STATE_TELEMETRY' },
  }));

  return {
    ...experiment,
    configuration: {
      mode: 'local-recurrent-neural-substrate',
      framework: 'PyTorch',
      device: 'cpu',
      dtype: 'float64',
      inputSize: 4,
      hiddenSize: 8,
      outputSize: 5,
      activation: 'tanh',
      sharedTransition: true,
      training: 'none',
      initialization: {
        method: 'torch.manual_seed with sequential torch.randn draws',
        seed,
        parameterOrder: ['encodeWeight', 'encodeBias', 'hiddenWeight', 'inputWeight', 'hiddenBias', 'outputWeight', 'outputBias'],
        weightScaling: { encodeWeight: '1/sqrt(4)', hiddenWeight: '1/sqrt(8)', inputWeight: '1/sqrt(4)', outputWeight: '1/sqrt(8)' },
        biasScaling: 0.1,
      },
      encoder: 'four binary moves; h0 = tanh(W_encode x + b_encode)',
      transition: 'h_next = tanh(W_h h + W_x x + b_h)',
      outputHead: 'argmax(W_out h + b_out)',
      allowedBudgets: [...ALLOWED_BUDGETS],
      maximumBudget: 8,
    },
    reasoningBudget: request.reasoningBudget,
    randomSeed: seed,
    initialState: { kind: 'RECURRENT_INITIAL_STATE', values: result.initialState, description: 'Actual encoded initial hidden state h0.' },
    groundTruth,
    predictionsByStep: observations.map(({ step, prediction }) => ({ step, prediction })),
    latentStateObservationsByStep: observations,
    finalPrediction: result.finalPrediction,
    finalScore: result.finalPrediction === groundTruth,
    latencyMs: performance.now() - startedAt,
    metrics: {
      computationSteps: observations.length,
      stateNormTrajectory: observations.map(({ metrics }) => metrics.stateNorm),
      stateChangeTrajectory: observations.map(({ metrics }) => metrics.deltaFromPrevious),
    },
    provenance,
    metadata: { evidenceLevel: 'LIVE', displayLabel: 'Live local toy recurrent neural substrate (not trained)', latencyScope: 'Backend elapsed time including worker queue wait and execution' },
    status: 'COMPLETE',
  };
}

/** Execute the local untrained recurrent substrate as its own queued job. */
export async function executeRecurrentLatent(request) {
  const validation = validateRecurrentRequest(request);
  if (!validation.valid) throw failure(validation.code, validation.errors[0]);
  const { result } = await pythonWorker.enqueue((send) => buildRecurrentResult(send, request));
  return result;
}
