import { executeRecurrentLatent, validateRecurrentRequest, RECURRENT_BACKEND_ID } from './recurrent-latent-backend.js';
import { executeSyntheticDemo, validateExperimentRequest } from './synthetic-demo-backend.js';
import { executeHrmInspired, validateHrmInspiredRequest, HRM_INSPIRED_BACKEND_ID } from './hrm-inspired-backend.js';
import { executeBdhCqInspired, validateBdhCqRequest, BDH_CQ_INSPIRED_BACKEND_ID } from './bdh-cq-inspired-backend.js';
import { executeTrainedRecurrent, validateTrainedRecurrentRequest, TRAINED_RECURRENT_BACKEND_ID } from './trained-recurrent-backend.js';

const BACKENDS = new Map([
  ['trained-recurrent', Object.freeze({ id: TRAINED_RECURRENT_BACKEND_ID, execute: executeTrainedRecurrent, validateRequest: validateTrainedRecurrentRequest })],
  ['recurrent', Object.freeze({ id: RECURRENT_BACKEND_ID, execute: executeRecurrentLatent, validateRequest: validateRecurrentRequest })],
  ['synthetic', Object.freeze({ id: 'synthetic-arithmetic-demo-v1', execute: executeSyntheticDemo, validateRequest: validateExperimentRequest })],
  ['hrm-inspired', Object.freeze({ id: HRM_INSPIRED_BACKEND_ID, execute: executeHrmInspired, validateRequest: validateHrmInspiredRequest })],
  ['bdh-cq-inspired', Object.freeze({ id: BDH_CQ_INSPIRED_BACKEND_ID, execute: executeBdhCqInspired, validateRequest: validateBdhCqRequest })],
]);

export function validateBackendId(id) {
  return typeof id === 'string' && BACKENDS.has(id)
    ? { valid: true, errors: [] }
    : { valid: false, errors: ['Backend must be trained-recurrent, recurrent, synthetic, hrm-inspired, or bdh-cq-inspired.'] };
}

export function getBackend(id = 'recurrent') {
  const validation = validateBackendId(id);
  if (!validation.valid) throw Object.assign(new Error(validation.errors[0]), { code: 'VALIDATION_ERROR' });
  return BACKENDS.get(id);
}
