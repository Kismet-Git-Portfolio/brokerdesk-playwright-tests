// Trade detail: lifecycle actions, amend, audit trail, FIX messages.
const tid = $('#trade-root').dataset.trade;
const FLOW = ['NEW', 'CONFIRMED', 'SETTLED'];
const ALLOWED = { confirm: ['NEW'], settle: ['CONFIRMED', 'FAILED'], fail: ['CONFIRMED'], cancel: ['NEW', 'CONFIRMED'] };
async function load() {
  const r = await fetch('/api/trades/' + encodeURIComponent(tid));
  if (!r.ok) { $('[data-testid=trade-title]').textContent = 'Trade not found'; return; }
  const t = await r.json();
  $('[data-testid=trade-title]').textContent = t.side.toUpperCase() + ' ' + t.quantity + ' ' + t.instrument + ' @ ' + t.price;
  const b = $('[data-testid=trade-status]'); b.textContent = t.status; b.className = 'badge st-' + t.status;
  const steps = t.status === 'FAILED' || t.status === 'CANCELLED' ? ['NEW', 'CONFIRMED', t.status] : FLOW;
  const idx = steps.indexOf(t.status);
  $('[data-testid=stepper]').innerHTML = steps.map((s, i) => '<span class="step ' + (i < idx ? 'done' : i === idx ? 'cur st-' + s : '') + '">' + s + '</span>').join('<span class="arrow">→</span>');
  $('[data-testid=trade-fields]').innerHTML = [['Trade ID', t.id], ['ClOrdID', t.cl_ord_id], ['Asset class', t.asset_class], ['Notional', fmt(t.notional)], ['Client', t.client || '—'],
    ['Counterparty', t.counterparty || '—'], ['Venue', t.venue], ['Settlement', t.settlement ? t.settlement.status + (t.settlement.settled_on ? ' · ' + t.settlement.settled_on : '') : 'none']]
    .map(([k, v]) => '<span>' + k + '</span><span data-testid="field-' + k.toLowerCase().replace(/\W+/g, '-') + '">' + esc(v) + '</span>').join('');
  $$('[data-act]').forEach((btn) => btn.disabled = !ALLOWED[btn.dataset.act].includes(t.status));
  $('[data-testid=action-amend]').disabled = t.status !== 'NEW';
  if (!$('[data-testid=amend-qty]').value) { $('[data-testid=amend-qty]').value = t.quantity; $('[data-testid=amend-price]').value = t.price; }
  $('[data-testid=audit]').innerHTML = t.audit.map((a) => '<li data-testid="audit-row"><strong data-testid="audit-action">' + esc(a.action) + '</strong> <span class="sub small">' +
    esc(a.from_status || '∅') + ' → ' + esc(a.to_status) + '</span><div class="sub small">' + esc(new Date(a.at).toLocaleTimeString('en-GB')) + (a.detail ? ' · ' + esc(a.detail) : '') + '</div></li>').join('');
  $('[data-testid=trade-fix]').innerHTML = t.fix.map((m) => '<div class="fixmsg" data-testid="trade-fix-msg" data-type="' + esc(m.msg_type) + '"><span class="badge blue">35=' + esc(m.msg_type) + '</span><code>' + esc(m.raw) + '</code></div>').join('');
}
async function act(a, body) {
  $('[data-testid=action-error]').textContent = '';
  const r = await post('/api/trades/' + encodeURIComponent(tid) + '/' + a, body || {});
  if (!r.ok) $('[data-testid=action-error]').textContent = r.body.error;
  load();
}
$$('[data-act]').forEach((b) => b.onclick = () => act(b.dataset.act));
function amend() { act('amend', { quantity: $('[data-testid=amend-qty]').value, price: $('[data-testid=amend-price]').value }); }
load();
