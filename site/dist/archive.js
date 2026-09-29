(() => {
  'use strict';
  const rows = document.querySelector('#archive-rows');
  const count = document.querySelector('#archive-count');
  const status = document.querySelector('#archive-status');
  const search = document.querySelector('#archive-search');
  let sources = [];
  const node = (tag, text) => { const n = document.createElement(tag); if (text) n.textContent = text; return n; };
  function link(url, label, download = false) {
    const a = node('a', label); a.href = url;
    if (download) a.download = '';
    else { a.target = '_blank'; a.rel = 'noopener noreferrer'; }
    return a;
  }
  function render() {
    const q = search.value.trim().toLowerCase();
    const matched = sources.filter(a => `${a.title} ${a.id} ${a.kind} ${a.sourceUrl}`.toLowerCase().includes(q));
    rows.replaceChildren();
    for (const a of matched) {
      const tr = node('tr');
      const title = node('td');
      title.append(node('span', a.title), node('small', a.kind === 'blog' ? 'Launch post' : 'Model card'));
      const captured = node('td');
      captured.append(node('span', new Date(a.retrievedAt).toLocaleString('en-US', {dateStyle:'medium',timeStyle:'short',timeZone:'UTC'}) + ' UTC'));
      const details = node('details'); details.append(node('summary', 'SHA-256'), node('code', a.sha256)); captured.append(details);
      const files = node('td');
      files.append(link(a.sourceUrl, 'Original'), link(a.archiveUrl, a.pages ? `PDF · ${a.pages} pages` : 'HTML', !a.pages), link(a.textUrl, 'Text'));
      if (a.readerUrl) files.prepend(link(a.readerUrl, 'Read snapshot'));
      files.append(node('small', `${(a.bytes / 1048576).toFixed(2)} MB`));
      tr.append(title, captured, files); rows.append(tr);
    }
    count.textContent = `${matched.length} of ${sources.length} sources`;
    status.textContent = matched.length ? '' : 'No matching sources.';
  }
  search.addEventListener('input',render);
  fetch('data/dataset.json').then(r => { if (!r.ok) throw new Error('Source archive unavailable'); return r.json(); })
    .then(d => {
      sources = d.artifacts.map(a => ({...a, title: [...new Set(d.releases.filter(r => r.blogArtifactId === a.id || r.cardArtifactId === a.id).map(r => r.name))].join(' · ') || a.id}));
      render();
    }).catch(() => { status.textContent = 'Unable to load the archive. Reload to try again.'; });
})();
