#!/usr/bin/env node
/**
 * Load test: N simulated players in one campaign, each behaving like a real client
 * (register, join, load state, open provinces, build, poll). Reports latency and errors.
 *
 *   node scripts/load-test.mjs --url http://localhost:3000 --players 50 --minutes 2 [--invite CODE]
 *
 * Start the server first with RATE_LIMIT_PER_MIN=100000 AUTH_RATE_LIMIT_PER_MIN=1000 in .env, because every
 * simulated player comes from this one address. Test accounts are named lt_<run>_<n>; delete them afterwards
 * (see docs/week16.md). Needs Node 20+.
 */
const args = Object.fromEntries(process.argv.slice(2).reduce((a, v, i, all) => (v.startsWith('--') ? [...a, [v.slice(2), all[i + 1] && !all[i + 1].startsWith('--') ? all[i + 1] : 'true']] : a), []));
const URL_ = (args.url ?? 'http://localhost:3000').replace(/\/$/, '') + '/api';
const PLAYERS = Number(args.players ?? 50);
const MINUTES = Number(args.minutes ?? 2);
const RUN = Date.now().toString(36);
const stats = new Map();
const failures = [];

class Client {
  constructor(n) { this.n = n; this.cookie = ''; this.name = `lt_${RUN}_${n}`; }
  async call(method, path, body) {
    const t0 = performance.now();
    let status = 0;
    try {
      const res = await fetch(URL_ + path, {
        method,
        headers: { 'content-type': 'application/json', 'accept-encoding': 'gzip', cookie: this.cookie },
        body: body ? JSON.stringify(body) : undefined,
      });
      status = res.status;
      const set = res.headers.getSetCookie?.() ?? [];
      if (set.length) this.cookie = set.map((c) => c.split(';')[0]).join('; ');
      const text = await res.text();
      let data = null;
      try { data = JSON.parse(text); } catch { /* not json */ }
      return { status, data, ms: performance.now() - t0, bytes: text.length };
    } catch (e) {
      return { status: 0, data: null, ms: performance.now() - t0, error: e.message };
    } finally {
      // recorded below
    }
  }
  async timed(label, method, path, body) {
    const r = await this.call(method, path, body);
    let s = stats.get(label);
    if (!s) stats.set(label, (s = { ms: [], errors: 0, bytes: 0 }));
    s.ms.push(r.ms);
    s.bytes += r.bytes ?? 0;
    // 4xx for game rules (not enough money, slot taken) are expected; only 5xx, 429 and network errors count.
    if (r.status === 0 || r.status >= 500 || r.status === 429) { s.errors++; failures.push(`${this.name} ${label} -> ${r.status} ${r.error ?? ''}`); }
    return r;
  }
}

const pct = (a, p) => { const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(s.length * p))] ?? 0; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pick = (a) => a[Math.floor(Math.random() * a.length)];
const BUILDS = ['local_factory', 'military_factory', 'recruitment_center', 'railway', 'research_lab'];

async function main() {
  console.log(`Load test: ${PLAYERS} players for ${MINUTES} min against ${URL_}`);
  const clients = Array.from({ length: PLAYERS }, (_, i) => new Client(i));
  const first = await clients[0].timed('register', 'POST', '/auth/register', { username: clients[0].name, password: 'loadtest-pass', inviteCode: args.invite });
  if (first.status !== 200 && first.status !== 201) throw new Error(`Cannot register (${first.status}): ${JSON.stringify(first.data)}`);
  await Promise.all(clients.slice(1).map((c) => c.timed('register', 'POST', '/auth/register', { username: c.name, password: 'loadtest-pass', inviteCode: args.invite })));

  // A campaign has 40 playable countries, so 50 players are spread over several campaigns (the server load is the same).
  const perCampaign = Number(args.perCampaign ?? 25);
  for (let g = 0; g * perCampaign < PLAYERS; g++) {
    const group = clients.slice(g * perCampaign, (g + 1) * perCampaign);
    const camp = await group[0].timed('createCampaign', 'POST', '/campaigns', { name: `Load test ${RUN} ${g + 1}` });
    if (!camp.data?.id) throw new Error(`Cannot create campaign (${camp.status}): ${JSON.stringify(camp.data)}`);
    const lobby = (await group[0].call('GET', `/campaigns/${camp.data.id}/lobby`)).data.filter((c) => c.isPlayable);
    if (group.length > lobby.length) throw new Error(`Only ${lobby.length} playable countries per campaign; lower --perCampaign.`);
    group.forEach((c, i) => { c.campaignId = camp.data.id; c.countryId = lobby[i].id; });
  }
  await Promise.all(clients.map((c) => c.timed('join', 'POST', `/campaigns/${c.campaignId}/join`, { countryId: c.countryId })));
  console.log('All players joined. Playing...');

  const end = Date.now() + MINUTES * 60_000;
  const play = async (c) => {
    const campaignId = c.campaignId;
    await sleep(Math.random() * 3000);
    let state = (await c.timed('state', 'GET', `/campaigns/${campaignId}/state`)).data;
    while (Date.now() < end) {
      const mine = state?.provinces?.filter((p) => p.ownerCountryId === state.me.countryId) ?? [];
      const roll = Math.random();
      if (roll < 0.35 && mine.length) await c.timed('province', 'GET', `/campaigns/${campaignId}/provinces/${pick(mine).id}`);
      else if (roll < 0.55 && mine.length) await c.timed('build', 'POST', `/campaigns/${campaignId}/provinces/${pick(mine).id}/buildings`, { type: pick(BUILDS) });
      else if (roll < 0.65) await c.timed('notifications', 'GET', `/campaigns/${campaignId}/notifications`);
      else state = (await c.timed('state', 'GET', `/campaigns/${campaignId}/state`)).data ?? state;
      await sleep(1500 + Math.random() * 3500);
    }
  };
  await Promise.all(clients.map(play));
  report();
}

function report() {
  console.log('\nroute            calls   p50 ms   p95 ms   max ms  errors  avg KB');
  let worstP95 = 0, errors = 0, calls = 0;
  for (const [label, s] of [...stats.entries()].sort()) {
    const p95 = pct(s.ms, 0.95);
    if (label !== 'register' && label !== 'join') worstP95 = Math.max(worstP95, p95);
    errors += s.errors; calls += s.ms.length;
    console.log(`${label.padEnd(16)} ${String(s.ms.length).padStart(5)} ${pct(s.ms, 0.5).toFixed(0).padStart(8)} ${p95.toFixed(0).padStart(8)} ${Math.max(...s.ms).toFixed(0).padStart(8)} ${String(s.errors).padStart(7)} ${(s.bytes / s.ms.length / 1024).toFixed(1).padStart(7)}`);
  }
  console.log(`\n${calls} calls, ${errors} errors (5xx, 429 or network). Slowest p95: ${worstP95.toFixed(0)} ms.`);
  if (failures.length) console.log('First failures:\n  ' + failures.slice(0, 8).join('\n  '));
  const pass = errors === 0 && worstP95 < 1000;
  console.log(pass ? 'PASS: no errors and every action under 1 s at p95.' : 'FAIL: see errors or slow routes above (GET /api/metrics shows server-side timings).');
  process.exit(pass ? 0 : 1);
}

main().catch((e) => { console.error(e.message); process.exit(2); });
