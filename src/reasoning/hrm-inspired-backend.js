import { performance } from 'node:perf_hooks';
import { createExperimentContract } from '../contracts/reasoning-backend.js';
import { encodeLineNavigationTask, solveLineNavigationTask } from './line-navigation-task.js';
import { pythonWorker } from './worker-client.js';

export const HRM_INSPIRED_BACKEND_ID = 'hrm-inspired-hierarchical-recurrence-v1';
export const HRM_INSPIRED_SEED = 20260908;
const BUDGETS = [1, 2, 4, 8];
const fail = (code, message) => Object.assign(new Error(message), { code });
const finite = (v) => Array.isArray(v) && v.length === 8 && v.every(Number.isFinite);
const argmax = (v) => v.indexOf(Math.max(...v));

export function validateHrmInspiredRequest(request) {
  if (!request || typeof request !== 'object' || Array.isArray(request)) return { valid: false, errors: ['Request body must be a JSON object.'], code: 'VALIDATION_ERROR' };
  if (!BUDGETS.includes(request.reasoningBudget)) return { valid: false, errors: ['Reasoning budget must be one of 1, 2, 4, or 8.'], code: 'VALIDATION_ERROR' };
  try { encodeLineNavigationTask(request.task); } catch (error) { return { valid: false, errors: [error.message], code: 'UNSUPPORTED_TASK' }; }
  return { valid: true, errors: [] };
}

function valid(result, budget) {
  return finite(result?.initialLowState) && finite(result?.initialHighState) && Array.isArray(result?.observations) && result.observations.length === budget && result.observations.every((o, i) => finite(o?.lowState) && finite(o?.highState) && Array.isArray(o.logits) && o.logits.length === 5 && o.logits.every(Number.isFinite) && o.prediction === argmax(o.logits) && o.highUpdated === ((i + 1) % 2 === 0) && ['lowMetrics', 'highMetrics'].every(key => ['stateNorm','mean','standardDeviation','deltaFromPrevious'].every(metric => Number.isFinite(o[key]?.[metric]))) && (o.lowMetrics.cosineSimilarityToPrevious === null || Number.isFinite(o.lowMetrics.cosineSimilarityToPrevious)) && (o.highMetrics.cosineSimilarityToPrevious === null || Number.isFinite(o.highMetrics.cosineSimilarityToPrevious))) && result.finalPrediction === result.observations.at(-1).prediction && finite(result.finalHighState) && finite(result.finalLowState);
}

/**
 * Pure computation core: given a worker `send` function (already holding the
 * job's active slot) and a validated request, runs one hierarchical
 * experiment and returns the full contract-shaped result. See
 * recurrent-latent-backend.js's `buildRecurrentResult` for why this is
 * split out from the job-owning `executeHrmInspired`.
 */
export async function buildHrmInspiredResult(send, request) {
  const check = validateHrmInspiredRequest(request); if (!check.valid) throw fail(check.code, check.errors[0]);
  const started = performance.now(); const inputVector = encodeLineNavigationTask(request.task); const groundTruth = solveLineNavigationTask(request.task);
  const raw = await send('hrm-inspired', { inputVector, reasoningBudget: request.reasoningBudget, seed: HRM_INSPIRED_SEED });
  if (!valid(raw, request.reasoningBudget)) throw fail('INVALID_RUNNER_RESPONSE', 'The local hierarchical runner returned an invalid response.');
  const provenance = { kind: 'OUR_IMPLEMENTATION', evidenceLevel: 'LIVE', version: HRM_INSPIRED_BACKEND_ID, description: 'Local untrained HRM-inspired hierarchical recurrence; a simplified educational implementation, not a reproduction of HRM.', researchSource: { evidenceLevel: 'PUBLISHED', url: 'https://arxiv.org/abs/2506.21734', relation: 'Inspired by the paper’s two-level cadence only.' } };
  const backend = { id: HRM_INSPIRED_BACKEND_ID, displayName: 'HRM-inspired hierarchical recurrence (local, simplified)', provenance };
  const base = createExperimentContract({ experimentId: `hrm-inspired-${request.task.replaceAll(',', '')}-${request.reasoningBudget}-${HRM_INSPIRED_SEED}`, taskId: 'bounded-line-navigation-v1', backend, input: { task: request.task } });
  const observations = raw.observations.map((o, step) => ({ step, stateObservation: { kind: 'HIERARCHICAL_LOW_LEVEL_STATE', values: o.lowState, description: 'Actual local low-level numerical state.' }, prediction: o.prediction, logits: o.logits, confidence: null, metrics: { computationStep: step + 1, ...o.lowMetrics }, metadata: { evidenceLevel: 'LIVE', observationPolicy: 'LOCAL_HRM_INSPIRED_LOW_STATE' } }));
  const hierarchical = raw.observations.map((o, step) => ({ step, highState: o.highState, lowState: o.lowState, highMetrics: o.highMetrics, lowMetrics: o.lowMetrics, highUpdated: o.highUpdated, prediction: o.prediction, logits: o.logits, metadata: { evidenceLevel: 'LIVE' } }));
  return { ...base, configuration: { mode: 'hrm-inspired-hierarchical-recurrence', framework: 'PyTorch', device: 'cpu', dtype: 'float64', stateSize: 8, inputSize: 4, outputSize: 5, activation: 'tanh', training: 'none', seed: HRM_INSPIRED_SEED, lowStepsPerHighCycle: 2, outputHead: 'argmax(W_out H + b_out)', implementationRelation: 'SIMPLIFIED_HRM_INSPIRED' }, reasoningBudget: request.reasoningBudget, randomSeed: HRM_INSPIRED_SEED, initialState: { kind: 'HIERARCHICAL_LOW_INITIAL_STATE', values: raw.initialLowState, description: 'Actual initial low-level state.' }, hierarchicalInitialState: { highState: raw.initialHighState, lowState: raw.initialLowState }, hierarchicalStateObservationsByStep: hierarchical, groundTruth, predictionsByStep: observations.map(({ step, prediction }) => ({ step, prediction })), latentStateObservationsByStep: observations, finalPrediction: raw.finalPrediction, finalScore: raw.finalPrediction === groundTruth, latencyMs: performance.now() - started, metrics: { computationSteps: observations.length, stateNormTrajectory: observations.map(o => o.metrics.stateNorm), stateChangeTrajectory: observations.map(o => o.metrics.deltaFromPrevious) }, provenance, metadata: { evidenceLevel: 'LIVE', displayLabel: 'LIVE local HRM-inspired hierarchical recurrence', latencyScope: 'Backend elapsed time including worker queue wait and execution' }, status: 'COMPLETE' };
}

/** Execute the local HRM-inspired hierarchical substrate as its own queued job. */
export async function executeHrmInspired(request) {
  const check = validateHrmInspiredRequest(request); if (!check.valid) throw fail(check.code, check.errors[0]);
  const { result } = await pythonWorker.enqueue((send) => buildHrmInspiredResult(send, request));
  return result;
}
