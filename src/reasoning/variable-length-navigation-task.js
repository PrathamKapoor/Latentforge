import { MAX_TASK_LENGTH } from '../server/config.js';

/**
 * Variable-length bounded 1D navigation task — the flagship experiment's
 * task family (generalizes line-navigation-task.js's fixed-length-4
 * version). Positions 0..GRID_SIZE-1, starting at the center; 0 = left,
 * 1 = right, clamped at both boundaries. Must stay in exact lockstep with
 * research/flagship/task.py's `solve()` — cross-checked by
 * test/variable-length-navigation-task.test.js.
 */
export const GRID_SIZE = 11;
export const GRID_CENTER = Math.floor(GRID_SIZE / 2);
export const MIN_TASK_LENGTH = 2;

/**
 * @param {unknown} task
 * @returns {{moves: number[]}}
 */
export function parseVariableLengthNavigationTask(task) {
  if (typeof task !== 'string' || !/^[01](,[01])*$/.test(task)) {
    const error = new Error(`Unsupported task. Expected comma-separated 0/1 moves, length ${MIN_TASK_LENGTH}-${MAX_TASK_LENGTH}.`);
    error.code = 'UNSUPPORTED_TASK';
    throw error;
  }
  const moves = task.split(',').map(Number);
  if (moves.length < MIN_TASK_LENGTH || moves.length > MAX_TASK_LENGTH) {
    const error = new Error(`Unsupported task. Expected comma-separated 0/1 moves, length ${MIN_TASK_LENGTH}-${MAX_TASK_LENGTH}.`);
    error.code = 'UNSUPPORTED_TASK';
    throw error;
  }
  return { moves };
}

/**
 * Solve independently on positions 0..GRID_SIZE-1, starting at GRID_CENTER.
 * @param {unknown} task
 * @returns {number}
 */
export function solveVariableLengthNavigationTask(task) {
  return parseVariableLengthNavigationTask(task).moves.reduce(
    (position, move) => Math.max(0, Math.min(GRID_SIZE - 1, position + (move === 1 ? 1 : -1))),
    GRID_CENTER,
  );
}

/**
 * @param {unknown} task
 * @returns {number[]}
 */
export function encodeVariableLengthNavigationTask(task) {
  return parseVariableLengthNavigationTask(task).moves;
}
