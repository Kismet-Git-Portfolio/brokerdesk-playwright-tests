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
const page = (title, body, script = '') => `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title>
<style>body{font-family:sans-serif;max-width:820px;margin:2rem auto}nav a{margin-right:1rem}table{border-collapse:collapse}td,th{border:1px solid #ccc;padding:4px 8px}.error{color:#b00}</style>
</head><body><nav data-testid="nav"><a href="/jobs">Jobs</a><a href="/shifts/new">New shift</a><a href="/payouts">Payouts</a><a href="/trades">Trades</a>
<button data-testid="logout" onclick="fetch('/api/logout',{method:'POST'}).then(()=>location='/login')">Log out</button></nav>
<h1>${title}</h1>${body}<script>
const $=(s)=>document.querySelector(s);
async function post(url,data,key){const h={'Content-Type':'application/json'};if(key)h['Idempotency-Key']=key;const r=await fetch(url,{method:'POST',headers:h,body:JSON.stringify(data)});return {ok:r.ok,body:await r.json()};}
const money=(n)=>Number(n).toFixed(2);
${script}</script></body></html>`;

const guard = (req, res, next) => (authed(req) ? next() : res.redirect('/login'));

app.get('/', (_req, res) => res.redirect('/jobs'));
app.get('/login', (_req, res) => res.send(`<!doctype html><html><head><title>Login</title></head><body><h1>Sign in</h1>
<form data-testid="login-form" onsubmit="event.preventDefault();login()">
<label>Email <input data-testid="login-email" name="username"></label>
<label>Password <input data-testid="login-password" type="password" name="password"></label>
<button data-testid="login-submit" type="submit">Sign in</button></form><p class="error" data-testid="login-error"></p>
<script>async function login(){const r=await fetch('/api/login',{method:'POST',headers:{'Content-Type':'application/json'},
body:JSON.stringify({username:document.querySelector('[name=username]').value,password:document.querySelector('[name=password]').value})});
if(r.ok)location='/jobs';else document.querySelector('[data-testid=login-error]').textContent=(await r.json()).error;}</script></body></html>`));

app.get('/jobs', guard, (_req, res) => res.send(page('Jobs and shifts',
  `<p data-testid="loading">Loading...</p><table data-testid="jobs-table" hidden><thead><tr><th>Title</th><th>Location</th><th>Type</th><th>Gross</th><th></th></tr></thead><tbody></tbody></table>`,
  `fetch('/api/jobs').then(r=>r.json()).then(d=>{const rows=[...d.jobs,...d.shifts].map(j=>'<tr data-testid="job-row" data-id="'+j.id+'"><td data-testid="job-title">'+j.title+'</td><td>'+j.location+'</td><td>'+j.type+'</td><td data-testid="job-gross">'+(j.gross!=null?money(j.gross):'')+'</td><td><a data-testid="job-open" href="/jobs/'+j.id+'">Open</a></td></tr>').join('');
$('tbody').innerHTML=rows;$('[data-testid=loading]').remove();$('[data-testid=jobs-table]').hidden=false;});`)));

app.get('/shifts/new', guard, (_req, res) => res.send(page('Create shift',
  `<form data-testid="shift-form" onsubmit="event.preventDefault();save()">
<label>Title <input data-testid="shift-title"></label><label>Location <input data-testid="shift-location"></label><br>
<label>Base <input data-testid="shift-base" value="0"></label><label>Allowance <input data-testid="shift-allowance" value="0"></label><label>Special <input data-testid="shift-special" value="0"></label>
<p>Gross total: <strong data-testid="shift-gross">0.00</strong></p><button data-testid="shift-submit">Publish shift</button></form>
<p data-testid="toast"></p><p class="error" data-testid="shift-error"></p>`,
  `const v=(t)=>$('[data-testid=shift-'+t+']').value;
function calc(){const g=['base','allowance','special'].reduce((s,k)=>s+(Number(v(k))||0),0);$('[data-testid=shift-gross]').textContent=money(g);}
document.querySelectorAll('input').forEach(i=>i.addEventListener('input',calc));
async function save(){const r=await post('/api/shifts',{title:v('title'),location:v('location'),base:v('base'),allowance:v('allowance'),special:v('special')});
if(r.ok){$('[data-testid=toast]').textContent='New shift added!';$('[data-testid=toast]').dataset.id=r.body.id;}else $('[data-testid=shift-error]').textContent=r.body.error;}`)));

app.get('/jobs/:id', guard, (req, res) => res.send(page('Job details',
  `<p data-testid="job-id">${req.params.id.replace(/[^\w-]/g, '')}</p><form data-testid="apply-form" onsubmit="event.preventDefault();apply()">
<label>Name <input data-testid="apply-name"></label><label>Email <input data-testid="apply-email"></label><button data-testid="apply-submit">Apply</button></form>
<p data-testid="apply-status"></p><h2>Applicants (<span data-testid="applicant-count">0</span>)</h2><ul data-testid="applicants"></ul>`,
  `const jid=$('[data-testid=job-id]').textContent;
function load(){fetch('/api/jobs/'+jid+'/applicants').then(r=>r.json()).then(l=>{$('[data-testid=applicant-count]').textContent=l.length;$('[data-testid=applicants]').innerHTML=l.map(a=>'<li data-testid="applicant">'+a.name+' &lt;'+a.email+'&gt;</li>').join('');});}
async function apply(){const r=await post('/api/jobs/'+jid+'/apply',{name:$('[data-testid=apply-name]').value,email:$('[data-testid=apply-email]').value});
$('[data-testid=apply-status]').textContent=r.ok?'Application sent!':r.body.error;load();}load();`)));

app.get('/payouts', guard, (_req, res) => res.send(page('Payouts',
  `<table data-testid="payouts-table"><thead><tr><th>Worker</th><th>Amount</th></tr></thead><tbody></tbody></table>`,
  `fetch('/api/payouts').then(r=>r.json()).then(l=>{$('tbody').innerHTML=l.map(p=>'<tr data-testid="payout-row" data-id="'+p.id+'"><td data-testid="payout-worker">'+p.worker+'</td><td data-testid="payout-amount">'+money(p.amount)+'</td></tr>').join('');});`)));

app.get('/trades', guard, (_req, res) => res.send(page('Trade booking',
  `<form data-testid="trade-form" onsubmit="event.preventDefault();book()">
<label>Instrument <input data-testid="trade-instrument"></label>
<label>Side <select data-testid="trade-side"><option value="buy">Buy</option><option value="sell">Sell</option></select></label>
<label>Price <input data-testid="trade-price"></label><label>Quantity <input data-testid="trade-quantity"></label>
<button data-testid="trade-submit">Book trade</button></form><p class="error" data-testid="trade-error"></p>
<label>Filter <select data-testid="blotter-filter"><option value="">All</option><option value="buy">Buy</option><option value="sell">Sell</option></select></label>
<table data-testid="blotter"><thead><tr><th>ID</th><th>Instrument</th><th>Side</th><th>Price</th><th>Qty</th><th>Notional</th></tr></thead><tbody></tbody></table>`,
  `let key=crypto.randomUUID();
function load(){const s=$('[data-testid=blotter-filter]').value;fetch('/api/trades'+(s?'?side='+s:'')).then(r=>r.json()).then(l=>{$('tbody').innerHTML=l.map(t=>'<tr data-testid="trade-row" data-id="'+t.id+'"><td>'+t.id+'</td><td data-testid="trade-row-instrument">'+t.instrument+'</td><td data-testid="trade-row-side">'+t.side+'</td><td data-testid="trade-row-price">'+t.price+'</td><td data-testid="trade-row-qty">'+t.quantity+'</td><td data-testid="trade-row-notional">'+money(t.notional)+'</td></tr>').join('');});}
$('[data-testid=blotter-filter]').addEventListener('change',load);
async function book(){const btn=$('[data-testid=trade-submit]');if(btn.disabled)return;btn.disabled=true;$('[data-testid=trade-error]').textContent='';
const g=(t)=>$('[data-testid=trade-'+t+']').value;
const r=await post('/api/trades',{instrument:g('instrument'),side:g('side'),price:g('price'),quantity:g('quantity')},key);
if(r.ok){key=crypto.randomUUID();load();}else $('[data-testid=trade-error]').textContent=r.body.error;btn.disabled=false;}
load();`)));

if (require.main === module) app.listen(PORT, () => console.log(`Mock app on http://localhost:${PORT}`));
module.exports = app;
