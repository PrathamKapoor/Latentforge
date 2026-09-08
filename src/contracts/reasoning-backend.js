/**
 * Phase 0 contracts for future recurrent-latent reasoning backends.
 * These declarations deliberately do not execute a model or simulate results.
 */

export const EVIDENCE_LEVELS = Object.freeze([
  'LIVE',
  'PRECOMPUTED',
  'SYNTHETIC',
  'PUBLISHED',
  'ILLUSTRATIVE',
]);

/**
 * @typedef {Object} ReasoningStepObservation
 * @property {number} step Zero-based recurrent computation step.
 * @property {unknown|null} stateObservation Backend-safe observation of state; never hidden chain-of-thought.
 * @property {unknown|null} prediction Prediction available at this step, if any.
 * @property {number|null} confidence Backend-reported confidence, if available.
 * @property {Object|null} metrics Step metrics, if measured.
 * @property {Object} metadata Evidence level, observation policy, and backend-defined details.
 */

/**
 * @typedef {Object} ReasoningBackend
 * @property {string} id Stable backend identity.
 * @property {string} displayName Human-readable backend identity.
 * @property {Object} provenance Source, version, license status, and evidence links.
 * @property {(request: Object) => AsyncIterable<ReasoningStepObservation>} execute Future execution interface.
 */

/**
 * Creates a schema-shaped record for a future experiment. Runtime fields remain
 * null until an actual execution records them.
 *
 * @param {{experimentId: string, taskId: string, backend: Object, input: unknown}} input
 * @returns {Object}
 */
export function createExperimentContract(input) {
  return {
    experimentId: input.experimentId,
    taskId: input.taskId,
    backend: input.backend,
    configuration: null,
    reasoningBudget: null,
    randomSeed: null,
    input: input.input,
    groundTruth: null,
    predictionsByStep: null,
    latentStateObservationsByStep: null,
    finalPrediction: null,
    finalScore: null,
    latencyMs: null,
    tokenCount: null,
    metrics: null,
    provenance: null,
    error: null,
    metadata: { evidenceLevel: 'ILLUSTRATIVE' },
    status: 'CONTRACT_ONLY',
  };
}

/** @param {Object} experiment @returns {{valid: boolean, errors: string[]}} */
export function validateExperimentContract(experiment) {
  const errors = [];
  for (const key of ['experimentId', 'taskId', 'backend', 'input', 'status']) {
    if (experiment?.[key] === undefined || experiment?.[key] === null) {
      errors.push(`Missing required contract field: ${key}`);
    }
  }
  if (experiment?.metadata?.evidenceLevel && !EVIDENCE_LEVELS.includes(experiment.metadata.evidenceLevel)) {
    errors.push('Unknown evidence level.');
  }
  return { valid: errors.length === 0, errors };
}
