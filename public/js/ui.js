/* Shared UI helpers: toast, html escaping, confirm */
function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

function money(n) {
  return '₹' + Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

let toastTimer = null;
function toast(msg, isError = false) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.toggle('err', isError);
  el.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.add('hidden'), 3500);
}

function confirmDialog(msg) {
  return window.confirm(msg);
}

function fmtDate(d) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

function progressBar(used, limit) {
  const pct = limit > 0 ? Math.min(100, Math.round((used / limit) * 100)) : 0;
  return `<span style="display:inline-flex;align-items:center;gap:8px">
    <span class="progress" style="width:120px"><span style="width:${pct}%"></span></span>
    <span>${used} / ${limit}</span>
  </span>`;
}

function statusChip(status) {
  const cls = {
    pending: 'amber',
    confirmed: 'blue',
    processing: 'blue',
    packed: 'blue',
    shipped: 'blue',
    out_for_delivery: 'blue',
    delivered: 'green',
    completed: 'green',
    cancelled: 'red',
    returned: 'red',
    failed: 'red',
  }[status] || '';
  const style = cls === 'blue' ? 'background:var(--blue-soft);color:var(--blue)' : '';
  return `<span class="chip ${cls}" ${cls === 'blue' ? `style="${style}"` : ''}>${esc(status)}</span>`;
}
