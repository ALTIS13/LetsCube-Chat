import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import test from 'node:test';
import { createUptimeCanary, observeUptimeCanary, retireUptimeCanary } from '../../scripts/ops/uptime-canary.mjs';

test('real loopback health and operator sink observe one opening, recovery and retirement', async () => {
  const sent = [];
  let health = 200;
  let lateHealth;
  let markReached;
  const server = createServer(async (req, res) => {
    if (req.url === '/health' && req.method === 'GET') {
      if (lateHealth) { markReached(); await lateHealth; }
      res.writeHead(health).end('fictional upstream detail never sent to sink');
      return;
    }
    if (req.url === '/operator-fixture' && req.method === 'POST') {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const body = Buffer.concat(chunks).toString('utf8');
      try { sent.push(JSON.parse(body)); res.writeHead(204).end(); }
      catch { res.writeHead(400).end(); }
      return;
    }
    res.writeHead(404).end();
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const origin = `http://127.0.0.1:${server.address().port}`;
  let state = createUptimeCanary();
  const request = (path, init) => fetch(origin + path, { ...init, redirect: 'error', signal: AbortSignal.timeout(5000) });
  const apply = async ({ state: next, notice }) => {
    state = next;
    if (!notice) return;
    const result = await request('/operator-fixture', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(notice) });
    assert.equal(result.status, 204);
  };
  const observe = async observedAt => {
    const response = await request('/health');
    await response.body.cancel();
    const outcome = response.status === 200 ? 'PASS' : response.status === 503 ? 'FAIL' : 'UNKNOWN';
    await apply(observeUptimeCanary(state, { observedAt, outcome }, observedAt));
  };
  try {
    const t = 180_000;
    await observe(t);
    health = 503;
    await observe(t + 60);
    assert.deepEqual(sent, []);
    await observe(t + 120);
    await observe(t + 180);
    assert.equal(sent.length, 1);
    health = 200;
    await observe(t + 240);
    await observe(t + 300);
    health = 503;
    await observe(t + 360);
    await observe(t + 420);
    let release;
    lateHealth = new Promise(resolve => { release = resolve; });
    const reached = new Promise(resolve => { markReached = resolve; });
    const pending = observe(t + 480);
    try {
      await Promise.race([reached, pending.then(() => assert.fail('probe settled before retirement'))]);
      await apply(retireUptimeCanary(state));
    } finally { release(); }
    await pending;
    assert.equal(state.phase, 'RETIRED');
    assert.deepEqual(sent, [
      { monitor: 'uptime-canary', kind: 'OPENED', incidentOpenedAt: 180_120 },
      { monitor: 'uptime-canary', kind: 'RECOVERED', incidentOpenedAt: 180_120 },
      { monitor: 'uptime-canary', kind: 'OPENED', incidentOpenedAt: 180_420 },
      { monitor: 'uptime-canary', kind: 'RETIRED', incidentOpenedAt: 180_420 },
    ]);
  } finally {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
});
