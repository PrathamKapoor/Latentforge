/**
 * Flagship experiment section: renders the measured, pre-computed
 * budget->accuracy results (fetched from GET /api/flagship-results, which
 * serves results/flagship-experiment.json byte-for-byte — no number here
 * is hand-typed) and offers one live run against the actual trained model
 * (POST /api/experiment, backend: "trained-recurrent") so a visitor can
 * see the same phenomenon happen in real time, not just read a chart.
 */
import { renderBudgetChart, seriesFor } from './charts.js';

const $ = (id) => document.querySelector(`#${id}`);

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
      highlightBudget: data.config.thinkingStepsTrain,
    });
    renderBudgetChart($('flagship-chart-seen'), {
      budgets: budgetSweep,
      recurrentSeries: seriesFor(data.recurrent.testSeen, budgetSweep),
      baselineMean: data.baseline.testSeen.aggregated.mean,
      title: 'In-distribution accuracy vs computation budget',
      highlightBudget: data.config.thinkingStepsTrain,
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
