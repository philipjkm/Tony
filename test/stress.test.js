'use strict';
/**
 * Stress test of the tournament engine: hundreds of simulated 4-hour games with random
 * (and deliberately messy) host actions. After every step, invariants are checked.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const E = require('../src/engine');

const MIN = 60_000;
const HOURS4 = 4 * 60 * MIN;

function rng(seed) { // mulberry32
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function check(t, now, ctx) {
  const d = E.derive(t, now);
  const cfg = t.config;
  const where = () => `${ctx} @ ${Math.round(now / 1000)}s`;
  // clock
  assert.ok(Number.isInteger(t.clock.levelIndex) && t.clock.levelIndex >= 0 && t.clock.levelIndex < cfg.levels.length, `level index ${where()}`);
  assert.ok(Number.isFinite(d.remainingMs) && d.remainingMs >= 0 && d.remainingMs <= 4 * d.levelDurationMs + 1, `remaining ${d.remainingMs} ${where()}`);
  // players & seats
  const ids = new Set(t.players.map((p) => p.id));
  assert.equal(ids.size, t.players.length, `unique ids ${where()}`);
  const seats = t.players.map((p) => p.seat).filter((s) => s !== null);
  assert.equal(new Set(seats).size, seats.length, `one player per seat ${where()}`);
  assert.ok(seats.every((s) => Number.isInteger(s) && s >= 0 && s < cfg.seats), `seats in range ${where()}`);
  for (const p of t.players) {
    assert.ok(p.status === 'active' || p.status === 'out', `status ${where()}`);
    assert.ok(p.rebuys >= 0 && p.addons >= 0, `counts ${where()}`);
  }
  // places: out players get exactly active+1 .. entries
  const out = t.players.filter((p) => p.status === 'out');
  const places = out.map((p) => d.places[p.id]).sort((a, b) => a - b);
  places.forEach((pl, i) => assert.equal(pl, d.activeCount + 1 + i, `places contiguous ${where()}`));
  assert.equal(d.finished, d.entries > 1 && d.activeCount === 1 && out.length > 0, `finished flag ${where()}`);
  if (d.finished) assert.equal(d.places[d.winnerId], 1);
  // money
  const rebuys = t.players.reduce((s, p) => s + p.rebuys, 0);
  const addons = t.players.reduce((s, p) => s + p.addons, 0);
  const expectedPool = cfg.prizePool.mode === 'fixed' ? cfg.prizePool.fixed
    : Math.max(cfg.buyIn * t.players.length + cfg.rebuy.price * rebuys + cfg.addon.price * addons + cfg.prizePool.added, cfg.prizePool.guarantee);
  assert.equal(d.prizePool, expectedPool, `pool ${where()}`);
  if (cfg.payouts.mode === 'percent') {
    const sum = d.payouts.reduce((s, p) => s + p.amount, 0);
    assert.ok(Math.abs(sum - d.prizePool) < 0.01, `payouts sum ${sum} vs ${d.prizePool} ${where()}`);
    assert.ok(d.payouts.length <= Math.max(1, d.entries), `no more paid places than players ${where()}`);
  }
  assert.ok(d.payouts.every((p) => p.amount >= 0), `no negative payouts ${where()}`);
  assert.equal(d.totalChips, cfg.startingStack * t.players.length + cfg.rebuy.chips * rebuys + cfg.addon.chips * addons, `chips ${where()}`);
  // bounded memory
  assert.ok(t.log.length <= 300, `log bounded ${where()}`);
  const json = JSON.stringify(E.publicState(t, now));
  assert.ok(json.length < 200_000, `state size ${json.length} ${where()}`);
}

function randomConfig(r) {
  const cfg = E.defaultConfig();
  cfg.seats = 2 + Math.floor(r() * 11);
  cfg.buyIn = [0, 50, 100, 200][Math.floor(r() * 4)];
  cfg.rebuy.lastLevel = Math.floor(r() * 8);
  cfg.rebuy.maxPerPlayer = Math.floor(r() * 3);
  cfg.addon.lastLevel = Math.floor(r() * 10);
  cfg.prizePool = r() < 0.2 ? { mode: 'fixed', fixed: 1000, added: 0, guarantee: 0 } : { mode: 'auto', fixed: 0, added: Math.floor(r() * 200), guarantee: r() < 0.3 ? 1500 : 0 };
  cfg.payouts = r() < 0.8 ? { mode: 'percent', places: [[100], [65, 35], [50, 30, 20], [70, 30]][Math.floor(r() * 4)] } : { mode: 'amount', places: [300, 200] };
  if (r() < 0.3) cfg.levels = cfg.levels.slice(0, 4 + Math.floor(r() * 6)); // short structures run past the end
  if (r() < 0.2) cfg.levels.forEach((l) => { l.minutes = 5; });
  return cfg;
}

function simulate(seed) {
  const r = rng(seed);
  const n = 2 + Math.floor(r() * 16);
  const players = Array.from({ length: n }, (_, i) => ({ name: 'P' + i }));
  let now = 1_700_000_000_000;
  const start = now;
  let t = E.createTournament(randomConfig(r), players, now);
  E.apply(t, { type: 'clock.start' }, now);
  let actions = 0;
  let errors = 0;
  const pick = () => t.players[Math.floor(r() * t.players.length)];

  while (now - start < HOURS4) {
    now += Math.floor(1000 + r() * 120_000); // 1s..2min between things happening
    E.tick(t, now);
    const x = r();
    let action = null;
    if (x < 0.10) action = { type: 'player.eliminate', playerId: pick().id };
    else if (x < 0.16) action = { type: 'player.rebuy', playerId: pick().id };
    else if (x < 0.20) action = { type: 'player.addon', playerId: pick().id };
    else if (x < 0.24) action = { type: 'undo' };
    else if (x < 0.28) action = { type: 'player.seat', playerId: pick().id, seat: r() < 0.2 ? null : Math.floor(r() * (t.config.seats + 1)) };
    else if (x < 0.31) action = { type: 'clock.toggle' };
    else if (x < 0.33) action = { type: r() < 0.5 ? 'clock.next' : 'clock.prev' };
    else if (x < 0.35) action = { type: 'clock.adjust', ms: (r() < 0.5 ? -1 : 1) * MIN };
    else if (x < 0.36) action = { type: 'clock.goto', levelIndex: Math.floor(r() * 40) - 5 };
    else if (x < 0.37) action = { type: 'nonsense', foo: 1 };
    if (action) {
      // a quick double-tap (sent twice) now and then
      const times = r() < 0.05 ? 2 : 1;
      for (let i = 0; i < times; i++) {
        let undoBefore = null;
        const pick5 = (p) => [p.id, p.status, p.rebuys, p.addons, p.eliminatedAt];
        if (action.type === 'undo' && t.log.length) {
          const ids = new Set(t.players.map((p) => p.id));
          undoBefore = JSON.stringify(t.log[t.log.length - 1].before.players.filter((p) => ids.has(p.id)).map(pick5).sort());
        }
        try {
          E.apply(t, action, now);
          actions++;
          if (undoBefore) {
            const prevIds = new Set(JSON.parse(undoBefore).map((x) => x[0]));
            assert.equal(JSON.stringify(t.players.filter((p) => prevIds.has(p.id)).map(pick5).sort()), undoBefore, `undo restores the game state (seed ${seed})`);
          }
        } catch (e) {
          if (!(e instanceof E.ActionError)) throw e;
          errors++;
        }
      }
    }
    // settings changed mid-game
    if (r() < 0.01) {
      const cfg = JSON.parse(JSON.stringify(t.config));
      cfg.seats = 2 + Math.floor(r() * 11);
      if (r() < 0.5) cfg.levels.push({ type: 'level', sb: 9000, bb: 18000, ante: 18000, minutes: 15 });
      const list = t.players.map((p) => ({ id: p.id, name: p.name, photo: p.photo, hat: p.hat }));
      if (r() < 0.5) list.push({ name: 'Late ' + now });
      if (r() < 0.2 && list.length > 2) list.splice(Math.floor(r() * list.length), 1);
      E.updateSetup(t, cfg, list, now);
    }
    // server restart: save → load (as server.js does)
    if (r() < 0.005) {
      const saved = JSON.parse(JSON.stringify({ ...t, savedAt: now }));
      saved.config = E.normalizeConfig(saved.config);
      E.fixSeats(saved);
      if (saved.clock.running) {
        saved.clock.remainingMs = Math.max(1000, saved.clock.remainingMs - (saved.savedAt - saved.clock.anchor));
        saved.clock.running = false;
        saved.clock.anchor = now;
      }
      t = saved;
      E.apply(t, { type: 'clock.start' }, now);
    }
    check(t, now, `seed ${seed}`);
  }
  return { actions, errors, t, now };
}

test('300 simulated 4-hour tournaments keep every invariant', () => {
  let actions = 0;
  let rejected = 0;
  for (let seed = 1; seed <= 300; seed++) {
    const r = simulate(seed);
    actions += r.actions;
    rejected += r.errors;
  }
  assert.ok(actions + rejected > 20_000, `enough actions exercised (${actions} accepted, ${rejected} correctly refused)`);
  console.log(`    ${actions} accepted actions, ${rejected} correctly refused`);
  // rejected = actions the app correctly refused (e.g. eliminating someone already out)
  assert.ok(rejected > 0);
});

test('clock accuracy: an untouched 4-hour run lands exactly on the expected level', () => {
  const t = E.createTournament(E.defaultConfig(), [{ name: 'A' }, { name: 'B' }], 0);
  E.apply(t, { type: 'clock.start' }, 0);
  // tick 4 times a second for 4 hours, like the server does
  for (let now = 0; now <= HOURS4; now += 250) E.tick(t, now);
  const levels = t.config.levels;
  let left = HOURS4;
  let idx = 0;
  while (left >= E.levelMs(levels[idx]) && idx < levels.length - 1) { left -= E.levelMs(levels[idx]); idx++; }
  const d = E.derive(t, HOURS4);
  assert.equal(d.levelIndex, idx);
  assert.equal(d.remainingMs, E.levelMs(levels[idx]) - left);
});

test('pause/resume 500 times does not lose or gain time', () => {
  const t = E.createTournament(E.defaultConfig(), [{ name: 'A' }, { name: 'B' }], 0);
  let now = 0;
  let runTime = 0;
  for (let i = 0; i < 500; i++) {
    E.apply(t, { type: 'clock.start' }, now);
    const run = 1000 + (i % 7) * 777;
    now += run;
    runTime += run;
    E.apply(t, { type: 'clock.pause' }, now);
    now += 5000 + (i % 3) * 1000; // paused time must not count
  }
  const total = t.config.levels.slice(0, t.clock.levelIndex).reduce((s, l) => s + E.levelMs(l), 0) + (E.levelMs(t.config.levels[t.clock.levelIndex]) - E.derive(t, now).remainingMs);
  assert.equal(total, runTime);
});
