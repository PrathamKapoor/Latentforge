import { execFile as execFileCallback, spawn } from 'node:child_process';
import { join } from 'node:path';
import { promisify } from 'node:util';

const execFile = promisify(execFileCallback);
const probeCode = 'import sys; assert (3, 10) <= sys.version_info[:2] <= (3, 11); import torch; print(sys.executable)';

export async function resolvePython({ platform = process.platform, environment = process.env, cwd = process.cwd(), probe = defaultProbe } = {}) {
  const venvPython = platform === 'win32' ? join(cwd, '.venv', 'Scripts', 'python.exe') : join(cwd, '.venv', 'bin', 'python');
  const candidates = environment.PYTHON
    ? [{ command: environment.PYTHON, prefix: [] }]
    : platform === 'win32'
      ? [{ command: venvPython, prefix: [] }, { command: 'python', prefix: [] }, { command: 'py', prefix: ['-3.11'] }, { command: 'py', prefix: ['-3.10'] }]
      : [{ command: venvPython, prefix: [] }, { command: 'python3.11', prefix: [] }, { command: 'python3.10', prefix: [] }, { command: 'python3', prefix: [] }, { command: 'python', prefix: [] }];

  for (const candidate of candidates) {
    try {
      const executable = (await probe(candidate.command, [...candidate.prefix, '-c', probeCode])).trim();
      if (executable) return executable;
    } catch { /* try the next supported interpreter */ }
  }
  throw new Error('LatentForge requires Python 3.10 or 3.11 with CPU PyTorch. Create .venv with requirements.txt or set PYTHON to that executable.');
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
