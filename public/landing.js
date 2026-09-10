/**
 * Landing page data. Two sources, both real:
 *  - GET /api/flagship-results (results/flagship-experiment.json) fills the
 *    hero dashboard and the "measure honestly" cards.
 *  - One POST /api/experiment against the local recurrent substrate fills
 *    the "inspect" cards, requested once when that section scrolls into view.
 * Nothing here invents a number: on failure the cards say so and link to the
 * lab. Server-derived values are only ever written with textContent.
 */
import { renderBudgetChart, seriesFor } from './charts.js';

const $ = (id) => document.getElementById(id);
const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const pct = (value, digits = 1) => `${(value * 100).toFixed(digits)}%`;
const pp = (value) => `${value >= 0 ? '+' : '−'}${Math.abs(value * 100).toFixed(1)}pp`;
const nextFrame = () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));

function element(tag, text, className) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
}

/* ---------------- Flagship results: hero + measure cards ---------------- */

let flagship = null;
let activeSplit = 'testUnseen';
const SPLIT_TITLES = { testUnseen: 'Held-out lengths', testSeen: 'In-distribution' };

async function loadFlagship() {
  try {
    const response = await fetch('/api/flagship-results');
    if (!response.ok) throw new Error('results not available');
    const data = await response.json();
    if (!data?.config?.budgetSweep || !data.recurrent?.testUnseen || !data.baseline?.testUnseen) throw new Error('unexpected results shape');
    flagship = data;
    renderHero();
    renderSweepBars();
    renderSeedBars();
  } catch {
    const empty = element('p', 'Flagship results are not available. Generate them with: python research/flagship/run_experiment.py', 'chart-empty');
    $('hero-chart').replaceChildren(empty);
    $('metric-config').textContent = 'No results file found.';
    for (const id of ['sweep-bars', 'seed-bars']) $(id).replaceChildren(element('li', 'Results file not generated yet.', 'mini-message'));
  }
}

async function renderHero() {
  const { config } = flagship;
  const split = flagship.recurrent[activeSplit];
  const baseline = flagship.baseline[activeSplit].aggregated;
  const chart = $('hero-chart');
  chart.classList.remove('is-drawn');
  renderBudgetChart(chart, {
    budgets: config.budgetSweep,
    recurrentSeries: seriesFor(split, config.budgetSweep),
    baselineMean: baseline.mean,
    title: `${SPLIT_TITLES[activeSplit]} accuracy vs computation budget`,
    compact: true,
    highlightBudget: config.thinkingStepsTrain,
  });
  $('hero-chart-title').textContent = activeSplit === 'testUnseen'
    ? `Held-out lengths ${config.testUnseenLengthRange.join('–')}`
    : `In-distribution lengths ${config.trainLengthRange.join('–')}`;

  const trained = split.aggregatedByBudget[String(config.thinkingStepsTrain)];
  const maxBudget = config.budgetSweep.at(-1);
  const atMax = split.aggregatedByBudget[String(maxBudget)];
  $('metric-trained-label').textContent = `At the trained budget (${config.thinkingStepsTrain} steps)`;
  $('metric-trained').textContent = pct(trained.mean);
  const trainedDelta = $('metric-trained-delta');
  trainedDelta.textContent = `${pp(trained.mean - baseline.mean)} vs baseline`;
  trainedDelta.className = trained.mean >= baseline.mean ? 'delta delta--up' : 'delta delta--down';
  trainedDelta.hidden = false;
  $('metric-baseline').textContent = pct(baseline.mean);
  $('metric-max-label').textContent = `At budget ${maxBudget}`;
  $('metric-max').textContent = pct(atMax.mean);
  const maxDelta = $('metric-max-delta');
  maxDelta.textContent = `${pp(atMax.mean - trained.mean)} vs trained budget`;
  maxDelta.className = atMax.mean >= trained.mean ? 'delta delta--up' : 'delta delta--down';
  maxDelta.hidden = false;
  $('metric-config').textContent = `GRU · hidden ${config.hiddenSize} · ${config.seeds.length} seeds · trained on lengths ${config.trainLengthRange.join('–')} · held out ${config.testUnseenLengthRange.join('–')} · ±${(trained.std * 100).toFixed(1)}pp std`;

  if (reduceMotion) return;
  await nextFrame();
  chart.classList.add('is-drawn');
}

function bar(label, value, { peak = false, delay = 0 } = {}) {
  const item = element('li');
  if (peak) item.dataset.peak = 'true';
  const track = element('span', undefined, 'track');
  const fill = element('span', undefined, 'fill');
  fill.style.setProperty('--value', pct(value, 2));
  fill.style.setProperty('--bar-delay', `${delay}ms`);
  track.append(fill);
  item.append(element('span', label), track, element('span', pct(value, 0), 'val'));
  item.setAttribute('aria-label', `${label}: ${pct(value)}`);
  return item;
}

async function animateIn(list) {
  if (reduceMotion) { list.classList.add('is-live'); return; }
  await nextFrame();
  list.classList.add('is-live');
}

function renderSweepBars() {
  const { config, recurrent } = flagship;
  const list = $('sweep-bars');
  const values = config.budgetSweep.map((budget) => recurrent.testSeen.aggregatedByBudget[String(budget)].mean);
  const best = Math.max(...values);
  list.replaceChildren(...config.budgetSweep.map((budget, index) => bar(`B${budget}`, values[index], { peak: values[index] === best, delay: index * 70 })));
  whenVisible(list, () => animateIn(list));
}

function renderSeedBars() {
  const { config, recurrent } = flagship;
  const list = $('seed-bars');
  const key = String(config.thinkingStepsTrain);
  const rows = recurrent.testUnseen.perSeed.filter((entry) => Number.isFinite(entry?.byBudget?.[key]));
  $('seed-label').textContent = `Held-out accuracy per seed · budget ${config.thinkingStepsTrain}`;
  const mean = recurrent.testUnseen.aggregatedByBudget[key].mean;
  list.replaceChildren(
    ...rows.map((entry, index) => bar(`seed ${entry.seed}`, entry.byBudget[key], { delay: index * 90 })),
    bar('mean', mean, { peak: true, delay: rows.length * 90 }),
  );
  whenVisible(list, () => animateIn(list));
}

for (const button of document.querySelectorAll('[data-split]')) {
  button.addEventListener('click', () => {
    if (!flagship || button.dataset.split === activeSplit) return;
    activeSplit = button.dataset.split;
    for (const other of document.querySelectorAll('[data-split]')) {
      const on = other === button;
      other.setAttribute('aria-pressed', String(on));
      if (on) other.setAttribute('aria-current', 'true'); else other.removeAttribute('aria-current');
    }
    renderHero();
  });
}

/* ---------------- Live inspection cards ---------------- */

const LIVE_REQUEST = Object.freeze({ backend: 'recurrent', task: '1,0,1,1', reasoningBudget: 4, includeBudgetSweep: false });
const finiteVector = (value) => Array.isArray(value) && value.length > 0 && value.every(Number.isFinite);
const number = (value) => Number(value.toPrecision(4)).toString();

function setLiveStatus(text, state) {
  const status = $('live-status');
  status.textContent = text;
  if (state) status.dataset.state = state; else delete status.dataset.state;
}

// #live-trajectory is an <ol>, so anything placed in it is wrapped in an <li>.
const asListItem = (node) => { const item = element('li', undefined, 'mini-note'); item.append(node); return item; };

function showLoading() {
  const skeleton = () => { const box = element('div', undefined, 'mini-skeleton'); box.setAttribute('aria-hidden', 'true'); for (let i = 0; i < 5; i += 1) box.append(element('i')); return box; };
  $('live-trajectory').replaceChildren(asListItem(skeleton()));
  $('live-heatmap').replaceChildren(skeleton());
}

function showLiveError(message) {
  setLiveStatus(`Live run unavailable: ${message}`, 'error');
  const note = () => {
    const text = element('p', 'No live result was generated, so nothing is shown here. ', 'mini-message');
    const link = element('a', 'Open the lab to run it.');
    link.href = '/lab#experiment';
    text.append(link);
    return text;
  };
  $('live-trajectory').replaceChildren(asListItem(note()));
  $('live-heatmap').replaceChildren(note());
  for (const id of ['live-prediction', 'live-truth', 'live-verdict']) $(id).textContent = '—';
  $('live-latency').textContent = '';
}

function validateLive(result) {
  const observations = result?.latentStateObservationsByStep;
  const dimension = result?.initialState?.values?.length;
  const ok = result && result.status === 'COMPLETE' && result.metadata?.evidenceLevel === 'LIVE'
    && finiteVector(result.initialState?.values)
    && Array.isArray(observations) && observations.length === LIVE_REQUEST.reasoningBudget
    && observations.every((entry) => finiteVector(entry?.stateObservation?.values) && entry.stateObservation.values.length === dimension)
    && Number.isFinite(result.finalPrediction) && Number.isFinite(result.groundTruth) && typeof result.finalScore === 'boolean';
  if (!ok) throw new Error('the response did not match the experiment contract.');
}

async function requestLive(attempt = 1) {
  const response = await fetch('/api/experiment', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(LIVE_REQUEST) });
  const body = await response.json().catch(() => null);
  if (response.status === 503 && attempt < 3) {
    setLiveStatus('The local worker is warming up. Retrying…');
    await new Promise((resolve) => setTimeout(resolve, 2500));
    return requestLive(attempt + 1);
  }
  if (!response.ok) throw new Error(typeof body?.error?.message === 'string' ? body.error.message : 'the experiment request failed.');
  validateLive(body);
  return body;
}

async function runLive() {
  setLiveStatus('Running a live experiment on the local worker…');
  showLoading();
  try {
    const result = await requestLive();
    renderLive(result);
  } catch (error) {
    showLiveError(error.message);
  }
}

async function renderLive(result) {
  const states = [
    { label: 'h0', values: result.initialState.values, norm: Math.hypot(...result.initialState.values) },
    ...result.latentStateObservationsByStep.map((entry) => ({ label: `h${entry.step + 1}`, values: entry.stateObservation.values, norm: entry.metrics?.stateNorm })),
  ];
  const scale = Math.max(...states.flatMap((state) => state.values.map(Math.abs)), 1e-9);
  const dimensions = String(states[0].values.length);

  const trajectory = $('live-trajectory');
  trajectory.replaceChildren(...states.map((state, row) => {
    const item = element('li');
    const vector = element('span', undefined, 'mini-vector');
    vector.style.setProperty('--dimensions', dimensions);
    state.values.forEach((value, column) => {
      const cell = element('span');
      const barNode = element('b', undefined, value < 0 ? 'negative' : 'positive');
      barNode.style.setProperty('--magnitude', `${(Math.abs(value) / scale) * 50}%`);
      barNode.style.setProperty('--bar-delay', `${row * 90 + column * 15}ms`);
      cell.append(barNode);
      vector.append(cell);
    });
    item.append(element('span', state.label), vector, element('span', Number.isFinite(state.norm) ? `L2 ${number(state.norm)}` : 'L2 n/a'));
    return item;
  }));

  const heatmap = $('live-heatmap');
  heatmap.replaceChildren(...states.map((state, row) => {
    const line = element('div', undefined, 'mini-heat-row');
    line.style.setProperty('--dimensions', dimensions);
    line.append(element('span', state.label));
    state.values.forEach((value, column) => {
      const cell = element('i', undefined, value < 0 ? 'negative' : undefined);
      cell.title = `${state.label}[${column}] = ${value}`;
      cell.style.setProperty('--heat', String(Math.abs(value) / scale));
      cell.style.setProperty('--bar-delay', `${row * 80 + column * 20}ms`);
      line.append(cell);
    });
    return line;
  }));

  $('live-prediction').textContent = String(result.finalPrediction);
  $('live-truth').textContent = String(result.groundTruth);
  const verdict = $('live-verdict');
  verdict.textContent = result.finalScore ? '✓ CORRECT' : '✕ INCORRECT';
  verdict.dataset.correct = String(result.finalScore);
  const latency = Number.isFinite(result.latencyMs) ? `${number(result.latencyMs)} ms` : 'latency not reported';
  $('live-latency').textContent = `${latency} · seed ${result.randomSeed ?? 'not reported'} · ${result.backend?.displayName ?? 'recurrent substrate'}`;

  for (const badge of document.querySelectorAll('[data-live-badge]')) {
    badge.textContent = result.metadata.evidenceLevel;
    badge.className = 'badge badge--live';
  }
  setLiveStatus(`${result.metadata.evidenceLevel} · task ${result.input?.task ?? LIVE_REQUEST.task} · budget ${result.reasoningBudget} · ${latency}`, 'ok');

  if (!reduceMotion) await nextFrame();
  for (const visual of document.querySelectorAll('#inspect .card-visual--data')) visual.classList.add('is-live');
}

/* ---------------- Visibility helper ---------------- */

function whenVisible(node, callback) {
  if (!('IntersectionObserver' in window)) { callback(); return; }
  const observer = new IntersectionObserver((entries) => {
    if (!entries.some((entry) => entry.isIntersecting)) return;
    observer.disconnect();
    callback();
  }, { rootMargin: '0px 0px -10% 0px' });
  observer.observe(node);
}

loadFlagship();
whenVisible($('inspect'), runLive);
