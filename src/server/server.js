import { createServer as createHttpServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getBackend, validateBackendId } from '../reasoning/backend-registry.js';
import { pythonWorker } from '../reasoning/worker-client.js';
import { buildRecurrentResult } from '../reasoning/recurrent-latent-backend.js';
import { buildHrmInspiredResult } from '../reasoning/hrm-inspired-backend.js';
import { buildBdhCqInspiredResult } from '../reasoning/bdh-cq-inspired-backend.js';
import { runReasoningBudgetSweep } from '../experiments/reasoning-budget-sweep.js';
import { runSeedCharacterization, ALL_CHARACTERIZATION_SEEDS } from '../experiments/seed-characterization.js';
import { encodeLineNavigationTask } from '../reasoning/line-navigation-task.js';
import { MAX_BODY_BYTES } from './config.js';

const publicRoot = fileURLToPath(new URL('../../public/', import.meta.url));
const MIME_TYPES = { '.css': 'text/css; charset=utf-8', '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8' };

// Backends whose computation runs on the persistent Python worker. `synthetic`
// is deliberately excluded here: it has no Python dependency and stays
// available even when the worker is not ready (see the route handler below).
const LIVE_SWEEP_BUDGETS = Object.freeze([1, 2, 4, 8]);
const LIVE_RESULT_BUILDERS = Object.freeze({
  recurrent: buildRecurrentResult,
  'hrm-inspired': buildHrmInspiredResult,
  'bdh-cq-inspired': buildBdhCqInspiredResult,
});

export function createServer() {
  return createHttpServer(async (request, response) => {
    try {
      if (request.method === 'GET' && request.url === '/health') {
        return sendJson(response, 200, { status: 'ok' });
      }
      if (request.method === 'GET' && request.url === '/ready') {
        const status = pythonWorker.getStatus();
        const ready = pythonWorker.isReady();
        return sendJson(response, ready ? 200 : 503, { status: ready ? 'ready' : 'not_ready', worker: status.status.toLowerCase() });
      }
      if (request.method === 'POST' && request.url === '/api/experiment') {
        const body = await readJsonBody(request);
        return await handleExperimentRequest(body, response);
      }
      if (request.method === 'POST' && request.url === '/api/characterization') {
        const body = await readJsonBody(request);
        return await handleCharacterizationRequest(body, response);
      }
      if (request.method === 'POST' && request.url.startsWith('/api/')) {
        return sendJson(response, 404, { error: { code: 'NOT_FOUND', message: 'API endpoint not found.' } });
      }
      if (request.method !== 'GET' && request.method !== 'HEAD') return sendJson(response, 405, { error: { code: 'METHOD_NOT_ALLOWED', message: 'Method not allowed.' } });
      return await serveStatic(request.url, response, request.method === 'HEAD');
    } catch (error) {
      const status = error.code === 'VALIDATION_ERROR' ? 400
        : error.code === 'UNSUPPORTED_TASK' ? 400
        : error.code === 'SERVICE_UNAVAILABLE' || error.code === 'RUNTIME_UNAVAILABLE' ? 503
        : error.code === 'OVERLOADED' ? 503
        : 500;
      const message = status === 500 ? 'The demonstration could not be completed. Please try again.' : error.message;
      return sendJson(response, status, { error: { code: error.code || 'EXECUTION_ERROR', message } });
    }
  });
}

/**
 * One user experiment produces one `/api/experiment` request, which enqueues
 * exactly one job on the shared Python worker. When a budget sweep is
 * requested (the default — matches the UI's existing always-on comparison
 * table), the SAME job computes the primary result and the remaining three
 * budgets as sequential sends, holding the worker's single active slot for
 * its whole duration rather than each budget competing independently for
 * the queue. The already-computed primary result is reused for its own row
 * in the sweep — it is never recomputed.
 */
async function handleExperimentRequest(body, response) {
  const backendId = typeof body?.backend === 'string' ? body.backend : 'recurrent';
  const backendValidation = validateBackendId(backendId);
  if (!backendValidation.valid) return sendJson(response, 400, { error: { code: 'VALIDATION_ERROR', message: backendValidation.errors[0] } });

  const backend = getBackend(backendId);
  const requestValidation = backend.validateRequest(body);
  if (!requestValidation.valid) return sendJson(response, 400, { error: { code: requestValidation.code ?? 'VALIDATION_ERROR', message: requestValidation.errors[0] } });

  const includeBudgetSweep = body.includeBudgetSweep !== false;

  if (backendId === 'synthetic') {
    const primary = await backend.execute(body);
    const budgetSweep = includeBudgetSweep ? await runSyntheticBudgetSweep(body, primary, backend) : null;
    return sendJson(response, 200, budgetSweep ? { ...primary, budgetSweep } : primary);
  }

  const buildResult = LIVE_RESULT_BUILDERS[backendId];
  const result = await pythonWorker.enqueue(async (send) => {
    const primary = await buildResult(send, body);
    if (!includeBudgetSweep) return primary;

    const remainingBudgets = LIVE_SWEEP_BUDGETS.filter((value) => value !== body.reasoningBudget);
    const remainingSweep = await runReasoningBudgetSweep({
      task: body.task,
      backend: backendId,
      budgets: remainingBudgets,
      execute: (sweepRequest) => buildResult(send, { ...body, reasoningBudget: sweepRequest.reasoningBudget }),
    });
    const primaryRow = { ...primary, status: 'COMPLETE', evidenceLevel: 'LIVE' };
    const runs = [...remainingSweep.runs, primaryRow].sort((left, right) => left.reasoningBudget - right.reasoningBudget);
    return {
      ...primary,
      budgetSweep: {
        id: `sweep-${backendId}-${body.task.replaceAll(',', '')}-20260907`,
        task: body.task,
        backend: backendId,
        budgets: [...LIVE_SWEEP_BUDGETS],
        evidenceLevel: 'LIVE',
        runs,
      },
    };
  });
  // `telemetry.queueWaitMs` lets the UI honestly report "this waited behind
  // another experiment" rather than silently absorbing queue time into a
  // fake-looking instant response.
  return sendJson(response, 200, { ...result.result, queueTelemetry: result.telemetry });
}

/**
 * LOCAL CHARACTERIZATION — NOT A BENCHMARK. One HTTP request, one queued
 * job: all `seeds x budgets` runs for the recurrent backend share a single
 * job (via `buildRecurrentResult` and the job's own `send`), exactly like
 * the primary+sweep combination in `handleExperimentRequest` — not one
 * queue entry per run. Scoped to the `recurrent` backend only for this
 * phase (see docs/phase-7-deployability-hardening.md for why).
 */
async function handleCharacterizationRequest(body, response) {
  const task = typeof body?.task === 'string' ? body.task : '1,0,1,1';
  try {
    encodeLineNavigationTask(task);
  } catch (error) {
    return sendJson(response, 400, { error: { code: 'UNSUPPORTED_TASK', message: error.message } });
  }

  const { result: characterization } = await pythonWorker.enqueue((send) => runSeedCharacterization({
    task,
    seeds: ALL_CHARACTERIZATION_SEEDS,
    execute: (request) => buildRecurrentResult(send, request),
  }));
  return sendJson(response, 200, characterization);
}

async function runSyntheticBudgetSweep(body, primaryResult, backend) {
  const remainingBudgets = LIVE_SWEEP_BUDGETS.filter((value) => value !== body.reasoningBudget);
  const remainingSweep = await runReasoningBudgetSweep({
    task: body.task,
    backend: 'synthetic',
    budgets: remainingBudgets,
    execute: (sweepRequest) => backend.execute({ ...body, reasoningBudget: sweepRequest.reasoningBudget }),
  });
  const primaryRow = { ...primaryResult, status: 'COMPLETE', evidenceLevel: 'SYNTHETIC' };
  const runs = [...remainingSweep.runs, primaryRow].sort((left, right) => left.reasoningBudget - right.reasoningBudget);
  return { id: `sweep-synthetic-${body.task.replaceAll(/[^a-z0-9]/gi, '')}-20260907`, task: body.task, backend: 'synthetic', budgets: [...LIVE_SWEEP_BUDGETS], evidenceLevel: 'SYNTHETIC', runs };
}

async function readJsonBody(request) {
  let raw = '';
  for await (const chunk of request) {
    raw += chunk;
    if (raw.length > MAX_BODY_BYTES) {
      const error = new Error('Request body is too large.');
      error.code = 'VALIDATION_ERROR';
      throw error;
    }
  }
  try { return JSON.parse(raw); } catch {
    const error = new Error('Request body must contain valid JSON.');
    error.code = 'VALIDATION_ERROR';
    throw error;
  }
}

async function serveStatic(url, response, headOnly) {
  const requestedPath = url === '/' ? 'index.html' : decodeURIComponent(url.split('?')[0]).replace(/^\/+/, '');
  const safePath = normalize(requestedPath).replace(/^(\.\.[\\/])+/u, '');
  if (safePath.includes('..')) return sendJson(response, 400, { error: { code: 'INVALID_PATH', message: 'Invalid path.' } });
  const extension = extname(safePath);
  if (!MIME_TYPES[extension]) return sendJson(response, 404, { error: { code: 'NOT_FOUND', message: 'Resource not found.' } });
  try {
    const content = await readFile(join(publicRoot, safePath));
    response.writeHead(200, { 'content-type': MIME_TYPES[extension], 'x-content-type-options': 'nosniff' });
    return response.end(headOnly ? undefined : content);
  } catch { return sendJson(response, 404, { error: { code: 'NOT_FOUND', message: 'Resource not found.' } }); }
}

function sendJson(response, status, body) {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'x-content-type-options': 'nosniff' });
  response.end(JSON.stringify(body));
}
