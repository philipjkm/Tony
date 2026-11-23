'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const E = require('../src/engine');

const T0 = 1_700_000_000_000;
const MIN = 60_000;

function make(n = 5, cfg = {}) {
  const players = Array.from({ length: n }, (_, i) => ({ id: 'p' + (i + 1), name: 'Player ' + (i + 1) }));
  return E.createTournament({ ...E.defaultConfig(), ...cfg }, players, T0);
}
const P = (t, id) => t.players.find((p) => p.id === id);

test('defaults: level 1 paused at full time', () => {
  const t = make();
  const d = E.derive(t, T0);
  assert.equal(d.levelIndex, 0);
  assert.equal(d.levelNumber, 1);
  assert.equal(d.running, false);
  assert.equal(d.remainingMs, 15 * MIN);
  assert.equal(d.activeCount, 5);
  assert.equal(d.entries, 5);
});

test('config normalization rejects junk and keeps safe values', () => {
  const c = E.normalizeConfig({
    buyIn: -10, startingStack: 'abc', levels: [{ type: 'break', minutes: 5 }],
    chips: [{ value: 5, color: 'red;evil', image: 'javascript:alert(1)' }],
    payouts: { places: [] },
  });
  assert.equal(c.buyIn, 0);
  assert.equal(c.startingStack, 10000); // falls back to default
  assert.ok(c.levels.some((l) => l.type === 'level'), 'at least one real level');
  assert.equal(c.chips[0].color, '#888888');
  assert.equal(c.chips[0].image, '');
  assert.deepEqual(c.payouts.places, [100]);
});

test('clock runs, pauses and resumes accurately', () => {
  const t = make();
  E.apply(t, { type: 'clock.start' }, T0);
  assert.equal(E.derive(t, T0 + 30_000).remainingMs, 15 * MIN - 30_000);
  E.apply(t, { type: 'clock.pause' }, T0 + 60_000);
  // time does not pass while paused
  assert.equal(E.derive(t, T0 + 10 * MIN).remainingMs, 14 * MIN);
  E.apply(t, { type: 'clock.toggle' }, T0 + 10 * MIN);
  assert.equal(E.derive(t, T0 + 11 * MIN).remainingMs, 13 * MIN);
});

test('clock auto-advances levels including breaks, carrying over time', () => {
  const t = make(3, { levels: [
    { type: 'level', sb: 10, bb: 20, ante: 0, minutes: 1 },
    { type: 'break', minutes: 2, label: 'Break' },
    { type: 'level', sb: 20, bb: 40, ante: 40, minutes: 1 },
  ] });
  E.apply(t, { type: 'clock.start' }, T0);
  let ev = E.tick(t, T0 + 61_000);
  assert.deepEqual(ev.map((e) => e.type), ['level']);
  let d = E.derive(t, T0 + 61_000);
  assert.equal(d.level.type, 'break');
  assert.equal(d.remainingMs, 2 * MIN - 1000);
  assert.equal(d.levelNumber, 1, 'break counts as the previous level number');
  // skip far past everything: lands on the last level, which keeps repeating (play goes on)
  ev = E.tick(t, T0 + 10 * MIN + 15_000);
  d = E.derive(t, T0 + 10 * MIN + 15_000);
  assert.equal(d.levelIndex, 2);
  assert.equal(d.levelNumber, 2);
  assert.equal(d.remainingMs, 45_000);
  assert.equal(d.running, true, 'clock keeps running on the final level');
  assert.ok(ev.some((e) => e.type === 'finalLevelRepeats'));
});

test('next/prev/adjust/reset level', () => {
  const t = make();
  E.apply(t, { type: 'clock.next' }, T0);
  assert.equal(t.clock.levelIndex, 1);
  E.apply(t, { type: 'clock.prev' }, T0);
  E.apply(t, { type: 'clock.prev' }, T0); // clamps at 0
  assert.equal(t.clock.levelIndex, 0);
  E.apply(t, { type: 'clock.adjust', ms: 60_000 }, T0);
  assert.equal(E.derive(t, T0).remainingMs, 16 * MIN);
  E.apply(t, { type: 'clock.adjust', ms: -100 * MIN }, T0);
  assert.equal(E.derive(t, T0).remainingMs, 1000, 'never below 1 second');
  E.apply(t, { type: 'clock.resetLevel' }, T0);
  assert.equal(E.derive(t, T0).remainingMs, 15 * MIN);
  const last = t.config.levels.length - 1;
  E.apply(t, { type: 'clock.goto', levelIndex: last }, T0);
  assert.throws(() => E.apply(t, { type: 'clock.next' }, T0), E.ActionError);
});

test('prize pool: auto with rebuys, add-ons, added money and guarantee', () => {
  const t = make(4, { buyIn: 20, rebuy: { enabled: true, price: 20, chips: 5000, lastLevel: 0, maxPerPlayer: 0 }, addon: { enabled: true, price: 10, chips: 5000, lastLevel: 0, maxPerPlayer: 1 }, prizePool: { mode: 'auto', added: 15, guarantee: 0 } });
  E.apply(t, { type: 'player.rebuy', playerId: 'p1' }, T0);
  E.apply(t, { type: 'player.addon', playerId: 'p2' }, T0);
  let d = E.derive(t, T0);
  assert.equal(d.prizePool, 4 * 20 + 20 + 10 + 15);
  assert.equal(d.totalChips, 4 * 10000 + 5000 + 5000);
  assert.equal(d.avgStack, Math.round(50000 / 4));
  t.config.prizePool.guarantee = 500;
  assert.equal(E.derive(t, T0).prizePool, 500);
  t.config.prizePool = { mode: 'fixed', fixed: 1234, added: 0, guarantee: 0 };
  assert.equal(E.derive(t, T0).prizePool, 1234);
});

test('payouts sum exactly to the pool (percent) and support fixed amounts', () => {
  const list = E.computePayouts({ mode: 'percent', places: [50, 30, 20] }, 333);
  assert.equal(list.reduce((s, p) => s + p.amount, 0), 333);
  assert.deepEqual(list.map((p) => p.place), [1, 2, 3]);
  // percentages that do not add to 100 are scaled
  const scaled = E.computePayouts({ mode: 'percent', places: [3, 1] }, 100);
  assert.deepEqual(scaled.map((p) => p.amount), [75, 25]);
  const fixed = E.computePayouts({ mode: 'amount', places: [300, 100] }, 400);
  assert.deepEqual(fixed.map((p) => p.amount), [300, 100]);
});

test('eliminations assign places in order and finish with a winner', () => {
  const t = make(4);
  E.apply(t, { type: 'clock.start' }, T0);
  let r = E.apply(t, { type: 'player.eliminate', playerId: 'p2' }, T0 + 1000);
  assert.equal(r.events[0].type, 'eliminated');
  assert.equal(r.events[0].place, 4);
  E.apply(t, { type: 'player.eliminate', playerId: 'p4' }, T0 + 2000);
  r = E.apply(t, { type: 'player.eliminate', playerId: 'p1' }, T0 + 3000);
  assert.equal(r.events[0].place, 2);
  const w = r.events.find((e) => e.type === 'winner');
  assert.ok(w, 'winner event');
  assert.equal(w.playerId, 'p3');
  const d = E.derive(t, T0 + 3000);
  assert.equal(d.finished, true);
  assert.equal(d.winnerId, 'p3');
  assert.deepEqual(d.places, { p3: 1, p1: 2, p4: 3, p2: 4 });
  assert.equal(d.running, false, 'clock pauses when the tournament ends');
  assert.throws(() => E.apply(t, { type: 'player.eliminate', playerId: 'p3' }, T0 + 4000), /finished|already/i);
});

test('elimination prize is reported for paid places', () => {
  const t = make(3, { buyIn: 100, payouts: { mode: 'percent', places: [70, 30] } });
  let r = E.apply(t, { type: 'player.eliminate', playerId: 'p1' }, T0);
  assert.equal(r.events[0].prize, 0, '3rd is unpaid');
  r = E.apply(t, { type: 'player.eliminate', playerId: 'p2' }, T0 + 1);
  assert.equal(r.events[0].prize, 90);
  assert.equal(r.events.find((e) => e.type === 'winner').prize, 210);
});

test('cannot eliminate an out player or the same player twice', () => {
  const t = make(3);
  E.apply(t, { type: 'player.eliminate', playerId: 'p1' }, T0);
  assert.throws(() => E.apply(t, { type: 'player.eliminate', playerId: 'p1' }, T0), /already/i);
  assert.throws(() => E.apply(t, { type: 'player.eliminate', playerId: 'nope' }, T0), /not found/i);
});

test('rebuy re-enters an eliminated player and places stay consistent', () => {
  const t = make(4);
  E.apply(t, { type: 'player.eliminate', playerId: 'p1' }, T0 + 1);
  E.apply(t, { type: 'player.eliminate', playerId: 'p2' }, T0 + 2);
  const r = E.apply(t, { type: 'player.rebuy', playerId: 'p1' }, T0 + 3);
  assert.equal(r.events[0].reentry, true);
  assert.equal(P(t, 'p1').status, 'active');
  assert.equal(P(t, 'p1').rebuys, 1);
  const d = E.derive(t, T0 + 3);
  assert.equal(d.activeCount, 3);
  assert.equal(d.places.p2, 4, 'p2 is now the only player out → 4th');
  assert.equal(d.places.p1, undefined);
});

test('rebuy rules: closes after last level and respects max per player', () => {
  const t = make(3, { rebuy: { enabled: true, price: 10, chips: 100, lastLevel: 2, maxPerPlayer: 2 } });
  E.apply(t, { type: 'player.rebuy', playerId: 'p1' }, T0);
  E.apply(t, { type: 'player.rebuy', playerId: 'p1' }, T0);
  assert.throws(() => E.apply(t, { type: 'player.rebuy', playerId: 'p1' }, T0), /max 2/i);
  // move to level 3 (skipping breaks)
  const idx = t.config.levels.findIndex((l, i) => l.type === 'level' && E.levelNumberAt(t.config.levels, i) === 3);
  E.apply(t, { type: 'clock.goto', levelIndex: idx }, T0);
  assert.throws(() => E.apply(t, { type: 'player.rebuy', playerId: 'p2' }, T0), /closed after level 2/i);
  t.config.rebuy.enabled = false;
  assert.throws(() => E.apply(t, { type: 'player.rebuy', playerId: 'p2' }, T0), /disabled/i);
});

test('add-on rules: active players only, max per player, closes after level', () => {
  const t = make(3, { addon: { enabled: true, price: 10, chips: 100, lastLevel: 1, maxPerPlayer: 1 } });
  E.apply(t, { type: 'player.addon', playerId: 'p1' }, T0);
  assert.throws(() => E.apply(t, { type: 'player.addon', playerId: 'p1' }, T0), /max 1/i);
  E.apply(t, { type: 'player.eliminate', playerId: 'p2' }, T0);
  assert.throws(() => E.apply(t, { type: 'player.addon', playerId: 'p2' }, T0), /eliminated/i);
  E.apply(t, { type: 'clock.next' }, T0);
  assert.throws(() => E.apply(t, { type: 'player.addon', playerId: 'p3' }, T0), /closed/i);
});

test('undo reverts eliminations, rebuys and add-ons (and un-finishes)', () => {
  const t = make(2);
  E.apply(t, { type: 'player.addon', playerId: 'p1' }, T0);
  E.apply(t, { type: 'player.eliminate', playerId: 'p2' }, T0);
  assert.equal(E.derive(t, T0).finished, true);
  E.apply(t, { type: 'undo' }, T0);
  assert.equal(E.derive(t, T0).finished, false);
  assert.equal(P(t, 'p2').status, 'active');
  E.apply(t, { type: 'undo' }, T0);
  assert.equal(P(t, 'p1').addons, 0);
  assert.throws(() => E.apply(t, { type: 'undo' }, T0), /nothing to undo/i);
});

test('updateSetup keeps progress, adds/removes players and keeps elapsed time', () => {
  const t = make(3);
  E.apply(t, { type: 'clock.start' }, T0);
  E.apply(t, { type: 'player.eliminate', playerId: 'p1' }, T0 + 1000);
  const cfg = JSON.parse(JSON.stringify(t.config));
  cfg.name = 'Renamed';
  cfg.levels[0].minutes = 20;
  E.updateSetup(t, cfg, [
    { id: 'p1', name: 'Uno', photo: '/uploads/abc.jpg' },
    { id: 'p3', name: 'Tres' },
    { name: 'Late Larry' },
  ], T0 + 5 * MIN);
  assert.equal(t.config.name, 'Renamed');
  assert.equal(t.players.length, 3);
  assert.equal(P(t, 'p1').status, 'out', 'progress kept');
  assert.equal(P(t, 'p1').name, 'Uno');
  assert.equal(P(t, 'p1').photo, '/uploads/abc.jpg');
  assert.ok(!P(t, 'p2'), 'removed player gone');
  assert.equal(E.derive(t, T0 + 5 * MIN).remainingMs, 15 * MIN, '20 min level with 5 min elapsed');
  assert.equal(t.clock.running, true);
});

test('publicState exposes per-player permissions and hides undo snapshots', () => {
  const t = make(3, { addon: { enabled: false } });
  E.apply(t, { type: 'player.eliminate', playerId: 'p1' }, T0);
  const s = E.publicState(t, T0);
  const p1 = s.players.find((p) => p.id === 'p1');
  const p2 = s.players.find((p) => p.id === 'p2');
  assert.equal(p1.canEliminate, false);
  assert.equal(p1.canRebuy, true);
  assert.equal(p1.place, 3);
  assert.equal(p2.canAddon, false);
  assert.match(p2.addonReason, /disabled/i);
  assert.equal(s.undo.type, 'eliminate');
  assert.ok(!('before' in s.log[0]));
  assert.ok(JSON.stringify(s).length < 20000);
});

test('unknown action is rejected', () => {
  const t = make();
  assert.throws(() => E.apply(t, { type: 'hack' }, T0), E.ActionError);
  assert.throws(() => E.apply(t, null, T0), E.ActionError);
});

test('seats: auto-assigned, overflow goes to waiting list', () => {
  const t = make(5, { seats: 3 });
  assert.deepEqual(t.players.map((p) => p.seat), [0, 1, 2, null, null]);
  assert.equal(E.derive(t, T0).waitingCount, 2);
});

test('seats: move to empty seat, swap, and send to waiting list', () => {
  const t = make(4, { seats: 4 });
  E.apply(t, { type: 'player.seat', playerId: 'p4', seat: null }, T0); // p4 → waiting
  assert.equal(P(t, 'p4').seat, null);
  E.apply(t, { type: 'player.seat', playerId: 'p4', seat: 3 }, T0); // back to empty seat
  assert.equal(P(t, 'p4').seat, 3);
  E.apply(t, { type: 'player.seat', playerId: 'p1', seat: 2 }, T0); // swap with p3
  assert.equal(P(t, 'p1').seat, 2);
  assert.equal(P(t, 'p3').seat, 0);
  E.apply(t, { type: 'player.seat', playerId: 'p2', seat: null }, T0);
  E.apply(t, { type: 'player.seat', playerId: 'p1', seat: 1 }, T0); // into the freed seat
  assert.equal(P(t, 'p1').seat, 1);
  // waiting player dropped onto an occupied seat swaps that player to the waiting list
  E.apply(t, { type: 'player.seat', playerId: 'p2', seat: 3 }, T0);
  assert.equal(P(t, 'p2').seat, 3);
  assert.equal(P(t, 'p4').seat, null);
  assert.throws(() => E.apply(t, { type: 'player.seat', playerId: 'p2', seat: 9 }, T0), /no such seat/i);
  // seat moves can be undone
  E.apply(t, { type: 'undo' }, T0);
  assert.equal(P(t, 'p2').seat, null);
  assert.equal(P(t, 'p4').seat, 3);
  const seats = t.players.map((p) => p.seat).filter((x) => x !== null);
  assert.equal(new Set(seats).size, seats.length, 'no two players share a seat');
});

test('seats: shrinking the table moves extra players to waiting; new players fill free seats', () => {
  const t = make(4, { seats: 6 });
  const cfg = { ...t.config, seats: 3 };
  E.updateSetup(t, cfg, [...t.players, { name: 'Late' }], T0);
  assert.deepEqual(t.players.map((p) => p.seat), [0, 1, 2, null, null]);
  E.updateSetup(t, { ...cfg, seats: 4 }, [...t.players, { name: 'Later' }], T0);
  assert.equal(t.players.find((p) => p.name === 'Later').seat, 3, 'new player takes the free seat');
  assert.equal(t.players[3].seat, null, 'existing waiting players stay waiting (host decides)');
});

test('payouts never cover more places than there are players', () => {
  const t = make(2, { buyIn: 100, payouts: { mode: 'percent', places: [50, 30, 20] } });
  const d = E.derive(t, T0);
  assert.equal(d.payouts.length, 2);
  assert.equal(d.payouts.reduce((s, p) => s + p.amount, 0), 200, 'whole pool still paid out');
});

test('undo after a settings change keeps the settings (seats, removed and late players)', () => {
  const t = make(4, { seats: 6 });
  E.apply(t, { type: 'player.seat', playerId: 'p1', seat: 5 }, T0);
  E.apply(t, { type: 'player.eliminate', playerId: 'p2' }, T0);
  E.updateSetup(t, { ...t.config, seats: 4 }, [
    ...t.players.filter((p) => p.id !== 'p3').map((p) => ({ id: p.id, name: p.name })),
    { name: 'Late' },
  ], T0);
  E.apply(t, { type: 'undo' }, T0); // undoes the elimination of p2
  assert.equal(P(t, 'p2').status, 'active');
  assert.ok(!P(t, 'p3'), 'removed player stays removed');
  assert.ok(t.players.some((p) => p.name === 'Late'), 'late player stays');
  E.apply(t, { type: 'undo' }, T0); // undoes p1 → seat 5, which no longer exists
  assert.ok(t.players.every((p) => p.seat === null || p.seat < 4), 'no one in a seat that no longer exists');
});

test('bubble, in the money and heads-up moments', () => {
  const t = make(5, { buyIn: 100, payouts: { mode: 'percent', places: [50, 30, 20] } });
  assert.equal(E.derive(t, T0).bubble, false);
  let r = E.apply(t, { type: 'player.eliminate', playerId: 'p1' }, T0 + 1);
  assert.ok(r.events.some((e) => e.type === 'bubble'), 'now on the bubble (4 left, 3 paid)');
  assert.equal(E.derive(t, T0 + 1).bubble, true);
  r = E.apply(t, { type: 'player.eliminate', playerId: 'p2' }, T0 + 2);
  const out = r.events.find((e) => e.type === 'eliminated');
  assert.equal(out.burstBubble, true);
  assert.equal(out.prize, 0, 'the bubble boy wins nothing');
  assert.equal(r.events.find((e) => e.type === 'inTheMoney').bubbleBoy, 'Player 2');
  const d = E.derive(t, T0 + 2);
  assert.equal(d.bubble, false);
  assert.equal(d.inTheMoney, true);
  r = E.apply(t, { type: 'player.eliminate', playerId: 'p3' }, T0 + 3);
  assert.ok(r.events.some((e) => e.type === 'headsUp'));
  assert.ok(!r.events.some((e) => e.type === 'bubble'));
  // undo the bubble burst → back on the bubble
  E.apply(t, { type: 'undo' }, T0 + 4);
  E.apply(t, { type: 'undo' }, T0 + 4);
  assert.equal(E.derive(t, T0 + 4).bubble, true);
  // when everyone is paid there is no bubble
  const t2 = make(3, { payouts: { mode: 'percent', places: [50, 30, 20] } });
  assert.equal(E.derive(t2, T0).bubble, false);
  assert.ok(!E.apply(t2, { type: 'player.eliminate', playerId: 'p1' }, T0).events.some((e) => e.type === 'bubble' || e.type === 'inTheMoney'));
});

test('first start is flagged (for "shuffle up and deal")', () => {
  const t = make(3);
  assert.equal(E.apply(t, { type: 'clock.start' }, T0).events[0].first, true);
  E.apply(t, { type: 'clock.pause' }, T0 + 1);
  assert.equal(E.apply(t, { type: 'clock.start' }, T0 + 2).events[0].first, false);
});

test('extra per player goes into the pool, except for exempted players', () => {
  const players = ['Philip', 'Tony', 'Maria', 'Jake'].map((name, i) => ({ id: 'p' + i, name, paysExtra: name !== 'Philip' }));
  const t = E.createTournament({ ...E.defaultConfig(), buyIn: 100, prizePool: { mode: 'auto', added: 0, guarantee: 0, extra: 300 } }, players, T0);
  let d = E.derive(t, T0);
  assert.equal(d.extraTotal, 900);
  assert.equal(d.prizePool, 4 * 100 + 3 * 300);
  assert.equal(d.payouts.reduce((s, p) => s + p.amount, 0), d.prizePool);
  // a late player pays it too; settings change keeps Philip exempt
  E.updateSetup(t, t.config, [...t.players.map((p) => ({ id: p.id, name: p.name, paysExtra: p.paysExtra })), { name: 'Late' }], T0);
  d = E.derive(t, T0);
  assert.equal(d.prizePool, 5 * 100 + 4 * 300);
  assert.equal(t.players[0].paysExtra, false);
  // fixed prize pool ignores it
  t.config.prizePool.mode = 'fixed';
  t.config.prizePool.fixed = 1000;
  assert.equal(E.derive(t, T0).prizePool, 1000);
});

test('all browser scripts are valid JavaScript', () => {
  const fs = require('fs');
  const path = require('path');
  const vm = require('vm');
  const dir = path.join(__dirname, '..', 'public', 'js');
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.js'))) {
    assert.doesNotThrow(() => new vm.Script(fs.readFileSync(path.join(dir, f), 'utf8'), { filename: f }), `${f} has a syntax error`);
  }
});

test('Danish announcer by default', () => {
  assert.deepEqual(E.defaultConfig().announcer, { voice: 'santa', lang: 'da' });
  assert.equal(E.normalizeConfig({}).announcer.lang, 'da');
  assert.equal(E.normalizeConfig({ announcer: { lang: 'en' } }).announcer.lang, 'en', 'English can still be chosen');
});

test('player fun facts: each told once per game, then none left; edits keep what was told', () => {
  const t = E.createTournament({ ...E.defaultConfig(), rebuy: { enabled: true, price: 10, chips: 100, lastLevel: 0, maxPerPlayer: 0 } }, [
    { id: 'a', name: 'Tony', facts: 'Har aldrig foldet esser\n\n  Elsker risalamande  \nKom for sent sidste år' },
    { id: 'b', name: 'Maria' },
    { id: 'c', name: 'Jake' },
  ], T0);
  assert.deepEqual(t.players[0].facts, ['Har aldrig foldet esser', 'Elsker risalamande', 'Kom for sent sidste år']);
  const told = [];
  for (let i = 0; i < 3; i++) told.push(E.apply(t, { type: 'player.rebuy', playerId: 'a' }, T0).events[0].fact);
  assert.equal(new Set(told).size, 3, 'three different facts');
  assert.equal(E.apply(t, { type: 'player.rebuy', playerId: 'a' }, T0).events[0].fact, null, 'no repeats');
  assert.equal(E.apply(t, { type: 'player.eliminate', playerId: 'b' }, T0).events[0].fact, null, 'no facts → none');
  // adding a fact mid-game: only the new one is left to tell
  E.updateSetup(t, t.config, [{ id: 'a', name: 'Tony', facts: [...t.players[0].facts, 'Ny fact'] }, { id: 'b', name: 'Maria' }, { id: 'c', name: 'Jake' }], T0);
  assert.equal(E.apply(t, { type: 'player.rebuy', playerId: 'a' }, T0).events[0].fact, 'Ny fact');
  assert.ok(t.players[0].facts.length <= 25);
});

test('facts can be labelled for a moment: "Rebuy:" / "Out:" (or Danish "Køb:" / "Ude:")', () => {
  const t = E.createTournament({ ...E.defaultConfig(), rebuy: { enabled: true, price: 10, chips: 100, lastLevel: 0, maxPerPlayer: 0 } }, [
    { id: 'a', name: 'Tony', facts: ['Rebuy: Tony betaler igen', 'Ude: Tony er ude, igen', 'Altid sidst til bords'] },
    { id: 'b', name: 'Maria' }, { id: 'c', name: 'Jake' },
  ], T0);
  const r1 = E.apply(t, { type: 'player.rebuy', playerId: 'a' }, T0).events[0].fact;
  assert.equal(r1, 'Tony betaler igen', 'the rebuy line first, without its label');
  const r2 = E.apply(t, { type: 'player.rebuy', playerId: 'a' }, T0).events[0].fact;
  assert.equal(r2, 'Altid sidst til bords', 'then a general line');
  assert.equal(E.apply(t, { type: 'player.rebuy', playerId: 'a' }, T0).events[0].fact, null, 'never the "out" line on a rebuy');
  assert.equal(E.apply(t, { type: 'player.eliminate', playerId: 'a' }, T0).events[0].fact, 'Tony er ude, igen');
});

test('Danish numbers are spoken as Danish words', () => {
  const fs = require('fs');
  const vm = require('vm');
  const ctx = { PT: { ordinal: (n) => n + '.' }, window: {}, document: { addEventListener() {} }, localStorage: { getItem() { return null; }, setItem() {} }, console };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(require('path').join(__dirname, '..', 'public', 'js', 'announcer.js'), 'utf8'), ctx);
  const say = ctx.PT.speakDanishNumbers;
  const cases = {
    'vinder 4060 kroner': 'vinder fire tusind og tres kroner',
    'vinder 4.060 kroner': 'vinder fire tusind og tres kroner',
    '1200 kroner': 'et tusind to hundrede kroner',
    '2025 kroner': 'to tusind og femogtyve kroner',
    '12500 kroner': 'tolv tusind fem hundrede kroner',
    '150 kroner': 'et hundrede og halvtreds kroner',
    'Blinds er nu 200 og 400': 'Blinds er nu to hundrede og fire hundrede',
    'Blinds er nu 75 og 150': 'Blinds er nu femoghalvfjerds og et hundrede og halvtreds',
    'Niveau 1!': 'Niveau et!',
    'Niveau 21!': 'Niveau enogtyve!',
    'ude på en 5. plads': 'ude på en femte plads',
    'på en 2. plads': 'på en anden plads',
    '1 time og 12 minutter': 'en time og tolv minutter',
    '1000000 kroner': 'en million kroner',
    '2001 kroner': 'to tusind og en kroner',
    '3 rebuys': 'tre rebuys',
  };
  for (const [input, want] of Object.entries(cases)) assert.equal(say(input), want, input);
});
