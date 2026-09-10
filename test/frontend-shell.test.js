import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { executeSyntheticDemo } from '../src/reasoning/synthetic-demo-backend.js';
import { createGuidedExperience } from '../src/ui/guided-experience.js';

// The interactive laboratory lives at /lab (public/lab.html); / is the landing page.
const html = await readFile(new URL('../public/lab.html', import.meta.url), 'utf8');
const script = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');

// Minimal DOM boundary: run the actual browser controller without external dependencies.
class Element {
  constructor(tag = 'div') { this.tagName = tag; this.children = []; this.attributes = {}; this.listeners = {}; this.style = { setProperty: (key, value) => { this.style[key] = value; } }; this.textContent = ''; this.hidden = false; this.value = ''; }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.children = children; }
  setAttribute(key, value) { this.attributes[key] = String(value); }
  addEventListener(name, handler) { this.listeners[name] = handler; }
  querySelectorAll() { return []; }
}

function browser(fetcher) {
  const nodes = new Map([...html.matchAll(/id="([^"]+)"/gu)].map(([, id]) => [id, new Element()]));
  nodes.get('task').value = '1,0,1,1';
  if (nodes.has('backend')) nodes.get('backend').value = 'recurrent';
  const requests = [];
  const context = vm.createContext({
    document: { querySelector: (selector) => nodes.get(selector.slice(1)), createElement: (tag) => new Element(tag) },
    FormData: class { get() { return '4'; } },
    fetch: async (url, options) => { const request = JSON.parse(options.body); requests.push({ url, ...request }); return fetcher(request); },
  });
  vm.runInContext(script.replace(/^import[^\n]+\n/u, ''), vm.createContext({ ...context, createGuidedExperience }));
  return { nodes, requests, submit: () => nodes.get('experiment-form').listeners.submit({ preventDefault() {} }) };
}

function liveResult(budget = 4) {
  const observations = Array.from({ length: budget }, (_, step) => ({
    step, stateObservation: { kind: 'RECURRENT_HIDDEN_STATE', values: [-0.5, 0.25], description: 'Numerical state.' },
    prediction: 2, confidence: null, logits: [0, 0, 1, 0, 0],
    metrics: { computationStep: step + 1, stateNorm: Math.sqrt(0.3125), deltaFromPrevious: step === 0 ? 0.75 : 0, mean: -0.125, standardDeviation: 0.375, cosineSimilarityToPrevious: null },
    metadata: { evidenceLevel: 'LIVE', observationPolicy: 'LOCAL_TOY_STATE_TELEMETRY' },
  }));
  const provenance = { kind: 'OUR_IMPLEMENTATION', evidenceLevel: 'LIVE', description: 'Local toy substrate; not trained.', version: 'recurrent-latent-toy-v1' };
  return {
    experimentId: 'test-run', taskId: 'bounded-line-navigation-v1', backend: { id: 'recurrent-latent-toy-v1', displayName: 'Local toy substrate', provenance },
    input: { task: '1,0,1,1' }, configuration: { mode: 'local-recurrent-neural-substrate', hiddenSize: 2, training: 'none' }, randomSeed: 20260907,
    reasoningBudget: budget, initialState: { kind: 'RECURRENT_INITIAL_STATE', values: [0.25, 0.25], description: 'Encoded h0.' },
    groundTruth: 4, predictionsByStep: observations.map(({ step, prediction }) => ({ step, prediction })), latentStateObservationsByStep: observations,
    finalPrediction: 2, finalScore: false, latencyMs: 12.5, tokenCount: null, metrics: { computationSteps: budget }, provenance,
    metadata: { evidenceLevel: 'LIVE', displayLabel: 'Live local toy substrate', latencyScope: 'Backend elapsed time' }, error: null, status: 'COMPLETE',
    // The server now computes the budget sweep as part of the same request/job
    // as the primary run (see server.js's handleExperimentRequest), so the
    // mocked HTTP response embeds it directly rather than the browser making
    // four additional fetches.
    budgetSweep: { id: 'sweep-test', task: '1,0,1,1', backend: 'recurrent', budgets: [1, 2, 4, 8], evidenceLevel: 'LIVE', runs: [1, 2, 4, 8].map((b) => ({ reasoningBudget: b, finalPrediction: 2, groundTruth: 4, finalScore: false, metrics: { computationSteps: b }, latencyMs: 1.5, status: 'COMPLETE', evidenceLevel: 'LIVE' })) },
  };
}
const ok = (body) => ({ ok: true, json: async () => body });
const textOf = (node) => [node.textContent, ...node.children.map(textOf)].join(' ');

test('shell offers live by default, synthetic explicitly, and accessible inspection/comparison', () => {
  assert.match(html, /<select[^>]+id="backend"/u);
  assert.match(html, /<option value="recurrent" selected>Live recurrent substrate<\/option>/u);
  assert.match(html, /<option value="synthetic">Synthetic contract demo<\/option>/u);
  assert.match(html, /id="task"[^>]+value="1,0,1,1"/u);
  for (const id of ['state-inspector', 'state-values', 'comparison-body', 'telemetry-latency', 'telemetry-seed', 'configuration']) assert.match(html, new RegExp(`id="${id}"`, 'u'));
  assert.match(html, /<caption[^>]*>[^<]*budget/iu);
});

test('browser hierarchy handlers delegate to the canonical guided-experience import', () => {
  assert.match(script, /import \{ createGuidedExperience \} from '\.\/guided-experience\.js';/u);
  assert.match(script, /const hierarchyExperience = createGuidedExperience\(\{ request: requestExperiment \}\)/u);
  assert.match(script, /hierarchyExperience\.runHierarchy\(\)/u);
  assert.match(script, /hierarchyExperience\.inspectHierarchy\(\)/u);
  assert.match(script, /hierarchyExperience\.compareHierarchy\(\)/u);
  assert.match(script, /hierarchyExperience\.completeHierarchyLesson\(\)/u);
});

test('live execution renders actual signed h0..hn, selectable values and independent budget results', async () => {
  const ui = browser((request) => ok(liveResult(request.reasoningBudget)));
  await ui.submit();
  // One user experiment produces exactly one /api/experiment request; the
  // budget-comparison table is rendered from that same response's embedded
  // budgetSweep, computed server-side as one combined queued job.
  assert.equal(ui.requests.length, 1);
  assert.deepEqual(ui.requests.map(({ reasoningBudget }) => reasoningBudget), [4]);
  assert.ok(ui.requests.every(({ url, task, backend }) => url === '/api/experiment' && task === '1,0,1,1' && backend === 'recurrent'));
  assert.equal(ui.nodes.get('evidence-badge').textContent, 'LIVE');
  const steps = ui.nodes.get('state-list').children;
  assert.equal(steps.length, 5);
  assert.match(textOf(steps[0]), /h0/u);
  assert.match(textOf(steps[1]), /L2.*0\.559/u);
  assert.match(textOf(steps[1]), /Δ.*0\.75/u);
  const signedColumns = steps[1].children[0].children[1].children;
  assert.equal(signedColumns[0].children[0].className, 'vector-bar negative');
  assert.equal(signedColumns[0].children[0].style['--magnitude'], '50%');
  assert.equal(signedColumns[1].children[0].className, 'vector-bar positive');
  assert.equal(signedColumns[1].children[0].style['--magnitude'], '25%');
  assert.equal(steps[0].children[0].children[1].children[0].children[0].style['--magnitude'], '25%');
  await steps[1].children[0].listeners.click();
  assert.match(textOf(ui.nodes.get('state-values')), /-0\.5/u);
  assert.match(textOf(ui.nodes.get('state-values')), /0\.25/u);
  assert.equal(ui.nodes.get('correct').textContent, '✕ INCORRECT');
  assert.equal(ui.nodes.get('prediction').textContent, '2');
  assert.equal(ui.nodes.get('ground-truth').textContent, '4');
  assert.match(ui.nodes.get('telemetry-latency').textContent, /12\.5/u);
  assert.equal(ui.nodes.get('comparison-body').children.length, 4);
  assert.ok(ui.nodes.get('comparison-body').children.every((row) => /INCORRECT/u.test(textOf(row))));
});

test('synthetic switch updates task and displays missing initial vector and metrics honestly', async () => {
  const ui = browser(async (request) => ok(await executeSyntheticDemo(request)));
  ui.nodes.get('backend').value = 'synthetic';
  ui.nodes.get('backend').listeners.change();
  assert.equal(ui.nodes.get('task').value, '17 + 28');
  await ui.submit();
  assert.equal(ui.nodes.get('evidence-badge').textContent, 'SYNTHETIC');
  assert.match(textOf(ui.nodes.get('state-list').children[0]), /not supplied/iu);
  assert.match(textOf(ui.nodes.get('state-list').children[1]), /L2.*not reported/iu);
  assert.match(ui.nodes.get('telemetry-latency').textContent, /not reported/iu);
  assert.ok(ui.requests.every(({ backend }) => backend === 'synthetic'));
});

test('malformed required fields, non-finite vectors, and mismatched evidence fail before rendering', async () => {
  const mutations = [
    (body) => { delete body.initialState.values; },
    (body) => { body.latentStateObservationsByStep[0].stateObservation.values[0] = Infinity; },
    (body) => { delete body.latentStateObservationsByStep[0].metrics.stateNorm; },
    (body) => { body.latentStateObservationsByStep[1].step = 0; },
    (body) => { body.metadata.evidenceLevel = 'SYNTHETIC'; },
    (body) => { body.finalScore = 'false'; },
    (body) => { body.predictionsByStep = []; },
    (body) => { body.latencyMs = -1; },
    (body) => { body.configuration = null; },
  ];
  for (const mutate of mutations) {
    const body = liveResult(); mutate(body);
    const ui = browser(() => ok(body));
    await ui.submit();
    assert.equal(ui.nodes.get('execution-status').textContent, 'EXECUTION ERROR');
    assert.equal(ui.nodes.get('state-list').children.length, 0);
    assert.equal(ui.nodes.get('run-button').disabled, false);
    assert.equal(ui.requests.length, 1);
  }
});

test('API errors and malformed comparison rows remain controlled and allow recovery', async () => {
  // One sweep row (budget 2) failed server-side — represented in the single
  // response's embedded budgetSweep, exactly as runReasoningBudgetSweep
  // already records a failed run (status: 'ERROR'), not as a second HTTP call.
  const body = liveResult(4);
  body.budgetSweep.runs[1] = { reasoningBudget: 2, status: 'ERROR', evidenceLevel: 'LIVE_ERROR', error: { message: 'The live recurrent run failed.' } };
  const ui = browser(() => ok(body));
  await ui.submit();
  assert.equal(ui.nodes.get('comparison-body').children.length, 4);
  assert.match(textOf(ui.nodes.get('comparison-body').children[1]), /error/iu);
  assert.equal(ui.nodes.get('prediction').textContent, '2');
  const failed = browser(() => ({ ok: false, json: async () => ({ error: { message: 'Runtime unavailable' } }) }));
  await failed.submit();
  assert.match(failed.nodes.get('form-status').textContent, /Runtime unavailable/u);
  assert.equal(failed.nodes.get('run-button').disabled, false);
});

test('a failed rerun clears previous results and evidence, then can recover', async () => {
  let invalidJson = false;
  const ui = browser((request) => invalidJson ? { ok: true, json: async () => { throw new SyntaxError('Invalid JSON'); } } : ok(liveResult(request.reasoningBudget)));
  await ui.submit();
  assert.equal(ui.nodes.get('result-grid').hidden, false);
  invalidJson = true;
  await ui.submit();
  assert.equal(ui.nodes.get('result-grid').hidden, true);
  assert.equal(ui.nodes.get('comparison').hidden, true);
  assert.equal(ui.nodes.get('state-list').children.length, 0);
  assert.equal(ui.nodes.get('evidence-badge').textContent, 'NOT YET RUN');
  assert.equal(ui.nodes.get('execution-status').textContent, 'EXECUTION ERROR');
  invalidJson = false;
  await ui.submit();
  assert.equal(ui.nodes.get('result-grid').hidden, false);
  assert.equal(ui.nodes.get('execution-status').textContent, 'COMPLETE');
});
