import { createGuidedExperience } from './guided-experience.js';
const $ = (id) => document.querySelector(`#${id}`);
const form = $('experiment-form');
const task = $('task');
const backend = $('backend');
const budgets = [1, 2, 4, 8];
const backendOptions = {
  recurrent: { id: 'recurrent-latent-toy-v1', evidence: 'LIVE', task: '1,0,1,1', help: 'Enter four comma-separated binary moves (0 = left, 1 = right). Start at position 2 on positions 0–4; each move is clamped to the boundary.', description: 'Local toy neural substrate with fixed initialization; no training.' },
  'hrm-inspired': { id: 'hrm-inspired-hierarchical-recurrence-v1', evidence: 'LIVE', task: '1,0,1,1', help: 'Uses the same bounded line-navigation task. Budget counts low-level updates; the local high-level state updates after every two.', description: 'Live local untrained educational implementation inspired by HRM cadence; not a reproduction of HRM.' },
  'bdh-cq-inspired': { id: 'bdh-cq-inspired-local-v1', evidence: 'LIVE', task: '1,0,1,1', help: 'Uses the same bounded line-navigation task. Demonstrations update S memory; the query then receives recurrent H workspace computation.', description: 'LIVE local BDH-CQ-inspired simplification; it is not a reproduction of the published system.' },
  synthetic: { id: 'synthetic-arithmetic-demo-v1', evidence: 'SYNTHETIC', task: '17 + 28', help: 'The synthetic contract demo supports only 17 + 28.', description: 'Deterministic illustrative pipeline demo; its vectors are not neural activations.' },
};
let running = false;
let activeResult = null;
let activeStates = [];
let selectedStateIndex = 0;
let guided = { step: 1, manipulated: false, quizPassed: false, explanationSubmitted: false };

backend.addEventListener('change', () => {
  const selected = backendOptions[backend.value];
  task.value = selected.task;
  $('task-help').textContent = selected.help;
  $('backend-help').textContent = selected.description;
  $('demonstration-control').hidden = backend.value !== 'bdh-cq-inspired';
  clearResults();
  $('form-status').textContent = 'Ready to run.';
  $('execution-status').textContent = 'AWAITING EXECUTION';
});

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (running) return;
  const formData = new FormData(form);
  const request = { task: task.value.trim(), reasoningBudget: Number(formData.get('budget')), backend: backend.value };
  if (request.backend === 'bdh-cq-inspired') request.demonstrationCount = Number(formData.get('demonstrationCount'));
  clearResults();
  setRunning(true);
  try {
    if (!request.task || !budgets.includes(request.reasoningBudget) || !backendOptions[request.backend] || (request.backend === 'bdh-cq-inspired' && ![1, 2, 3].includes(request.demonstrationCount))) throw new Error('Choose a backend, enter a valid task, and select supported computation controls.');
    const result = await requestExperiment(request);
    renderExperiment(result);
    if (guided.step === 4 && request.backend === 'recurrent' && request.reasoningBudget !== 4 && result.metadata.evidenceLevel === 'LIVE') { guided.manipulated = true; $('guided-copy').textContent = 'Live budget change received. Inspect the additional returned states and compare prediction with ground truth.'; renderGuidedState(); }
    $('execution-status').textContent = 'COMPLETE';
    // The budget sweep was computed server-side as part of this same request
    // (one experiment → one API request → one queued job); it is rendered
    // from the response already in hand, not fetched separately.
    const failures = result.budgetSweep ? renderComparison(request, result.budgetSweep) : 0;
    const queueWaitMs = result.queueTelemetry?.queueWaitMs;
    const queueNote = Number.isFinite(queueWaitMs) && queueWaitMs > 200 ? ` This experiment waited ${Math.round(queueWaitMs)}ms behind another experiment before it started.` : '';
    $('form-status').textContent = (failures ? 'Experiment complete. Some budget comparisons failed; see the table.' : 'Experiment and budget comparison complete.') + queueNote;
  } catch (error) {
    clearResults();
    // Never show a synthetic result after a live backend failure — clearResults()
    // above already wiped any partial rendering; this only decides the message.
    $('form-status').textContent = UNAVAILABLE_CODES.has(error.code)
      ? `Experiment unavailable — ${error.message} No result was generated. Try again.`
      : `Unable to run experiment: ${error.message}`;
    $('execution-status').textContent = 'EXECUTION ERROR';
  } finally { setRunning(false); }
});

function setRunning(value) {
  running = value;
  $('run-button').disabled = value;
  for (const input of form.querySelectorAll('input, select')) input.disabled = value;
  form.setAttribute('aria-busy', String(value));
  if (value) {
    $('form-status').textContent = 'Running experiment…';
    $('execution-status').textContent = 'RUNNING';
  }
}

function clearResults() {
  activeResult = null; activeStates = []; selectedStateIndex = 0;
  $('state-list').replaceChildren();
  $('state-values').replaceChildren();
  $('comparison-body').replaceChildren();
  if ($('hierarchy-body')) { $('hierarchy-body').replaceChildren(); $('hierarchy-panel').hidden = true; }
  if ($('bdh-body')) { $('bdh-body').replaceChildren(); $('bdh-panel').hidden = true; }
  for (const id of ['result-grid', 'state-inspector', 'vector-scale', 'provenance-panel', 'comparison']) $(id).hidden = true;
  $('state-empty').hidden = false;
  $('result-empty').hidden = false;
  $('evidence-badge').textContent = 'NOT YET RUN';
  $('substrate-status').textContent = `SUBSTRATE: ${backend.value.toUpperCase()} / NOT YET RUN`;
  $('state-description').textContent = 'Numerical state telemetry is not a human-readable thought or explanation.';
  if ($('state-scrubber')) { $('state-scrubber').hidden = true; $('scrubber-label').hidden = true; $('scrubber-description').hidden = true; $('state-heatmap').hidden = true; }
}

const UNAVAILABLE_CODES = new Set(['SERVICE_UNAVAILABLE', 'RUNTIME_UNAVAILABLE', 'OVERLOADED']);

async function requestExperiment(request) {
  const response = await fetch('/api/experiment', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(request),
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    const error = new Error(typeof body?.error?.message === 'string' ? body.error.message : 'The experiment request failed.');
    error.code = body?.error?.code;
    throw error;
  }
  validateResult(body, request);
  return body;
}

const record = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const finiteVector = (value) => Array.isArray(value) && value.length > 0 && value.every(Number.isFinite);
const nonnegative = (value) => Number.isFinite(value) && value >= 0;
const nonempty = (value) => typeof value === 'string' && value.trim().length > 0;

// Backend IDs establish evidence identity; rendering consumes only contract data.
function validateResult(result, request) {
  const expected = backendOptions[request.backend];
  const fail = () => { throw new Error('The response did not match the expected experiment contract.'); };
  if (!record(result) || !nonempty(result.experimentId) || !nonempty(result.taskId)
    || result.status !== 'COMPLETE' || result.error !== null
    || result.backend?.id !== expected.id || !nonempty(result.backend?.displayName)
    || result.metadata?.evidenceLevel !== expected.evidence
    || !record(result.configuration) || !record(result.provenance)
    || result.provenance.evidenceLevel !== expected.evidence || !nonempty(result.provenance.description)
    || result.backend.provenance?.evidenceLevel !== expected.evidence
    || result.input?.task !== request.task || result.reasoningBudget !== request.reasoningBudget
    || !Number.isFinite(result.finalPrediction) || !Number.isFinite(result.groundTruth)
    || typeof result.finalScore !== 'boolean' || result.finalScore !== (result.finalPrediction === result.groundTruth)
    || !(result.latencyMs === null || nonnegative(result.latencyMs))
    || !(result.randomSeed === null || Number.isInteger(result.randomSeed))
    || !(result.tokenCount === null || (Number.isInteger(result.tokenCount) && result.tokenCount >= 0))
    || result.metrics?.computationSteps !== request.reasoningBudget
    || !record(result.initialState) || !nonempty(result.initialState.kind)
    || !Array.isArray(result.latentStateObservationsByStep) || result.latentStateObservationsByStep.length !== request.reasoningBudget
    || !Array.isArray(result.predictionsByStep) || result.predictionsByStep.length !== request.reasoningBudget) fail();
  const observations = result.latentStateObservationsByStep;
  const dimension = observations[0]?.stateObservation?.values?.length;
  const isLive = expected.evidence === 'LIVE';
  if ((isLive || result.initialState.values !== undefined) && (!finiteVector(result.initialState.values) || result.initialState.values.length !== dimension)) fail();
  if (isLive && !Number.isInteger(result.randomSeed)) fail();
  for (const [index, observation] of observations.entries()) {
    if (!record(observation) || observation.step !== index
      || !nonempty(observation.stateObservation?.kind)
      || !finiteVector(observation.stateObservation?.values) || observation.stateObservation.values.length !== dimension
      || !Number.isFinite(observation.prediction)
      || !(observation.confidence === null || (Number.isFinite(observation.confidence) && observation.confidence >= 0 && observation.confidence <= 1))
      || observation.metadata?.evidenceLevel !== expected.evidence
      || !record(observation.metrics) || observation.metrics.computationStep !== index + 1
      || result.predictionsByStep[index]?.step !== index || result.predictionsByStep[index]?.prediction !== observation.prediction) fail();
    for (const key of ['stateNorm', 'deltaFromPrevious']) {
      if ((isLive || observation.metrics[key] !== undefined) && !nonnegative(observation.metrics[key])) fail();
    }
  }
  if (result.finalPrediction !== observations.at(-1).prediction) fail();
  if (request.backend === 'hrm-inspired') {
    if (!record(result.hierarchicalInitialState) || !finiteVector(result.hierarchicalInitialState.highState) || !finiteVector(result.hierarchicalInitialState.lowState) || !Array.isArray(result.hierarchicalStateObservationsByStep) || result.hierarchicalStateObservationsByStep.length !== request.reasoningBudget) fail();
    for (const [index, item] of result.hierarchicalStateObservationsByStep.entries()) if (!record(item) || item.step !== index || !finiteVector(item.highState) || !finiteVector(item.lowState) || typeof item.highUpdated !== 'boolean' || item.highUpdated !== ((index + 1) % 2 === 0)) fail();
  }
  if (request.backend === 'bdh-cq-inspired') {
    if (result.configuration?.demonstrationCount !== request.demonstrationCount || result.effectiveReasoningBudget !== request.reasoningBudget || !Array.isArray(result.memoryTrajectory) || result.memoryTrajectory.length !== request.demonstrationCount || !Array.isArray(result.workspaceTrajectory) || result.workspaceTrajectory.length !== request.reasoningBudget) fail();
  }
}

function element(tag, text, className) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
}
const number = (value) => Number(value.toPrecision(6)).toString();
const measured = (value) => value === undefined || value === null ? 'not reported' : number(value);
const latency = (result) => result.latencyMs === null ? 'Not reported' : `${number(result.latencyMs)} ms`;

function renderExperiment(result) {
  if (result.hierarchicalStateObservationsByStep) {
    $('hierarchy-body').replaceChildren();
    for (const item of result.hierarchicalStateObservationsByStep) {
      const row = element('tr');
      const step = element('th', String(item.step + 1)); step.setAttribute('scope', 'row');
      row.append(step, element('td', `[${item.lowState.map(number).join(', ')}]`), element('td', `[${item.highState.map(number).join(', ')}]`), element('td', item.highUpdated ? 'UPDATED' : 'HELD'));
      $('hierarchy-body').append(row);
    }
    $('hierarchy-panel').hidden = false;
  }
  if (result.memoryTrajectory && result.workspaceTrajectory) {
    const body = $('bdh-body'); body.replaceChildren();
    const append = (stage, step, values, status) => {
      const row = element('tr'); const label = element('th', stage); label.setAttribute('scope', 'row');
      row.append(label, element('td', String(step)), element('td', `[${values.map(number).join(', ')}]`), element('td', status)); body.append(row);
    };
    for (const item of result.memoryTrajectory) append('S memory', item.step + 1, item.state, 'UPDATED');
    append('H workspace', 0, result.initialState.values, 'MEMORY-CONDITIONED H₀');
    for (const item of result.workspaceTrajectory) append('H workspace', item.step + 1, item.state, 'UPDATED');
    $('bdh-panel').hidden = false;
  }
  const evidence = result.metadata.evidenceLevel;
  $('evidence-badge').textContent = evidence;
  $('substrate-status').textContent = `SUBSTRATE: ${evidence}`;
  $('state-description').textContent = evidence === 'SYNTHETIC'
    ? 'SYNTHETIC illustrative vectors, not neural activations. Missing state values and metrics remain unavailable.'
    : 'Actual recurrent state vectors from an untrained local toy substrate. Numerical telemetry is not a human-readable thought or explanation.';
  const states = [
    { label: 'h0', observation: result.initialState, metrics: null },
    ...result.latentStateObservationsByStep.map((step) => ({ label: `h${step.step + 1}`, observation: step.stateObservation, metrics: step.metrics, prediction: step.prediction })),
  ];
  activeResult = result; activeStates = states; selectedStateIndex = 0;
  // A single symmetric scale prevents per-row rescaling and negative-value clipping.
  let maximum = 0;
  for (const state of states) for (const value of state.observation.values ?? []) maximum = Math.max(maximum, Math.abs(value));
  const scale = maximum || 1;
  $('vector-scale').textContent = `Shared scale: −${number(scale)} to +${number(scale)}; center line = 0. Cyan = positive, orange = negative. Select a state to inspect all values.`;
  $('vector-scale').hidden = false;
  const buttons = [];
  for (const state of states) {
    const item = element('li', undefined, 'state-step');
    const button = element('button', undefined, 'state-select');
    button.type = 'button';
    button.setAttribute('aria-pressed', 'false');
    button.setAttribute('aria-controls', 'state-inspector');
    button.append(element('span', state.label, 'step-label'));
    const values = state.observation.values;
    if (values) {
      const vector = element('span', undefined, 'state-vector');
      vector.setAttribute('aria-hidden', 'true');
      vector.style.setProperty('--dimensions', String(values.length));
      for (const value of values) {
        const column = element('span', undefined, 'vector-column');
        const bar = element('span', undefined, value < 0 ? 'vector-bar negative' : 'vector-bar positive');
        bar.style.setProperty('--magnitude', `${Math.abs(value) / scale * 50}%`);
        column.append(bar); vector.append(column);
      }
      button.append(vector);
    } else button.append(element('span', 'Initial vector not supplied', 'field-help'));
    const norm = state.metrics ? measured(state.metrics.stateNorm) : values ? `${number(Math.hypot(...values))} (from vector)` : 'not reported';
    const delta = state.metrics ? measured(state.metrics.deltaFromPrevious) : 'not applicable';
    button.append(element('span', `L2 ${norm} · Δ ${delta}`, 'step-metrics'));
    button.setAttribute('aria-label', `${state.label}, L2 ${norm}, delta ${delta}. Inspect state values.`);
    button.addEventListener('click', () => selectRenderedState(states.indexOf(state), buttons));
    buttons.push(button);
    item.append(button); $('state-list').append(item);
  }
  buttons[0].setAttribute('aria-pressed', 'true');
  renderInspector(states[0]); renderHeatmap(states);
  const scrubber = $('state-scrubber');
  scrubber.min = '0'; scrubber.max = String(states.length - 1); scrubber.value = '0'; scrubber.hidden = false;
  $('scrubber-label').hidden = false; $('scrubber-description').hidden = false;
  scrubber.oninput = () => selectRenderedState(Number(scrubber.value), buttons);
  $('state-empty').hidden = true;
  $('result-empty').hidden = true;
  $('result-grid').hidden = false;
  $('prediction').textContent = String(result.finalPrediction);
  $('prediction-detail').textContent = evidence === 'SYNTHETIC' ? 'SYNTHETIC / illustrative demo prediction' : 'LIVE / untrained toy substrate prediction';
  $('ground-truth').textContent = String(result.groundTruth);
  $('correct').textContent = result.finalScore ? '✓ CORRECT' : '✕ INCORRECT';
  $('correct').setAttribute('data-correct', String(result.finalScore));
  $('correct-detail').textContent = result.finalScore ? 'Prediction matches independent ground truth' : 'Prediction differs from independent ground truth';
  $('telemetry-evidence').textContent = evidence;
  $('telemetry-steps').textContent = String(result.metrics.computationSteps);
  $('telemetry-status').textContent = result.status;
  $('telemetry-latency').textContent = latency(result);
  $('telemetry-seed').textContent = result.randomSeed === null ? 'Not reported' : String(result.randomSeed);
  $('telemetry-tokens').textContent = result.tokenCount === null ? 'Not reported' : String(result.tokenCount);
  $('provenance-description').textContent = `${result.backend.displayName}: ${result.provenance.description}`;
  $('latency-scope').textContent = typeof result.metadata.latencyScope === 'string' ? result.metadata.latencyScope : 'Latency scope not reported.';
  $('configuration').textContent = JSON.stringify({ experimentId: result.experimentId, taskId: result.taskId, input: result.input, randomSeed: result.randomSeed, configuration: result.configuration, provenance: result.provenance }, null, 2);
  $('provenance-panel').hidden = false;
  $('selected-state-rule').textContent = 'Current state: h₀. The recurrence rule below is invariant.';
}

function selectRenderedState(index, buttons = null) {
  if (!activeStates[index]) return;
  selectedStateIndex = index;
  if (buttons) for (const [buttonIndex, button] of buttons.entries()) button.setAttribute('aria-pressed', String(buttonIndex === index));
  $('state-scrubber').value = String(index);
  renderInspector(activeStates[index]);
  $('selected-state-rule').textContent = `Current state: ${activeStates[index].label}. The recurrence rule below is invariant.`;
}

function renderHeatmap(states) {
  const heatmap = $('state-heatmap'); heatmap.replaceChildren();
  const values = states.flatMap((state) => state.observation.values ?? []);
  const scale = Math.max(...values.map(Math.abs), 1);
  for (const state of states) {
    const row = element('div', undefined, 'heatmap-row'); row.append(element('span', state.label, 'heatmap-label'));
    for (const value of state.observation.values ?? []) { const cell = element('span', '', value < 0 ? 'heatmap-cell negative' : 'heatmap-cell positive'); cell.title = `${state.label}, raw value ${value}`; cell.style.setProperty('--heat', String(Math.abs(value) / scale)); row.append(cell); }
    heatmap.append(row);
  }
  heatmap.hidden = false;
}

function renderInspector(state) {
  $('state-inspector').hidden = false;
  $('inspector-title').textContent = `State inspector / ${state.label}`;
  const values = state.observation.values;
  const derivedMean = values?.reduce((sum, value) => sum + value, 0) / values?.length;
  const derivedStd = values ? Math.sqrt(values.reduce((sum, value) => sum + (value - derivedMean) ** 2, 0) / values.length) : null;
  const metrics = state.metrics
    ? `L2 norm ${measured(state.metrics.stateNorm)}; mean ${measured(state.metrics.mean)}; standard deviation ${measured(state.metrics.standardDeviation)}; state change ${measured(state.metrics.deltaFromPrevious)}; cosine similarity ${measured(state.metrics.cosineSimilarityToPrevious)}.`
    : values ? `Initial state h₀. L2 norm ${number(Math.hypot(...values))}; mean ${number(derivedMean)}; standard deviation ${number(derivedStd)}. No prior state exists for change or cosine similarity.` : 'Numerical state values unavailable.';
  const prediction = state.prediction === undefined ? 'Initial state h₀ has no post-update prediction.' : `Output-head prediction at ${state.label}: ${state.prediction}.`;
  $('inspector-description').textContent = `${typeof state.observation.description === 'string' ? state.observation.description : 'Numerical state values.'} ${metrics} ${prediction}`;
  $('state-values').replaceChildren();
  if (!values) {
    const row = element('tr');
    const cell = element('td', 'Initial vector not supplied by this contract.');
    cell.colSpan = 2; row.append(cell); $('state-values').append(row);
    return;
  }
  values.forEach((value, index) => {
    const row = element('tr');
    const dimension = element('th', String(index)); dimension.setAttribute('scope', 'row');
    row.append(dimension, element('td', String(value)));
    $('state-values').append(row);
  });
}

function renderComparison(request, budgetSweep) {
  $('comparison').hidden = false;
  $('comparison-context').textContent = `${backendOptions[request.backend].evidence} · Task: ${request.task}. Each budget runs independently; no trend is assumed. Computed as one combined job alongside the primary run above.`;
  $('comparison-body').replaceChildren();
  let failures = 0;
  for (const run of budgetSweep.runs) {
    const row = element('tr');
    const label = element('th', String(run.reasoningBudget)); label.setAttribute('scope', 'row');
    if (run.status === 'COMPLETE') {
      row.append(label, ...[
        String(run.finalPrediction), String(run.groundTruth), run.finalScore ? 'CORRECT' : 'INCORRECT', String(run.metrics.computationSteps), latency(run),
      ].map((value) => element('td', value)));
    } else {
      failures += 1;
      const cell = element('td', `Error: ${run.error?.message ?? 'The live recurrent run failed.'}`); cell.colSpan = 5;
      row.append(label, cell);
    }
    $('comparison-body').append(row);
  }
  $('comparison-status').textContent = failures ? `Comparison finished with ${failures} failed execution(s).` : 'All four independent executions complete.';
  renderComparisonInsight(budgetSweep);
  return failures;
}

function renderComparisonInsight(budgetSweep) {
  const insight = $('comparison-insight');
  const completed = budgetSweep.runs.filter((run) => run.status === 'COMPLETE');
  if (completed.length < 2) { insight.hidden = true; return; }
  const scores = completed.map((run) => run.finalScore);
  const monotonic = scores.every((value, index) => index === 0 || value >= scores[index - 1]);
  insight.hidden = false;
  insight.replaceChildren(
    element('p', 'MORE COMPUTATION ≠ GUARANTEED IMPROVEMENT', 'evidence-word'),
    monotonic
      ? element('p', 'For this run, correctness did not decrease as budget increased — that pattern is not guaranteed in general. Recurrent computation changes the state trajectory; it does not guarantee convergence toward the correct answer.')
      : element('p', 'More computation did not monotonically improve the answer here. Recurrent computation changes the state trajectory; it does not guarantee convergence toward the correct answer.'),
  );
}

$('repeat-sweep').addEventListener('click', () => form.requestSubmit?.());

$('run-characterization')?.addEventListener('click', async () => {
  $('characterization-status').textContent = 'Running local seed characterization…';
  try {
    const response = await fetch('/api/characterization', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ task: task.value.trim() || '1,0,1,1' }) });
    const body = await response.json().catch(() => null);
    if (!response.ok) throw new Error(typeof body?.error?.message === 'string' ? body.error.message : 'The characterization request failed.');
    renderCharacterization(body);
  } catch (error) {
    $('characterization-status').textContent = `Unable to run characterization: ${error.message}`;
  }
});

function renderCharacterization(characterization) {
  $('characterization-table-wrap').hidden = false;
  $('characterization-body').replaceChildren();
  for (const [seed, rows] of Object.entries(characterization.bySeed)) {
    const row = element('tr');
    const label = element('th', String(seed)); label.setAttribute('scope', 'row');
    const cellsByBudget = characterization.budgets.map((budget) => {
      const match = rows.find((entry) => entry.reasoningBudget === budget);
      if (!match) return element('td', '—');
      return element('td', match.status === 'COMPLETE' ? String(match.prediction) : 'Error');
    });
    const truth = rows.find((entry) => entry.status === 'COMPLETE')?.groundTruth ?? '—';
    const correctCount = rows.filter((entry) => entry.correct).length;
    row.append(label, ...cellsByBudget, element('td', String(truth)), element('td', `${correctCount}/${rows.length}`));
    $('characterization-body').append(row);
  }
  const correctCount = characterization.rows.filter((row) => row.correct).length;
  $('characterization-status').textContent = `${characterization.label}. ${characterization.rows.length} runs recorded across ${Object.keys(characterization.bySeed).length} seeds.`;
  const summary = $('characterization-summary');
  summary.hidden = false;
  summary.replaceChildren(
    element('strong', `${correctCount} / ${characterization.rows.length} correct`),
    element('span', ' — the canonical trajectory above is one illustrative instance of recurrent behavior, not a representative accuracy result.'),
  );
}

const hierarchyExperience = createGuidedExperience({ request: requestExperiment });
$('run-hierarchy').addEventListener('click', async () => { const result = await hierarchyExperience.runHierarchy(); renderExperiment(result); $('inspect-hierarchy').disabled = false; $('hierarchy-status').textContent = 'LIVE H/L RUN READY FOR INSPECTION'; });
$('inspect-hierarchy').addEventListener('click', () => { if (hierarchyExperience.inspectHierarchy()) { $('compare-hierarchy').disabled = false; $('hierarchy-status').textContent = 'H/L TELEMETRY INSPECTED'; } });
$('compare-hierarchy').addEventListener('click', async () => { const comparison = await hierarchyExperience.compareHierarchy(); const body = $('hierarchy-comparison-body'); body.replaceChildren(); for (const [label, result] of [['Single recurrence', comparison.single], ['HRM-inspired', comparison.hierarchical]]) { const row = element('tr'); row.append(...[label, result.experimentId, String(result.finalPrediction), String(result.groundTruth), result.finalScore ? 'CORRECT' : 'INCORRECT', result.metadata.evidenceLevel].map((value) => element('td', value))); body.append(row); } $('hierarchy-comparison').hidden = false; $('research-hrm').hidden = false; $('hierarchy-status').textContent = hierarchyExperience.completeHierarchyLesson() ? 'LESSON COMPLETE: TWO LIVE EXECUTIONS COMPARED' : 'LESSON REMAINS LOCKED'; });

function renderGuidedState() {
  for (const item of document.querySelectorAll?.('[data-lesson]') ?? []) item.setAttribute('data-active', String(Number(item.dataset.lesson) === guided.step));
  $('lesson-next').disabled = guided.step === 4 && !guided.manipulated;
  $('knowledge-check').hidden = guided.step < 5;
  $('explanation-prompt').hidden = !(guided.step === 5 && guided.quizPassed);
  $('enter-sandbox').disabled = !(guided.manipulated && guided.quizPassed && guided.explanationSubmitted);
}

$('lesson-next').addEventListener('click', () => {
  if (guided.step === 4 && !guided.manipulated) { $('guided-copy').textContent = 'Change the reasoning budget and wait for the returned LIVE state trajectory before continuing.'; return; }
  guided.step = Math.min(5, guided.step + 1); renderGuidedState();
});

for (const choice of document.querySelectorAll?.('[data-choice]') ?? []) choice.addEventListener('click', () => {
  guided.quizPassed = choice.dataset.choice === 'B';
  $('check-status').textContent = guided.quizPassed ? 'Correct: the hidden state is updated again. Now explain the mechanism in your own words.' : 'Try again: no new token, retraining, or ground-truth change occurs.';
  renderGuidedState();
});

$('submit-explanation').addEventListener('click', () => {
  guided.explanationSubmitted = $('learner-explanation').value.trim().length > 0;
  if (guided.explanationSubmitted) { $('reference-explanation').hidden = false; renderGuidedState(); }
});

$('enter-sandbox').addEventListener('click', () => { if (!guided.manipulated || !guided.quizPassed || !guided.explanationSubmitted) return; $('mode-status').textContent = 'SANDBOX MODE'; document.querySelector('#experiment').scrollIntoView?.({ behavior: 'smooth' }); });

const originalSubmit = form.listeners;
if (typeof window !== 'undefined') {
  window.addEventListener('DOMContentLoaded', () => {
    renderGuidedState();
    form.requestSubmit?.();
  });
}
