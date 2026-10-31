// Tiny self-contained mock "gig shifts" + trade booking app. In-memory only. Demo data, no real systems.
const express = require('express');
const crypto = require('crypto');

const PORT = Number(process.env.PORT || 3100);
const USER = process.env.DEMO_USER || 'demo.user@example.com';
const PASS = process.env.DEMO_PASSWORD || 'Demo#Pass123';

const app = express();
app.use(express.json());

const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;
const id = () => crypto.randomUUID().slice(0, 8);

let db;
function reset() {
  db = {
    sessions: new Set(),
    jobs: [
      { id: 'job-1', title: 'Warehouse Picker', location: 'Makati', type: 'job' },
      { id: 'job-2', title: 'Event Staff', location: 'Taguig', type: 'job' },
    ],
    shifts: [],
    applicants: {},  // jobId -> [{name,email}]
    payouts: [],
    trades: [],
    idem: {},        // idempotency key -> stored response
  };
}
reset();

// ---------- helpers ----------
const num = (v) => (typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN);
function cookieToken(req) {
  const m = /(?:^|;\s*)session=([^;]+)/.exec(req.headers.cookie || '');
  return m && m[1];
}
const authed = (req) => db.sessions.has(cookieToken(req));
function idempotent(req, res, create) {
  const key = req.get('Idempotency-Key');
  if (key && db.idem[key]) return res.status(200).json({ ...db.idem[key], duplicate: true });
  const result = create();
  if (result.error) return res.status(400).json(result);
  if (key) db.idem[key] = result;
  return res.status(201).json(result);
}

// ---------- API ----------
app.get('/health', (_req, res) => res.json({ ok: true }));
app.post('/api/reset', (_req, res) => { reset(); res.json({ ok: true }); });

app.post('/api/login', (req, res) => {
  const { username, password } = req.body || {};
  if (username !== USER || password !== PASS) return res.status(401).json({ error: 'Invalid email or password' });
  const t = crypto.randomUUID();
  db.sessions.add(t);
  res.set('Set-Cookie', `session=${t}; Path=/; HttpOnly`).json({ ok: true });
});
app.post('/api/logout', (req, res) => {
  db.sessions.delete(cookieToken(req));
  res.set('Set-Cookie', 'session=; Path=/; Max-Age=0').json({ ok: true });
});

app.get('/api/jobs', (_req, res) => res.json({ jobs: db.jobs, shifts: db.shifts }));

app.post('/api/shifts', (req, res) => {
  const { title, location } = req.body || {};
  const base = num(req.body.base), allowance = num(req.body.allowance ?? 0), special = num(req.body.special ?? 0);
  if (!title || !location) return res.status(400).json({ error: 'Title and location are required' });
  if ([base, allowance, special].some((n) => !Number.isFinite(n) || n < 0) || base <= 0)
    return res.status(400).json({ error: 'Compensation must be valid positive numbers' });
  const shift = { id: 'shift-' + id(), title, location, base, allowance, special, gross: round2(base + allowance + special), type: 'shift' };
  db.shifts.push(shift);
  res.status(201).json(shift);
});

app.post('/api/jobs/:id/apply', (req, res) => {
  const job = [...db.jobs, ...db.shifts].find((j) => j.id === req.params.id);
  if (!job) return res.status(404).json({ error: 'Not found' });
  const { name, email } = req.body || {};
  if (!name || !email) return res.status(400).json({ error: 'Name and email are required' });
  const list = (db.applicants[job.id] ||= []);
  if (list.some((a) => a.email === email)) return res.status(409).json({ error: 'Already applied' });
  list.push({ name, email });
  res.status(201).json({ ok: true, count: list.length });
});
app.get('/api/jobs/:id/applicants', (req, res) => res.json(db.applicants[req.params.id] || []));

app.get('/api/payouts', (_req, res) => res.json(db.payouts));
app.post('/api/payouts', (req, res) =>
  idempotent(req, res, () => {
    const { worker } = req.body || {};
    const base = num(req.body.base), allowance = num(req.body.allowance ?? 0), special = num(req.body.special ?? 0);
    if (!worker || [base, allowance, special].some((n) => !Number.isFinite(n) || n < 0))
      return { error: 'Invalid payout' };
    // payout = sum of components (a double-payout bug would show up here as 2x)
    const p = { id: 'pay-' + id(), worker, base, allowance, special, amount: round2(base + allowance + special) };
    db.payouts.push(p);
    return p;
  })
);

app.get('/api/trades', (req, res) => {
  const side = req.query.side;
  res.json(side ? db.trades.filter((t) => t.side === side) : db.trades);
});
app.post('/api/trades', (req, res) =>
  idempotent(req, res, () => {
    const { instrument, side } = req.body || {};
    const price = num(req.body.price), quantity = num(req.body.quantity);
    if (!instrument || !String(instrument).trim()) return { error: 'Instrument is required' };
    if (side !== 'buy' && side !== 'sell') return { error: 'Side must be buy or sell' };
    if (!Number.isFinite(price) || price <= 0) return { error: 'Price must be a positive number' };
    if (!Number.isFinite(quantity) || quantity <= 0) return { error: 'Quantity must be a positive number' };
    const t = { id: 'trd-' + id(), instrument: String(instrument).trim().toUpperCase(), side, price, quantity, notional: round2(price * quantity) };
    db.trades.push(t);
    return t;
  })
);

// ---------- UI ----------
// ShiftDesk QA Showcase: plain HTML + CSS + vanilla JS, no build step.
const path = require('path');
app.use('/static', express.static(path.join(__dirname, 'public')));

const NAV = [
  ['QA Showcase', [['/', 'Overview', '◎']]],
  ['Gig Platform', [['/jobs', 'Jobs board', '▦'], ['/shifts/new', 'Create shift', '＋'], ['/payouts', 'Payouts', '₱']]],
  ['Trading Desk', [['/trades', 'Trade booking', '⇅']]],
];
const head = (title) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title} · ShiftDesk QA Showcase</title><link rel="stylesheet" href="/static/styles.css"></head>`;
const helpers = `const $=(s)=>document.querySelector(s);const $$=(s)=>[...document.querySelectorAll(s)];
const esc=(v)=>String(v).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
async function post(url,data,key){const h={'Content-Type':'application/json'};if(key)h['Idempotency-Key']=key;const r=await fetch(url,{method:'POST',headers:h,body:JSON.stringify(data)});return {ok:r.ok,body:await r.json()};}
const money=(n)=>Number(n).toFixed(2);const fmt=(n)=>Number(n).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});
const initials=(n)=>String(n).split(/\\s+/).slice(0,2).map(w=>w[0]||'').join('').toUpperCase();`;

const page = (active, title, subtitle, body, script = '') => `${head(title)}<body><div class="shell">
<aside class="side" data-testid="nav"><div class="brand"><div class="logo">SD</div><div>ShiftDesk<small>QA Showcase</small></div></div>
${NAV.map(([g, items]) => `<div class="navgroup">${g}</div>` + items.map(([href, label, ic]) => `<a href="${href}" class="${active === href ? 'active' : ''}"><span>${ic}</span>${label}</a>`).join('')).join('')}
<div class="spacer"></div><button class="btn ghost" data-testid="logout" onclick="fetch('/api/logout',{method:'POST'}).then(()=>location='/login')">Log out</button></aside>
<main><div class="topline"><div><h1>${title}</h1><p class="sub">${subtitle}</p></div></div>${body}</main></div>
<script>${helpers}${script}</script></body></html>`;

const guard = (req, res, next) => (authed(req) ? next() : res.redirect('/login'));

app.get('/login', (_req, res) => res.send(`${head('Sign in')}<body class="login"><div class="card">
<div class="brand"><div class="logo">SD</div><div>ShiftDesk<small>QA Showcase</small></div></div>
<h1>Welcome back</h1><p class="sub" style="margin-bottom:1rem">Sign in to the demo workspace.</p>
<form data-testid="login-form" onsubmit="event.preventDefault();login()">
<label class="f">Email <input data-testid="login-email" name="username" autocomplete="username" placeholder="demo.user@example.com"></label>
<label class="f">Password <input data-testid="login-password" type="password" name="password" autocomplete="current-password"></label>
<button class="btn" data-testid="login-submit" type="submit">Sign in</button><p class="error" data-testid="login-error"></p></form>
<p class="sub" style="font-size:.8rem">Demo credentials come from env vars (see <span class="kbd">.env.example</span>).</p></div>
<script>async function login(){const r=await fetch('/api/login',{method:'POST',headers:{'Content-Type':'application/json'},
body:JSON.stringify({username:document.querySelector('[name=username]').value,password:document.querySelector('[name=password]').value})});
if(r.ok)location='/jobs';else document.querySelector('[data-testid=login-error]').textContent=(await r.json()).error;}</script></body></html>`));

const COVERAGE = [
  ['Auth', 'Valid login, invalid password error, logout + protected-route redirect', 'tests/ui/auth.spec.ts'],
  ['Jobs board', 'Seeded listings render; slow network (page.route delay) shows loading skeleton', 'tests/ui/jobs.spec.ts'],
  ['Job applications', 'Apply flow, duplicate apply blocked, batch of 10 applicants via API verified in UI', 'tests/ui/jobs.spec.ts'],
  ['Shift creation', 'Live gross total = base + allowance + special; UI == API == listing; negative pay rejected', 'tests/ui/shifts.spec.ts'],
  ['Payouts', 'Double-payout check: expected == API == UI; decimal-safe sums; idempotent submit', 'tests/ui/payouts.spec.ts, tests/api/payouts.api.spec.ts'],
  ['Trade validation', 'Negative, zero and non-numeric price/qty rejected, nothing booked', 'tests/ui/trades.spec.ts, tests/api/trades.api.spec.ts'],
  ['Notional math', 'price × qty rounded to 2 dp, tricky decimals (0.1×0.2, 1.005×1000, 99.875×3)', 'tests/api/trades.api.spec.ts, tests/ui/trades.spec.ts'],
  ['Double-submit', 'Rapid double click books exactly one trade; same Idempotency-Key creates one record', 'tests/ui/trades.spec.ts, tests/api/trades.api.spec.ts'],
  ['Blotter', 'Row values == API values; buy/sell filter', 'tests/ui/trades.spec.ts'],
  ['Performance', 'K6 smoke/load on /api/trades, p95 < 500 ms, errors < 1%', 'k6/load-trades.js'],
];
app.get('/', guard, (_req, res) => res.send(page('/', 'QA Showcase', 'Playwright + TypeScript automation against a realistic gig platform and a trading desk.',
  `<div class="hero"><span class="badge teal">34 automated tests · CI on every push</span><h1 style="margin-top:.6rem">What this demo proves</h1>
<p class="sub" style="max-width:760px">End-to-end UI and API automation with page objects, fixtures, <span class="kbd">data-testid</span> locators, env-based credentials and GitHub Actions. Every money figure is checked in three places: the expected value, the API, and the screen.</p></div>
<div class="grid g2" style="margin-bottom:1.25rem">
<div class="card"><span class="badge blue">Gig Platform</span><h2 style="margin-top:.6rem">Shifts, applicants &amp; payouts</h2>
<p class="sub">Jobs board, shift creation with live gross pay, applications (including a 10-applicant batch set up via API), and a payouts dashboard with statements. Mirrors flows I automated in production QA work.</p>
<div class="row" style="margin-top:.8rem"><a class="btn" href="/jobs">Open jobs board</a><a class="btn ghost" href="/payouts">Payouts</a></div></div>
<div class="card"><span class="badge buy">Trading Desk</span><h2 style="margin-top:.6rem">Trade booking &amp; blotter</h2>
<p class="sub">Instrument picker, buy/sell toggle, live notional preview, validation, idempotent booking and a filterable blotter: the accuracy and reliability checks a financial markets QA engineer owns.</p>
<div class="row" style="margin-top:.8rem"><a class="btn" href="/trades">Open trading desk</a></div></div></div>
<div class="card"><h2>Test coverage</h2><div class="tablewrap"><table data-testid="coverage-table"><thead><tr><th>Feature</th><th>What's tested</th><th>Test file</th></tr></thead><tbody>
${COVERAGE.map(([f, w, t]) => `<tr><td><strong>${f}</strong></td><td>${w}</td><td><span class="kbd">${t}</span></td></tr>`).join('')}</tbody></table></div></div>`)));

app.get('/jobs', guard, (_req, res) => res.send(page('/jobs', 'Jobs and shifts', 'Open roles and published shifts. Data loads from /api/jobs.',
  `<div data-testid="loading" class="grid g3" aria-busy="true"><span class="sub" style="grid-column:1/-1">Loading...</span><div class="sk" style="height:150px"></div><div class="sk" style="height:150px"></div><div class="sk" style="height:150px"></div></div>
<div data-testid="jobs-table" class="grid g3" hidden></div>`,
  `fetch('/api/jobs').then(r=>r.json()).then(d=>{const all=[...d.jobs,...d.shifts];
$('[data-testid=jobs-table]').innerHTML=all.map(j=>'<div class="card jobcard" data-testid="job-row" data-id="'+esc(j.id)+'"><div class="row between"><span class="badge '+(j.type==='shift'?'teal':'blue')+'">'+j.type+'</span><span class="meta">'+esc(j.id)+'</span></div><h2 data-testid="job-title" style="margin:0">'+esc(j.title)+'</h2><div class="meta">📍 '+esc(j.location)+'</div>'+
(j.gross!=null?'<div class="meta">Gross pay ₱ <strong data-testid="job-gross" style="color:var(--text)">'+money(j.gross)+'</strong></div>':'<div class="meta">Gross pay <span data-testid="job-gross"></span>—</div>')+
'<a class="btn" style="text-align:center;text-decoration:none;margin-top:.4rem" data-testid="job-open" href="/jobs/'+encodeURIComponent(j.id)+'">Open</a></div>').join('')||'<p class="sub">No listings yet.</p>';
$('[data-testid=loading]').remove();$('[data-testid=jobs-table]').hidden=false;});`)));

app.get('/shifts/new', guard, (_req, res) => res.send(page('/shifts/new', 'Create shift', 'Compensation is summed live; the backend must agree to the centavo.',
  `<div class="grid g2"><form class="card" data-testid="shift-form" onsubmit="event.preventDefault();save()">
<div class="grid g2"><label class="f">Title <input data-testid="shift-title" placeholder="Night Shift"></label><label class="f">Location <input data-testid="shift-location" placeholder="Pasig"></label></div>
<h2 style="margin-top:1rem">Compensation (₱)</h2><div class="grid g3"><label class="f">Base <input data-testid="shift-base" value="0" inputmode="decimal"></label><label class="f">Allowance <input data-testid="shift-allowance" value="0" inputmode="decimal"></label><label class="f">Special <input data-testid="shift-special" value="0" inputmode="decimal"></label></div>
<div class="total"><span>Gross total</span><span>₱ <strong data-testid="shift-gross">0.00</strong></span></div>
<button class="btn" data-testid="shift-submit">Publish shift</button><p class="error" data-testid="shift-error" style="margin-top:.8rem"></p></form>
<div class="card"><h2>How it's tested</h2><p class="sub">The test types 750 + 120.50 + 49.25, expects <span class="kbd">919.75</span> on screen, publishes, then checks the API saved 919.75 and the jobs board shows the same.</p><p class="sub">Negative values are rejected server-side.</p></div></div>
<div class="toast" data-testid="toast"></div>`,
  `const v=(t)=>$('[data-testid=shift-'+t+']').value;
function calc(){const g=['base','allowance','special'].reduce((s,k)=>s+(Number(v(k))||0),0);$('[data-testid=shift-gross]').textContent=money(g);}
$$('input').forEach(i=>i.addEventListener('input',calc));
async function save(){$('[data-testid=shift-error]').textContent='';const r=await post('/api/shifts',{title:v('title'),location:v('location'),base:v('base'),allowance:v('allowance'),special:v('special')});
if(r.ok){$('[data-testid=toast]').textContent='New shift added!';$('[data-testid=toast]').dataset.id=r.body.id;}else $('[data-testid=shift-error]').textContent=r.body.error;}`)));

app.get('/jobs/:id', guard, (req, res) => res.send(page('/jobs', 'Job details', 'Apply and see applicants in real time.',
  `<div class="grid g2"><form class="card" data-testid="apply-form" onsubmit="event.preventDefault();apply()">
<div class="row between"><h2 style="margin:0">Apply</h2><span class="badge blue" data-testid="job-id">${req.params.id.replace(/[^\w-]/g, '')}</span></div>
<div class="grid" style="margin-top:.8rem"><label class="f">Name <input data-testid="apply-name"></label><label class="f">Email <input data-testid="apply-email"></label>
<button class="btn" data-testid="apply-submit">Apply</button><p class="sub" data-testid="apply-status"></p></div></form>
<div class="card"><h2>Applicants <span class="badge teal" data-testid="applicant-count">0</span></h2><ul class="people" data-testid="applicants"></ul></div></div>`,
  `const jid=$('[data-testid=job-id]').textContent;
function load(){fetch('/api/jobs/'+jid+'/applicants').then(r=>r.json()).then(l=>{$('[data-testid=applicant-count]').textContent=l.length;$('[data-testid=applicants]').innerHTML=l.map(a=>'<li data-testid="applicant"><span class="avatar">'+esc(initials(a.name))+'</span><span><strong>'+esc(a.name)+'</strong><br><span class="sub">&lt;'+esc(a.email)+'&gt;</span></span></li>').join('')||'<li class="sub">No applicants yet.</li>';});}
async function apply(){const r=await post('/api/jobs/'+jid+'/apply',{name:$('[data-testid=apply-name]').value,email:$('[data-testid=apply-email]').value});
$('[data-testid=apply-status]').textContent=r.ok?'Application sent!':r.body.error;load();}load();`)));

app.get('/payouts', guard, (_req, res) => res.send(page('/payouts', 'Payouts', 'Every payout = base + allowance + special. Checked against the API and expected value.',
  `<div class="grid g4" style="margin-bottom:1rem"><div class="card stat"><div class="label">Total paid out</div><div class="value" id="s-total">₱ 0.00</div></div>
<div class="card stat"><div class="label">Payouts</div><div class="value" id="s-count">0</div></div><div class="card stat"><div class="label">Average</div><div class="value" id="s-avg">₱ 0.00</div></div>
<div class="card stat"><div class="label">Integrity check</div><div class="value"><span class="badge buy">UI = API</span></div></div></div>
<div class="tablewrap"><table data-testid="payouts-table"><thead><tr><th>Payout</th><th>Worker</th><th class="num">Base</th><th class="num">Allowance</th><th class="num">Special</th><th class="num">Amount</th><th></th></tr></thead><tbody></tbody></table></div>`,
  `fetch('/api/payouts').then(r=>r.json()).then(l=>{const tot=l.reduce((s,p)=>s+p.amount,0);$('#s-total').textContent='₱ '+fmt(tot);$('#s-count').textContent=l.length;$('#s-avg').textContent='₱ '+fmt(l.length?tot/l.length:0);
$('tbody').innerHTML=l.map(p=>'<tr data-testid="payout-row" data-id="'+esc(p.id)+'"><td><span class="kbd">'+esc(p.id)+'</span></td><td data-testid="payout-worker">'+esc(p.worker)+'</td><td class="num">'+money(p.base)+'</td><td class="num">'+money(p.allowance)+'</td><td class="num">'+money(p.special)+'</td><td class="num" data-testid="payout-amount">'+money(p.amount)+'</td><td><a href="/payouts/'+encodeURIComponent(p.id)+'">Statement</a></td></tr>').join('')||'<tr><td colspan="7" class="sub">No payouts yet.</td></tr>';});`)));

app.get('/payouts/:id', guard, (req, res) => res.send(page('/payouts', 'Payout statement', 'PDF-style statement. The total here is what QA compares with the database.',
  `<div class="statement" id="stmt"><p class="sub">Loading...</p></div><p style="margin-top:1rem"><a href="/payouts">← Back to payouts</a> · <a href="#" onclick="print();return false">Print / save as PDF</a></p>`,
  `const pid=${JSON.stringify(req.params.id)};fetch('/api/payouts').then(r=>r.json()).then(l=>{const p=l.find(x=>x.id===pid);if(!p){$('#stmt').innerHTML='<p>Statement not found.</p>';return;}
$('#stmt').innerHTML='<div style="display:flex;justify-content:space-between"><div><h3>ShiftDesk</h3><div style="color:#6b7280">Payout statement</div></div><div style="text-align:right"><div><strong>'+esc(p.id)+'</strong></div><div style="color:#6b7280">'+new Date().toLocaleDateString()+'</div></div></div><hr style="margin:1.2rem 0;border:0;border-top:1px solid #e5e7eb"><p>Paid to: <strong>'+esc(p.worker)+'</strong></p><table><thead><tr><th>Component</th><th class="num">Amount (₱)</th></tr></thead><tbody><tr><td>Base pay</td><td class="num">'+fmt(p.base)+'</td></tr><tr><td>Allowance</td><td class="num">'+fmt(p.allowance)+'</td></tr><tr><td>Special pay</td><td class="num">'+fmt(p.special)+'</td></tr><tr class="tot"><td>Total payout</td><td class="num" data-testid="statement-total">'+fmt(p.amount)+'</td></tr></tbody></table><p style="color:#6b7280;font-size:.8rem;margin-top:1.2rem">Demo document. Total must equal the sum of components and the API record.</p>';});`)));

app.get('/trades', guard, (_req, res) => res.send(page('/trades', 'Trade booking', 'Trading Desk · notional = price × quantity, rounded to 2 decimals.',
  `<div class="grid g2" style="grid-template-columns:minmax(300px,380px) 1fr;align-items:start">
<form class="card" data-testid="trade-form" onsubmit="event.preventDefault();book()" novalidate>
<h2>New trade</h2><label class="f">Instrument <input data-testid="trade-instrument" list="instruments" placeholder="GBPUSD" autocomplete="off"></label>
<datalist id="instruments"><option>GBPUSD</option><option>EURUSD</option><option>USDJPY</option><option>UST10Y</option><option>BUND10Y</option><option>XAUUSD</option></datalist>
<div class="chips" style="margin:.5rem 0 .9rem">${['GBPUSD', 'EURUSD', 'USDJPY', 'UST10Y', 'XAUUSD'].map((i) => `<button type="button" class="chip" data-inst="${i}">${i}</button>`).join('')}</div>
<label class="f">Side</label><div class="seg" style="margin:.3rem 0 .4rem"><button type="button" class="b on" data-side="buy">BUY</button><button type="button" class="s" data-side="sell">SELL</button></div>
<div class="mini" style="margin-bottom:.8rem"><select data-testid="trade-side" aria-label="Side"><option value="buy">Buy</option><option value="sell">Sell</option></select></div>
<div class="grid g2" style="grid-template-columns:1fr 1fr"><label class="f">Price <input data-testid="trade-price" inputmode="decimal"><span class="hint" id="h-price"></span></label>
<label class="f">Quantity <input data-testid="trade-quantity" inputmode="decimal"><span class="hint" id="h-qty"></span></label></div>
<div class="total"><span>Notional</span><strong id="notional-preview">—</strong></div>
<button class="btn" style="width:100%" data-testid="trade-submit">Book trade</button><p class="error" data-testid="trade-error" style="margin-top:.8rem"></p></form>
<div class="card"><div class="row between" style="margin-bottom:.8rem"><h2 style="margin:0">Blotter</h2>
<div class="row"><div class="chips">${[['', 'All'], ['buy', 'Buys'], ['sell', 'Sells']].map(([v, l]) => `<button type="button" class="chip${v === '' ? ' on' : ''}" data-f="${v}">${l}</button>`).join('')}</div>
<span class="mini"><select data-testid="blotter-filter" aria-label="Filter"><option value="">All</option><option value="buy">Buy</option><option value="sell">Sell</option></select></span></div></div>
<div class="tablewrap"><table data-testid="blotter"><thead><tr><th>ID</th><th>Instrument</th><th>Side</th><th class="num">Price</th><th class="num">Qty</th><th class="num">Notional</th></tr></thead><tbody></tbody></table></div></div></div>
<div class="toast" id="toast"></div>`,
  `let key=crypto.randomUUID();const g=(t)=>$('[data-testid=trade-'+t+']').value;
const sideSel=$('[data-testid=trade-side]'),filt=$('[data-testid=blotter-filter]');
function syncSide(){$$('.seg button').forEach(b=>b.classList.toggle('on',b.dataset.side===sideSel.value));}
$$('.seg button').forEach(b=>b.onclick=()=>{sideSel.value=b.dataset.side;syncSide();});sideSel.addEventListener('change',syncSide);
$$('[data-inst]').forEach(b=>b.onclick=()=>{$('[data-testid=trade-instrument]').value=b.dataset.inst;preview();});
function check(v){if(v.trim()==='')return '';const n=Number(v);if(!Number.isFinite(n))return 'Must be a number';if(n<=0)return 'Must be greater than 0';return '';}
function preview(){const hp=check(g('price')),hq=check(g('quantity'));$('#h-price').textContent=hp;$('#h-qty').textContent=hq;
$('[data-testid=trade-price]').classList.toggle('invalid',!!hp);$('[data-testid=trade-quantity]').classList.toggle('invalid',!!hq);
const p=Number(g('price')),q=Number(g('quantity'));$('#notional-preview').textContent=(!hp&&!hq&&g('price')&&g('quantity'))?fmt(Math.round((p*q+Number.EPSILON)*100)/100):'—';}
['price','quantity'].forEach(t=>$('[data-testid=trade-'+t+']').addEventListener('input',preview));
function syncChips(){$$('[data-f]').forEach(c=>c.classList.toggle('on',c.dataset.f===filt.value));}
$$('[data-f]').forEach(c=>c.onclick=()=>{filt.value=c.dataset.f;syncChips();load();});
filt.addEventListener('change',()=>{syncChips();load();});
function load(){const s=filt.value;fetch('/api/trades'+(s?'?side='+s:'')).then(r=>r.json()).then(l=>{$('tbody').innerHTML=l.map(t=>'<tr data-testid="trade-row" data-id="'+esc(t.id)+'"><td><span class="kbd">'+esc(t.id)+'</span></td><td data-testid="trade-row-instrument"><strong>'+esc(t.instrument)+'</strong></td><td data-testid="trade-row-side"><span class="badge '+t.side+'">'+t.side+'</span></td><td class="num" data-testid="trade-row-price">'+t.price+'</td><td class="num" data-testid="trade-row-qty">'+t.quantity+'</td><td class="num" data-testid="trade-row-notional">'+money(t.notional)+'</td></tr>').join('')||'<tr><td colspan="6" class="sub">No trades yet.</td></tr>';});}
async function book(){const btn=$('[data-testid=trade-submit]');if(btn.disabled)return;btn.disabled=true;$('[data-testid=trade-error]').textContent='';
const r=await post('/api/trades',{instrument:g('instrument'),side:g('side'),price:g('price'),quantity:g('quantity')},key);
if(r.ok){key=crypto.randomUUID();load();const t=$('#toast');t.textContent='Booked '+r.body.side.toUpperCase()+' '+r.body.instrument+' · notional '+fmt(r.body.notional);setTimeout(()=>t.textContent='',2500);}else $('[data-testid=trade-error]').textContent=r.body.error;btn.disabled=false;}
load();`)));

if (require.main === module) app.listen(PORT, () => console.log(`ShiftDesk QA Showcase on http://localhost:${PORT}`));
module.exports = app;
