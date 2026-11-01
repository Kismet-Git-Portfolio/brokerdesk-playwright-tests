// not in CI. npm start, then: k6 run -e PROFILE=smoke k6/load-trades.js
import http from 'k6/http';
import { check, sleep } from 'k6';

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3100';
const smoke = __ENV.PROFILE === 'smoke';

export const options = {
  scenarios: smoke
    ? { smoke: { executor: 'constant-vus', vus: 1, duration: '30s' } }
    : { load: { executor: 'ramping-vus', stages: [
        { duration: '30s', target: 20 },
        { duration: '1m', target: 20 },
        { duration: '15s', target: 0 },
      ] } },
  thresholds: {
    http_req_duration: ['p(95)<500'], // 95% of requests under 500 ms
    http_req_failed: ['rate<0.01'],   // under 1% errors
  },
};

export default function () {
  const side = Math.random() < 0.5 ? 'buy' : 'sell';
  const res = http.post(`${BASE_URL}/api/trades`, JSON.stringify({
    instrument: 'EURUSD', side, price: 1.08, quantity: Math.ceil(Math.random() * 1000),
  }), { headers: { 'Content-Type': 'application/json', 'Idempotency-Key': `${__VU}-${__ITER}-${Date.now()}` } });
  check(res, {
    'status is 201': (r) => r.status === 201,
    'notional is price*qty': (r) => { const t = r.json(); return t.notional === Math.round((t.price * t.quantity + Number.EPSILON) * 100) / 100; },
  });
  const list = http.get(`${BASE_URL}/api/trades?side=${side}`);
  check(list, { 'blotter 200': (r) => r.status === 200 });
  sleep(1);
}
