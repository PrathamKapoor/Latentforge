/**
 * Dependency-free SVG chart helpers shared by the lab's flagship section
 * (flagship.js) and the landing hero (landing.js). Every number drawn here
 * comes from the caller — normally GET /api/flagship-results — never from
 * this file.
 */
const SVG_NS = 'http://www.w3.org/2000/svg';

export function svgEl(tag, attrs) {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [key, value] of Object.entries(attrs)) el.setAttribute(key, value);
  return el;
}

/**
 * A small line chart: one solid series with point markers (the recurrent
 * model, mean +/- std shaded band) and one dashed flat reference line (the
 * one-shot baseline's mean). `compact` drops the caption and tightens the
 * frame for embedding inside a mockup; `highlightBudget` marks one point.
 */
export function renderBudgetChart(container, { budgets, recurrentSeries, baselineMean, title, compact = false, highlightBudget = null }) {
  container.replaceChildren();
  const width = compact ? 520 : 420;
  const height = compact ? 240 : 220;
  const padding = compact ? { top: 18, right: 12, bottom: 24, left: 34 } : { top: 16, right: 16, bottom: 28, left: 36 };
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
  const line = svgEl('polyline', { points: linePoints, class: 'chart-line' });
  svg.append(line);
  recurrentSeries.forEach((point, index) => {
    const peak = highlightBudget !== null && budgets[index] === highlightBudget;
    svg.append(svgEl('circle', { cx: xFor(index), cy: yFor(point.mean), r: peak ? 5 : 3.5, class: peak ? 'chart-point chart-point--peak' : 'chart-point' }));
  });

  container.append(svg);
  // Lets CSS draw the line in on reveal (see .js-motion .is-drawn in site.css).
  if (typeof line.getTotalLength === 'function') svg.style.setProperty('--line-length', String(Math.ceil(line.getTotalLength())));
  if (!compact) {
    const caption = document.createElement('p');
    caption.className = 'chart-caption';
    caption.textContent = 'x-axis: computation budget (additional recurrent "thinking" steps) · y-axis: accuracy';
    container.append(caption);
  }
}

export function seriesFor(splitResult, budgets) {
  return budgets.map((budget) => splitResult.aggregatedByBudget[String(budget)]);
}
