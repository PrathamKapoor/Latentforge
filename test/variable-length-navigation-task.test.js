import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseVariableLengthNavigationTask,
  solveVariableLengthNavigationTask,
  encodeVariableLengthNavigationTask,
  GRID_SIZE,
  GRID_CENTER,
  MIN_TASK_LENGTH,
} from '../src/reasoning/variable-length-navigation-task.js';

test('parses variable-length comma-separated binary move sequences', () => {
  assert.deepEqual(encodeVariableLengthNavigationTask('1,0,1'), [1, 0, 1]);
  assert.deepEqual(encodeVariableLengthNavigationTask('0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0'), Array(24).fill(0));
});

test('rejects syntactically invalid tasks', () => {
  for (const task of ['', '2,0', '1,0,', ',1,0', '1;0;1', 'abc', null, 42]) {
    assert.throws(() => parseVariableLengthNavigationTask(task), (error) => { assert.equal(error.code, 'UNSUPPORTED_TASK'); return true; });
  }
});

test('rejects tasks shorter than MIN_TASK_LENGTH or longer than the configured maximum', () => {
  assert.throws(() => parseVariableLengthNavigationTask('1'), (error) => { assert.equal(error.code, 'UNSUPPORTED_TASK'); return true; });
  const tooLong = Array.from({ length: 25 }, () => '1').join(',');
  assert.throws(() => parseVariableLengthNavigationTask(tooLong), (error) => { assert.equal(error.code, 'UNSUPPORTED_TASK'); return true; });
  assert.equal(MIN_TASK_LENGTH, 2);
});

test('solves all-left and all-right boundary paths with clamping', () => {
  assert.equal(solveVariableLengthNavigationTask(Array(20).fill(0).join(',')), 0);
  assert.equal(solveVariableLengthNavigationTask(Array(20).fill(1).join(',')), GRID_SIZE - 1);
});

test('starting position is the grid center and cancelling moves return to it', () => {
  assert.equal(GRID_CENTER, Math.floor(GRID_SIZE / 2));
  assert.equal(solveVariableLengthNavigationTask('1,0'), GRID_CENTER);
  assert.equal(solveVariableLengthNavigationTask('1,1,0,0'), GRID_CENTER);
});

test('agrees with brute-force simulation across many random instances', () => {
  const rng = (() => { let seed = 42; return () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; }; })();
  for (let trial = 0; trial < 200; trial += 1) {
    const length = 2 + Math.floor(rng() * 23);
    const moves = Array.from({ length }, () => (rng() < 0.5 ? 0 : 1));
    let expected = GRID_CENTER;
    for (const move of moves) expected = Math.max(0, Math.min(GRID_SIZE - 1, expected + (move === 1 ? 1 : -1)));
    assert.equal(solveVariableLengthNavigationTask(moves.join(',')), expected);
  }
});
