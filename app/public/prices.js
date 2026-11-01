// Price board: polls /api/prices every second, flashes up/down ticks, shows STALE when a feed stops.
const last = {};
async function tick() {
  const q = await (await fetch('/api/prices')).json();
  $('#pb').innerHTML = q.map((p) => {
    const dir = last[p.symbol] == null ? '' : p.mid > last[p.symbol] ? 'up' : p.mid < last[p.symbol] ? 'down' : '';
    last[p.symbol] = p.mid;
    const t = new Date(p.ts);
    return '<tr data-testid="price-row" data-symbol="' + esc(p.symbol) + '" class="' + (p.stale ? 'stale' : dir) + '">' +
      '<td><strong>' + esc(p.symbol) + '</strong><div class="sub small">' + esc(p.description) + '</div></td><td><span class="badge blue">' + esc(p.asset_class) + '</span></td>' +
      '<td class="num px" data-testid="price-bid">' + p.bid.toFixed(p.decimals) + '</td><td class="num px" data-testid="price-ask">' + p.ask.toFixed(p.decimals) + '</td>' +
      '<td class="num sub">' + (p.ask - p.bid).toFixed(p.decimals) + '</td>' +
      '<td data-testid="price-ts" data-ts="' + esc(p.ts) + '"><span class="kbd">' + t.toLocaleTimeString('en-GB') + '.' + String(t.getMilliseconds()).padStart(3, '0') + '</span> <span class="sub small">' + (p.age_ms / 1000).toFixed(1) + 's ago</span></td>' +
      '<td data-testid="price-status">' + (p.stale ? '<span class="badge sell">STALE</span>' : '<span class="badge buy">LIVE</span>') + '</td>' +
      '<td>' + (p.stale ? '<button class="chip" data-testid="price-resume" data-sym="' + esc(p.symbol) + '" data-op="resume">Restore feed</button>'
        : '<button class="chip" data-testid="price-freeze" data-sym="' + esc(p.symbol) + '" data-op="freeze">Simulate outage</button>') + '</td></tr>';
  }).join('');
  $('[data-testid=board-clock]').textContent = 'Updated ' + new Date().toLocaleTimeString('en-GB');
}
$('#pb').addEventListener('click', async (e) => { const b = e.target.closest('[data-op]'); if (!b) return;
  await fetch('/api/prices/' + encodeURIComponent(b.dataset.sym) + '/' + b.dataset.op, { method: 'POST' }); tick(); });
tick(); setInterval(tick, 1000);
