'use strict';
// Daily writing stats module
const Stats = (() => {
  function show() {
    const body = document.getElementById('stats-body');
    body.innerHTML = '';

    const daily = State.daily;
    const docs  = State.docs;
    if (!Object.keys(daily).length) {
      body.innerHTML = `<p style="color:var(--fg-bar);padding:12px">${t('stats_no_stats_yet', 'No writing stats yet.')}</p>`;
      document.getElementById('stats-dlg').showModal();
      return;
    }

    const docMap = {};
    docs.forEach(d => { docMap[d.id] = d.name; });

    Object.entries(daily).forEach(([id, days]) => {
      if (!Object.keys(days).length) return;
      const name = document.createElement('div');
      name.className = 'stats-doc-name';
      name.textContent = docMap[id] || `#${id}`;
      body.appendChild(name);

      const table = document.createElement('table');
      table.className = 'stats-table';
      table.innerHTML = `<tr><th>${t('stats_header_date', 'Date')}</th><th>${t('stats_header_words', 'Words')}</th></tr>`;
      const today = new Date().toISOString().slice(0, 10);
      Object.entries(days).sort((a,b) => b[0].localeCompare(a[0])).forEach(([date, wc]) => {
        const tr = document.createElement('tr');
        const suffix = date === today ? ' ' + t('stats_today_suffix', '← today') : '';
        tr.innerHTML = `<td>${date}${suffix}</td><td>${wc}</td>`;
        table.appendChild(tr);
      });
      body.appendChild(table);
    });

    document.getElementById('stats-dlg').showModal();
  }

  return { show };
})();
