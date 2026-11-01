// Full blotter with asset class + status filters (server-side filtering via /api/trades).
const ac = $('[data-testid=blotter-asset]'), st = $('[data-testid=blotter-status]');
function syncChips() { $$('[data-ac]').forEach((c) => c.classList.toggle('on', c.dataset.ac === ac.value)); }
$$('[data-ac]').forEach((c) => c.onclick = () => { ac.value = c.dataset.ac; syncChips(); load(); });
ac.addEventListener('change', () => { syncChips(); load(); });
st.addEventListener('change', load);
async function load() {
  const qs = new URLSearchParams(); if (ac.value) qs.set('asset_class', ac.value); if (st.value) qs.set('status', st.value);
  const l = await (await fetch('/api/trades?' + qs)).json();
  $('#fb').innerHTML = l.map((t) => '<tr data-testid="trade-row" data-id="' + esc(t.id) + '"><td><a class="kbd" data-testid="trade-link" href="/trades/' + encodeURIComponent(t.id) + '">' + esc(t.id) + '</a></td>' +
    '<td data-testid="trade-row-instrument"><strong>' + esc(t.instrument) + '</strong></td><td data-testid="trade-row-class">' + esc(t.asset_class) + '</td>' +
    '<td data-testid="trade-row-side"><span class="badge ' + t.side + '">' + t.side + '</span></td><td class="num" data-testid="trade-row-price">' + t.price + '</td>' +
    '<td class="num" data-testid="trade-row-qty">' + t.quantity + '</td><td class="num" data-testid="trade-row-notional">' + money(t.notional) + '</td>' +
    '<td>' + esc(t.client || '—') + '</td><td>' + esc(t.counterparty || '—') + '</td><td>' + esc(t.venue) + '</td>' +
    '<td data-testid="trade-row-status"><span class="badge st-' + t.status + '">' + t.status + '</span></td></tr>').join('') || '<tr><td colspan="11" class="sub">No trades match.</td></tr>';
  const tot = l.reduce((s, t) => s + t.notional, 0);
  $('[data-testid=blotter-summary]').textContent = l.length + ' trade(s) · total notional ' + fmt(Math.round(tot * 100) / 100);
}
load();
