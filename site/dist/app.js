/* Witchbench UI. Vanilla JS, no build step. Everything is rendered with DOM APIs and textContent.
   The interface tracks benchmark usage only; it never reproduces scores or results. */
(() => {
  'use strict';

  const DATASET_URL = 'data/dataset.json';
  const TOP_N = 5;
  const SVG_NS = 'http://www.w3.org/2000/svg';
  const SERIES_COLORS = ['#a85a2b', '#24292e', '#2f6f8f', '#6b7d3a', '#7a4f8c', '#b5843b', '#3c8a7a', '#8c4a4a'];

  const el = {
    brandMeta: document.getElementById('brand-meta'),
    toolbar: document.querySelector('.toolbar'),
    viewMatrix: document.getElementById('view-matrix'),
    viewTrends: document.getElementById('view-trends'),
    search: document.getElementById('search'),
    count: document.getElementById('count'),
    span: document.getElementById('span'),
    earlier: document.getElementById('earlier'),
    later: document.getElementById('later'),
    matrix: document.getElementById('matrix'),
    trends: document.getElementById('trends'),
    chart: document.getElementById('chart'),
    readout: document.getElementById('readout'),
    chartSummary: document.getElementById('chart-summary'),
    picker: document.getElementById('picker'),
    clearTrends: document.getElementById('clear-trends'),
    state: document.getElementById('state'),
    repoLink: document.getElementById('repo-link'),
    feedbackLink: document.getElementById('feedback-link'),
    details: document.getElementById('details'),
    detailsClose: document.getElementById('details-close'),
    detailsRelease: document.getElementById('details-release'),
    detailsTitle: document.getElementById('details-title'),
    detailsMeta: document.getElementById('details-meta'),
    detailsTiers: document.getElementById('details-tiers'),
    detailsEvidence: document.getElementById('details-evidence'),
    detailsLinks: document.getElementById('details-links'),
  };

  const state = {
    releases: [],        // sorted oldest to newest
    benchmarks: [],      // sorted most used to least used, then by name
    visible: [],         // releases currently shown (after search)
    cells: new Map(),    // `${releaseId}\u0000${benchmarkId}` -> finding[]
    usage: new Map(),    // benchmarkId -> distinct releases with a verified tier
    artifacts: new Map(),
    releaseById: new Map(),
    benchmarkById: new Map(),
    repositoryUrl: null,
    year: 2026,
    snapshotMonth: 11,   // months after this index are "after snapshot"
    view: 'matrix',
    selected: new Set(), // trend selection, ephemeral
    cursor: null,        // month index under the pointer or keyboard
    lastTrigger: null,
  };

  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

  // ---------- helpers ----------

  const isString = (v) => typeof v === 'string';
  const asArray = (v) => (Array.isArray(v) ? v : []);
  const key = (releaseId, benchmarkId) => `${releaseId}\u0000${benchmarkId}`;

  function h(tag, props, ...children) {
    const node = document.createElement(tag);
    if (props) {
      for (const [name, value] of Object.entries(props)) {
        if (value === null || value === undefined || value === false) continue;
        if (name === 'className') node.className = value;
        else if (name === 'text') node.textContent = value;
        else if (name === 'dataset') Object.assign(node.dataset, value);
        else node.setAttribute(name, value === true ? '' : String(value));
      }
    }
    for (const child of children) {
      if (child === null || child === undefined || child === false) continue;
      node.append(child instanceof Node ? child : document.createTextNode(String(child)));
    }
    return node;
  }

  function s(tag, attrs, ...children) {
    const node = document.createElementNS(SVG_NS, tag);
    if (attrs) {
      for (const [name, value] of Object.entries(attrs)) {
        if (value === null || value === undefined || value === false) continue;
        if (name === 'text') node.textContent = value;
        else node.setAttribute(name, String(value));
      }
    }
    for (const child of children) if (child) node.append(child);
    return node;
  }

  // Only http(s) absolute URLs or scheme-less relative paths (with optional #page=N) may become links.
  function safeUrl(value) {
    if (!isString(value) || !value.trim()) return null;
    const v = value.trim();
    if (/^https?:\/\//i.test(v)) return v;
    if (/^[a-z][a-z0-9+.-]*:/i.test(v) || v.startsWith('//')) return null;
    return v;
  }

  function link(url, text, { external = false } = {}) {
    const href = safeUrl(url);
    if (!href) return h('span', { text });
    const a = h('a', { href, text });
    if (external || /^https?:\/\//i.test(href)) {
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
    }
    return a;
  }

  function parseDate(value) {
    if (!isString(value)) return null;
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
    if (!m) return null;
    return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  }

  const fmt = {
    monthDay: new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }),
    day: new Intl.DateTimeFormat('en-US', { day: 'numeric', timeZone: 'UTC' }),
    full: new Intl.DateTimeFormat('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' }),
    year: new Intl.DateTimeFormat('en-US', { year: 'numeric', timeZone: 'UTC' }),
    monthShort: new Intl.DateTimeFormat('en-US', { month: 'short', timeZone: 'UTC' }),
    monthLong: new Intl.DateTimeFormat('en-US', { month: 'long', timeZone: 'UTC' }),
  };

  const monthDate = (m) => new Date(Date.UTC(state.year, m, 1));
  const monthShort = (m) => fmt.monthShort.format(monthDate(m));
  const monthLong = (m) => fmt.monthLong.format(monthDate(m));

  function formatShort(value) {
    const d = parseDate(value);
    return d ? fmt.monthDay.format(d) : (isString(value) ? value : '');
  }

  function formatLong(value) {
    const d = parseDate(value);
    return d ? fmt.full.format(d) : (isString(value) ? value : '');
  }

  function formatRange(a, b) {
    const da = parseDate(a);
    const db = parseDate(b);
    if (!da || !db) return `${formatShort(a)} – ${formatShort(b)}`;
    if (da.getTime() === db.getTime()) return fmt.full.format(da);
    const sameYear = da.getUTCFullYear() === db.getUTCFullYear();
    const sameMonth = sameYear && da.getUTCMonth() === db.getUTCMonth();
    if (sameMonth) return `${fmt.monthDay.format(da)} – ${fmt.day.format(db)}, ${fmt.year.format(db)}`;
    if (sameYear) return `${fmt.monthDay.format(da)} – ${fmt.monthDay.format(db)}, ${fmt.year.format(db)}`;
    return `${fmt.full.format(da)} – ${fmt.full.format(db)}`;
  }

  const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

  // ---------- data ----------

  function normalise(raw) {
    if (!raw || typeof raw !== 'object') throw new Error('The dataset is not a JSON object.');
    const releases = asArray(raw.releases).filter((r) => r && isString(r.id) && isString(r.name));
    const benchmarks = asArray(raw.benchmarks).filter((b) => b && isString(b.id) && isString(b.name));
    if (!releases.length || !benchmarks.length) throw new Error('The dataset has no releases or no benchmarks.');

    state.repositoryUrl = safeUrl(raw.repositoryUrl);
    state.releases = releases
      .map((r, i) => ({ ...r, _order: i }))
      .sort((a, b) => (a.date || '').localeCompare(b.date || '') || a._order - b._order);
    state.releaseById = new Map(state.releases.map((r) => [r.id, r]));
    state.benchmarkById = new Map(benchmarks.map((b) => [b.id, b]));
    state.artifacts = new Map(asArray(raw.artifacts).filter((a) => a && isString(a.id)).map((a) => [a.id, a]));

    const snapshot = parseDate(raw.snapshot);
    state.year = Number.isInteger(raw.year) ? raw.year : (snapshot ? snapshot.getUTCFullYear() : 2026);
    state.snapshotMonth = snapshot && snapshot.getUTCFullYear() === state.year ? snapshot.getUTCMonth() : 11;

    state.cells = new Map();
    for (const f of asArray(raw.findings)) {
      if (!f || !isString(f.releaseId) || !isString(f.benchmarkId)) continue;
      const k = key(f.releaseId, f.benchmarkId);
      if (!state.cells.has(k)) state.cells.set(k, []);
      state.cells.get(k).push(f);
    }

    // Usage: distinct release events with either verified tier. A release with both tiers counts once.
    state.usage = new Map(benchmarks.map((b) => [b.id, 0]));
    for (const b of benchmarks) {
      let n = 0;
      for (const r of state.releases) if (isUsed(r.id, b.id)) n += 1;
      state.usage.set(b.id, n);
    }
    state.benchmarks = [...benchmarks].sort((a, b) =>
      state.usage.get(b.id) - state.usage.get(a.id) || a.name.localeCompare(b.name, 'en', { numeric: true, sensitivity: 'base' }));

    state.selected = new Set(state.benchmarks.slice(0, TOP_N).map((b) => b.id));
    state.cursor = null;
  }

  function findingsFor(releaseId, benchmarkId) {
    return state.cells.get(key(releaseId, benchmarkId)) || [];
  }

  function isUsed(releaseId, benchmarkId) {
    return findingsFor(releaseId, benchmarkId).some((f) => f.status === 'verified' && (f.tier === 'blog' || f.tier === 'card'));
  }

  function cellSummary(releaseId, benchmarkId) {
    const findings = findingsFor(releaseId, benchmarkId);
    const verified = (tier) => findings.some((f) => f.status === 'verified' && f.tier === tier);
    const summary = {
      findings,
      blog: verified('blog'),
      card: verified('card'),
      unreviewed: findings.some((f) => f.status !== 'verified'),
    };
    summary.informative = summary.blog || summary.card || summary.unreviewed;
    return summary;
  }

  function cardStatus(release) {
    const note = isString(release.cardNote) ? release.cardNote : null;
    if (!release.cardArtifactId) return { code: 'none', label: 'No card located', note };
    const artifact = state.artifacts.get(release.cardArtifactId);
    if (artifact && artifact.status === 'failed') return { code: 'failed', label: 'Card not retrieved', note };
    return { code: 'ok', label: 'Card', note };
  }

  function blogStatus(release) {
    const artifact = release.blogArtifactId ? state.artifacts.get(release.blogArtifactId) : null;
    if (artifact && artifact.status === 'failed') return { code: 'failed', label: 'Launch post not retrieved' };
    return { code: 'ok', label: 'Launch post' };
  }

  // ---------- marks ----------

  function tick(kind) {
    if (kind === 'blog') return h('span', { className: 'tick tick-blog', 'aria-hidden': 'true', text: 'B' });
    if (kind === 'card') return h('span', { className: 'tick tick-card', 'aria-hidden': 'true', text: 'C' });
    if (kind === 'unreviewed') return h('span', { className: 'tick tick-unreviewed', 'aria-hidden': 'true', text: '?' });
    return h('span', { className: 'tick tick-empty', 'aria-hidden': 'true' });
  }

  function describeCell(summary, release, benchmark) {
    const parts = [];
    if (summary.blog) parts.push('blog highlight');
    if (summary.card) parts.push('card evaluation');
    if (summary.unreviewed) parts.push('unreviewed evidence');
    return `${release.name}, ${benchmark.name}: ${parts.join(', ')}. Open details.`;
  }

  // ---------- matrix ----------

  function renderMatrix() {
    fitColumnWidth();
    const releases = state.visible;
    const table = h('table');
    table.style.width = `calc(var(--label-w) + ${releases.length} * var(--col-w))`;
    const colgroup = h('colgroup', null, h('col', { className: 'label-col' }));
    for (let i = 0; i < releases.length; i += 1) colgroup.append(h('col', { className: 'release-col' }));
    table.append(colgroup);

    const headRow = h('tr', null,
      h('th', { scope: 'col', className: 'corner' },
        h('span', { className: 'corner-label' }, h('span', { text: 'Benchmark' }), h('span', { text: 'Releases', title: 'Distinct releases with a blog highlight or card evaluation' }))));
    for (const r of releases) {
      const card = cardStatus(r);
      const head = h('div', { className: 'col-head' },
        h('time', { datetime: isString(r.date) ? r.date : null, text: formatShort(r.date) }),
        h('span', { className: 'model', text: r.name }),
        h('span', { className: 'lab', text: isString(r.lab) ? r.lab : '' }),
        h('span', { className: 'card-status', dataset: { card: card.code }, title: card.note || null, text: card.label }));
      headRow.append(h('th', { scope: 'col', dataset: { release: r.id } }, head));
    }
    table.append(h('thead', null, headRow));

    const tbody = h('tbody');
    const frag = document.createDocumentFragment();
    for (const b of state.benchmarks) {
      const usage = state.usage.get(b.id) || 0;
      const label = h('span', { className: 'row-label' },
        h('span', { className: 'name', text: b.name }),
        h('span', { className: 'usage', 'aria-hidden': 'true', text: String(usage) }),
        h('span', { className: 'visually-hidden', text: `, used by ${plural(usage, 'release')}` }));
      const row = h('tr', null, h('th', { scope: 'row' }, label));
      for (const r of releases) {
        const td = h('td');
        const summary = cellSummary(r.id, b.id);
        if (summary.informative) {
          const button = h('button', {
            type: 'button',
            className: 'cell',
            'aria-label': describeCell(summary, r, b),
            dataset: { release: r.id, benchmark: b.id },
          });
          button.append(tick(summary.blog ? 'blog' : 'empty'));
          button.append(tick(summary.card ? 'card' : 'empty'));
          if (summary.unreviewed) button.append(tick('unreviewed'));
          td.append(button);
        }
        row.append(td);
      }
      frag.append(row);
    }
    tbody.append(frag);
    table.append(tbody);
    el.matrix.replaceChildren(table);
  }

  // ---------- matrix scrolling ----------

  function fitColumnWidth() {
    const css = getComputedStyle(document.documentElement);
    const label = parseFloat(css.getPropertyValue('--label-w'));
    const minimum = parseFloat(css.getPropertyValue('--col-w'));
    const available = el.matrix.parentElement.clientWidth - label - 2;
    const columns = Math.max(1, Math.floor(available / minimum));
    el.matrix.style.setProperty('--col-w', `${Math.max(minimum, available / columns)}px`);
  }

  function metrics() {
    const corner = el.matrix.querySelector('thead th.corner');
    const firstData = el.matrix.querySelector('thead th[data-release]');
    const labelW = corner ? corner.offsetWidth : 0;
    const colW = firstData ? firstData.offsetWidth : 0;
    return { labelW, colW, viewW: Math.max(0, el.matrix.clientWidth - labelW) };
  }

  function scrollToLeft(left, smooth = true) {
    const behavior = smooth && !reducedMotion.matches ? 'smooth' : 'auto';
    el.matrix.scrollTo({ left: Math.max(0, left), behavior });
  }

  function scrollByColumns(n) {
    const { colW } = metrics();
    if (!colW) return;
    const target = el.matrix.scrollLeft + n * colW;
    scrollToLeft(Math.round(target / colW) * colW);
  }

  function pageColumns() {
    const { colW, viewW } = metrics();
    if (!colW) return 1;
    return Math.max(1, Math.floor(viewW / colW) - 1);
  }

  function scrollToNewest() {
    el.matrix.scrollLeft = el.matrix.scrollWidth;
    updateRange();
  }

  function visibleRange() {
    const n = state.visible.length;
    const { colW, viewW } = metrics();
    if (!n || !colW) return null;
    const start = el.matrix.scrollLeft;
    const end = start + viewW;
    let first = Math.ceil(start / colW - 0.5);
    let last = Math.floor(end / colW - 0.5);
    first = Math.min(Math.max(first, 0), n - 1);
    last = Math.min(Math.max(last, first), n - 1);
    return { first, last };
  }

  function updateRange() {
    const range = el.matrix.hidden ? null : visibleRange();
    if (!range) {
      el.earlier.disabled = true;
      el.later.disabled = true;
      return;
    }
    el.span.textContent = formatRange(state.visible[range.first].date, state.visible[range.last].date);
    const maxLeft = el.matrix.scrollWidth - el.matrix.clientWidth;
    el.earlier.disabled = el.matrix.scrollLeft <= 1;
    el.later.disabled = el.matrix.scrollLeft >= maxLeft - 1;
  }

  let rangeFrame = 0;
  function scheduleRange() {
    if (rangeFrame) return;
    rangeFrame = requestAnimationFrame(() => {
      rangeFrame = 0;
      updateRange();
    });
  }

  function onMatrixKey(event) {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    switch (event.key) {
      case 'ArrowLeft': scrollByColumns(-1); break;
      case 'ArrowRight': scrollByColumns(1); break;
      case 'PageUp': scrollByColumns(-pageColumns()); break;
      case 'PageDown': scrollByColumns(pageColumns()); break;
      case 'Home': scrollToLeft(0); break;
      case 'End': scrollToLeft(el.matrix.scrollWidth); break;
      default: return;
    }
    event.preventDefault();
  }

  // ---------- trends ----------

  function monthBuckets() {
    const buckets = Array.from({ length: 12 }, () => []);
    for (const r of state.visible) {
      const d = parseDate(r.date);
      if (d && d.getUTCFullYear() === state.year) buckets[d.getUTCMonth()].push(r);
    }
    return buckets;
  }

  function seriesFor(benchmarkId, buckets) {
    return buckets.map((releases) => {
      const denom = releases.length;
      const count = releases.filter((r) => isUsed(r.id, benchmarkId)).length;
      return { count, denom, share: denom ? count / denom : null };
    });
  }

  function buildPicker() {
    const items = state.benchmarks.map((b) => {
      const id = `pick-${b.id}`;
      const input = h('input', { type: 'checkbox', id, value: b.id });
      input.checked = state.selected.has(b.id);
      const label = h('label', { for: id },
        input,
        h('span', { className: 'name', text: b.name }),
        h('span', { className: 'usage', text: String(state.usage.get(b.id) || 0), title: 'Distinct releases with a blog highlight or card evaluation' }),
        h('span', { className: 'swatch', 'aria-hidden': 'true' }));
      return h('li', null, label);
    });
    el.picker.replaceChildren(...items);
  }

  function syncPickerColors(series) {
    const colorById = new Map(series.map((sr) => [sr.benchmark.id, sr.color]));
    for (const label of el.picker.querySelectorAll('label')) {
      const input = label.querySelector('input');
      const color = colorById.get(input.value);
      const swatch = label.querySelector('.swatch');
      if (color) {
        label.dataset.color = color;
        swatch.style.background = color;
      } else {
        delete label.dataset.color;
        swatch.style.background = '';
      }
    }
  }

  let chartModel = null; // { series, buckets, geometry }

  function renderTrends() {
    const buckets = monthBuckets();
    const selected = state.benchmarks.filter((b) => state.selected.has(b.id));
    const series = selected.map((b, i) => ({
      benchmark: b,
      color: SERIES_COLORS[i % SERIES_COLORS.length],
      points: seriesFor(b.id, buckets),
    }));
    syncPickerColors(series);
    el.clearTrends.disabled = series.length === 0;

    const W = Math.max(320, el.chart.clientWidth - 18 || 760);
    const H = W < 500 ? 290 : 340, L = 56, R = 20, T = 20, B = 46;
    const plotW = W - L - R;
    const plotH = H - T - B;
    const step = plotW / 12;
    const x = (m) => L + (m + 0.5) * step;
    const y = (share) => T + plotH * (1 - share);
    chartModel = { series, buckets, geometry: { W, L, step } };

    const svg = s('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-labelledby': 'chart-title-svg', 'aria-describedby': 'chart-summary' });
    svg.append(s('title', { id: 'chart-title-svg', text: 'Share of releases discussing each selected benchmark, by month' }));

    // Months after the snapshot are future: shaded, no data by design.
    if (state.snapshotMonth < 11) {
      const fx = L + (state.snapshotMonth + 1) * step;
      svg.append(s('rect', { class: 'future', x: fx, y: T, width: L + plotW - fx, height: plotH }));
      svg.append(s('text', { class: 'future-label', x: fx + 8, y: T + 16, text: W < 500 ? 'Future' : 'After snapshot' }));
    }

    for (const pct of [0, 25, 50, 75, 100]) {
      const gy = y(pct / 100);
      svg.append(s('line', { class: pct === 0 ? 'axis' : 'grid', x1: L, x2: L + plotW, y1: gy, y2: gy }));
      svg.append(s('text', { class: 'axis-text', x: L - 8, y: gy + 5, 'text-anchor': 'end', text: `${pct}%` }));
    }
    svg.append(s('text', { class: 'axis-title', transform: `translate(14 ${T + plotH / 2}) rotate(-90)`, 'text-anchor': 'middle', text: 'Share of releases' }));

    for (let m = 0; m < 12; m += 1) {
      const muted = buckets[m].length === 0;
      svg.append(s('text', {
        class: muted ? 'axis-text month-label muted' : 'axis-text month-label',
        x: x(m), y: H - B + 20, 'text-anchor': 'middle', text: monthShort(m),
      }));
    }

    for (const sr of series) {
      let d = '';
      let pen = false;
      sr.points.forEach((p, m) => {
        if (p.share === null) { pen = false; return; }
        d += `${pen ? 'L' : 'M'}${x(m).toFixed(1)} ${y(p.share).toFixed(1)} `;
        pen = true;
      });
      if (d) svg.append(s('path', { class: 'series-line', d: d.trim(), stroke: sr.color }));
      sr.points.forEach((p, m) => {
        if (p.share === null) return;
        const circle = s('circle', { class: 'series-point', cx: x(m), cy: y(p.share), r: 4, fill: sr.color });
        circle.append(s('title', { text: `${sr.benchmark.name}, ${monthLong(m)}: ${p.count} of ${plural(p.denom, 'release')}` }));
        svg.append(circle);
      });
    }

    if (!series.length) {
      svg.append(s('text', { class: 'chart-empty', x: L + plotW / 2, y: T + plotH / 2, 'text-anchor': 'middle', text: 'Select a benchmark to plot its usage' }));
    }

    const cursor = s('line', { class: 'cursor', id: 'chart-cursor', x1: 0, x2: 0, y1: T, y2: T + plotH, visibility: 'hidden' });
    svg.append(cursor);
    svg.append(s('rect', { class: 'hit', x: L, y: T, width: plotW, height: plotH }));
    el.chart.replaceChildren(svg);

    renderSummary();
    if (state.cursor !== null) setCursor(state.cursor); else renderReadout(null);
  }

  function renderSummary() {
    if (!chartModel) return;
    const { series, buckets } = chartModel;
    const parts = [];
    const empty = [];
    for (let m = 0; m <= state.snapshotMonth; m += 1) if (!buckets[m].length) empty.push(monthShort(m));
    parts.push(`${plural(state.visible.length, 'release')} in ${state.year} through ${monthLong(state.snapshotMonth)}.`);
    if (empty.length) parts.push(`No releases in ${empty.join(', ')}.`);
    if (state.snapshotMonth < 11) parts.push(`${monthShort(state.snapshotMonth + 1)} to Dec are after the snapshot.`);
    for (const sr of series) {
      const months = sr.points
        .map((p, m) => (p.share === null ? null : `${monthShort(m)} ${p.count} of ${p.denom}`))
        .filter(Boolean);
      parts.push(`${sr.benchmark.name}: ${months.join(', ') || 'no data'}.`);
    }
    el.chartSummary.textContent = parts.join(' ');
  }

  function renderReadout(m) {
    if (!chartModel) return;
    const { series, buckets } = chartModel;
    if (m === null) {
      el.readout.replaceChildren(h('p', { text: series.length ? 'Point at a month, or focus the chart and use the arrow keys.' : '' }));
      return;
    }
    const denom = buckets[m].length;
    const head = h('p');
    head.append(h('span', { className: 'readout-month', text: `${monthLong(m)} ${state.year}` }));
    if (m > state.snapshotMonth) head.append(': after the snapshot, no data yet');
    else if (!denom) head.append(': no matching releases');
    else head.append(`: ${plural(denom, 'release')}`);
    const nodes = [head];
    if (denom && series.length) {
      const list = h('ul');
      for (const sr of series) {
        const p = sr.points[m];
        const swatch = h('span', { className: 'swatch', 'aria-hidden': 'true' });
        swatch.style.background = sr.color;
        list.append(h('li', null, swatch, `${sr.benchmark.name}: ${p.count} of ${denom} (${Math.round(p.share * 100)}%)`));
      }
      nodes.push(list);
    }
    el.readout.replaceChildren(...nodes);
  }

  function setCursor(m) {
    if (!chartModel) return;
    const clamped = Math.min(11, Math.max(0, m));
    state.cursor = clamped;
    const { L, step } = chartModel.geometry;
    const cursor = el.chart.querySelector('#chart-cursor');
    if (cursor) {
      const cx = L + (clamped + 0.5) * step;
      cursor.setAttribute('x1', cx);
      cursor.setAttribute('x2', cx);
      cursor.setAttribute('visibility', 'visible');
    }
    renderReadout(clamped);
  }

  function clearCursor() {
    state.cursor = null;
    const cursor = el.chart.querySelector('#chart-cursor');
    if (cursor) cursor.setAttribute('visibility', 'hidden');
    renderReadout(null);
  }

  function onChartPointer(event) {
    const svg = el.chart.querySelector('svg');
    if (!svg || !chartModel) return;
    const rect = svg.getBoundingClientRect();
    if (!rect.width) return;
    const { W, L, step } = chartModel.geometry;
    const vx = ((event.clientX - rect.left) / rect.width) * W;
    setCursor(Math.floor((vx - L) / step));
  }

  function onChartKey(event) {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    const current = state.cursor === null ? state.snapshotMonth : state.cursor;
    switch (event.key) {
      case 'ArrowLeft': setCursor(current - 1); break;
      case 'ArrowRight': setCursor(state.cursor === null ? current : current + 1); break;
      case 'Home': setCursor(0); break;
      case 'End': setCursor(11); break;
      case 'Escape': clearCursor(); break;
      default: return;
    }
    event.preventDefault();
  }

  // ---------- views ----------

  function setView(view) {
    state.view = view;
    el.toolbar.dataset.view = view;
    el.viewMatrix.setAttribute('aria-pressed', String(view === 'matrix'));
    el.viewTrends.setAttribute('aria-pressed', String(view === 'trends'));
    if (state.visible.length) {
      el.matrix.hidden = view !== 'matrix';
      el.trends.hidden = view !== 'trends';
      if (view === 'matrix') updateRange();
      else renderTrends();
    }
  }

  // ---------- search ----------

  function parseQuery(value) {
    return value.split(',').map((t) => t.trim().toLowerCase()).filter(Boolean);
  }

  function applySearch() {
    const terms = parseQuery(el.search.value);
    const total = state.releases.length;
    state.visible = terms.length
      ? state.releases.filter((r) => {
          const name = r.name.toLowerCase();
          return terms.some((t) => name.includes(t));
        })
      : state.releases;

    if (state.visible.length === 0) {
      el.count.textContent = `0 of ${total}`;
      el.matrix.hidden = true;
      el.trends.hidden = true;
      el.matrix.replaceChildren();
      showState([
        h('p', { className: 'error-title', text: 'No releases match that name.' }),
        h('p', { text: 'Try a model name such as Sonnet, GPT-5.5 or Gemini, or separate several names with commas.' }),
        h('p', null, h('button', { className: 'button', type: 'button', id: 'clear-search', text: 'Clear the filter' })),
      ]);
      el.span.textContent = 'Nothing to show';
      el.earlier.disabled = true;
      el.later.disabled = true;
      return;
    }

    el.count.textContent = terms.length ? `${state.visible.length} of ${total}` : `${total} releases`;
    hideState();
    renderMatrix();
    renderTrends();
    el.matrix.hidden = state.view !== 'matrix';
    el.trends.hidden = state.view !== 'trends';
    if (state.view === 'matrix') scrollToNewest();
  }

  let searchTimer = 0;
  function onSearchInput() {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(applySearch, 120);
  }

  // ---------- state box ----------

  function showState(children) {
    el.state.replaceChildren(...children);
    el.state.hidden = false;
  }

  function hideState() {
    el.state.hidden = true;
  }

  function showError(message) {
    el.state.setAttribute('role', 'alert');
    el.matrix.hidden = true;
    el.trends.hidden = true;
    showState([
      h('p', { className: 'error-title', text: 'The dataset could not be loaded.' }),
      h('p', null, 'Expected ', h('code', { text: DATASET_URL }), '. ', message),
      h('p', null, h('button', { className: 'button', type: 'button', id: 'retry', text: 'Try again' })),
    ]);
    el.span.textContent = '';
    el.search.disabled = true;
  }

  // ---------- details sheet ----------

  function statusLine(mark, text, note) {
    const dd = h('dd');
    const line = h('div', { className: 'status-line' });
    if (mark) line.append(tick(mark));
    line.append(h('span', { text }));
    dd.append(line);
    if (note) dd.append(h('span', { className: 'status-note', text: note }));
    return dd;
  }

  function artifactFor(finding) {
    if (isString(finding.sourceId) && state.artifacts.has(finding.sourceId)) return state.artifacts.get(finding.sourceId);
    return null;
  }

  function evidenceKind(finding) {
    const artifact = artifactFor(finding);
    const kind = artifact ? artifact.kind : finding.tier;
    if (kind === 'card') return 'Model card';
    if (kind === 'blog') return 'Launch post';
    return 'Source';
  }

  function renderEvidence(findings) {
    const order = (f) => {
      if (f.status === 'verified' && f.tier === 'blog') return 0;
      if (f.status === 'verified' && f.tier === 'card') return 1;
      if (f.status === 'verified') return 2;
      return 3;
    };
    const sorted = [...findings].sort((a, b) => order(a) - order(b));
    const items = [];

    for (const f of sorted) {
      const artifact = artifactFor(f);
      const head = h('div', { className: 'evidence-head' });
      const kindNode = h('span', { className: 'kind' });
      if (f.status === 'verified' && (f.tier === 'blog' || f.tier === 'card')) kindNode.append(tick(f.tier));
      kindNode.append(h('span', { text: evidenceKind(f) }));
      head.append(kindNode);
      if (f.status !== 'verified') head.append(h('span', { className: 'tag', text: 'Unreviewed' }));
      if (f.status === 'verified' && !f.tier) head.append(h('span', { className: 'tag', text: 'Mention only' }));
      const where = [];
      if (isString(f.mentionType) && f.mentionType) where.push(f.mentionType);
      if (isString(f.location) && f.location) where.push(f.location);
      if (where.length) head.append(h('span', { text: where.join(', ') }));

      const item = h('li', { className: 'evidence-item' }, head);

      // Score-free description of where and how the benchmark is used. Never values.
      if (isString(f.excerpt) && f.excerpt.trim()) {
        item.append(h('p', { className: 'summary', text: f.excerpt.trim() }));
      }

      const links = h('div', { className: 'evidence-links' });
      const sourceUrl = safeUrl(f.sourceUrl) || (artifact ? safeUrl(artifact.sourceUrl) : null);
      const archiveUrl = safeUrl(f.readerUrl) || safeUrl(f.archiveUrl) || (artifact ? safeUrl(artifact.readerUrl || artifact.archiveUrl) : null);
      const textUrl = artifact ? safeUrl(artifact.textUrl) : null;
      if (sourceUrl) links.append(link(sourceUrl, 'Original source', { external: true }));
      if (archiveUrl) links.append(link(archiveUrl, 'Archived copy'));
      if (textUrl) links.append(link(textUrl, 'Extracted text'));
      if (artifact && isString(artifact.retrievedAt) && artifact.retrievedAt) {
        links.append(h('span', { className: 'retrieved', text: `Retrieved ${formatLong(artifact.retrievedAt) || artifact.retrievedAt}` }));
      }
      if (links.childElementCount) item.append(links);
      items.push(item);
    }

    if (!items.length) {
      items.push(h('li', null, h('p', { className: 'empty-evidence', text: 'No evidence entries are recorded for this cell.' })));
    }
    el.detailsEvidence.replaceChildren(...items);
  }

  function openDetails(releaseId, benchmarkId, trigger) {
    const release = state.releaseById.get(releaseId);
    const benchmark = state.benchmarkById.get(benchmarkId);
    if (!release || !benchmark) return;
    const summary = cellSummary(releaseId, benchmarkId);
    const card = cardStatus(release);
    const blog = blogStatus(release);
    const unreviewed = (tier) => summary.findings.some((f) => f.status !== 'verified' && f.tier === tier);

    el.detailsRelease.textContent = release.name;
    el.detailsTitle.textContent = benchmark.name;
    el.detailsMeta.textContent = [isString(release.lab) ? release.lab : null, formatLong(release.date)].filter(Boolean).join(', ');

    const tiers = [h('dt', { text: 'Launch post' })];
    if (summary.blog) tiers.push(statusLine('blog', 'Highlighted in the post’s prose'));
    else if (blog.code === 'failed') tiers.push(statusLine(null, blog.label));
    else if (unreviewed('blog')) tiers.push(statusLine('unreviewed', 'Unreviewed mention'));
    else tiers.push(statusLine(null, 'No qualifying prose highlight identified'));

    tiers.push(h('dt', { text: 'Model card' }));
    if (card.code === 'none') tiers.push(statusLine(null, 'No dedicated card located', card.note));
    else if (card.code === 'failed') tiers.push(statusLine(null, card.label, card.note));
    else if (summary.card) tiers.push(statusLine('card', 'Evaluated in the card', card.note));
    else if (unreviewed('card')) tiers.push(statusLine('unreviewed', 'Unreviewed mention', card.note));
    else tiers.push(statusLine(null, 'No qualifying evaluation identified', card.note));
    el.detailsTiers.replaceChildren(...tiers);

    renderEvidence(summary.findings);

    const footerLinks = [link('archive.html', 'Source Archive')];
    if (state.repositoryUrl) {
      const title = `Correction: ${release.name} / ${benchmark.name}`;
      footerLinks.push(link(`${state.repositoryUrl.replace(/\/+$/, '')}/issues/new?title=${encodeURIComponent(title)}`, 'Feedback', { external: true }));
    }
    el.detailsLinks.replaceChildren(...footerLinks);

    state.lastTrigger = trigger || null;
    el.details.showModal();
    el.details.querySelector('.details-inner').scrollTop = 0;
    el.detailsClose.focus();
  }

  function closeDetails() {
    if (el.details.open) el.details.close();
  }

  function onDetailsClosed() {
    const trigger = state.lastTrigger;
    state.lastTrigger = null;
    if (trigger && trigger.isConnected) trigger.focus();
    else el.matrix.focus();
  }

  // ---------- chrome ----------

  function renderChrome(raw) {
    const bits = [String(state.year)];
    if (isString(raw.snapshot) && raw.snapshot) bits.push(`snapshot ${formatLong(raw.snapshot) || raw.snapshot}`);
    bits.push(plural(state.releases.length, 'release'));
    bits.push(plural(state.benchmarks.length, 'benchmark'));
    el.brandMeta.textContent = bits.join(' · ');

    if (state.repositoryUrl) {
      const base = state.repositoryUrl.replace(/\/+$/, '');
      el.repoLink.href = base;
      el.repoLink.hidden = false;
      el.feedbackLink.href = `${base}/issues/new`;
      el.feedbackLink.hidden = false;
      for (const a of [el.repoLink, el.feedbackLink]) {
        a.target = '_blank';
        a.rel = 'noopener noreferrer';
      }
    }
  }

  // ---------- load ----------

  async function load() {
    el.state.setAttribute('role', 'status');
    el.matrix.hidden = true;
    el.trends.hidden = true;
    showState([h('p', { text: 'Loading the dataset…' })]);
    let raw;
    try {
      const response = await fetch(DATASET_URL, { cache: 'no-cache' });
      if (!response.ok) throw new Error(`The server answered ${response.status} ${response.statusText}.`.trim());
      raw = await response.json();
    } catch (err) {
      showError(err && err.message ? err.message : 'The request failed.');
      return;
    }
    try {
      normalise(raw);
    } catch (err) {
      showError(err.message);
      return;
    }
    renderChrome(raw);
    buildPicker();
    el.search.disabled = false;
    applySearch();
  }

  // ---------- wiring ----------

  el.viewMatrix.addEventListener('click', () => setView('matrix'));
  el.viewTrends.addEventListener('click', () => setView('trends'));
  el.search.addEventListener('input', onSearchInput);
  el.search.addEventListener('search', applySearch);
  el.earlier.addEventListener('click', () => scrollByColumns(-pageColumns()));
  el.later.addEventListener('click', () => scrollByColumns(pageColumns()));
  el.matrix.addEventListener('scroll', scheduleRange, { passive: true });
  el.matrix.addEventListener('keydown', onMatrixKey);
  el.matrix.addEventListener('click', (event) => {
    const button = event.target.closest('button.cell');
    if (!button || !el.matrix.contains(button)) return;
    openDetails(button.dataset.release, button.dataset.benchmark, button);
  });

  el.picker.addEventListener('change', (event) => {
    const input = event.target;
    if (!(input instanceof HTMLInputElement) || input.type !== 'checkbox') return;
    if (input.checked) state.selected.add(input.value); else state.selected.delete(input.value);
    renderTrends();
  });
  el.clearTrends.addEventListener('click', () => {
    state.selected.clear();
    for (const input of el.picker.querySelectorAll('input')) input.checked = false;
    renderTrends();
  });
  el.chart.addEventListener('pointermove', onChartPointer);
  el.chart.addEventListener('pointerdown', onChartPointer);
  el.chart.addEventListener('pointerleave', () => { if (document.activeElement !== el.chart) clearCursor(); });
  el.chart.addEventListener('keydown', onChartKey);
  el.chart.addEventListener('blur', clearCursor);

  el.state.addEventListener('click', (event) => {
    const target = event.target.closest('button');
    if (!target) return;
    if (target.id === 'clear-search') {
      el.search.value = '';
      applySearch();
      el.search.focus();
    } else if (target.id === 'retry') {
      load();
    }
  });
  el.detailsClose.addEventListener('click', closeDetails);
  el.details.addEventListener('click', (event) => {
    // The inner wrapper fills the dialog, so a click on the dialog itself is a click on the backdrop.
    if (event.target === el.details) closeDetails();
  });
  // Escape is handled natively by the dialog and ends in the same 'close' event.
  el.details.addEventListener('close', onDetailsClosed);

  let resizeTimer = 0;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      const wasNewest = el.later.disabled;
      const previousColumn = el.matrix.scrollLeft / (metrics().colW || 1);
      fitColumnWidth();
      if (state.view === 'matrix') {
        if (wasNewest) scrollToNewest();
        else scrollToLeft(previousColumn * metrics().colW, false);
        updateRange();
      } else renderTrends();
    }, 80);
  });

  load();
})();
