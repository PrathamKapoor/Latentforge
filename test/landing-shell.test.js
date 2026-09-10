import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createServer } from '../src/server/server.js';

const landing = await readFile(new URL('../public/index.html', import.meta.url), 'utf8');
const lab = await readFile(new URL('../public/lab.html', import.meta.url), 'utf8');

async function withServer(run) {
  // Static pages need no Python worker, so none is started here.
  const server = createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  try {
    await run(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

test('landing page links into the lab and loads only landing scripts', () => {
  assert.match(landing, /href="\/lab(#[\w-]+)?"/u);
  assert.match(landing, /<script type="module" src="\/site\.js"><\/script>/u);
  assert.match(landing, /<script type="module" src="\/landing\.js"><\/script>/u);
  assert.doesNotMatch(landing, /src="\/app\.js"/u, 'the lab controller must not auto-run experiments on the landing page');
  assert.doesNotMatch(landing, /src="\/flagship\.js"/u);
});

test('lab page keeps the lab controllers and the shared chrome', () => {
  for (const script of ['site.js', 'flagship.js', 'app.js']) assert.match(lab, new RegExp(`src="/${script.replace('.', '\\.')}"`, 'u'));
  assert.doesNotMatch(lab, /grainient/iu);
});

test('pages use stylesheets rather than inline styles', () => {
  for (const html of [landing, lab]) {
    assert.doesNotMatch(html, /\sstyle="/u);
    assert.match(html, /href="\/css\/tokens\.css"/u);
    assert.match(html, /href="\/css\/site\.css"/u);
  }
});

test('landing copy is LatentForge\'s own', () => {
  assert.doesNotMatch(landing, /future\s*agi/iu);
  assert.match(landing, /LatentForge/u);
});

test('GET / serves the landing page and GET /lab serves the laboratory', async () => {
  await withServer(async (baseUrl) => {
    for (const [path, marker] of [['/', 'page-landing'], ['/lab', 'page-lab'], ['/lab/', 'page-lab'], ['/?ref=x', 'page-landing']]) {
      const response = await fetch(`${baseUrl}${path}`);
      assert.equal(response.status, 200, path);
      assert.match(response.headers.get('content-type'), /text\/html/u, path);
      assert.match(await response.text(), new RegExp(marker, 'u'), path);
    }
    for (const asset of ['/css/tokens.css', '/css/site.css', '/css/landing.css', '/css/lab.css', '/site.js', '/landing.js', '/charts.js']) {
      const response = await fetch(`${baseUrl}${asset}`);
      assert.equal(response.status, 200, asset);
      await response.arrayBuffer();
    }
    const traversal = await fetch(`${baseUrl}/lab/../../package.json`);
    assert.notEqual(traversal.status, 200);
    await traversal.arrayBuffer();
  });
});
