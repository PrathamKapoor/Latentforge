import test from 'node:test';
import assert from 'node:assert/strict';
import { request as httpRequest } from 'node:http';
import { readFile } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createServer } from '../src/server/server.js';
import { createRateLimiter, clientAddress } from '../src/server/rate-limiter.js';

// Static routes and the synthetic backend need no Python worker, so none is started.
async function withServer(options, run) {
  const server = createServer(options);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  try {
    await run(port);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

// Raw request: no automatic decompression, so gzip and 304 are observed as sent.
function raw(port, { method = 'GET', path = '/', headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const req = httpRequest({ host: '127.0.0.1', port, method, path, headers }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

const syntheticRun = (extraHeaders = {}) => ({
  method: 'POST',
  path: '/api/experiment',
  headers: { 'content-type': 'application/json', ...extraHeaders },
  body: JSON.stringify({ backend: 'synthetic', task: '17 + 28', reasoningBudget: 4, includeBudgetSweep: false }),
});

test('per-client rate limit returns 429 with Retry-After once the budget is spent', async () => {
  await withServer({ rateLimitPerMinute: 2 }, async (port) => {
    assert.equal((await raw(port, syntheticRun())).status, 200);
    assert.equal((await raw(port, syntheticRun())).status, 200);
    const limited = await raw(port, syntheticRun());
    assert.equal(limited.status, 429);
    assert.ok(Number(limited.headers['retry-after']) >= 1);
    assert.equal(JSON.parse(limited.body).error.code, 'RATE_LIMITED');
  });
});

test('rate limiting is off by default so local development is unaffected', async () => {
  await withServer({ rateLimitPerMinute: 0 }, async (port) => {
    for (let i = 0; i < 6; i += 1) assert.equal((await raw(port, syntheticRun())).status, 200);
  });
});

test('behind a trusted proxy, clients are keyed by X-Forwarded-For', async () => {
  await withServer({ rateLimitPerMinute: 1, trustProxy: true }, async (port) => {
    assert.equal((await raw(port, syntheticRun({ 'x-forwarded-for': '203.0.113.1' }))).status, 200);
    assert.equal((await raw(port, syntheticRun({ 'x-forwarded-for': '203.0.113.2, 10.0.0.1' }))).status, 200);
    assert.equal((await raw(port, syntheticRun({ 'x-forwarded-for': '203.0.113.1' }))).status, 429);
  });
});

test('security headers are sent on pages and API responses; HSTS only for proxied HTTPS', async () => {
  await withServer({ trustProxy: true }, async (port) => {
    for (const path of ['/', '/lab', '/health']) {
      const response = await raw(port, { path });
      assert.match(response.headers['content-security-policy'], /script-src 'self'/u, path);
      assert.match(response.headers['content-security-policy'], /frame-ancestors 'none'/u, path);
      assert.equal(response.headers['x-frame-options'], 'DENY', path);
      assert.equal(response.headers['x-content-type-options'], 'nosniff', path);
      assert.equal(response.headers['referrer-policy'], 'strict-origin-when-cross-origin', path);
      assert.equal(response.headers['strict-transport-security'], undefined, path);
    }
    const https = await raw(port, { path: '/', headers: { 'x-forwarded-proto': 'https' } });
    assert.match(https.headers['strict-transport-security'], /max-age=\d+/u);
  });
});

test('pages stay compatible with the Content-Security-Policy (no inline scripts or styles)', async () => {
  for (const page of ['index.html', 'lab.html']) {
    const html = await readFile(new URL(`../public/${page}`, import.meta.url), 'utf8');
    assert.doesNotMatch(html, /<script(?![^>]*\bsrc=)[^>]*>/u, `${page} has an inline <script>`);
    assert.doesNotMatch(html, /<style[\s>]/u, `${page} has an inline <style>`);
    assert.doesNotMatch(html, /\son[a-z]+="/u, `${page} has an inline event handler`);
  }
});

test('static files revalidate with ETag (304) and are gzipped when accepted', async () => {
  await withServer({}, async (port) => {
    const first = await raw(port, { path: '/css/site.css' });
    assert.equal(first.status, 200);
    assert.equal(first.headers['cache-control'], 'no-cache');
    assert.ok(first.headers.etag);
    const again = await raw(port, { path: '/css/site.css', headers: { 'if-none-match': first.headers.etag } });
    assert.equal(again.status, 304);
    assert.equal(again.body.length, 0);

    const zipped = await raw(port, { path: '/lab', headers: { 'accept-encoding': 'gzip, br' } });
    assert.equal(zipped.status, 200);
    assert.equal(zipped.headers['content-encoding'], 'gzip');
    assert.match(zipped.headers.vary, /Accept-Encoding/iu);
    const lab = await readFile(new URL('../public/lab.html', import.meta.url));
    assert.deepEqual(gunzipSync(zipped.body), lab);
    assert.notEqual(zipped.headers.etag, first.headers.etag);
  });
});

test('malformed percent-encoding is a clean 400, not a server error', async () => {
  await withServer({}, async (port) => {
    const response = await raw(port, { path: '/%E0%A4%A' });
    assert.equal(response.status, 400);
    assert.equal(JSON.parse(response.body).error.code, 'INVALID_PATH');
  });
});

test('token buckets refill over time and stay independent per client', () => {
  let clock = 0;
  const limiter = createRateLimiter({ perMinute: 2, now: () => clock });
  assert.equal(limiter.take('a').allowed, true);
  assert.equal(limiter.take('a').allowed, true);
  const denied = limiter.take('a');
  assert.equal(denied.allowed, false);
  assert.equal(denied.retryAfterSeconds, 30);
  assert.equal(limiter.take('b').allowed, true);
  clock += 30_000; // one token refills every 30 s at 2/minute
  assert.equal(limiter.take('a').allowed, true);
  assert.equal(limiter.take('a').allowed, false);
  assert.equal(createRateLimiter({ perMinute: 0 }).take('x').allowed, true);
});

test('clientAddress ignores X-Forwarded-For unless the proxy is trusted', () => {
  const request = { headers: { 'x-forwarded-for': '198.51.100.7, 10.0.0.2' }, socket: { remoteAddress: '10.0.0.2' } };
  assert.equal(clientAddress(request, false), '10.0.0.2');
  assert.equal(clientAddress(request, true), '198.51.100.7');
});

// config.js reads the environment once at import, so each case runs in a fresh process.
function trustProxyUnder(overrides) {
  const env = { ...process.env };
  for (const key of ['LATENTFORGE_TRUST_PROXY', 'RAILWAY_PROJECT_ID', 'RAILWAY_ENVIRONMENT_ID', 'RENDER']) delete env[key];
  const configUrl = new URL('../src/server/config.js', import.meta.url).href;
  return execFileSync(process.execPath, ['--input-type=module', '-e', `const m = await import(${JSON.stringify(configUrl)}); process.stdout.write(String(m.TRUST_PROXY));`], {
    cwd: fileURLToPath(new URL('..', import.meta.url)),
    env: { ...env, ...overrides },
    encoding: 'utf8',
  });
}

test('proxy trust is detected on Railway and Render, and an explicit setting always wins', () => {
  assert.equal(trustProxyUnder({}), 'false');
  assert.equal(trustProxyUnder({ RAILWAY_PROJECT_ID: 'p-123' }), 'true');
  assert.equal(trustProxyUnder({ RAILWAY_ENVIRONMENT_ID: 'e-123' }), 'true');
  assert.equal(trustProxyUnder({ RENDER: 'true' }), 'true');
  assert.equal(trustProxyUnder({ RAILWAY_PROJECT_ID: 'p-123', LATENTFORGE_TRUST_PROXY: 'false' }), 'false');
  assert.equal(trustProxyUnder({ LATENTFORGE_TRUST_PROXY: 'true' }), 'true');
});
