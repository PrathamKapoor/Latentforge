/**
 * Parse the strict line-navigation task syntax.
 * @param {unknown} task
 * @returns {{moves: number[]}}
 */
export function parseLineNavigationTask(task) {
  if (typeof task !== 'string' || !/^[01](,[01]){3}$/.test(task)) {
    const error = new Error('Unsupported line-navigation task. Expected exactly four comma-separated 0/1 moves.');
    error.code = 'UNSUPPORTED_TASK';
    throw error;
  }

  return { moves: task.split(',').map(Number) };
}

/**
 * Solve independently on positions 0 through 4, starting at position 2.
 * @param {unknown} task
 * @returns {number}
 */
export function solveLineNavigationTask(task) {
  return parseLineNavigationTask(task).moves.reduce(
    (position, move) => Math.max(0, Math.min(4, position + (move === 1 ? 1 : -1))),
    2,
  );
}

/**
 * Encode the task as its four binary moves.
 * @param {unknown} task
 * @returns {number[]}
 */
export function encodeLineNavigationTask(task) {
  return parseLineNavigationTask(task).moves;
}
