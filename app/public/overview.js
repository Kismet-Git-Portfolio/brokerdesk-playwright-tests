// Overview: KPIs + notional by asset class + mini ticker.
async function loadStats() {
  const s = await (await fetch('/api/stats')).json();
  $('[data-testid=kpi-trades]').textContent = s.trades_today;
  $('[data-testid=kpi-unsettled]').textContent = s.unsettled;
  $('[data-testid=kpi-rejects]').textContent = s.rejects;
  $('[data-testid=kpi-fix]').textContent = s.fix_messages;
  $('[data-testid=kpi-stale]').textContent = s.stale_prices;
  const max = Math.max(1, ...s.by_asset_class.map((r) => r.notional));
  $('[data-testid=notional-by-class]').innerHTML = s.by_asset_class.map((r) =>
    '<div class="bar" data-testid="class-row" data-class="' + esc(r.asset_class) + '"><span class="bl">' + esc(r.asset_class) + ' <span class="sub small">(' + r.trades + ')</span></span>' +
    '<span class="bt"><span style="width:' + Math.max(3, (r.notional / max) * 100) + '%"></span></span><span class="bv num" data-testid="class-notional">' + fmt(r.notional) + '</span></div>').join('') ||
    '<p class="sub">No trades yet. Book one on the <a href="/trades">order ticket</a>.</p>';
}
async function loadTicker() {
  const q = await (await fetch('/api/prices')).json();
  $('[data-testid=ticker]').innerHTML = q.map((p) => '<div class="tk' + (p.stale ? ' stale' : '') + '"><strong>' + esc(p.symbol) + '</strong><span class="num">' +
    p.bid.toFixed(p.decimals) + ' / ' + p.ask.toFixed(p.decimals) + '</span>' + (p.stale ? '<span class="badge sell">STALE</span>' : '') + '</div>').join('');
}
loadStats(); loadTicker(); setInterval(loadTicker, 1000); setInterval(loadStats, 5000);
