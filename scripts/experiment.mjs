import { spawn } from 'node:child_process';
import { resolvePython } from './python-runtime.mjs';

const python = await resolvePython();
const child = spawn(python, ['research/flagship/run_experiment.py'], { stdio: 'inherit', windowsHide: true });
const { code, signal } = await new Promise((resolve) => {
  child.on('exit', (exitCode, exitSignal) => resolve({ code: exitCode, signal: exitSignal }));
});
if (code !== 0) process.exitCode = code ?? 1;
if (signal) process.exitCode = 1;
