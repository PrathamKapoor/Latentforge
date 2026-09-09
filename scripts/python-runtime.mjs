import { execFile as execFileCallback, spawn } from 'node:child_process';
import path from 'node:path';
import { promisify } from 'node:util';

const execFile = promisify(execFileCallback);
// Range verified working, not merely asserted: 3.10 locally (this repo's own
// .venv) and 3.13 in CI (github.com/PrathamKapoor/Latent-forge/actions,
// runs #1-4) both installed torch==2.13.0 from requirements.txt and passed
// the full suite. 3.11/3.12 are included as the contiguous versions between
// two verified-good ones, not independently confirmed.
const probeCode = 'import sys; assert (3, 10) <= sys.version_info[:2] <= (3, 13); import torch; print(sys.executable)';

export async function resolvePython({ platform = process.platform, environment = process.env, cwd = process.cwd(), probe = defaultProbe } = {}) {
  // Use the path flavor matching the *simulated* platform (the `platform`
  // parameter), not the ambient `node:path` join tied to the real host OS —
  // otherwise this function is only actually testable on the OS it's
  // running on, since `path.join('C:/x', 'y')` produces backslashes on
  // Windows but forward slashes on Linux/macOS regardless of `platform`.
  const join = platform === 'win32' ? path.win32.join : path.posix.join;
  const venvPython = platform === 'win32' ? join(cwd, '.venv', 'Scripts', 'python.exe') : join(cwd, '.venv', 'bin', 'python');
  const candidates = environment.PYTHON
    ? [{ command: environment.PYTHON, prefix: [] }]
    : platform === 'win32'
      ? [{ command: venvPython, prefix: [] }, { command: 'python', prefix: [] }, { command: 'py', prefix: ['-3.13'] }, { command: 'py', prefix: ['-3.12'] }, { command: 'py', prefix: ['-3.11'] }, { command: 'py', prefix: ['-3.10'] }]
      : [{ command: venvPython, prefix: [] }, { command: 'python3.13', prefix: [] }, { command: 'python3.12', prefix: [] }, { command: 'python3.11', prefix: [] }, { command: 'python3.10', prefix: [] }, { command: 'python3', prefix: [] }, { command: 'python', prefix: [] }];

  for (const candidate of candidates) {
    try {
      const executable = (await probe(candidate.command, [...candidate.prefix, '-c', probeCode])).trim();
      if (executable) return executable;
    } catch { /* try the next supported interpreter */ }
  }
  throw new Error('LatentForge requires Python 3.10-3.13 with CPU PyTorch. Create .venv with requirements.txt or set PYTHON to that executable.');
}

async function defaultProbe(command, args) {
  const { stdout } = await execFile(command, args, { windowsHide: true });
  return stdout;
}

export async function runWithPython(command, args, options = {}) {
  const python = await resolvePython(options);
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: 'inherit',
      windowsHide: true,
      env: { ...process.env, PYTHON: python },
    });
    child.on('error', reject);
    child.on('exit', (code, signal) => resolve({ code, signal }));
  });
}
