import { createServer as createHttpServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getBackend, validateBackendId } from '../reasoning/backend-registry.js';
import { pythonWorker } from '../reasoning/worker-client.js';
import { buildRecurrentResult } from '../reasoning/recurrent-latent-backend.js';
import { buildHrmInspiredResult } from '../reasoning/hrm-inspired-backend.js';
import { buildBdhCqInspiredResult } from '../reasoning/bdh-cq-inspired-backend.js';
import { buildTrainedRecurrentResult, THINKING_STEPS_TRAIN } from '../reasoning/trained-recurrent-backend.js';
import { runReasoningBudgetSweep } from '../experiments/reasoning-budget-sweep.js';
import { runSeedCharacterization, ALL_CHARACTERIZATION_SEEDS } from '../experiments/seed-characterization.js';
import { encodeLineNavigationTask } from '../reasoning/line-navigation-task.js';
import { MAX_BODY_BYTES, REQUEST_TIMEOUT_MS, RATE_LIMIT_PER_MINUTE, CHARACTERIZATION_RATE_LIMIT_PER_MINUTE, TRUST_PROXY } from './config.js';
import { createRateLimiter, clientAddress } from './rate-limiter.js';

const publicRoot = fileURLToPath(new URL('../../public/', import.meta.url));
const flagshipResultsPath = fileURLToPath(new URL('../../results/flagship-experiment.json', import.meta.url));
let cachedFlagshipResults; // the file never changes at runtime — read once, reuse
const MIME_TYPES = { '.css': 'text/css; charset=utf-8', '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml' };

// Backends whose computation runs on the persistent Python worker. `synthetic`
// is deliberately excluded here: it has no Python dependency and stays
// available even when the worker is not ready (see the route handler below).
const LIVE_SWEEP_BUDGETS = Object.freeze([1, 2, 4, 8]);
// The flagship model's own evaluated sweep (research/flagship/evaluate.py's
// BUDGET_SWEEP) includes its training budget so a live request at the
// canonical budget can be directly compared to the reported curve.
const TRAINED_RECURRENT_SWEEP_BUDGETS = Object.freeze([0, 1, 2, THINKING_STEPS_TRAIN, 8, 16, 24]);
const LIVE_SWEEP_BUDGETS_BY_BACKEND = Object.freeze({
  recurrent: LIVE_SWEEP_BUDGETS,
  'hrm-inspired': LIVE_SWEEP_BUDGETS,
  'bdh-cq-inspired': LIVE_SWEEP_BUDGETS,
  'trained-recurrent': TRAINED_RECURRENT_SWEEP_BUDGETS,
});
const LIVE_RESULT_BUILDERS = Object.freeze({
  recurrent: buildRecurrentResult,
  'hrm-inspired': buildHrmInspiredResult,
  'bdh-cq-inspired': buildBdhCqInspiredResult,
  'trained-recurrent': buildTrainedRecurrentResult,
});

// Applied to every response. The pages load only same-origin scripts and
// Google Fonts, and never use inline <script>/<style> or style attributes.
const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com",
  "img-src 'self' data:",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');

function applySecurityHeaders(request, response, trustProxy) {
  response.setHeader('content-security-policy', CONTENT_SECURITY_POLICY);
  response.setHeader('x-content-type-options', 'nosniff');
  response.setHeader('x-frame-options', 'DENY');
  response.setHeader('referrer-policy', 'strict-origin-when-cross-origin');
  response.setHeader('permissions-policy', 'camera=(), microphone=(), geolocation=(), interest-cohort=()');
  response.setHeader('cross-origin-opener-policy', 'same-origin');
  if (trustProxy && request.headers['x-forwarded-proto'] === 'https') {
    response.setHeader('strict-transport-security', 'max-age=15552000');
  }
}

export function createServer({
  requestTimeoutMs = REQUEST_TIMEOUT_MS,
  rateLimitPerMinute = RATE_LIMIT_PER_MINUTE,
  characterizationRateLimitPerMinute = CHARACTERIZATION_RATE_LIMIT_PER_MINUTE,
  trustProxy = TRUST_PROXY,
} = {}) {
  const limiters = {
    '/api/experiment': createRateLimiter({ perMinute: rateLimitPerMinute }),
    '/api/characterization': createRateLimiter({ perMinute: characterizationRateLimitPerMinute }),
  };
  const context = { limiters, trustProxy };
  return createHttpServer(async (request, response) => {
    applySecurityHeaders(request, response, trustProxy);
    let timeout;
    // Threaded down into pythonWorker.enqueue() so a request timeout doesn't
    // just abandon the promise while the job keeps occupying the worker's
    // single active slot — see worker-client.js's `enqueue`/`onAbort`.
    const controller = new AbortController();
    try {
      await Promise.race([
        handleRequest(request, response, controller.signal, context),
        new Promise((_, reject) => {
          timeout = setTimeout(() => {
            controller.abort();
            reject(Object.assign(new Error('The experiment timed out. Please try again.'), { code: 'REQUEST_TIMEOUT' }));
          }, requestTimeoutMs);
        }),
      ]);
    } catch (error) {
      const status = error.code === 'VALIDATION_ERROR' ? 400
        : error.code === 'UNSUPPORTED_TASK' ? 400
        : error.code === 'SERVICE_UNAVAILABLE' || error.code === 'RUNTIME_UNAVAILABLE' ? 503
        : error.code === 'OVERLOADED' ? 503
        : error.code === 'REQUEST_TIMEOUT' ? 504
        : 500;
      const message = status === 500 ? 'The demonstration could not be completed. Please try again.' : error.message;
      return sendJson(response, status, { error: { code: error.code || 'EXECUTION_ERROR', message } });
    } finally {
      clearTimeout(timeout);
    }
  });
}

async function handleRequest(request, response, signal, { limiters, trustProxy }) {
      // Spend the client's budget before reading the body or touching the
      // worker, so a flood of requests costs almost nothing to turn away.
      const limiter = request.method === 'POST' ? limiters[request.url] : undefined;
      if (limiter?.enabled) {
        const verdict = limiter.take(clientAddress(request, trustProxy));
        if (!verdict.allowed) {
          response.setHeader('retry-after', String(verdict.retryAfterSeconds));
          return sendJson(response, 429, { error: { code: 'RATE_LIMITED', message: `Too many experiments from your connection. Please wait ${verdict.retryAfterSeconds} seconds and try again.` } });
        }
      }
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
        return await handleExperimentRequest(body, response, signal);
      }
      if (request.method === 'POST' && request.url === '/api/characterization') {
        const body = await readJsonBody(request);
        return await handleCharacterizationRequest(body, response, signal);
      }
      if (request.method === 'GET' && request.url === '/api/flagship-results') {
        return await handleFlagshipResultsRequest(response);
      }
      if (request.method === 'POST' && request.url.startsWith('/api/')) {
        return sendJson(response, 404, { error: { code: 'NOT_FOUND', message: 'API endpoint not found.' } });
      }
      if (request.method !== 'GET' && request.method !== 'HEAD') return sendJson(response, 405, { error: { code: 'METHOD_NOT_ALLOWED', message: 'Method not allowed.' } });
      return await serveStatic(request, response);
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
async function handleExperimentRequest(body, response, signal) {
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
  const sweepBudgets = LIVE_SWEEP_BUDGETS_BY_BACKEND[backendId];
  const result = await pythonWorker.enqueue(async (send) => {
    const primary = await buildResult(send, body);
    if (!includeBudgetSweep) return primary;

    const remainingBudgets = sweepBudgets.filter((value) => value !== body.reasoningBudget);
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
        budgets: [...sweepBudgets],
        evidenceLevel: 'LIVE',
        runs,
      },
    };
  }, { signal });
  // `telemetry.queueWaitMs` lets the UI honestly report "this waited behind
  // another experiment" rather than silently absorbing queue time into a
  // fake-looking instant response.
  return sendJson(response, 200, { ...result.result, queueTelemetry: result.telemetry });
}

/**
 * Serves the flagship experiment's machine-readable results
 * (results/flagship-experiment.json, produced by
 * research/flagship/evaluate.py) so the UI's budget/length accuracy
 * charts read the exact same file a reviewer would reproduce with `python
 * research/flagship/run_experiment.py` — never a hand-typed duplicate of
 * these numbers. No Python worker involved; this is a static read, so it
 * works even if the worker never became ready.
 */
async function handleFlagshipResultsRequest(response) {
  if (!cachedFlagshipResults) {
    try {
      cachedFlagshipResults = await readFile(flagshipResultsPath, 'utf8');
    } catch {
      return sendJson(response, 503, { error: { code: 'RESULTS_UNAVAILABLE', message: 'Flagship results have not been generated. Run: python research/flagship/run_experiment.py' } });
    }
  }
  if (response.writableEnded || response.destroyed) return;
  response.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'x-content-type-options': 'nosniff' });
  return response.end(cachedFlagshipResults);
}

/**
 * LOCAL CHARACTERIZATION — NOT A BENCHMARK. One HTTP request, one queued
 * job: all `seeds x budgets` runs for the recurrent backend share a single
 * job (via `buildRecurrentResult` and the job's own `send`), exactly like
 * the primary+sweep combination in `handleExperimentRequest` — not one
 * queue entry per run. Scoped to the `recurrent` backend only for this
 * phase (see docs/phase-7-deployability-hardening.md for why).
 */
async function handleCharacterizationRequest(body, response, signal) {
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
  }), { signal });
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
  const chunks = [];
  let bytes = 0;
  for await (const chunk of request) {
    // `chunk.length` is the actual byte count of this Buffer; accumulating
    // decoded-string length instead would undercount every multibyte UTF-8
    // character (each counts as 1-2 UTF-16 code units but 2-4 bytes on the
    // wire), letting a multibyte payload sail past MAX_BODY_BYTES in real
    // bytes while `string.length` still reports it as under the cap.
    bytes += chunk.length;
    if (bytes > MAX_BODY_BYTES) {
      const error = new Error('Request body is too large.');
      error.code = 'VALIDATION_ERROR';
      throw error;
    }
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch {
    const error = new Error('Request body must contain valid JSON.');
    error.code = 'VALIDATION_ERROR';
    throw error;
  }
}

// Extensionless page routes. Everything else must name a file with an
// allowed MIME type (see serveStatic).
const PAGE_ROUTES = Object.freeze({ '/': 'index.html', '/lab': 'lab.html', '/lab/': 'lab.html' });

const COMPRESSIBLE = new Set(['.css', '.html', '.js', '.svg']);
const GZIP_MIN_BYTES = 1024;
// Compressed bodies keyed by path + ETag, so each file version is gzipped once.
const gzipCache = new Map();
const GZIP_CACHE_MAX = 64;

async function serveStatic(request, response) {
  const headOnly = request.method === 'HEAD';
  const pathname = request.url.split('?')[0];
  let requestedPath;
  try {
    requestedPath = PAGE_ROUTES[pathname] ?? decodeURIComponent(pathname).replace(/^\/+/, '');
  } catch {
    return sendJson(response, 400, { error: { code: 'INVALID_PATH', message: 'Invalid path.' } });
  }
  const safePath = normalize(requestedPath).replace(/^(\.\.[\\/])+/u, '');
  if (safePath.includes('..')) return sendJson(response, 400, { error: { code: 'INVALID_PATH', message: 'Invalid path.' } });
  const extension = extname(safePath);
  if (!MIME_TYPES[extension]) return sendJson(response, 404, { error: { code: 'NOT_FOUND', message: 'Resource not found.' } });
  const filePath = join(publicRoot, safePath);
  try {
    const info = await stat(filePath);
    if (!info.isFile()) throw new Error('not a file');
    // Files have no content hash in their names, so browsers always
    // revalidate (no-cache) and a redeploy can never mix stale JS with new HTML;
    // the ETag keeps revalidation a cheap 304.
    const gzip = COMPRESSIBLE.has(extension) && info.size >= GZIP_MIN_BYTES && /\bgzip\b/u.test(request.headers['accept-encoding'] ?? '');
    const etag = `W/"${info.size.toString(16)}-${Math.floor(info.mtimeMs).toString(16)}${gzip ? '-gz' : ''}"`;
    const headers = { 'content-type': MIME_TYPES[extension], 'cache-control': 'no-cache', etag, vary: 'Accept-Encoding' };
    const candidates = (request.headers['if-none-match'] ?? '').split(',').map((tag) => tag.trim());
    if (candidates.includes(etag)) {
      response.writeHead(304, headers);
      return response.end();
    }
    let content = await readFile(filePath);
    if (gzip) {
      const key = `${safePath}:${etag}`;
      let compressed = gzipCache.get(key);
      if (!compressed) {
        if (gzipCache.size >= GZIP_CACHE_MAX) gzipCache.clear();
        compressed = gzipSync(content);
        gzipCache.set(key, compressed);
      }
      content = compressed;
      headers['content-encoding'] = 'gzip';
    }
    headers['content-length'] = String(content.length);
    response.writeHead(200, headers);
    return response.end(headOnly ? undefined : content);
  } catch { return sendJson(response, 404, { error: { code: 'NOT_FOUND', message: 'Resource not found.' } }); }
}

function sendJson(response, status, body) {
  if (response.writableEnded || response.destroyed) return;
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'x-content-type-options': 'nosniff' });
  response.end(JSON.stringify(body));
}
