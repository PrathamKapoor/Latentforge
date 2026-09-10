/**
 * Flagship experiment section: renders the measured, pre-computed
 * budget->accuracy results (fetched from GET /api/flagship-results, which
 * serves results/flagship-experiment.json byte-for-byte — no number here
 * is hand-typed) and offers one live run against the actual trained model
 * (POST /api/experiment, backend: "trained-recurrent") so a visitor can
 * see the same phenomenon happen in real time, not just read a chart.
 */
const $ = (id) => document.querySelector(`#${id}`);

const SVG_NS = 'http://www.w3.org/2000/svg';
function svgEl(tag, attrs) {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [key, value] of Object.entries(attrs)) el.setAttribute(key, value);
  return el;
}

/**
 * A small, dependency-free line chart: one solid series with point markers
 * (the recurrent model, mean +/- std shaded band) and one dashed flat
 * reference line (the one-shot baseline's mean).
 */
function renderBudgetChart(container, { budgets, recurrentSeries, baselineMean, title }) {
  container.replaceChildren();
  const width = 420;
  const height = 220;
  const padding = { top: 16, right: 16, bottom: 28, left: 36 };
  const plotWidth = width - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;
  const xFor = (index) => padding.left + (index / (budgets.length - 1)) * plotWidth;
  const yFor = (fraction) => padding.top + (1 - fraction) * plotHeight;

  const svg = svgEl('svg', { viewBox: `0 0 ${width} ${height}`, width: '100%', height: 'auto', role: 'img', 'aria-label': title });

  for (const gridFraction of [0, 0.25, 0.5, 0.75, 1]) {
    const y = yFor(gridFraction);
    svg.append(svgEl('line', { x1: padding.left, x2: width - padding.right, y1: y, y2: y, class: 'chart-grid' }));
    const label = svgEl('text', { x: padding.left - 6, y: y + 3, class: 'chart-axis-label', 'text-anchor': 'end' });
    label.textContent = `${Math.round(gridFraction * 100)}%`;
    svg.append(label);
  }
  budgets.forEach((budget, index) => {
    const label = svgEl('text', { x: xFor(index), y: height - 8, class: 'chart-axis-label', 'text-anchor': 'middle' });
    label.textContent = String(budget);
    svg.append(label);
  });

  const bandPoints = [
    ...recurrentSeries.map((point, index) => `${xFor(index)},${yFor(Math.min(1, point.mean + point.std))}`),
    ...[...recurrentSeries].reverse().map((point, reverseIndex) => {
      const index = recurrentSeries.length - 1 - reverseIndex;
      return `${xFor(index)},${yFor(Math.max(0, point.mean - point.std))}`;
    }),
  ].join(' ');
  svg.append(svgEl('polygon', { points: bandPoints, class: 'chart-band' }));

  svg.append(svgEl('line', { x1: padding.left, x2: width - padding.right, y1: yFor(baselineMean), y2: yFor(baselineMean), class: 'chart-baseline' }));
  const baselineLabel = svgEl('text', { x: width - padding.right, y: yFor(baselineMean) - 4, class: 'chart-axis-label chart-baseline-label', 'text-anchor': 'end' });
  baselineLabel.textContent = `one-shot baseline: ${Math.round(baselineMean * 100)}%`;
  svg.append(baselineLabel);

  const linePoints = recurrentSeries.map((point, index) => `${xFor(index)},${yFor(point.mean)}`).join(' ');
  svg.append(svgEl('polyline', { points: linePoints, class: 'chart-line' }));
  recurrentSeries.forEach((point, index) => {
    svg.append(svgEl('circle', { cx: xFor(index), cy: yFor(point.mean), r: 4, class: 'chart-point' }));
  });

  svg.append(svgEl('text', { x: width / 2, y: height, class: 'chart-axis-label', 'text-anchor': 'middle' })).textContent = '';
  container.append(svg);
  const caption = document.createElement('p');
  caption.className = 'chart-caption';
  caption.textContent = 'x-axis: computation budget (additional recurrent "thinking" steps) · y-axis: accuracy';
  container.append(caption);
}

function seriesFor(splitResult, budgets) {
  return budgets.map((budget) => splitResult.aggregatedByBudget[String(budget)]);
}

async function loadFlagshipResults() {
  const summary = $('flagship-summary');
  try {
    const response = await fetch('/api/flagship-results');
    if (!response.ok) throw new Error('results not available');
    const data = await response.json();
    const { budgetSweep } = data.config;

    renderBudgetChart($('flagship-chart-unseen'), {
      budgets: budgetSweep,
      recurrentSeries: seriesFor(data.recurrent.testUnseen, budgetSweep),
      baselineMean: data.baseline.testUnseen.aggregated.mean,
      title: 'Held-out unseen-length accuracy vs computation budget',
    });
    renderBudgetChart($('flagship-chart-seen'), {
      budgets: budgetSweep,
      recurrentSeries: seriesFor(data.recurrent.testSeen, budgetSweep),
      baselineMean: data.baseline.testSeen.aggregated.mean,
      title: 'In-distribution accuracy vs computation budget',
    });

    const unseenAtTrainBudget = data.recurrent.testUnseen.aggregatedByBudget[String(data.config.thinkingStepsTrain)];
    const unseenBaseline = data.baseline.testUnseen.aggregated;
    const seenBest = Math.max(...budgetSweep.map((b) => data.recurrent.testSeen.aggregatedByBudget[String(b)].mean));
    const seenBestBudget = budgetSweep.find((b) => data.recurrent.testSeen.aggregatedByBudget[String(b)].mean === seenBest);
    summary.innerHTML = '';
    summary.append(document.createTextNode(
      `At the trained budget (${data.config.thinkingStepsTrain} thinking steps), the trained model reaches ${(unseenAtTrainBudget.mean * 100).toFixed(1)}% on unseen lengths ${data.config.testUnseenLengthRange.join('-')} (${data.config.seeds.length} seeds, ±${(unseenAtTrainBudget.std * 100).toFixed(1)}pp), versus ${(unseenBaseline.mean * 100).toFixed(1)}% for an order-blind one-shot baseline on the same held-out instances. `
      + `On in-distribution lengths ${data.config.trainLengthRange.join('-')}, accuracy peaks at budget ${seenBestBudget} (${(seenBest * 100).toFixed(1)}%) and degrades at higher budgets — more computation is not a free improvement.`,
    ));
  } catch {
    summary.textContent = 'Flagship results are not available. Generate them with: python research/flagship/run_experiment.py';
  }
}

function renderTrajectoryTable(container, steps) {
  container.replaceChildren();
  const table = document.createElement('table');
  const caption = document.createElement('caption');
  caption.textContent = 'Live per-step prediction (encoding, then thinking)';
  table.append(caption);
  const thead = document.createElement('thead');
  thead.innerHTML = '<tr><th scope="col">Step</th><th scope="col">Phase</th><th scope="col">Prediction</th></tr>';
  table.append(thead);
  const tbody = document.createElement('tbody');
  steps.forEach((step, index) => {
    const row = document.createElement('tr');
    for (const value of [String(index), step.phase, String(step.prediction)]) {
      const cell = document.createElement('td');
      cell.textContent = value;
      row.append(cell);
    }
    tbody.append(row);
  });
  table.append(tbody);
  container.append(table);
}

function initLiveRun() {
  const form = $('flagship-run-form');
  if (!form) return;
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const status = $('flagship-run-status');
    const formData = new FormData(form);
    const task = formData.get('flagshipTask');
    const reasoningBudget = Number(formData.get('flagshipBudget'));
    status.textContent = 'Running…';
    $('flagship-run-result').hidden = true;
    try {
      const response = await fetch('/api/experiment', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ backend: 'trained-recurrent', task, reasoningBudget, includeBudgetSweep: false }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result?.error?.message ?? 'The live experiment failed.');
      $('flagship-run-prediction').textContent = String(result.finalPrediction);
      $('flagship-run-truth').textContent = String(result.groundTruth);
      $('flagship-run-verdict').textContent = result.finalScore ? 'CORRECT' : 'INCORRECT';
      $('flagship-run-result').hidden = false;
      renderTrajectoryTable($('flagship-run-trajectory'), result.latentStateObservationsByStep.map((o) => ({ phase: o.metrics.phase, prediction: o.prediction })));
      status.textContent = `Live · evidence: ${result.metadata.evidenceLevel}`;
    } catch (error) {
      status.textContent = `Error: ${error.message}`;
    }
  });
}

loadFlagshipResults();
initLiveRun();
