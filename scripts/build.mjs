import { execFile as execFileCallback } from 'node:child_process';
import { promisify } from 'node:util';
import { resolvePython } from './python-runtime.mjs';

const execFile = promisify(execFileCallback);
const files = [
  'src/contracts/reasoning-backend.js', 'src/reasoning/synthetic-demo-backend.js', 'src/reasoning/recurrent-latent-backend.js',
  'src/reasoning/hrm-inspired-backend.js', 'src/reasoning/bdh-cq-inspired-backend.js', 'src/reasoning/trained-recurrent-backend.js',
  'src/reasoning/variable-length-navigation-task.js', 'src/reasoning/worker-client.js',
  'src/experiments/reasoning-budget-sweep.js', 'src/experiments/hierarchical-comparison.js', 'src/experiments/bdh-cq-demonstration-sweep.js',
  'src/experiments/seed-characterization.js', 'src/ui/guided-experience.js', 'public/guided-experience.js', 'src/server/config.js',
  'src/server/server.js', 'src/server/index.js', 'public/app.js', 'public/flagship.js', 'public/charts.js', 'public/site.js', 'public/landing.js',
  'scripts/python-runtime.mjs', 'scripts/test.mjs', 'scripts/start.mjs',
];

// `node --check` only checks its first file (later arguments become script
// argv), so each file gets its own check.
for (const file of files) await execFile(process.execPath, ['--check', file], { stdio: 'inherit', windowsHide: true });
const python = await resolvePython();
await execFile(python, ['-m', 'py_compile', 'src/reasoning/recurrent-runner.py', 'src/reasoning/hrm-inspired-runner.py', 'src/reasoning/bdh-cq-inspired-runner.py', 'src/reasoning/trained-recurrent-runner.py', 'src/reasoning/worker-server.py'], { stdio: 'inherit', windowsHide: true });
