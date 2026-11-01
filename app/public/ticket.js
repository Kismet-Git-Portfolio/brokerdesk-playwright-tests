// Order ticket (RFQ): live market panel, client-side checks, idempotent submit, confirmation, today's orders.
let key = crypto.randomUUID();
const g = (t) => $('[data-testid=trade-' + t + ']').value;
const sideSel = $('[data-testid=trade-side]'), filt = $('[data-testid=blotter-filter]');
let mkt = null;
function syncSide() { $$('.seg button').forEach((b) => b.classList.toggle('on', b.dataset.side === sideSel.value)); }
$$('.seg button').forEach((b) => b.onclick = () => { sideSel.value = b.dataset.side; syncSide(); });
sideSel.addEventListener('change', syncSide);
$$('[data-inst]').forEach((b) => b.onclick = () => { $('[data-testid=trade-instrument]').value = b.dataset.inst; refreshMarket(); preview(); });
$('[data-testid=trade-instrument]').addEventListener('input', () => { refreshMarket(); });
async function refreshMarket() {
  const sym = g('instrument').trim().toUpperCase();
  $$('[data-inst]').forEach((c) => c.classList.toggle('on', c.dataset.inst === sym));
  const box = $('[data-testid=ticket-market]');
  if (!sym) { mkt = null; box.innerHTML = '<span class="sub">Pick an instrument to see the market.</span>'; return; }
  const r = await fetch('/api/prices/' + encodeURIComponent(sym));
  if (!r.ok) { mkt = null; box.innerHTML = '<span class="sub">No market data for ' + esc(sym) + '.</span>'; return; }
  mkt = await r.json();
  const d = mkt.decimals, lo = mkt.mid * (1 - mkt.tolerance_pct / 100), hi = mkt.mid * (1 + mkt.tolerance_pct / 100);
  box.innerHTML = '<div class="row between"><span><strong>' + esc(sym) + '</strong> <span class="sub small">' + esc(mkt.asset_class) + '</span></span>' +
    (mkt.stale ? '<span class="badge sell" data-testid="ticket-stale">STALE</span>' : '<span class="badge buy">LIVE</span>') + '</div>' +
    '<div class="row between" style="margin-top:.3rem"><button type="button" class="q bid" data-testid="use-bid" data-px="' + mkt.bid + '">Bid ' + mkt.bid.toFixed(d) + '</button>' +
    '<button type="button" class="q ask" data-testid="use-ask" data-px="' + mkt.ask + '">Ask ' + mkt.ask.toFixed(d) + '</button></div>' +
    '<div class="sub small" style="margin-top:.3rem">Tolerance ±' + mkt.tolerance_pct + '%: <span data-testid="tolerance-band">' + lo.toFixed(d) + ' – ' + hi.toFixed(d) + '</span></div>';
  $$('.q').forEach((b) => b.onclick = () => { $('[data-testid=trade-price]').value = b.dataset.px; preview(); });
}
setInterval(() => { if (g('instrument').trim()) refreshMarket(); }, 2000);
function check(v) { if (v.trim() === '') return ''; const n = Number(v); if (!Number.isFinite(n)) return 'Must be a number'; if (n <= 0) return 'Must be greater than 0'; return ''; }
function preview() {
  const hp = check(g('price')), hq = check(g('quantity'));
  let warn = hp;
  if (!hp && g('price') && mkt) { const off = Math.abs(Number(g('price')) - mkt.mid) / mkt.mid * 100; if (off > mkt.tolerance_pct) warn = 'Outside ±' + mkt.tolerance_pct + '% band'; }
  $('#h-price').textContent = warn; $('#h-qty').textContent = hq;
  $('[data-testid=trade-price]').classList.toggle('invalid', !!warn); $('[data-testid=trade-quantity]').classList.toggle('invalid', !!hq);
  const p = Number(g('price')), q = Number(g('quantity'));
  $('#notional-preview').textContent = (!hp && !hq && g('price') && g('quantity')) ? fmt(Math.round((p * q + Number.EPSILON) * 100) / 100) : '—';
}
['price', 'quantity'].forEach((t) => $('[data-testid=trade-' + t + ']').addEventListener('input', preview));
function syncChips() { $$('[data-f]').forEach((c) => c.classList.toggle('on', c.dataset.f === filt.value)); }
$$('[data-f]').forEach((c) => c.onclick = () => { filt.value = c.dataset.f; syncChips(); load(); });
filt.addEventListener('change', () => { syncChips(); load(); });
function load() {
  const s = filt.value;
  fetch('/api/trades' + (s ? '?side=' + s : '')).then((r) => r.json()).then((l) => {
    $('#tb').innerHTML = l.map((t) => '<tr data-testid="trade-row" data-id="' + esc(t.id) + '"><td><a class="kbd" href="/trades/' + encodeURIComponent(t.id) + '">' + esc(t.id) + '</a></td>' +
      '<td data-testid="trade-row-instrument"><strong>' + esc(t.instrument) + '</strong></td><td data-testid="trade-row-side"><span class="badge ' + t.side + '">' + t.side + '</span></td>' +
      '<td class="num" data-testid="trade-row-price">' + t.price + '</td><td class="num" data-testid="trade-row-qty">' + t.quantity + '</td>' +
      '<td class="num" data-testid="trade-row-notional">' + money(t.notional) + '</td><td><span class="badge st-' + t.status + '">' + t.status + '</span></td></tr>').join('') ||
      '<tr><td colspan="7" class="sub">No orders yet.</td></tr>';
  });
}
async function book() {
  const btn = $('[data-testid=trade-submit]'); if (btn.disabled) return; btn.disabled = true;
  $('[data-testid=trade-error]').textContent = '';
  const r = await post('/api/orders', { instrument: g('instrument'), side: g('side'), price: g('price'), quantity: g('quantity'),
    client: g('client'), counterparty: g('counterparty'), venue: g('venue') }, key);
  if (r.ok) {
    key = crypto.randomUUID(); load();
    const t = r.body, c = $('[data-testid=order-confirmation]');
    c.hidden = false;
    c.innerHTML = '<div class="row between"><strong>✓ Order accepted</strong><span class="badge st-' + t.status + '">' + t.status + '</span></div>' +
      '<div class="kv small"><span>Trade ID</span><a data-testid="confirm-trade-id" href="/trades/' + encodeURIComponent(t.id) + '">' + esc(t.id) + '</a>' +
      '<span>ClOrdID (11)</span><span class="kbd" data-testid="confirm-clordid">' + esc(t.cl_ord_id) + '</span>' +
      '<span>Order</span><span>' + t.side.toUpperCase() + ' ' + t.quantity + ' ' + esc(t.instrument) + ' @ ' + t.price + '</span>' +
      '<span>Notional</span><span>' + fmt(t.notional) + '</span></div>' +
      '<div class="row" style="margin-top:.5rem"><a href="/trades/' + encodeURIComponent(t.id) + '">Lifecycle →</a><a data-testid="confirm-fix" href="/fix?trade=' + encodeURIComponent(t.id) + '">FIX messages →</a></div>';
    const toast = $('#toast'); toast.textContent = 'Booked ' + t.side.toUpperCase() + ' ' + t.instrument + ' · notional ' + fmt(t.notional); setTimeout(() => toast.textContent = '', 2500);
  } else $('[data-testid=trade-error]').textContent = r.body.error;
  btn.disabled = false;
}
load();
