// FIX log viewer: list + parsed tag table with tag names.
const NAMES = { 8: 'BeginString', 9: 'BodyLength', 35: 'MsgType', 49: 'SenderCompID', 56: 'TargetCompID', 34: 'MsgSeqNum', 52: 'SendingTime', 11: 'ClOrdID', 41: 'OrigClOrdID',
  1: 'Account', 55: 'Symbol', 54: 'Side', 38: 'OrderQty', 40: 'OrdType', 44: 'Price', 59: 'TimeInForce', 60: 'TransactTime', 37: 'OrderID', 17: 'ExecID', 150: 'ExecType',
  39: 'OrdStatus', 32: 'LastQty', 31: 'LastPx', 14: 'CumQty', 151: 'LeavesQty', 6: 'AvgPx', 10: 'CheckSum' };
const ENUMS = { 35: { D: 'NewOrderSingle', 8: 'ExecutionReport', G: 'OrderCancelReplaceRequest', F: 'OrderCancelRequest' }, 54: { 1: 'Buy', 2: 'Sell' }, 40: { 2: 'Limit' },
  59: { 0: 'Day' }, 150: { 0: 'New', 4: 'Canceled', 5: 'Replaced', F: 'Trade (fill)' }, 39: { 0: 'New', 2: 'Filled', 4: 'Canceled' } };
const TYPE = { D: 'NewOrderSingle', 8: 'ExecutionReport', G: 'CancelReplace', F: 'CancelRequest' };
const filter = $('[data-testid=fix-filter]');
filter.value = new URLSearchParams(location.search).get('trade') || '';
let msgs = [];
const tag = (m, t) => (m.tags.find(([k]) => k === String(t)) || [])[1];
async function load() {
  const q = filter.value.trim();
  msgs = await (await fetch('/api/fix' + (q ? '?trade_id=' + encodeURIComponent(q) : ''))).json();
  $('#fx').innerHTML = msgs.map((m) => {
    const sum = m.msg_type === '8' ? 'ExecType ' + (ENUMS[150][tag(m, 150)] || tag(m, 150)) + ' · OrdStatus ' + (ENUMS[39][tag(m, 39)] || tag(m, 39))
      : (ENUMS[54][tag(m, 54)] || '') + ' ' + (tag(m, 38) || '') + ' ' + tag(m, 55) + (tag(m, 44) ? ' @ ' + tag(m, 44) : '');
    return '<tr data-testid="fix-row" data-id="' + m.id + '" data-type="' + esc(m.msg_type) + '" data-trade="' + esc(m.trade_id || '') + '" class="clickable">' +
      '<td class="sub">' + tag(m, 34) + '</td><td class="sub small">' + esc(new Date(m.sent_at).toLocaleTimeString('en-GB')) + '</td>' +
      '<td><span class="badge ' + (m.msg_type === '8' ? 'teal' : 'blue') + '">35=' + esc(m.msg_type) + '</span> <span class="small">' + TYPE[m.msg_type] + '</span></td>' +
      '<td><span class="kbd">' + esc(m.trade_id || '') + '</span></td><td class="small">' + esc(sum) + '</td></tr>';
  }).join('') || '<tr><td colspan="5" class="sub">No FIX messages yet. Submit an order on the ticket.</td></tr>';
}
function show(idv) {
  const m = msgs.find((x) => String(x.id) === String(idv)); if (!m) return;
  $$('[data-testid=fix-row]').forEach((r) => r.classList.toggle('sel', r.dataset.id === String(idv)));
  $('[data-testid=fix-raw]').textContent = m.raw;
  $('#ft').innerHTML = m.tags.map(([k, v]) => '<tr data-testid="fix-tag" data-tag="' + esc(k) + '"><td class="kbd">' + esc(k) + '</td><td>' + (NAMES[k] || '') + '</td>' +
    '<td data-testid="fix-tag-value">' + esc(v) + (ENUMS[k] && ENUMS[k][v] ? ' <span class="sub small">(' + ENUMS[k][v] + ')</span>' : '') + '</td></tr>').join('');
}
$('#fx').addEventListener('click', (e) => { const r = e.target.closest('[data-testid=fix-row]'); if (r) show(r.dataset.id); });
filter.addEventListener('input', load);
load();
