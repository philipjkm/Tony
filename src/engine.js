'use strict';
/**
 * Tournament engine — pure, deterministic logic (all time passed in as `now` in ms).
 * The server owns one tournament object and applies actions to it.
 */
const crypto = require('crypto');

const uid = () => crypto.randomBytes(5).toString('hex');
const MIN = 60 * 1000;
const MAX_SEATS = 12;
const clone = (o) => JSON.parse(JSON.stringify(o));
const num = (v, d = 0) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
};
const nonNeg = (v, d = 0) => Math.max(0, num(v, d));

function defaultLevels() {
  const blinds = [
    [25, 50, 0], [50, 100, 0], [75, 150, 0], [100, 200, 200],
    [150, 300, 300], [200, 400, 400], [300, 600, 600], [400, 800, 800],
    [500, 1000, 1000], [600, 1200, 1200], [800, 1600, 1600], [1000, 2000, 2000],
    [1500, 3000, 3000], [2000, 4000, 4000], [3000, 6000, 6000], [5000, 10000, 10000],
  ];
  const levels = [];
  blinds.forEach(([sb, bb, ante], i) => {
    levels.push({ type: 'level', sb, bb, ante, minutes: 15 });
    if (i === 3 || i === 9) levels.push({ type: 'break', minutes: 10, label: i === 3 ? 'Break · Add-on' : 'Break' });
  });
  return levels;
}

function defaultConfig() {
  return {
    name: 'Friday Night Poker',
    currency: 'kr.',
    theme: 'classic',
    buyIn: 50,
    entryFee: 0,
    startingStack: 10000,
    seats: 10,
    rebuy: { enabled: true, price: 50, chips: 10000, lastLevel: 4, maxPerPlayer: 0 },
    addon: { enabled: true, price: 50, chips: 15000, lastLevel: 5, maxPerPlayer: 1 },
    prizePool: { mode: 'auto', fixed: 0, added: 0, guarantee: 0 },
    payouts: { mode: 'percent', places: [50, 30, 20] },
    levels: defaultLevels(),
    chips: [
      { id: uid(), value: 25, color: '#2e8b57', image: '' },
      { id: uid(), value: 100, color: '#1c1c1c', image: '' },
      { id: uid(), value: 500, color: '#7b3fbf', image: '' },
      { id: uid(), value: 1000, color: '#f2c94c', image: '' },
      { id: uid(), value: 5000, color: '#d7263d', image: '' },
    ],
  };
}

function normalizeLevel(l) {
  if (l && l.type === 'break') {
    return { type: 'break', minutes: Math.max(0.1, num(l.minutes, 10)), label: String(l.label || 'Break').slice(0, 40) };
  }
  return {
    type: 'level',
    sb: nonNeg(l && l.sb),
    bb: nonNeg(l && l.bb),
    ante: nonNeg(l && l.ante),
    minutes: Math.max(0.1, num(l && l.minutes, 15)),
  };
}

function normalizeConfig(input) {
  const d = defaultConfig();
  const c = input || {};
  const rebuy = c.rebuy || {};
  const addon = c.addon || {};
  const pp = c.prizePool || {};
  const pay = c.payouts || {};
  let levels = Array.isArray(c.levels) ? c.levels.map(normalizeLevel) : d.levels;
  if (!levels.some((l) => l.type === 'level')) levels = d.levels;
  let places = Array.isArray(pay.places) ? pay.places.map((p) => nonNeg(p)).filter((p, i, a) => i < 50) : d.payouts.places;
  if (!places.length) places = [100];
  return {
    name: String(c.name ?? d.name).slice(0, 80) || 'Tournament',
    currency: String(c.currency ?? d.currency).slice(0, 4),
    theme: ['classic', 'christmas'].includes(c.theme) ? c.theme : 'classic',
    buyIn: nonNeg(c.buyIn, d.buyIn),
    entryFee: nonNeg(c.entryFee, 0),
    startingStack: nonNeg(c.startingStack, d.startingStack),
    seats: Math.min(MAX_SEATS, Math.max(2, Math.floor(num(c.seats, d.seats)))),
    rebuy: {
      enabled: !!(rebuy.enabled ?? d.rebuy.enabled),
      price: nonNeg(rebuy.price, d.rebuy.price),
      chips: nonNeg(rebuy.chips, d.rebuy.chips),
      lastLevel: Math.floor(nonNeg(rebuy.lastLevel, d.rebuy.lastLevel)),
      maxPerPlayer: Math.floor(nonNeg(rebuy.maxPerPlayer, 0)),
    },
    addon: {
      enabled: !!(addon.enabled ?? d.addon.enabled),
      price: nonNeg(addon.price, d.addon.price),
      chips: nonNeg(addon.chips, d.addon.chips),
      lastLevel: Math.floor(nonNeg(addon.lastLevel, d.addon.lastLevel)),
      maxPerPlayer: Math.floor(nonNeg(addon.maxPerPlayer, 1)),
    },
    prizePool: {
      mode: pp.mode === 'fixed' ? 'fixed' : 'auto',
      fixed: nonNeg(pp.fixed),
      added: nonNeg(pp.added),
      guarantee: nonNeg(pp.guarantee),
    },
    payouts: { mode: pay.mode === 'amount' ? 'amount' : 'percent', places },
    levels,
    chips: (Array.isArray(c.chips) ? c.chips : d.chips).slice(0, 12).map((ch) => ({
      id: String(ch.id || uid()),
      value: nonNeg(ch.value),
      color: /^#[0-9a-f]{3,8}$/i.test(ch.color || '') ? ch.color : '#888888',
      image: safeUrl(ch.image),
    })),
  };
}

function safeUrl(u) {
  u = String(u || '');
  return /^\/uploads\/[\w.-]+$/.test(u) ? u : '';
}

function newPlayer(p) {
  return {
    id: String((p && p.id) || uid()),
    name: String((p && p.name) || 'Player').slice(0, 40),
    photo: safeUrl(p && p.photo),
    status: 'active', // 'active' | 'out'
    rebuys: 0,
    addons: 0,
    eliminatedAt: null,
    // seat index 0..seats-1, null = waiting for a seat, undefined = auto-assign
    seat: p && (p.seat === null || Number.isInteger(p.seat)) ? p.seat : undefined,
  };
}

/** Make seats valid: in range, no duplicates, auto-seat players that have no seat decided yet. */
function fixSeats(t) {
  const n = t.config.seats;
  const taken = new Set();
  for (const p of t.players) {
    if (Number.isInteger(p.seat) && p.seat >= 0 && p.seat < n && !taken.has(p.seat)) taken.add(p.seat);
    else if (p.seat !== undefined) p.seat = null; // out of range / duplicate → waiting
  }
  for (const p of t.players) {
    if (p.seat !== undefined) continue;
    let free = -1;
    for (let i = 0; i < n; i++) if (!taken.has(i)) { free = i; break; }
    p.seat = free >= 0 ? free : null;
    if (free >= 0) taken.add(free);
  }
}

const levelMs = (level) => Math.round(level.minutes * MIN);

function createTournament(config, players, now = Date.now()) {
  const cfg = normalizeConfig(config);
  const t = {
    id: uid(),
    config: cfg,
    players: (players || []).map(newPlayer),
    clock: { running: false, levelIndex: 0, remainingMs: levelMs(cfg.levels[0]), anchor: now },
    startedAt: null,
    log: [],
    seq: 0,
  };
  fixSeats(t);
  return t;
}

/** Replace settings while keeping progress (players matched by id keep their runtime state). */
function updateSetup(t, config, players, now = Date.now()) {
  settle(t, now);
  const cfg = normalizeConfig(config);
  const oldLevels = t.config.levels;
  t.config = cfg;
  if (Array.isArray(players)) {
    const byId = new Map(t.players.map((p) => [p.id, p]));
    t.players = players.map((p) => {
      const existing = p && p.id && byId.get(String(p.id));
      if (existing) {
        existing.name = String(p.name || existing.name).slice(0, 40);
        existing.photo = safeUrl(p.photo);
        return existing;
      }
      return newPlayer(p);
    });
  }
  fixSeats(t);
  // keep clock sane against the new structure
  const c = t.clock;
  if (c.levelIndex >= cfg.levels.length) {
    c.levelIndex = cfg.levels.length - 1;
    c.remainingMs = levelMs(cfg.levels[c.levelIndex]);
  } else {
    const before = oldLevels[c.levelIndex];
    const after = cfg.levels[c.levelIndex];
    if (!before || levelMs(before) !== levelMs(after)) {
      // duration of the current level changed: keep elapsed time, clamp to new length
      const elapsed = before ? levelMs(before) - c.remainingMs : 0;
      c.remainingMs = Math.max(1000, levelMs(after) - elapsed);
    }
  }
  c.anchor = now;
  bump(t);
  return t;
}

function bump(t) {
  t.seq = (t.seq || 0) + 1;
}

/* ------------------------------ clock ------------------------------ */

function remainingNow(t, now) {
  const c = t.clock;
  return c.running ? c.remainingMs - (now - c.anchor) : c.remainingMs;
}

/** Bring the clock up to `now`, advancing levels if time ran out. Returns events. */
function settle(t, now) {
  const c = t.clock;
  const events = [];
  if (!c.running) return events;
  let rem = remainingNow(t, now);
  const levels = t.config.levels;
  while (rem <= 0 && c.levelIndex < levels.length - 1) {
    c.levelIndex += 1;
    rem += levelMs(levels[c.levelIndex]);
    events.push({ type: 'level', levelIndex: c.levelIndex });
  }
  if (rem <= 0) {
    rem = 0;
    c.running = false;
    events.push({ type: 'clockEnded' });
  }
  c.remainingMs = rem;
  c.anchor = now;
  if (events.length) bump(t);
  return events;
}

function tick(t, now = Date.now()) {
  return settle(t, now);
}

function gotoLevel(t, idx, now) {
  const levels = t.config.levels;
  idx = Math.max(0, Math.min(levels.length - 1, idx));
  t.clock.levelIndex = idx;
  t.clock.remainingMs = levelMs(levels[idx]);
  t.clock.anchor = now;
  return { type: 'level', levelIndex: idx };
}

/* ------------------------------ derived ------------------------------ */

function levelNumberAt(levels, idx) {
  let n = 0;
  for (let i = 0; i <= idx && i < levels.length; i++) if (levels[i].type === 'level') n++;
  return Math.max(1, n);
}

function derive(t, now = Date.now()) {
  const cfg = t.config;
  const levels = cfg.levels;
  const idx = t.clock.levelIndex;
  const players = t.players;
  const active = players.filter((p) => p.status === 'active');
  const out = players.filter((p) => p.status === 'out').sort((a, b) => b.eliminatedAt - a.eliminatedAt);
  const entries = players.length;
  const rebuys = players.reduce((s, p) => s + p.rebuys, 0);
  const addons = players.reduce((s, p) => s + p.addons, 0);

  let prizePool;
  if (cfg.prizePool.mode === 'fixed') prizePool = cfg.prizePool.fixed;
  else {
    prizePool = cfg.buyIn * entries + cfg.rebuy.price * rebuys + cfg.addon.price * addons + cfg.prizePool.added;
    prizePool = Math.max(prizePool, cfg.prizePool.guarantee);
  }
  const payouts = computePayouts(cfg.payouts, prizePool);

  const totalChips = cfg.startingStack * entries + cfg.rebuy.chips * rebuys + cfg.addon.chips * addons;
  const finished = entries > 1 && active.length === 1 && out.length > 0;

  // Places: winner = 1 when finished; out players ranked by most recent elimination
  const places = {};
  if (finished) places[active[0].id] = 1;
  out.forEach((p, i) => { places[p.id] = active.length + 1 + i; });

  // time to next break
  let nextBreakMs = null;
  const rem = Math.max(0, remainingNow(t, now));
  if (levels[idx] && levels[idx].type !== 'break') {
    let acc = rem;
    for (let i = idx + 1; i < levels.length; i++) {
      if (levels[i].type === 'break') { nextBreakMs = acc; break; }
      acc += levelMs(levels[i]);
    }
  }
  let nextLevel = null;
  for (let i = idx + 1; i < levels.length; i++) {
    if (levels[i].type === 'level') { nextLevel = levels[i]; break; }
  }

  const levelNumber = levelNumberAt(levels, idx);
  return {
    levelIndex: idx,
    level: levels[idx],
    levelNumber,
    levelCount: levels.filter((l) => l.type === 'level').length,
    upNext: levels[idx + 1] || null,
    nextLevel,
    remainingMs: rem,
    running: t.clock.running,
    levelDurationMs: levelMs(levels[idx]),
    entries,
    activeCount: active.length,
    waitingCount: active.filter((p) => p.seat === null).length,
    rebuys,
    addons,
    prizePool,
    payouts,
    totalChips,
    avgStack: active.length ? Math.round(totalChips / active.length) : 0,
    nextBreakMs,
    finished,
    winnerId: finished ? active[0].id : null,
    places,
    rebuyOpen: cfg.rebuy.enabled && (cfg.rebuy.lastLevel === 0 || levelNumber <= cfg.rebuy.lastLevel),
    addonOpen: cfg.addon.enabled && (cfg.addon.lastLevel === 0 || levelNumber <= cfg.addon.lastLevel),
  };
}

function computePayouts(payouts, pool) {
  if (payouts.mode === 'amount') {
    return payouts.places.map((amount, i) => ({ place: i + 1, amount, pct: pool ? (amount / pool) * 100 : 0 }));
  }
  const total = payouts.places.reduce((s, p) => s + p, 0) || 1;
  const list = payouts.places.map((pct, i) => ({ place: i + 1, pct: (pct / total) * 100, amount: Math.floor((pool * pct) / total) }));
  // give rounding remainder to 1st place so the payouts always sum to the pool
  const rest = pool - list.reduce((s, p) => s + p.amount, 0);
  if (list.length) list[0].amount += Math.round(rest * 100) / 100;
  return list;
}

/* ------------------------------ actions ------------------------------ */

class ActionError extends Error {}

function canRebuy(t, p, d) {
  if (!t.config.rebuy.enabled) return 'Rebuys are disabled';
  if (!d.rebuyOpen) return `Rebuys closed after level ${t.config.rebuy.lastLevel}`;
  if (d.finished) return 'Tournament is finished';
  const max = t.config.rebuy.maxPerPlayer;
  if (max && p.rebuys >= max) return `Max ${max} rebuy${max > 1 ? 's' : ''} reached`;
  return null;
}

function canAddon(t, p, d) {
  if (!t.config.addon.enabled) return 'Add-ons are disabled';
  if (p.status !== 'active') return 'Player is eliminated';
  if (!d.addonOpen) return `Add-ons closed after level ${t.config.addon.lastLevel}`;
  if (d.finished) return 'Tournament is finished';
  const max = t.config.addon.maxPerPlayer;
  if (max && p.addons >= max) return `Max ${max} add-on${max > 1 ? 's' : ''} reached`;
  return null;
}

function canEliminate(t, p, d) {
  if (p.status !== 'active') return 'Player is already eliminated';
  if (d.finished) return 'Tournament is finished';
  if (d.activeCount <= 1) return 'Last player standing';
  return null;
}

function pushLog(t, entry) {
  t.log.push(entry);
  if (t.log.length > 300) t.log.splice(0, t.log.length - 300);
}

/**
 * Apply an action. Returns { events } and mutates t. Throws ActionError on invalid input.
 */
function apply(t, action, now = Date.now()) {
  const events = settle(t, now);
  const type = action && action.type;
  const c = t.clock;
  const findPlayer = () => {
    const p = t.players.find((x) => x.id === action.playerId);
    if (!p) throw new ActionError('Player not found');
    return p;
  };
  const snapshot = () => ({ players: clone(t.players), running: c.running });

  switch (type) {
    case 'clock.start':
      if (!c.running) {
        if (remainingNow(t, now) <= 0) throw new ActionError('Clock has ended — go to a level first');
        c.running = true;
        c.anchor = now;
        if (!t.startedAt) t.startedAt = now;
        events.push({ type: 'resumed' });
      }
      break;
    case 'clock.pause':
      if (c.running) {
        c.remainingMs = remainingNow(t, now);
        c.running = false;
        c.anchor = now;
        events.push({ type: 'paused' });
      }
      break;
    case 'clock.toggle':
      return apply(t, { type: c.running ? 'clock.pause' : 'clock.start' }, now);
    case 'clock.next':
      if (c.levelIndex >= t.config.levels.length - 1) throw new ActionError('Already at the last level');
      events.push(gotoLevel(t, c.levelIndex + 1, now));
      break;
    case 'clock.prev':
      events.push(gotoLevel(t, c.levelIndex - 1, now));
      break;
    case 'clock.goto':
      events.push(gotoLevel(t, Math.floor(num(action.levelIndex)), now));
      break;
    case 'clock.adjust': {
      const delta = num(action.ms);
      const max = levelMs(t.config.levels[c.levelIndex]) * 4;
      c.remainingMs = Math.min(max, Math.max(1000, remainingNow(t, now) + delta));
      c.anchor = now;
      break;
    }
    case 'clock.resetLevel':
      c.remainingMs = levelMs(t.config.levels[c.levelIndex]);
      c.anchor = now;
      break;

    case 'player.eliminate': {
      const p = findPlayer();
      const d = derive(t, now);
      const err = canEliminate(t, p, d);
      if (err) throw new ActionError(err);
      const before = snapshot();
      const place = d.activeCount;
      p.status = 'out';
      p.eliminatedAt = now;
      const after = derive(t, now);
      const prize = (after.payouts.find((x) => x.place === place) || {}).amount || 0;
      pushLog(t, { id: uid(), ts: now, type: 'eliminate', playerId: p.id, name: p.name, place, before });
      events.push({ type: 'eliminated', playerId: p.id, name: p.name, photo: p.photo, place, prize });
      if (after.finished) {
        const w = t.players.find((x) => x.id === after.winnerId);
        if (c.running) apply(t, { type: 'clock.pause' }, now);
        const firstPrize = (after.payouts.find((x) => x.place === 1) || {}).amount || 0;
        events.push({ type: 'winner', playerId: w.id, name: w.name, photo: w.photo, prize: firstPrize });
      }
      break;
    }
    case 'player.rebuy': {
      const p = findPlayer();
      const d = derive(t, now);
      const err = canRebuy(t, p, d);
      if (err) throw new ActionError(err);
      const before = snapshot();
      const reentry = p.status === 'out';
      p.rebuys += 1;
      p.status = 'active';
      p.eliminatedAt = null;
      pushLog(t, { id: uid(), ts: now, type: 'rebuy', playerId: p.id, name: p.name, before });
      events.push({ type: 'rebuy', playerId: p.id, name: p.name, photo: p.photo, reentry });
      break;
    }
    case 'player.addon': {
      const p = findPlayer();
      const d = derive(t, now);
      const err = canAddon(t, p, d);
      if (err) throw new ActionError(err);
      const before = snapshot();
      p.addons += 1;
      pushLog(t, { id: uid(), ts: now, type: 'addon', playerId: p.id, name: p.name, before });
      events.push({ type: 'addon', playerId: p.id, name: p.name, photo: p.photo });
      break;
    }
    case 'player.seat': {
      const p = findPlayer();
      const target = action.seat === null || action.seat === undefined ? null : Math.floor(num(action.seat, -1));
      if (target !== null && (target < 0 || target >= t.config.seats)) throw new ActionError('No such seat');
      if (target === p.seat) break;
      const before = snapshot();
      const occupant = target === null ? null : t.players.find((x) => x.seat === target);
      if (occupant) occupant.seat = p.seat; // swap (may send them to the waiting list)
      p.seat = target;
      pushLog(t, { id: uid(), ts: now, type: 'seat', playerId: p.id, name: p.name, seat: target, before });
      events.push({ type: 'seat', playerId: p.id, seat: target, swappedWith: occupant ? occupant.id : null });
      break;
    }
    case 'undo': {
      const last = t.log.pop();
      if (!last) throw new ActionError('Nothing to undo');
      t.players = last.before.players;
      events.push({ type: 'undo', what: last.type, name: last.name });
      break;
    }
    default:
      throw new ActionError('Unknown action: ' + type);
  }
  bump(t);
  return { events };
}

/** What gets sent to clients. */
function publicState(t, now = Date.now()) {
  const d = derive(t, now);
  const last = t.log[t.log.length - 1];
  return {
    id: t.id,
    seq: t.seq,
    serverNow: now,
    config: t.config,
    players: t.players.map((p) => ({
      ...p,
      place: d.places[p.id] || null,
      canRebuy: !canRebuy(t, p, d),
      canAddon: !canAddon(t, p, d),
      canEliminate: !canEliminate(t, p, d),
      rebuyReason: canRebuy(t, p, d),
      addonReason: canAddon(t, p, d),
    })),
    derived: d,
    startedAt: t.startedAt,
    undo: last ? { type: last.type, name: last.name } : null,
    log: t.log.slice(-25).reverse().map(({ before, ...rest }) => rest),
  };
}

module.exports = {
  MIN,
  ActionError,
  defaultConfig,
  normalizeConfig,
  createTournament,
  updateSetup,
  apply,
  tick,
  derive,
  computePayouts,
  publicState,
  levelNumberAt,
  levelMs,
  MAX_SEATS,
  fixSeats,
};
