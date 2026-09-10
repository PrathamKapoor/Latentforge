import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile as execFileCallback } from 'node:child_process';
import { promisify } from 'node:util';

const execFile = promisify(execFileCallback);

// src/server/config.js reads LATENTFORGE_MAX_REASONING_BUDGET from
// process.env at module-import time, so exercising a *different* value
// than this test file's own process env requires a fresh child process —
// not a mock. This proves the advertised env var actually constrains
// validation (previously it was defined in config.js but never imported
// or consulted by any backend's validateRequest).
const CHECK_SCRIPT = `
import { validateRecurrentRequest } from './src/reasoning/recurrent-latent-backend.js';
import { validateHrmInspiredRequest } from './src/reasoning/hrm-inspired-backend.js';
import { validateBdhCqRequest } from './src/reasoning/bdh-cq-inspired-backend.js';

const task = '1,0,1,1';
const results = {
  recurrentBudget8: validateRecurrentRequest({ task, reasoningBudget: 8 }).valid,
  recurrentBudget4: validateRecurrentRequest({ task, reasoningBudget: 4 }).valid,
  hrmBudget8: validateHrmInspiredRequest({ task, reasoningBudget: 8 }).valid,
  bdhBudget8: validateBdhCqRequest({ task, reasoningBudget: 8, demonstrationCount: 2 }).valid,
};
process.stdout.write(JSON.stringify(results));
`;

async function runWithEnv(env) {
  const { stdout } = await execFile(process.execPath, ['--input-type=module', '-e', CHECK_SCRIPT], {
    cwd: new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'),
    env: { ...process.env, ...env },
    windowsHide: true,
  });
  return JSON.parse(stdout);
}

test('LATENTFORGE_MAX_REASONING_BUDGET actually narrows every backend\'s accepted budgets, not just documents a ceiling', async () => {
  const uncapped = await runWithEnv({ LATENTFORGE_MAX_REASONING_BUDGET: '' });
  assert.equal(uncapped.recurrentBudget8, true, 'default ceiling (8) must not change existing behavior');
  assert.equal(uncapped.hrmBudget8, true);
  assert.equal(uncapped.bdhBudget8, true);

  const capped = await runWithEnv({ LATENTFORGE_MAX_REASONING_BUDGET: '4' });
  assert.equal(capped.recurrentBudget8, false, 'budget 8 must be rejected once the operator caps the ceiling at 4');
  assert.equal(capped.recurrentBudget4, true, 'budget 4 must remain accepted at the new ceiling');
  assert.equal(capped.hrmBudget8, false);
  assert.equal(capped.bdhBudget8, false);
});
