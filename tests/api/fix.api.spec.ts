import { test, expect } from '../../fixtures/test';

const tags = (m: any) => Object.fromEntries(m.tags);
// Recompute FIX BodyLength (9) and CheckSum (10) from the raw message (| stands for SOH).
function verify(raw: string) {
  const soh = raw.split('|').join('\x01') + '\x01';
  const bodyStart = soh.indexOf('\x01', soh.indexOf('9=')) + 1, csAt = soh.lastIndexOf('10=');
  const bodyLen = Buffer.byteLength(soh.slice(bodyStart, csAt));
  const sum = [...Buffer.from(soh.slice(0, csAt))].reduce((s, b) => s + b, 0) % 256;
  return { bodyLen, checksum: String(sum).padStart(3, '0') };
}

test.describe('FIX API', () => {
  test('each order produces 35=D + 35=8 with matching tags and valid BodyLength/CheckSum', async ({ api }) => {
    const { mid } = await (await api.get('/api/prices/XAUUSD')).json();
    const t = await (await api.post('/api/orders', { data: { instrument: 'XAUUSD', side: 'sell', price: mid, quantity: 15, client: 'Charlie Asset Mgmt', counterparty: 'NORTHBANK' } })).json();
    const msgs = (await (await api.get(`/api/fix?trade_id=${t.id}`)).json()).reverse(); // oldest first
    expect(msgs.map((m: any) => m.msg_type)).toEqual(['D', '8']);
    const [nos, er] = msgs.map(tags);
    expect(nos).toMatchObject({ 8: 'FIX.4.4', 35: 'D', 11: t.cl_ord_id, 55: 'XAUUSD', 54: '2', 38: '15', 44: String(mid), 56: 'NORTHBANK', 40: '2' });
    expect(er).toMatchObject({ 35: '8', 37: t.id, 11: t.cl_ord_id, 150: '0', 39: '0', 151: '15', 14: '0' });
    expect(Number(er[34])).toBe(Number(nos[34]) + 1); // MsgSeqNum increments
    for (const m of msgs) {
      const v = verify(m.raw);
      expect(Number(tags(m)[9])).toBe(v.bodyLen);
      expect(tags(m)[10]).toBe(v.checksum);
    }
  });

  test('cancel produces 35=F (41 = original ClOrdID) and 35=8 150=4 39=4', async ({ api }) => {
    const { mid } = await (await api.get('/api/prices/BRENT')).json();
    const t = await (await api.post('/api/orders', { data: { instrument: 'BRENT', side: 'buy', price: mid, quantity: 1000, client: 'Alpha Capital', counterparty: 'EASTSEC' } })).json();
    await api.post(`/api/trades/${t.id}/cancel`);
    const [er, cxl] = (await (await api.get(`/api/fix?trade_id=${t.id}`)).json()).map(tags); // newest first
    expect(cxl).toMatchObject({ 35: 'F', 41: t.cl_ord_id });
    expect(er).toMatchObject({ 35: '8', 150: '4', 39: '4', 11: cxl[11] });
  });
});
