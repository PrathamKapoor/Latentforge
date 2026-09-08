import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('documents the guided live preset, evidence boundaries, and limitation', async () => {
  const readme = await readFile(new URL('../README.md', import.meta.url), 'utf8');
  assert.match(readme, /Guided/i);
  assert.match(readme, /LIVE/i);
  assert.match(readme, /does not guarantee/i);
  assert.match(readme, /does not measure token savings/i);
});
