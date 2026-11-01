// Mock broker desk for practising tests. Fake data, in-memory SQLite so I can check things with SQL.
const express = require('express');
const crypto = require('crypto');
const path = require('path');
const Database = require('better-sqlite3');

const PORT = Number(process.env.PORT || 3100);
const USER = process.env.DEMO_USER || 'demo.user@example.com';
const PASS = process.env.DEMO_PASSWORD || 'Demo#Pass123';
const STALE_MS = 5000; // a price older than this is STALE and cannot be used to validate an order

const app = express();
app.use(express.json());

const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;
const id = () => crypto.randomUUID().slice(0, 8);
const today = () => new Date().toISOString().slice(0, 10);

// reference data
// symbol, asset class, description, reference price, tolerance band %, display decimals, quoted spread
const INSTRUMENTS = [
  ['EURUSD', 'FX', 'Euro / US Dollar spot', 1.0842, 1.0, 5, 0.0001],
  ['GBPUSD', 'FX', 'Sterling / US Dollar spot', 1.2734, 1.0, 5, 0.0001],
  ['USDJPY', 'FX', 'US Dollar / Yen spot', 151.23, 1.0, 3, 0.01],
  ['UST10Y', 'Rates', 'US Treasury 10Y note (price)', 99.875, 0.5, 3, 0.03125],
  ['BUND10Y', 'Rates', 'German Bund 10Y (price)', 131.62, 0.5, 2, 0.02],
  ['IG-CDS-5Y', 'Credit', 'Investment-grade CDS index 5Y (bps)', 62.5, 3.0, 2, 0.25],
  ['BRENT', 'Energy', 'Brent crude front month ($/bbl)', 82.4, 2.0, 2, 0.03],
  ['XAUUSD', 'Commodities', 'Gold spot ($/oz)', 2384.4, 2.0, 2, 0.3],
].map(([symbol, asset_class, description, ref_price, tolerance_pct, decimals, spread]) => ({ symbol, asset_class, description, ref_price, tolerance_pct, decimals, spread }));
const INST = Object.fromEntries(INSTRUMENTS.map((i) => [i.symbol, i]));
const CLIENTS = ['Alpha Capital', 'Bravo Bank', 'Charlie Asset Mgmt', 'Delta Pension Fund', 'Echo Hedge Partners'];
const COUNTERPARTIES = ['NORTHBANK', 'EASTSEC', 'WESTCAP', 'SOUTHMARKETS'];

// simulated market data
let market = {};
function resetMarket() {
  market = Object.fromEntries(INSTRUMENTS.map((i, k) => [i.symbol, { mid: i.ref_price, ts: Date.now(), frozen: false, phase: k * 1.7 }]));
}
// small random walk around ref, max one tick per second
function quote(sym) {
  const i = INST[sym], m = market[sym], now = Date.now();
  if (!m.frozen && now - m.ts >= 1000) {
    m.mid = i.ref_price * (1 + 0.0015 * Math.sin(now / 7000 + m.phase) + (Math.random() - 0.5) * 0.0004);
    m.ts = now;
  }
  const f = 10 ** i.decimals, bid = Math.round((m.mid - i.spread / 2) * f) / f, ask = Math.round((m.mid + i.spread / 2) * f) / f;
  return { symbol: sym, asset_class: i.asset_class, description: i.description, bid, ask, mid: Math.round(m.mid * f) / f, decimals: i.decimals,
    tolerance_pct: i.tolerance_pct, ts: new Date(m.ts).toISOString(), age_ms: now - m.ts, stale: now - m.ts > STALE_MS };
}

// SQLite
const SCHEMA = `
CREATE TABLE instruments (symbol TEXT PRIMARY KEY, asset_class TEXT NOT NULL, ref_price REAL NOT NULL, tolerance_pct REAL NOT NULL);
CREATE TABLE trades (trade_id TEXT PRIMARY KEY, instrument TEXT NOT NULL, asset_class TEXT NOT NULL, side TEXT NOT NULL CHECK (side IN ('buy','sell')),
  price REAL NOT NULL, quantity REAL NOT NULL, notional REAL NOT NULL, client TEXT, counterparty TEXT, venue TEXT,
  status TEXT NOT NULL DEFAULT 'NEW' CHECK (status IN ('NEW','CONFIRMED','SETTLED','FAILED','CANCELLED')),
  cl_ord_id TEXT, trade_date TEXT, booked_at TEXT, seq INTEGER);
CREATE TABLE settlements (settlement_id TEXT PRIMARY KEY, trade_id TEXT NOT NULL, status TEXT NOT NULL, settled_on TEXT);
CREATE TABLE fix_messages (fix_id INTEGER PRIMARY KEY, trade_id TEXT, msg_type TEXT NOT NULL, cl_ord_id TEXT, exec_type TEXT, ord_status TEXT,
  symbol TEXT, side TEXT, qty REAL, price REAL, raw TEXT NOT NULL, sent_at TEXT);
CREATE TABLE audit (audit_id INTEGER PRIMARY KEY, trade_id TEXT NOT NULL, action TEXT NOT NULL, from_status TEXT, to_status TEXT, detail TEXT, at TEXT);
CREATE TABLE rejects (reject_id INTEGER PRIMARY KEY, instrument TEXT, reason TEXT NOT NULL, at TEXT);
CREATE TABLE payouts (payout_id TEXT PRIMARY KEY, worker TEXT NOT NULL, shift_ref TEXT, base REAL NOT NULL, allowance REAL NOT NULL,
  special REAL NOT NULL, amount REAL NOT NULL, seq INTEGER);
CREATE INDEX idx_settlements_trade ON settlements(trade_id);
CREATE INDEX idx_fix_trade ON fix_messages(trade_id);`;
let sql, seq = 0, fixSeq = 0, db;

// FIX 4.4 (simulated)
const SOH = '\x01';
const fixTime = (d = new Date()) => d.toISOString().replace(/-/g, '').replace('T', '-').replace('Z', '');
function buildFix(fields) {
  const body = fields.map(([t, v]) => `${t}=${v}${SOH}`).join('');
  const head = `8=FIX.4.4${SOH}9=${Buffer.byteLength(body)}${SOH}`;
  const sum = [...Buffer.from(head + body)].reduce((s, b) => s + b, 0) % 256;
  return (head + body + `10=${String(sum).padStart(3, '0')}${SOH}`).split(SOH).filter(Boolean).join('|');
}
const parseFix = (raw) => raw.split('|').map((kv) => { const k = kv.indexOf('='); return [kv.slice(0, k), kv.slice(k + 1)]; });
const fixSide = (s) => (s === 'buy' ? '1' : '2');
// msgType D/G/F/8. o = { trade_id, cl_ord_id, orig_cl_ord_id, symbol, side, qty, price, cpty, account, exec_type, ord_status, cum, leaves, last }
function sendFix(type, o) {
  const now = new Date(), ts = fixTime(now);
  const hdr = [['35', type], ['49', 'BRKDESK'], ['56', o.cpty || 'HOUSE'], ['34', ++fixSeq], ['52', ts]];
  let f;
  if (type === 'D') f = [['11', o.cl_ord_id], ['1', (o.account || 'HOUSE').replace(/[|=]/g, '')], ['55', o.symbol], ['54', fixSide(o.side)], ['38', o.qty], ['40', '2'], ['44', o.price], ['59', '0'], ['60', ts]];
  else if (type === 'G') f = [['11', o.cl_ord_id], ['41', o.orig_cl_ord_id], ['37', o.trade_id], ['55', o.symbol], ['54', fixSide(o.side)], ['38', o.qty], ['40', '2'], ['44', o.price], ['60', ts]];
  else if (type === 'F') f = [['11', o.cl_ord_id], ['41', o.orig_cl_ord_id], ['37', o.trade_id], ['55', o.symbol], ['54', fixSide(o.side)], ['38', o.qty], ['60', ts]];
  else f = [['37', o.trade_id], ['11', o.cl_ord_id], ['17', 'EX' + fixSeq], ['150', o.exec_type], ['39', o.ord_status], ['55', o.symbol], ['54', fixSide(o.side)],
    ['38', o.qty], ['44', o.price], ['32', o.last ? o.qty : 0], ['31', o.last ? o.price : 0], ['14', o.cum || 0], ['151', o.leaves ?? 0], ['6', o.cum ? o.price : 0], ['60', ts]];
  const raw = buildFix([...hdr, ...f]);
  sql.prepare('INSERT INTO fix_messages (trade_id,msg_type,cl_ord_id,exec_type,ord_status,symbol,side,qty,price,raw,sent_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)')
    .run(o.trade_id, type, o.cl_ord_id, type === '8' ? o.exec_type : null, type === '8' ? o.ord_status : null, o.symbol, o.side, o.qty, o.price ?? null, raw, now.toISOString());
}
const fixFor = (t, extra = {}) => ({ trade_id: t.trade_id, cl_ord_id: t.cl_ord_id, symbol: t.instrument, side: t.side, qty: t.quantity, price: t.price, cpty: t.counterparty, account: t.client, ...extra });
const execNew = (t) => sendFix('8', fixFor(t, { exec_type: '0', ord_status: '0', cum: 0, leaves: t.quantity }));
const execFill = (t, over = {}) => sendFix('8', fixFor(t, { exec_type: 'F', ord_status: '2', cum: t.quantity, leaves: 0, last: true, ...over }));

const audit = (trade_id, action, from, to, detail = '') =>
  sql.prepare('INSERT INTO audit (trade_id,action,from_status,to_status,detail,at) VALUES (?,?,?,?,?,?)').run(trade_id, action, from, to, detail, new Date().toISOString());
const getTrade = (tid) => sql.prepare('SELECT * FROM trades WHERE trade_id = ?').get(tid);

function insertTrade(o) {
  const t = { trade_id: o.trade_id || 'TRD-' + id().toUpperCase(), instrument: o.instrument, asset_class: (INST[o.instrument] || {}).asset_class || 'Other',
    side: o.side, price: o.price, quantity: o.quantity, notional: round2(o.price * o.quantity), client: o.client || null, counterparty: o.counterparty || null,
    venue: o.venue || 'Electronic', status: 'NEW', cl_ord_id: o.cl_ord_id || 'ORD-' + id().toUpperCase(), trade_date: today(), booked_at: new Date().toISOString() };
  sql.prepare(`INSERT INTO trades (trade_id,instrument,asset_class,side,price,quantity,notional,client,counterparty,venue,status,cl_ord_id,trade_date,booked_at,seq)
    VALUES (@trade_id,@instrument,@asset_class,@side,@price,@quantity,@notional,@client,@counterparty,@venue,@status,@cl_ord_id,@trade_date,@booked_at,${++seq})`).run(t);
  sendFix('D', fixFor(t));
  execNew(t);
  audit(t.trade_id, 'BOOKED', null, 'NEW', `${t.side.toUpperCase()} ${t.quantity} ${t.instrument} @ ${t.price} via ${t.venue}`);
  return t;
}

// Demo data with deliberate defects for the Data Checks page.
function seedDemo() {
  const rows = [
    // id, instrument, side, price, qty, client, cpty, venue, final status
    ['T-1001', 'GBPUSD', 'buy', 1.2734, 250000, 'Alpha Capital', 'NORTHBANK', 'Electronic', 'SETTLED'],
    ['T-1002', 'EURUSD', 'sell', 1.0842, 500000, 'Bravo Bank', 'EASTSEC', 'Voice', 'SETTLED'],
    ['T-1003', 'UST10Y', 'buy', 99.875, 30, 'Alpha Capital', 'WESTCAP', 'Electronic', 'SETTLED'],   // FIX exec report says qty 3 (BRK-411)
    ['T-1004', 'USDJPY', 'sell', 151.23, 100000, 'Charlie Asset Mgmt', 'SOUTHMARKETS', 'Voice', 'CONFIRMED'], // no settlement (BRK-318)
    ['T-1005', 'XAUUSD', 'buy', 2384.4, 12, 'Bravo Bank', 'NORTHBANK', 'Electronic', 'FAILED'],      // settlement failed (BRK-318)
    ['T-1006', 'BUND10Y', 'sell', 131.62, 40, 'Delta Pension Fund', 'EASTSEC', 'Voice', 'CONFIRMED'], // no settlement + no exec report
    ['T-1007', 'EURUSD', 'buy', 1.0839, 200000, 'Echo Hedge Partners', 'WESTCAP', 'Electronic', 'CANCELLED'], // in DB, not on blotter (BRK-327)
    ['T-1008', 'EURUSD', 'sell', 1.0842, 500000, 'Bravo Bank', 'EASTSEC', 'Voice', 'SETTLED'],       // duplicate booking of T-1002 (BRK-322)
    ['T-1009', 'BRENT', 'buy', 92.1, 5000, 'Echo Hedge Partners', 'SOUTHMARKETS', 'Voice', 'NEW'],    // fat finger: 11.8% above reference (BRK-415)
    ['T-1010', 'IG-CDS-5Y', 'sell', 62.75, 200, 'Delta Pension Fund', 'NORTHBANK', 'Electronic', 'SETTLED'],
    ['T-1011', 'GBPUSD', 'sell', 1.2729, 750000, 'Charlie Asset Mgmt', 'WESTCAP', 'Electronic', 'NEW'],
  ];
  const settle = { 'T-1001': 'SETTLED', 'T-1002': 'SETTLED', 'T-1003': 'SETTLED', 'T-1005': 'FAILED', 'T-1008': 'SETTLED', 'T-1010': 'SETTLED' };
  for (const [tid, inst, side, price, qty, client, cpty, venue, status] of rows) {
    const t = insertTrade({ trade_id: tid, cl_ord_id: 'ORD-' + tid.slice(2), instrument: inst, side, price, quantity: qty, client, counterparty: cpty, venue });
    if (status === 'NEW') continue;
    if (status === 'CANCELLED') { sql.prepare("UPDATE trades SET status='CANCELLED' WHERE trade_id=?").run(tid); audit(tid, 'CANCELLED', 'NEW', 'CANCELLED', 'Client withdrew RFQ');
      sendFix('8', fixFor(t, { exec_type: '4', ord_status: '4', cum: 0, leaves: 0 })); continue; }
    if (tid === 'T-1003') execFill(t, { qty: 3 }); else if (tid !== 'T-1006') execFill(t);
    sql.prepare("UPDATE trades SET status='CONFIRMED' WHERE trade_id=?").run(tid); audit(tid, 'CONFIRMED', 'NEW', 'CONFIRMED', 'Counterparty confirmed');
    if (settle[tid]) {
      sql.prepare('INSERT INTO settlements VALUES (?,?,?,?)').run('S-' + tid.slice(2), tid, settle[tid], settle[tid] === 'SETTLED' ? today() : null);
      sql.prepare('UPDATE trades SET status=? WHERE trade_id=?').run(status, tid); audit(tid, status === 'FAILED' ? 'SETTLEMENT_FAILED' : 'SETTLED', 'CONFIRMED', status, '');
    }
  }
  const r = sql.prepare('INSERT INTO rejects (instrument,reason,at) VALUES (?,?,?)');
  r.run('BRENT', 'Price outside tolerance band', new Date().toISOString()); r.run('UST10Y', 'Quantity must be a positive number', new Date().toISOString());
  const p = sql.prepare('INSERT INTO payouts VALUES (?,?,?,?,?,?,?,?)');
  [['P-9001', 'Ana Reyes', 'shift-A1', 1500, 250.75, 99.99], ['P-9002', 'Ben Cruz', 'shift-B7', 980, 120, 0],
   ['P-9003', 'Carla Santos', 'shift-C3', 2100.5, 300, 150.25], ['P-9004', 'Ben Cruz', 'shift-B7', 980, 120, 0]] // duplicate payout (GIG-322)
    .forEach(([pid, w, ref, b, a, sp]) => p.run(pid, w, ref, b, a, sp, round2(b + a + sp), ++seq));
}
function reset(seed = false) {
  db = { sessions: db ? db.sessions : new Set(), jobs: [
      { id: 'job-1', title: 'Warehouse Picker', location: 'Makati', type: 'job' },
      { id: 'job-2', title: 'Event Staff', location: 'Taguig', type: 'job' }], shifts: [], applicants: {}, idem: {} };
  if (sql) sql.close();
  sql = new Database(':memory:');
  sql.exec(SCHEMA);
  const ins = sql.prepare('INSERT INTO instruments VALUES (?,?,?,?)');
  INSTRUMENTS.forEach((i) => ins.run(i.symbol, i.asset_class, i.ref_price, i.tolerance_pct));
  seq = 0; fixSeq = 0;
  resetMarket();
  if (seed) seedDemo();
}
reset(process.env.SEED !== '0'); // the app starts with demo data; tests reset to an empty DB (or ?seed=demo)
const TRADE_COLS = `trade_id AS id, instrument, asset_class, side, price, quantity, notional, client, counterparty, venue, status, cl_ord_id, booked_at`;
const PAYOUT_COLS = 'payout_id AS id, worker, base, allowance, special, amount';

// one read-only SELECT/WITH, capped rows
function runReadOnly(query) {
  const q = String(query || '').trim().replace(/;\s*$/, '');
  if (!q) return { error: 'Query is empty' };
  if (!/^(select|with)\b/i.test(q)) return { error: 'Only SELECT queries are allowed (read-only console)' };
  let stmt;
  try { stmt = sql.prepare(q); } catch (e) { return { error: /more than one statement/i.test(e.message) ? 'Only one statement is allowed' : 'SQL error: ' + e.message }; }
  if (!stmt.readonly || !stmt.reader) return { error: 'Only SELECT queries are allowed (read-only console)' };
  try {
    const rows = stmt.raw(true).all().slice(0, 500);
    return { columns: stmt.columns().map((c) => c.name), rows };
  } catch (e) { return { error: 'SQL error: ' + e.message }; }
}

// helpers
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
  if (result.error) return res.status(result.status || 400).json(result);
  if (key) db.idem[key] = result;
  return res.status(201).json(result);
}
const publicTrade = (t) => ({ id: t.trade_id, instrument: t.instrument, asset_class: t.asset_class, side: t.side, price: t.price, quantity: t.quantity,
  notional: t.notional, client: t.client, counterparty: t.counterparty, venue: t.venue, status: t.status, cl_ord_id: t.cl_ord_id, booked_at: t.booked_at });

// strict = ticket (client + cpty required)
function validateOrder(b, strict) {
  const instrument = String(b.instrument || '').trim().toUpperCase();
  const price = num(b.price), quantity = num(b.quantity);
  if (!instrument) return { error: 'Instrument is required' };
  if (b.side !== 'buy' && b.side !== 'sell') return { error: 'Side must be buy or sell' };
  if (!Number.isFinite(price) || price <= 0) return { error: 'Price must be a positive number' };
  if (!Number.isFinite(quantity) || quantity <= 0) return { error: 'Quantity must be a positive number' };
  if (strict && !INST[instrument]) return { error: `Unknown instrument ${instrument}` };
  if (strict && !String(b.client || '').trim()) return { error: 'Client is required' };
  if (strict && !String(b.counterparty || '').trim()) return { error: 'Counterparty is required' };
  if (INST[instrument]) {
    const q = quote(instrument);
    if (q.stale) return { error: `Market data for ${instrument} is stale. Cannot validate price`, code: 'STALE_PRICE' };
    const off = Math.abs(price - q.mid) / q.mid * 100;
    if (off > q.tolerance_pct) return { error: `Price outside tolerance band: ±${q.tolerance_pct}% of market ${q.mid.toFixed(q.decimals)}`, code: 'PRICE_TOLERANCE' };
  }
  return { instrument, side: b.side, price, quantity };
}
function bookOrder(req, res, strict) {
  return idempotent(req, res, () => {
    const b = req.body || {};
    const v = validateOrder(b, strict);
    if (v.error) { sql.prepare('INSERT INTO rejects (instrument,reason,at) VALUES (?,?,?)').run(String(b.instrument || '').toUpperCase() || null, v.error, new Date().toISOString()); return v; }
    const t = insertTrade({ ...v, client: b.client, counterparty: b.counterparty, venue: b.venue === 'Voice' ? 'Voice' : 'Electronic' });
    return publicTrade(getTrade(t.trade_id));
  });
}

// Trade lifecycle: allowed transitions only.
const TRANSITIONS = { confirm: [['NEW'], 'CONFIRMED'], settle: [['CONFIRMED', 'FAILED'], 'SETTLED'], fail: [['CONFIRMED'], 'FAILED'], cancel: [['NEW', 'CONFIRMED'], 'CANCELLED'] };
function transition(tid, action, body = {}) {
  const t = getTrade(tid);
  if (!t) return { status: 404, error: 'Trade not found' };
  if (action === 'amend') {
    if (t.status !== 'NEW') return { status: 409, error: `Cannot amend a trade in status ${t.status}` };
    const v = validateOrder({ instrument: t.instrument, side: t.side, price: body.price ?? t.price, quantity: body.quantity ?? t.quantity }, false);
    if (v.error) return { status: 400, ...v };
    const newId = 'ORD-' + id().toUpperCase();
    sendFix('G', fixFor(t, { cl_ord_id: newId, orig_cl_ord_id: t.cl_ord_id, qty: v.quantity, price: v.price }));
    sql.prepare('UPDATE trades SET price=?, quantity=?, notional=?, cl_ord_id=? WHERE trade_id=?').run(v.price, v.quantity, round2(v.price * v.quantity), newId, tid);
    const u = getTrade(tid);
    sendFix('8', fixFor(u, { exec_type: '5', ord_status: '0', cum: 0, leaves: u.quantity }));
    audit(tid, 'AMENDED', 'NEW', 'NEW', `qty ${t.quantity} → ${u.quantity}, price ${t.price} → ${u.price}`);
    return publicTrade(u);
  }
  const rule = TRANSITIONS[action];
  if (!rule) return { status: 400, error: 'Unknown action' };
  if (!rule[0].includes(t.status)) return { status: 409, error: `Cannot ${action} a trade in status ${t.status}` };
  const to = rule[1];
  if (action === 'confirm') execFill(t);
  if (action === 'cancel') {
    const newId = 'ORD-' + id().toUpperCase();
    sendFix('F', fixFor(t, { cl_ord_id: newId, orig_cl_ord_id: t.cl_ord_id }));
    sendFix('8', fixFor(t, { cl_ord_id: newId, exec_type: '4', ord_status: '4', cum: 0, leaves: 0 }));
  }
  if (action === 'settle' || action === 'fail') {
    sql.prepare('DELETE FROM settlements WHERE trade_id=?').run(tid);
    sql.prepare('INSERT INTO settlements VALUES (?,?,?,?)').run('S-' + id().toUpperCase(), tid, to, to === 'SETTLED' ? today() : null);
  }
  sql.prepare('UPDATE trades SET status=? WHERE trade_id=?').run(to, tid);
  audit(tid, { confirm: 'CONFIRMED', settle: 'SETTLED', fail: 'SETTLEMENT_FAILED', cancel: 'CANCELLED' }[action], t.status, to, String(body.reason || ''));
  return publicTrade(getTrade(tid));
}

// API
app.get('/health', (_req, res) => res.json({ ok: true }));
app.post('/api/reset', (req, res) => { reset(req.query.seed === 'demo' || (req.body || {}).seed === 'demo'); res.json({ ok: true }); });
app.post('/api/sql', (req, res) => {
  if (!authed(req)) return res.status(401).json({ error: 'Sign in required' });
  const r = runReadOnly((req.body || {}).query);
  res.status(r.error ? 400 : 200).json(r);
});

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

// Market data
app.get('/api/instruments', (_req, res) => res.json(INSTRUMENTS));
app.get('/api/prices', (_req, res) => res.json(INSTRUMENTS.map((i) => quote(i.symbol))));
app.get('/api/prices/:sym', (req, res) => (INST[req.params.sym] ? res.json(quote(req.params.sym)) : res.status(404).json({ error: 'Unknown instrument' })));
// test hook: freeze a feed so it goes stale
app.post('/api/prices/:sym/freeze', (req, res) => {
  const m = market[req.params.sym];
  if (!m) return res.status(404).json({ error: 'Unknown instrument' });
  m.frozen = true; m.ts = Date.now() - STALE_MS - 1000;
  res.json(quote(req.params.sym));
});
app.post('/api/prices/:sym/resume', (req, res) => {
  const m = market[req.params.sym];
  if (!m) return res.status(404).json({ error: 'Unknown instrument' });
  m.frozen = false; m.ts = 0;
  res.json(quote(req.params.sym));
});

// Orders / trades
app.post('/api/orders', (req, res) => bookOrder(req, res, true));   // RFQ ticket: all fields required
app.post('/api/trades', (req, res) => bookOrder(req, res, false));  // quick booking (client/counterparty optional)
app.get('/api/trades', (req, res) => {
  const { side, asset_class, status } = req.query;
  const where = [], args = [];
  if (status === 'ALL') {} else if (status) { where.push('status = ?'); args.push(status); } else where.push("status <> 'CANCELLED'"); // blotter hides cancelled
  if (side) { where.push('side = ?'); args.push(side); }
  if (asset_class) { where.push('asset_class = ?'); args.push(asset_class); }
  res.json(sql.prepare(`SELECT ${TRADE_COLS} FROM trades${where.length ? ' WHERE ' + where.join(' AND ') : ''} ORDER BY seq`).all(...args));
});
app.get('/api/trades/:id', (req, res) => {
  const t = getTrade(req.params.id);
  if (!t) return res.status(404).json({ error: 'Trade not found' });
  res.json({ ...publicTrade(t),
    settlement: sql.prepare('SELECT settlement_id, status, settled_on FROM settlements WHERE trade_id=?').get(t.trade_id) || null,
    audit: sql.prepare('SELECT action, from_status, to_status, detail, at FROM audit WHERE trade_id=? ORDER BY audit_id').all(t.trade_id),
    fix: sql.prepare('SELECT fix_id AS id, msg_type, raw FROM fix_messages WHERE trade_id=? ORDER BY fix_id').all(t.trade_id) });
});
for (const action of ['confirm', 'settle', 'fail', 'cancel', 'amend'])
  app.post(`/api/trades/:id/${action}`, (req, res) => { const r = transition(req.params.id, action, req.body || {}); res.status(r.error ? r.status : 200).json(r); });

app.get('/api/fix', (req, res) => {
  const tid = req.query.trade_id;
  const rows = sql.prepare(`SELECT fix_id AS id, trade_id, msg_type, raw, sent_at FROM fix_messages${tid ? ' WHERE trade_id = ?' : ''} ORDER BY fix_id DESC LIMIT 300`).all(...(tid ? [tid] : []));
  res.json(rows.map((r) => ({ ...r, tags: parseFix(r.raw) })));
});

app.get('/api/stats', (_req, res) => {
  const one = (q) => sql.prepare(q).get();
  res.json({
    trades_today: one(`SELECT COUNT(*) AS n FROM trades WHERE status <> 'CANCELLED' AND trade_date = '${today()}'`).n,
    unsettled: one(`SELECT COUNT(*) AS n FROM trades t LEFT JOIN settlements s ON s.trade_id = t.trade_id
      WHERE t.status IN ('CONFIRMED','SETTLED','FAILED') AND (s.trade_id IS NULL OR s.status <> 'SETTLED')`).n,
    rejects: one('SELECT COUNT(*) AS n FROM rejects').n,
    fix_messages: one('SELECT COUNT(*) AS n FROM fix_messages').n,
    stale_prices: INSTRUMENTS.filter((i) => quote(i.symbol).stale).length,
    by_asset_class: sql.prepare(`SELECT asset_class, COUNT(*) AS trades, ROUND(SUM(notional),2) AS notional FROM trades WHERE status <> 'CANCELLED' GROUP BY asset_class ORDER BY notional DESC`).all(),
    by_status: sql.prepare('SELECT status, COUNT(*) AS trades FROM trades GROUP BY status').all(),
  });
});

// Gig platform (prior work)
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
app.get('/api/payouts', (_req, res) => res.json(sql.prepare(`SELECT ${PAYOUT_COLS} FROM payouts ORDER BY seq`).all()));
app.post('/api/payouts', (req, res) =>
  idempotent(req, res, () => {
    const { worker } = req.body || {};
    const base = num(req.body.base), allowance = num(req.body.allowance ?? 0), special = num(req.body.special ?? 0);
    if (!worker || [base, allowance, special].some((n) => !Number.isFinite(n) || n < 0)) return { error: 'Invalid payout' };
    const p = { id: 'pay-' + id(), worker, base, allowance, special, amount: round2(base + allowance + special) };
    sql.prepare('INSERT INTO payouts VALUES (?,?,?,?,?,?,?,?)').run(p.id, worker, req.body.shift_ref || null, base, allowance, special, p.amount, ++seq);
    return p;
  })
);

// UI
app.use('/static', express.static(path.join(__dirname, 'public')));
const NAV = [
  ['Trading desk', [['/', 'Overview', '◎'], ['/prices', 'Price board', '≋'], ['/trades', 'Order ticket (RFQ)', '⇅'], ['/blotter', 'Blotter', '☰'],
    ['/fix', 'FIX message log', '⟨⟩'], ['/data-checks', 'Data checks (SQL)', '⌗']]],
  ['Gig platform (prior work)', [['/jobs', 'Jobs board', '▦'], ['/shifts/new', 'Create shift', '＋'], ['/payouts', 'Payouts', '₱']]],
];
const head = (title) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title} · BrokerDesk</title><link rel="stylesheet" href="/static/styles.css"></head>`;
const helpers = `const $=(s)=>document.querySelector(s);const $$=(s)=>[...document.querySelectorAll(s)];
const esc=(v)=>String(v).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
async function post(url,data,key){const h={'Content-Type':'application/json'};if(key)h['Idempotency-Key']=key;const r=await fetch(url,{method:'POST',headers:h,body:JSON.stringify(data)});return {ok:r.ok,body:await r.json()};}
const money=(n)=>Number(n).toFixed(2);const fmt=(n)=>Number(n).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});
const initials=(n)=>String(n).split(/\\s+/).slice(0,2).map(w=>w[0]||'').join('').toUpperCase();`;
const BRAND = `<div class="brand"><div class="logo">BD</div><div>BrokerDesk<small>Practice desk</small></div></div>`;
const page = (active, title, subtitle, body, script = '', src = '') => `${head(title)}<body><div class="shell">
<aside class="side" data-testid="nav">${BRAND}
${NAV.map(([g, items]) => `<div class="navgroup">${g}</div>` + items.map(([href, label, ic]) => `<a href="${href}" class="${active === href ? 'active' : ''}"><span>${ic}</span>${label}</a>`).join('')).join('')}
<div class="spacer"></div><button class="btn ghost" data-testid="logout" onclick="fetch('/api/logout',{method:'POST'}).then(()=>location='/login')">Log out</button></aside>
<main><div class="topline"><div><h1>${title}</h1><p class="sub">${subtitle}</p></div></div>${body}</main></div>
<script>${helpers}${script}</script>${src ? `<script src="/static/${src}"></script>` : ''}</body></html>`;
const guard = (req, res, next) => (authed(req) ? next() : res.redirect('/login'));

app.get('/login', (_req, res) => res.send(`${head('Sign in')}<body class="login"><div class="card">
${BRAND}
<h1>Welcome back</h1><p class="sub" style="margin-bottom:1rem">Sign in to the demo broking desk.</p>
<form data-testid="login-form" onsubmit="event.preventDefault();login()">
<label class="f">Email <input data-testid="login-email" name="username" autocomplete="username" placeholder="demo.user@example.com"></label>
<label class="f">Password <input data-testid="login-password" type="password" name="password" autocomplete="current-password"></label>
<button class="btn" data-testid="login-submit" type="submit">Sign in</button><p class="error" data-testid="login-error"></p></form>
</div><footer class="credit">Designed by <strong>Keesmet Gorostiza</strong> to showcase automation testing<br>with Playwright + TypeScript.</footer>
<script>async function login(){const r=await fetch('/api/login',{method:'POST',headers:{'Content-Type':'application/json'},
body:JSON.stringify({username:document.querySelector('[name=username]').value,password:document.querySelector('[name=password]').value})});
if(r.ok)location='/';else document.querySelector('[data-testid=login-error]').textContent=(await r.json()).error;}</script></body></html>`));

const COVERAGE = [
  ['Market data', 'Prices tick (bid < ask, timestamp moves); feed outage turns a price STALE and blocks orders on it', 'tests/ui/price-board.spec.ts, tests/api/orders.api.spec.ts'],
  ['Order validation', 'Required fields, qty/price > 0, price inside the tolerance band of the live market (fat-finger guard)', 'tests/ui/order-ticket.spec.ts, tests/ui/trades.spec.ts, tests/api/*.ts'],
  ['Idempotency', 'Double click books exactly one trade; same Idempotency-Key creates one record', 'tests/ui/trades.spec.ts, tests/ui/order-ticket.spec.ts, tests/api/trades.api.spec.ts'],
  ['Trade lifecycle', 'NEW → CONFIRMED → SETTLED / FAILED / CANCELLED; amend; illegal transitions rejected (409); audit trail', 'tests/ui/lifecycle.spec.ts, tests/api/lifecycle.api.spec.ts'],
  ['FIX 4.4', '35=D + 35=8 per order; tags 11/55/54/38/44 equal the ticket; 39/150 follow the lifecycle; BodyLength + CheckSum valid', 'tests/ui/fix-log.spec.ts, tests/api/fix.api.spec.ts'],
  ['Notional math', 'price × qty rounded to 2 dp, tricky decimals (0.1×0.2, 1.005×1000, 99.875×3)', 'tests/api/trades.api.spec.ts, tests/ui/trades.spec.ts'],
  ['Blotter', 'Row values == API values; filters by side, asset class and status; cancelled trades hidden', 'tests/ui/trades.spec.ts, tests/ui/blotter.spec.ts'],
  ['SQL data checks', 'Settlement breaks (LEFT JOIN), duplicate bookings (GROUP BY/HAVING), blotter vs DB, FIX vs trades, price vs tolerance; SELECT-only console', 'tests/ui/data-checks.spec.ts, tests/api/sql.api.spec.ts'],
  ['Gig platform (prior work)', 'Login, shifts gross pay, 10-applicant batch, double-payout check, idempotent payouts, slow network', 'tests/ui/{auth,jobs,shifts,payouts}.spec.ts'],
  ['Performance', 'K6 smoke/load on /api/trades, p95 < 500 ms, errors < 1%', 'k6/load-trades.js'],
];
app.get('/', guard, (_req, res) => res.send(page('/', 'Overview', 'A mock interdealer broking desk: rates, FX, credit, energy &amp; commodities, voice and electronic. Built to be tested.',
  `<div class="grid g4" style="margin-bottom:1rem">
<a class="card stat kpi" href="/blotter"><div class="label">Trades today</div><div class="value" data-testid="kpi-trades">–</div><div class="sub small">non-cancelled bookings</div></a>
<a class="card stat kpi" href="/data-checks"><div class="label">Unsettled / failed</div><div class="value warn" data-testid="kpi-unsettled">–</div><div class="sub small">settlement breaks to chase</div></a>
<a class="card stat kpi" href="/trades"><div class="label">Order rejects</div><div class="value bad" data-testid="kpi-rejects">–</div><div class="sub small">validation / tolerance / stale</div></a>
<a class="card stat kpi" href="/fix"><div class="label">FIX messages</div><div class="value" data-testid="kpi-fix">–</div><div class="sub small"><span data-testid="kpi-stale">0</span> stale price(s)</div></a></div>
<div class="grid" style="grid-template-columns:minmax(300px,1.1fr) minmax(300px,1fr);margin-bottom:1rem">
<div class="card"><div class="row between"><h2 style="margin:0">Notional by asset class</h2><span class="badge teal">price × qty</span></div><div data-testid="notional-by-class" class="bars" style="margin-top:.8rem"></div></div>
<div class="card"><div class="row between"><h2 style="margin:0">Market snapshot</h2><a href="/prices">Price board →</a></div><div class="ticker" data-testid="ticker" style="margin-top:.8rem"></div></div></div>
<div class="hero"><span class="badge teal">Playwright + TypeScript · UI + API + SQL · CI on every push</span><h1 style="margin-top:.6rem">What this demo proves</h1>
<p class="sub" style="max-width:820px">The risks a broker's QA team cares about: a duplicate trade, an order priced off a stale quote, a fat-finger price, a FIX message that disagrees with the booking, a trade that never settles. Each one has an automated test and a SQL check you can run live.</p></div>
<div class="card"><h2>Test coverage</h2><div class="tablewrap"><table data-testid="coverage-table"><thead><tr><th>Area</th><th>What's tested</th><th>Test file</th></tr></thead><tbody>
${COVERAGE.map(([f, w, t]) => `<tr><td><strong>${f}</strong></td><td>${w}</td><td><span class="kbd">${t}</span></td></tr>`).join('')}</tbody></table></div></div>`, '', 'overview.js')));

app.get('/prices', guard, (_req, res) => res.send(page('/prices', 'Price board', `Simulated streaming quotes, refreshed every second. A quote older than ${STALE_MS / 1000}s is STALE and orders on it are blocked.`,
  `<div class="card"><div class="row between" style="margin-bottom:.8rem"><h2 style="margin:0">Live quotes</h2><span class="sub small" data-testid="board-clock"></span></div>
<div class="tablewrap"><table data-testid="price-board"><thead><tr><th>Instrument</th><th>Asset class</th><th class="num">Bid</th><th class="num">Ask</th><th class="num">Spread</th><th>Last update</th><th>Status</th><th></th></tr></thead><tbody id="pb"></tbody></table></div>
<p class="sub small" style="margin-top:.8rem">"Simulate outage" stops one feed so you can show the stale-price guard. Tests use the same hook: <span class="kbd">POST /api/prices/:symbol/freeze</span>.</p></div>`, '', 'prices.js')));

app.get('/trades', guard, (_req, res) => res.send(page('/trades', 'Order ticket (RFQ)', 'Price is checked against the live market tolerance band. Every order emits FIX 35=D + 35=8. Notional = price × quantity (2 dp).',
  `<div class="grid" style="grid-template-columns:minmax(320px,400px) 1fr;align-items:start">
<form class="card" data-testid="trade-form" onsubmit="event.preventDefault();book()" novalidate>
<h2>New order</h2><label class="f">Instrument <input data-testid="trade-instrument" list="instruments" placeholder="EURUSD" autocomplete="off"></label>
<datalist id="instruments">${INSTRUMENTS.map((i) => `<option value="${i.symbol}">${i.description}</option>`).join('')}</datalist>
<div class="chips" style="margin:.5rem 0 .6rem">${INSTRUMENTS.map((i) => `<button type="button" class="chip" data-inst="${i.symbol}">${i.symbol}</button>`).join('')}</div>
<div class="mkt" data-testid="ticket-market"><span class="sub">Pick an instrument to see the market.</span></div>
<label class="f">Side</label><div class="seg" style="margin:.3rem 0 .4rem"><button type="button" class="b on" data-side="buy">BUY</button><button type="button" class="s" data-side="sell">SELL</button></div>
<div class="mini" style="margin-bottom:.8rem"><select data-testid="trade-side" aria-label="Side"><option value="buy">Buy</option><option value="sell">Sell</option></select></div>
<div class="grid g2" style="grid-template-columns:1fr 1fr"><label class="f">Quantity <input data-testid="trade-quantity" inputmode="decimal"><span class="hint" id="h-qty"></span></label>
<label class="f">Price <input data-testid="trade-price" inputmode="decimal"><span class="hint" id="h-price"></span></label></div>
<div class="grid g2" style="grid-template-columns:1fr 1fr;margin-top:.6rem"><label class="f">Client <select data-testid="trade-client"><option value="">Select client…</option>${CLIENTS.map((c) => `<option>${c}</option>`).join('')}</select></label>
<label class="f">Counterparty <select data-testid="trade-counterparty"><option value="">Select…</option>${COUNTERPARTIES.map((c) => `<option>${c}</option>`).join('')}</select></label></div>
<label class="f" style="margin-top:.6rem">Venue <select data-testid="trade-venue"><option>Electronic</option><option>Voice</option></select></label>
<div class="total"><span>Notional</span><strong id="notional-preview">—</strong></div>
<button class="btn" style="width:100%" data-testid="trade-submit">Submit order</button><p class="error" data-testid="trade-error" style="margin-top:.8rem"></p>
<div class="confirm" data-testid="order-confirmation" hidden></div></form>
<div class="card"><div class="row between" style="margin-bottom:.8rem"><h2 style="margin:0">Today's orders</h2>
<div class="row"><div class="chips">${[['', 'All'], ['buy', 'Buys'], ['sell', 'Sells']].map(([v, l]) => `<button type="button" class="chip${v === '' ? ' on' : ''}" data-f="${v}">${l}</button>`).join('')}</div>
<span class="mini"><select data-testid="blotter-filter" aria-label="Filter"><option value="">All</option><option value="buy">Buy</option><option value="sell">Sell</option></select></span></div></div>
<div class="tablewrap"><table data-testid="blotter"><thead><tr><th>ID</th><th>Instrument</th><th>Side</th><th class="num">Price</th><th class="num">Qty</th><th class="num">Notional</th><th>Status</th></tr></thead><tbody id="tb"></tbody></table></div></div></div>
<div class="toast" id="toast"></div>`, '', 'ticket.js')));

const STATUSES = ['NEW', 'CONFIRMED', 'SETTLED', 'FAILED', 'CANCELLED'];
const CLASSES = [...new Set(INSTRUMENTS.map((i) => i.asset_class))];
app.get('/blotter', guard, (_req, res) => res.send(page('/blotter', 'Blotter', 'All bookings from the trades table. Cancelled trades stay in the DB for audit but are hidden unless you filter for them.',
  `<div class="card"><div class="row between" style="margin-bottom:.8rem">
<div class="chips" data-testid="asset-chips">${[['', 'All asset classes'], ...CLASSES.map((c) => [c, c])].map(([v, l]) => `<button type="button" class="chip${v === '' ? ' on' : ''}" data-ac="${v}">${l}</button>`).join('')}</div>
<div class="row"><span class="mini"><select data-testid="blotter-asset" aria-label="Asset class"><option value="">All asset classes</option>${CLASSES.map((c) => `<option>${c}</option>`).join('')}</select></span>
<span class="mini"><select data-testid="blotter-status" aria-label="Status"><option value="">Active (not cancelled)</option>${STATUSES.map((s) => `<option>${s}</option>`).join('')}<option value="ALL">All incl. cancelled</option></select></span></div></div>
<div class="row" style="margin-bottom:.6rem"><span class="sub" data-testid="blotter-summary"></span></div>
<div class="tablewrap"><table data-testid="full-blotter"><thead><tr><th>Trade</th><th>Instrument</th><th>Class</th><th>Side</th><th class="num">Price</th><th class="num">Qty</th><th class="num">Notional</th><th>Client</th><th>Cpty</th><th>Venue</th><th>Status</th></tr></thead><tbody id="fb"></tbody></table></div></div>`, '', 'blotter.js')));

app.get('/trades/:id', guard, (req, res) => res.send(page('/blotter', 'Trade ' + req.params.id.replace(/[^\w-]/g, ''), 'Lifecycle, audit trail and the FIX messages behind this booking.',
  `<div data-trade="${req.params.id.replace(/[^\w-]/g, '')}" id="trade-root"><div class="grid" style="grid-template-columns:minmax(320px,1fr) minmax(300px,380px);align-items:start">
<div class="card"><div class="row between"><h2 style="margin:0" data-testid="trade-title">Loading…</h2><span class="badge" data-testid="trade-status">–</span></div>
<div class="stepper" data-testid="stepper" style="margin:1rem 0"></div><div class="kv" data-testid="trade-fields"></div>
<div class="row" style="margin-top:1rem"><button class="btn" data-testid="action-confirm" data-act="confirm">Confirm</button><button class="btn" data-testid="action-settle" data-act="settle">Settle</button>
<button class="btn ghost" data-testid="action-fail" data-act="fail">Mark settlement failed</button><button class="btn danger" data-testid="action-cancel" data-act="cancel">Cancel trade</button></div>
<p class="error" data-testid="action-error" style="margin-top:.8rem"></p></div>
<form class="card" data-testid="amend-form" onsubmit="event.preventDefault();amend()"><h2>Amend (NEW only)</h2><p class="sub small">Re-validated against the tolerance band. Sends FIX 35=G and 35=8 150=5.</p>
<div class="grid g2" style="grid-template-columns:1fr 1fr;margin-top:.6rem"><label class="f">Quantity <input data-testid="amend-qty"></label><label class="f">Price <input data-testid="amend-price"></label></div>
<button class="btn" style="margin-top:.8rem;width:100%" data-testid="action-amend">Amend order</button></form></div>
<div class="grid g2" style="margin-top:1rem;align-items:start"><div class="card"><h2>Audit trail</h2><ol class="audit" data-testid="audit"></ol></div>
<div class="card"><div class="row between"><h2 style="margin:0">FIX messages</h2><a data-testid="open-fix-log" href="/fix?trade=${encodeURIComponent(req.params.id)}">Open in FIX log →</a></div><div data-testid="trade-fix" class="fixlist" style="margin-top:.8rem"></div></div></div></div>`, '', 'trade.js')));

app.get('/fix', guard, (_req, res) => res.send(page('/fix', 'FIX message log', 'Simulated FIX 4.4 session BRKDESK ↔ counterparties. Click a message to parse it into tags. SOH shown as |.',
  `<div class="grid" style="grid-template-columns:minmax(340px,1fr) minmax(320px,460px);align-items:start">
<div class="card"><div class="row between" style="margin-bottom:.8rem"><h2 style="margin:0">Messages</h2><input data-testid="fix-filter" placeholder="Filter by trade ID…" style="max-width:220px"></div>
<div class="tablewrap"><table data-testid="fix-table"><thead><tr><th>#</th><th>Time</th><th>Type</th><th>Trade</th><th>Summary</th></tr></thead><tbody id="fx"></tbody></table></div></div>
<div class="card sticky"><h2>Parsed message</h2><pre class="raw" data-testid="fix-raw">Select a message.</pre>
<div class="tablewrap"><table data-testid="fix-tags"><thead><tr><th>Tag</th><th>Name</th><th>Value</th></tr></thead><tbody id="ft"></tbody></table></div></div></div>`, '', 'fix.js')));

const PRESETS = require('../sql/presets');
app.get('/data-checks', guard, (_req, res) => res.send(page('/data-checks', 'Data checks (SQL)', 'Read-only SQL console on the live SQLite DB behind the blotter, FIX log and settlements. SELECT only.',
  `<div class="grid g4" style="margin-bottom:1rem">${PRESETS.map((p) => `<button type="button" class="card preset" data-testid="preset-${p.key}" data-key="${p.key}"><span class="badge ${p.gig ? 'blue' : 'teal'}">${p.ticket}</span><strong>${p.title}</strong><span class="sub">${p.why}</span></button>`).join('')}</div>
<div class="grid" style="grid-template-columns:minmax(320px,1fr) minmax(260px,340px);align-items:start">
<div class="card"><div class="row between" style="margin-bottom:.6rem"><h2 style="margin:0">Query</h2><span class="badge teal">read-only · SELECT only</span></div>
<textarea data-testid="sql-editor" class="sqled" spellcheck="false" aria-label="SQL query"></textarea>
<div class="row" style="margin-top:.8rem"><button class="btn" data-testid="sql-run" onclick="run()">Run query ▶</button><span class="sub" data-testid="sql-meta"></span></div>
<p class="error" data-testid="sql-error" style="margin-top:.8rem"></p>
<div class="tablewrap"><table data-testid="sql-results"><thead id="sh"></thead><tbody id="sb"><tr><td class="sub">Pick a check above or write a SELECT.</td></tr></tbody></table></div></div>
<div class="card"><h2>Schema</h2><p class="sub" style="margin-bottom:.6rem">In-memory SQLite, seeded with demo breaks.</p>
<div class="schema"><div><span class="kbd">trades</span> trade_id, instrument, asset_class, side, price, quantity, notional, client, counterparty, venue, status, cl_ord_id, trade_date</div>
<div><span class="kbd">settlements</span> settlement_id, trade_id, status, settled_on</div>
<div><span class="kbd">fix_messages</span> fix_id, trade_id, msg_type, cl_ord_id, exec_type, ord_status, symbol, side, qty, price, raw</div>
<div><span class="kbd">instruments</span> symbol, asset_class, ref_price, tolerance_pct</div>
<div><span class="kbd">audit</span> trade_id, action, from_status, to_status, detail, at</div>
<div><span class="kbd">rejects</span> instrument, reason, at</div>
<div><span class="kbd">payouts</span> (gig) payout_id, worker, shift_ref, amount</div></div>
<h2 style="margin-top:1.2rem">Seeded breaks</h2><ul class="sub defects"><li>BRK-318: 2 confirmed trades never settled, 1 FAILED</li><li>BRK-322: T-1008 is a duplicate booking of T-1002</li><li>BRK-327: cancelled trade in DB, not on blotter</li><li>BRK-411: FIX fill qty ≠ trade qty (T-1003); no exec report (T-1006)</li><li>BRK-415: Brent booked 11.8% off market (T-1009)</li></ul>
<button class="btn ghost" style="margin-top:.6rem" data-testid="sql-reseed" onclick="fetch('/api/reset?seed=demo',{method:'POST'}).then(()=>{$('[data-testid=sql-meta]').textContent='Demo data reloaded';})">Reload demo data</button></div></div>`,
  `const P=${JSON.stringify(PRESETS).replace(/</g, '\\u003c')};
$$('.preset').forEach(b=>b.onclick=()=>{$$('.preset').forEach(x=>x.classList.toggle('on',x===b));$('[data-testid=sql-editor]').value=P.find(p=>p.key===b.dataset.key).sql;run();});
async function run(){$('[data-testid=sql-error]').textContent='';const t0=performance.now();
const r=await post('/api/sql',{query:$('[data-testid=sql-editor]').value});
if(!r.ok){$('[data-testid=sql-error]').textContent=r.body.error;$('[data-testid=sql-meta]').textContent='';return;}
$('#sh').innerHTML='<tr>'+r.body.columns.map(c=>'<th>'+esc(c)+'</th>').join('')+'</tr>';
$('#sb').innerHTML=r.body.rows.map(row=>'<tr data-testid="sql-row">'+row.map(v=>v===null?'<td class="null">NULL</td>':'<td'+(typeof v==='number'?' class="num"':'')+'>'+esc(v)+'</td>').join('')+'</tr>').join('')||'<tr><td class="sub" colspan="'+r.body.columns.length+'">0 rows. No breaks found.</td></tr>';
$('[data-testid=sql-meta]').textContent=r.body.rows.length+' row(s) · '+Math.round(performance.now()-t0)+' ms';}
$('[data-testid=sql-editor]').addEventListener('keydown',e=>{if((e.ctrlKey||e.metaKey)&&e.key==='Enter')run();});`)));

// Gig platform (prior work)
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
$('#stmt').innerHTML='<div style="display:flex;justify-content:space-between"><div><h3>Gig Platform</h3><div style="color:#6b7280">Payout statement</div></div><div style="text-align:right"><div><strong>'+esc(p.id)+'</strong></div><div style="color:#6b7280">'+new Date().toLocaleDateString()+'</div></div></div><hr style="margin:1.2rem 0;border:0;border-top:1px solid #e5e7eb"><p>Paid to: <strong>'+esc(p.worker)+'</strong></p><table><thead><tr><th>Component</th><th class="num">Amount (₱)</th></tr></thead><tbody><tr><td>Base pay</td><td class="num">'+fmt(p.base)+'</td></tr><tr><td>Allowance</td><td class="num">'+fmt(p.allowance)+'</td></tr><tr><td>Special pay</td><td class="num">'+fmt(p.special)+'</td></tr><tr class="tot"><td>Total payout</td><td class="num" data-testid="statement-total">'+fmt(p.amount)+'</td></tr></tbody></table><p style="color:#6b7280;font-size:.8rem;margin-top:1.2rem">Demo document. Total must equal the sum of components and the API record.</p>';});`)));

if (require.main === module) app.listen(PORT, () => console.log(`BrokerDesk on http://localhost:${PORT}`));
module.exports = app;
