import test from 'node:test';
import assert from 'node:assert/strict';
import { resolvePython } from '../scripts/python-runtime.mjs';

test('uses an explicit PYTHON executable without probing fallbacks', async () => {
  const calls = [];
  const python = await resolvePython({
    environment: { PYTHON: 'C:/Python/python.exe' },
    cwd: 'C:/no-venv',
    probe: async (command, args) => {
      calls.push([command, args]);
      return 'C:/Python/python.exe\n';
    },
  });

  assert.equal(python, 'C:/Python/python.exe');
  assert.deepEqual(calls, [['C:/Python/python.exe', ['-c', 'import sys; assert (3, 10) <= sys.version_info[:2] <= (3, 13); import torch; print(sys.executable)']]]);
});

test('falls back to the Windows launcher when python is not on PATH', async () => {
  const calls = [];
  const python = await resolvePython({
    platform: 'win32',
    environment: {},
    cwd: 'C:/no-venv',
    probe: async (command, args) => {
      calls.push([command, args]);
      if (command === 'py' && args[0] === '-3.10') return 'C:/Python310/python.exe\n';
      throw new Error('not found');
    },
  });

  const probeCode = 'import sys; assert (3, 10) <= sys.version_info[:2] <= (3, 13); import torch; print(sys.executable)';
  assert.equal(python, 'C:/Python310/python.exe');
  assert.deepEqual(calls, [
    ['C:\\no-venv\\.venv\\Scripts\\python.exe', ['-c', probeCode]],
    ['python', ['-c', probeCode]],
    ['py', ['-3.13', '-c', probeCode]],
    ['py', ['-3.12', '-c', probeCode]],
    ['py', ['-3.11', '-c', probeCode]],
    ['py', ['-3.10', '-c', probeCode]],
  ]);
});

test('reports a configuration-safe error when no supported interpreter is available', async () => {
  await assert.rejects(
    () => resolvePython({ environment: {}, cwd: 'C:/no-venv', probe: async () => { throw new Error('not found'); } }),
    /requires Python 3\.10-3\.13/u,
  );
});
