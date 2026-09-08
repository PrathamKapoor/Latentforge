/**
 * PythonWorkerClient — Node-side half of the persistent-worker protocol
 * implemented by `worker-server.py`.
 *
 * This replaces the previous "spawn a fresh python process per HTTP
 * request" pattern used by every backend adapter. It is an execution
 * optimization only: the Python side still owns all model computation
 * (see worker-server.py's docstring for the equivalence guarantees).
 *
 * Concurrency model: a single persistent worker processes exactly one
 * "job" at a time (LATENTFORGE_MAX_ACTIVE is fixed at 1 — see
 * src/server/config.js for why). `enqueue(jobFn)` queues one job (bounded
 * by LATENTFORGE_MAX_QUEUE) and, once it becomes active, calls
 * `jobFn(send)` with a `send(backend, payload)` function that talks
 * directly to the worker transport WITHOUT re-entering the outer queue.
 * This means a job that needs several sequential Python round-trips (e.g.
 * a primary experiment plus a budget sweep) holds the single active slot
 * for its entire duration — one queue entry, one scheduling decision, one
 * lifecycle — rather than each round-trip competing independently for the
 * queue.
 */

import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import {
  MAX_QUEUE,
  WORKER_START_TIMEOUT_MS,
  WORKER_EXECUTION_TIMEOUT_MS,
  MAX_WORKER_RESTART_ATTEMPTS,
} from '../server/config.js';

const workerServerPath = fileURLToPath(new URL('./worker-server.py', import.meta.url));

const fail = (code, message) => Object.assign(new Error(message), { code });

let requestCounter = 0;
const nextRequestId = () => `req-${Date.now()}-${(requestCounter += 1)}`;

export class PythonWorkerClient {
  constructor({ pythonBin = process.env.PYTHON ?? 'python' } = {}) {
    this.pythonBin = pythonBin;
    this.child = null;
    this.readyPromise = null;
    this.status = 'STOPPED'; // STOPPED | STARTING | READY | RESTARTING | UNAVAILABLE
    this.environment = null;
    this.pending = new Map(); // requestId -> { resolve, reject }
    this.queue = []; // queued jobs waiting for the single active slot
    this.activeJob = null;
    this.restartAttempts = 0;
    this.stopping = false;
  }

  getStatus() {
    return { status: this.status, environment: this.environment, queueDepth: this.queue.length, activeJob: this.activeJob !== null };
  }

  isReady() {
    return this.status === 'READY';
  }

  async start() {
    if (this.status === 'READY' || this.status === 'STARTING') return this.readyPromise;
    this.status = 'STARTING';
    this.stopping = false;
    this.readyPromise = this._spawnAndAwaitReady();
    try {
      await this.readyPromise;
      this.status = 'READY';
      this.restartAttempts = 0;
    } catch (error) {
      this.status = 'UNAVAILABLE';
      throw error;
    }
    return undefined;
  }

  _spawnAndAwaitReady() {
    return new Promise((resolve, reject) => {
      let child;
      try {
        child = spawn(this.pythonBin, [workerServerPath], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
      } catch {
        reject(fail('RUNTIME_UNAVAILABLE', 'The local Python worker runtime is unavailable.'));
        return;
      }

      let settled = false;
      const startTimeout = setTimeout(() => {
        if (settled) return;
        settled = true;
        child.kill();
        reject(fail('RUNTIME_UNAVAILABLE', 'The local Python worker did not become ready in time.'));
      }, WORKER_START_TIMEOUT_MS);

      child.on('error', () => {
        if (settled) return;
        settled = true;
        clearTimeout(startTimeout);
        reject(fail('RUNTIME_UNAVAILABLE', 'The local Python worker runtime is unavailable.'));
      });

      child.on('exit', () => {
        if (!settled) {
          settled = true;
          clearTimeout(startTimeout);
          reject(fail('RUNTIME_UNAVAILABLE', 'The local Python worker exited before becoming ready.'));
        }
        this._handleUnexpectedExit();
      });

      const rl = createInterface({ input: child.stdout });
      rl.once('line', (line) => {
        let message;
        try { message = JSON.parse(line); } catch {
          if (settled) return;
          settled = true;
          clearTimeout(startTimeout);
          child.kill();
          reject(fail('RUNTIME_UNAVAILABLE', 'The local Python worker sent an invalid readiness response.'));
          return;
        }
        if (!message.ready) {
          if (settled) return;
          settled = true;
          clearTimeout(startTimeout);
          child.kill();
          reject(fail('RUNTIME_UNAVAILABLE', 'The local Python worker failed to initialize.'));
          return;
        }
        this.environment = message.environment ?? null;
        this.child = child;
        this._attachResponseHandler(rl);
        if (settled) return;
        settled = true;
        clearTimeout(startTimeout);
        resolve(undefined);
      });

      child.stdin.on('error', () => {});
    });
  }

  _attachResponseHandler(rl) {
    rl.on('line', (line) => {
      let message;
      try { message = JSON.parse(line); } catch { return; }
      const pending = this.pending.get(message.requestId);
      if (!pending) return;
      this.pending.delete(message.requestId);
      clearTimeout(pending.timeoutHandle);
      if (message.ok) pending.resolve(message.result);
      else pending.reject(fail(message.error?.code ?? 'EXECUTION_ERROR', message.error?.message ?? 'The local worker could not complete execution.'));
    });
  }

  _handleUnexpectedExit() {
    if (this.stopping) { this.status = 'STOPPED'; return; }
    const error = fail('WORKER_CRASHED', 'The local Python worker exited unexpectedly.');
    for (const pending of this.pending.values()) { clearTimeout(pending.timeoutHandle); pending.reject(error); }
    this.pending.clear();
    const queued = this.queue.splice(0, this.queue.length);
    for (const job of queued) job.reject(fail('WORKER_RESTARTING', 'The local worker restarted before this job could run.'));
    if (this.activeJob) { this.activeJob.reject(error); this.activeJob = null; }

    this.status = 'RESTARTING';
    this.restartAttempts += 1;
    if (this.restartAttempts > MAX_WORKER_RESTART_ATTEMPTS) {
      this.status = 'UNAVAILABLE';
      return;
    }
    this.start().then(() => this._pump()).catch(() => { this.status = 'UNAVAILABLE'; });
  }

  /**
   * Queue one job. `jobFn(send)` runs once this job becomes active and
   * holds the worker's single active slot until it settles; `send(backend,
   * payload)` issues one request/response round-trip against the live
   * worker without competing for the outer queue again.
   */
  async enqueue(jobFn) {
    if (this.status === 'STOPPED') {
      await this.start(); // lazy auto-start: callers (tests, the HTTP route) need not coordinate startup themselves
    } else if (this.status === 'STARTING' || this.status === 'RESTARTING') {
      await this.readyPromise;
    }
    if (!this.isReady()) throw fail('SERVICE_UNAVAILABLE', 'The local recurrent worker is not ready.');
    if (this.queue.length >= MAX_QUEUE) throw fail('OVERLOADED', 'Too many experiments are already queued. Please try again shortly.');

    return new Promise((resolve, reject) => {
      const job = { jobFn, resolve, reject, queuedAt: Date.now() };
      this.queue.push(job);
      this._pump();
    });
  }

  _pump() {
    if (this.activeJob || this.queue.length === 0 || !this.isReady()) return;
    const job = this.queue.shift();
    this.activeJob = job;
    const startedAt = Date.now();

    const send = (backend, payload) => this._send(backend, payload);

    Promise.resolve()
      .then(() => job.jobFn(send))
      .then((result) => {
        job.resolve({ result, telemetry: { queuedAt: job.queuedAt, startedAt, completedAt: Date.now(), queueWaitMs: startedAt - job.queuedAt, durationMs: Date.now() - startedAt } });
      })
      .catch((error) => { job.reject(error); })
      .finally(() => { this.activeJob = null; this._pump(); });
  }

  _send(backend, payload) {
    if (!this.child || !this.isReady()) return Promise.reject(fail('SERVICE_UNAVAILABLE', 'The local recurrent worker is not ready.'));
    const requestId = nextRequestId();
    return new Promise((resolve, reject) => {
      const timeoutHandle = setTimeout(() => {
        this.pending.delete(requestId);
        this._restartHungWorker();
        reject(fail('WORKER_TIMEOUT', 'The local worker did not respond in time.'));
      }, WORKER_EXECUTION_TIMEOUT_MS);
      this.pending.set(requestId, { resolve, reject, timeoutHandle });
      try {
        this.child.stdin.write(`${JSON.stringify({ requestId, backend, payload })}\n`);
      } catch {
        clearTimeout(timeoutHandle);
        this.pending.delete(requestId);
        reject(fail('EXECUTION_ERROR', 'The local worker could not accept the request.'));
      }
    });
  }

  _restartHungWorker() {
    if (!this.child) return;
    const child = this.child;
    this.child = null;
    this.status = 'RESTARTING';
    child.kill();
  }

  async stop() {
    this.stopping = true;
    const queued = this.queue.splice(0, this.queue.length);
    for (const job of queued) job.reject(fail('SERVICE_SHUTTING_DOWN', 'The local worker is shutting down.'));
    for (const pending of this.pending.values()) { clearTimeout(pending.timeoutHandle); pending.reject(fail('SERVICE_SHUTTING_DOWN', 'The local worker is shutting down.')); }
    this.pending.clear();
    if (!this.child) { this.status = 'STOPPED'; return; }
    const child = this.child;
    this.child = null;
    await new Promise((resolve) => {
      const forceKill = setTimeout(() => { try { child.kill('SIGKILL'); } catch { /* already gone */ } resolve(); }, 2000);
      child.once('exit', () => { clearTimeout(forceKill); resolve(); });
      try { child.stdin.end(); } catch { /* already closed */ }
    });
    this.status = 'STOPPED';
  }
}

export const pythonWorker = new PythonWorkerClient();

// Safety net only — graceful shutdown is `stop()`, called explicitly by the
// real server's SIGINT/SIGTERM/close handlers and by test teardown. This
// exists so an orphaned worker child process is never left running if the
// parent Node process exits some other way (an uncaught error, the test
// runner finishing without an explicit stop() call, etc).
process.once('exit', () => {
  try { pythonWorker.child?.kill(); } catch { /* already gone */ }
});
