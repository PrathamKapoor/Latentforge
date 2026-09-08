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

/** Matches the existing line-navigation task's canonical 4-move length. */
export const MAX_TASK_LENGTH = int('LATENTFORGE_MAX_TASK_LENGTH', 4);

/** Matches the existing ALLOWED_BUDGETS maximum (1, 2, 4, 8). */
export const MAX_REASONING_BUDGET = int('LATENTFORGE_MAX_REASONING_BUDGET', 8);

/** Matches the server's existing request-body size cap. */
export const MAX_BODY_BYTES = int('LATENTFORGE_MAX_BODY_BYTES', 65536);
