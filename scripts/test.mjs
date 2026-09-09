import { runWithPython } from './python-runtime.mjs';
import { readdir } from 'node:fs/promises';

const files = (await readdir('test')).filter((file) => file.endsWith('.test.js')).map((file) => `test/${file}`);
const { code, signal } = await runWithPython(process.execPath, ['--test', '--test-concurrency=4', ...files]);
if (code !== 0) process.exitCode = code ?? 1;
if (signal) process.exitCode = 1;
