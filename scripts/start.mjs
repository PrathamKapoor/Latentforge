import { runWithPython } from './python-runtime.mjs';

const { code, signal } = await runWithPython(process.execPath, ['src/server/index.js']);
if (code !== 0) process.exitCode = code ?? 1;
if (signal) process.exitCode = 1;
