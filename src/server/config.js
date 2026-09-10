/**
 * Centralized, env-var-overridable resource limits. Every default below
 * matches the value that was previously hardcoded somewhere in the
 * codebase before Phase 7 — this module only makes them named and
 * overridable, it does not change default behavior.
 */

const int = (name, fallback) => {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const value = Number.parseInt(raw, 10);
  return Number.isFinite(value) && value > 0 ? value : fallback;
};

/** Maximum number of jobs waiting behind the single active worker slot. */
export const MAX_QUEUE = int('LATENTFORGE_MAX_QUEUE', 8);

/**
 * Maximum simultaneously active experiment jobs. Fixed at 1: the worker is
 * a single CPU-bound PyTorch process, and the spec this phase implements
 * explicitly calls "one active experiment at a time" a safe, acceptable
 * default that should not be raised without measurement. Kept as a named
 * constant (not a magic `1` scattered through worker-client.js) so a future
 * phase can revisit it deliberately.
 */
export const MAX_ACTIVE = int('LATENTFORGE_MAX_ACTIVE', 1);

/** Total time budget for one HTTP request, including any queue wait. */
export const REQUEST_TIMEOUT_MS = int('LATENTFORGE_REQUEST_TIMEOUT_MS', 20000);

/** How long the worker has to emit its readiness line after being spawned. */
export const WORKER_START_TIMEOUT_MS = int('LATENTFORGE_WORKER_START_TIMEOUT_MS', 30000);

/** How long a single Python round-trip may take before it's treated as hung. */
export const WORKER_EXECUTION_TIMEOUT_MS = int('LATENTFORGE_WORKER_EXECUTION_TIMEOUT_MS', 20000);

/** Consecutive worker crash/restart attempts allowed before giving up. */
export const MAX_WORKER_RESTART_ATTEMPTS = int('LATENTFORGE_MAX_WORKER_RESTART_ATTEMPTS', 3);

/**
 * Ceiling on move-sequence length for the `trained-recurrent` (flagship,
 * variable-length) backend only — the `recurrent`/`hrm-inspired`/
 * `bdh-cq-inspired` toy backends are architecturally fixed at exactly 4
 * moves and don't consult this constant. Default matches the flagship
 * experiment's own TEST_UNSEEN length range (see research/flagship/task.py).
 */
export const MAX_TASK_LENGTH = int('LATENTFORGE_MAX_TASK_LENGTH', 24);

/**
 * Ceiling on reasoning budget. The three toy backends can only ever
 * narrow their own fixed {1, 2, 4, 8} set toward this value, never exceed
 * it (see recurrent-latent-backend.js et al.); the flagship
 * `trained-recurrent` backend uses this directly as its budget-sweep
 * ceiling (its own budget sweep goes up to 24 — see
 * research/flagship/evaluate.py's BUDGET_SWEEP).
 */
export const MAX_REASONING_BUDGET = int('LATENTFORGE_MAX_REASONING_BUDGET', 24);

/** Matches the server's existing request-body size cap. */
export const MAX_BODY_BYTES = int('LATENTFORGE_MAX_BODY_BYTES', 65536);

const bool = (name) => /^(1|true|yes|on)$/iu.test(process.env[name] ?? '');

/**
 * Per-client request budgets for the public API, as requests per minute.
 * 0 (the default) disables per-client limiting, which keeps local
 * development and the test suite unaffected; the global MAX_QUEUE cap
 * still bounds total load either way. The Docker image and render.yaml
 * turn these on for public hosting.
 */
export const RATE_LIMIT_PER_MINUTE = int('LATENTFORGE_RATE_LIMIT_PER_MINUTE', 0);
/** Characterization runs 20 executions per request, so it gets its own, smaller budget. */
export const CHARACTERIZATION_RATE_LIMIT_PER_MINUTE = int('LATENTFORGE_CHARACTERIZATION_RATE_LIMIT_PER_MINUTE', 0);

/**
 * Set when the server sits behind a reverse proxy (Render, Fly, Railway,
 * nginx). The client address for rate limiting is then read from the
 * proxy's X-Forwarded-For header instead of the socket, and HSTS is sent
 * for requests the proxy received over HTTPS.
 */
export const TRUST_PROXY = bool('LATENTFORGE_TRUST_PROXY');
