import test from 'node:test';
import assert from 'node:assert/strict';

import {
  encodeLineNavigationTask,
  parseLineNavigationTask,
  solveLineNavigationTask,
} from '../src/reasoning/line-navigation-task.js';

test('parses and encodes exactly four binary moves', () => {
  assert.deepEqual(parseLineNavigationTask('1,0,1,1'), { moves: [1, 0, 1, 1] });
  assert.deepEqual(encodeLineNavigationTask('1,0,1,1'), [1, 0, 1, 1]);
});

test('solves all-left and all-right boundary paths with clamping', () => {
  assert.equal(solveLineNavigationTask('0,0,0,0'), 0);
  assert.equal(solveLineNavigationTask('1,1,1,1'), 4);
});

test('clamps each move before reversing direction at a boundary', () => {
  assert.equal(solveLineNavigationTask('0,0,0,1'), 1);
  assert.equal(solveLineNavigationTask('1,1,1,0'), 3);
});

test('solves a mixed path from the independent starting position', () => {
  assert.equal(solveLineNavigationTask('0,1,0,1'), 2);
  assert.equal(solveLineNavigationTask('1,0,0,1'), 2);
  assert.equal(solveLineNavigationTask('1,0,1,1'), 4);
});

test('rejects unsupported line-navigation syntax with a stable error code', () => {
  for (const task of [
    '1,0,1',
    '1,0,1,1,0',
    '1,0,2,1',
    '1, 0, 1, 1',
    '',
    null,
    1011,
  ]) {
    assert.throws(
      () => parseLineNavigationTask(task),
      (error) => error?.code === 'UNSUPPORTED_TASK',
    );
  }
});
