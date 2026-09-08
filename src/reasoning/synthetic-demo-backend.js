import { createExperimentContract } from '../contracts/reasoning-backend.js';

export const DEMONSTRATION_TASK = '17 + 28';
export const DEMONSTRATION_GROUND_TRUTH = 45;
export const MAX_DEMONSTRATION_BUDGET = 8;

/** @param {unknown} request */
export function validateExperimentRequest(request) {
  if (!request || typeof request !== 'object') return invalid('Request body must be a JSON object.');
  if (typeof request.task !== 'string' || request.task.trim().length === 0) return invalid('A non-empty task is required.');
  if (!Number.isInteger(request.reasoningBudget)) return invalid('Reasoning budget must be an integer.');
  if (request.reasoningBudget < 1) return invalid('Reasoning budget must be at least 1.');
  if (request.reasoningBudget > MAX_DEMONSTRATION_BUDGET) return invalid(`Reasoning budget must not exceed ${MAX_DEMONSTRATION_BUDGET} for this demonstration.`);
  return { valid: true, errors: [] };
}

function invalid(message) {
  return { valid: false, errors: [message] };
}

/**
 * A deterministic, non-neural demonstration backend. Its observations are
 * synthetic teaching artifacts, not measurements of a latent model state.
 * @param {{task: string, reasoningBudget: number}} request
 */
export async function executeSyntheticDemo(request) {
  const validation = validateExperimentRequest(request);
  if (!validation.valid) {
    const error = new Error(validation.errors[0]);
    error.code = 'VALIDATION_ERROR';
    throw error;
  }
  if (request.task.trim() !== DEMONSTRATION_TASK) {
    const error = new Error(`This Phase 1 demonstration supports only the task “${DEMONSTRATION_TASK}”.`);
    error.code = 'UNSUPPORTED_TASK';
    throw error;
  }

  const backend = {
    id: 'synthetic-arithmetic-demo-v1',
    displayName: 'Synthetic arithmetic demonstration',
    provenance: {
      kind: 'OUR_IMPLEMENTATION',
      evidenceLevel: 'SYNTHETIC',
      description: 'Deterministic Phase 1 pipeline demonstration; not a trained neural model.',
    },
  };
  const experiment = createExperimentContract({
    experimentId: `synthetic-17-plus-28-${request.reasoningBudget}`,
    taskId: 'toy-arithmetic-17-plus-28',
    backend,
    input: { task: DEMONSTRATION_TASK },
  });
  const observations = Array.from({ length: request.reasoningBudget }, (_, index) => {
    const progress = (index + 1) / request.reasoningBudget;
    const vector = [0.16, 0.28, 0.41, 0.57, 0.73, 0.88].map((base, vectorIndex) =>
      Number(Math.min(1, base * progress + vectorIndex * 0.015).toFixed(2)),
    );
    return {
      step: index,
      stateObservation: {
        kind: 'SYNTHETIC_ILLUSTRATIVE_VECTOR',
        values: vector,
        description: 'Synthetic illustration of a computation state; not a neural latent state.',
      },
      prediction: DEMONSTRATION_GROUND_TRUTH,
      confidence: null,
      metrics: { computationStep: index + 1 },
      metadata: { evidenceLevel: 'SYNTHETIC', observationPolicy: 'SAFE_DEMONSTRATION' },
    };
  });

  return {
    ...experiment,
    configuration: { mode: 'synthetic-demonstration', maximumBudget: MAX_DEMONSTRATION_BUDGET },
    reasoningBudget: request.reasoningBudget,
    initialState: { kind: 'SYNTHETIC_INITIAL_STATE', description: 'Illustrative initial state only.' },
    groundTruth: DEMONSTRATION_GROUND_TRUTH,
    predictionsByStep: observations.map(({ step, prediction }) => ({ step, prediction })),
    latentStateObservationsByStep: observations,
    finalPrediction: DEMONSTRATION_GROUND_TRUTH,
    finalScore: true,
    metrics: { computationSteps: request.reasoningBudget },
    provenance: backend.provenance,
    metadata: { evidenceLevel: 'SYNTHETIC', displayLabel: 'Synthetic demonstration' },
    status: 'COMPLETE',
  };
}
