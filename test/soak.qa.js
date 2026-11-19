'use strict';
/**
 * Full-stack soak test: a complete 4-hour tournament, time-compressed.
 * Real server + real Chromium (TV display + 2 phone remotes) + socket bots.
 * Run with:  npm run test:soak
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createApp } = require('../server');
const E = require('../src/engine');

let chromium, devices;
try { ({ chromium, devices } = require('playwright')); } catch { /* skipped below */ }
const { io } = require('socket.io-client');

const SPEED = Number(process.env.SOAK_SPEED) || 80; // 4h ≈ 3 real minutes
const HOUR = 3600_000;
const SHOTS = path.join(__dirname, '..', 'docs', 'screenshots');

test('soak: 4 hours of play with outages, restarts, bursts and settings changes', { skip: !chromium, timeout: 20 * 60_000 }, async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'poker-soak-'));
  const W0 = Date.now();
  const P0 = performance.now();
  const now = () => W0 + (performance.now() - P0) * SPEED; // accelerated, monotonic
  const quiet = () => {};
  let app = createApp({ dataDir, port: 0, tickMs: 50, log: quiet, now });
  const port = await app.start();
  const base = `http://127.0.0.1:${port}`;
  const report = { checks: 0, actions: 0, refused: 0, maxTimerDriftSec: 0, levelsSeen: new Set() };
  const errors = [];
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const state = () => E.publicState(app.getTournament(), now());
  const kr = (n) => Math.round(n).toLocaleString('da-DK') + ' kr.';

  const browser = await chromium.launch();
  let bots = [];
  try {
    /* ---------- setup: 12 players (2 waiting), 6 with photos, Christmas theme ---------- */
    const imgPage = await browser.newPage({ viewport: { width: 200, height: 200 } });
    const photos = [];
    for (let i = 0; i < 6; i++) {
      await imgPage.setContent(`<body style="margin:0;background:hsl(${i * 60},70%,50%);width:200px;height:200px"></body>`);
      const fd = new FormData();
      fd.append('file', new Blob([await imgPage.screenshot()], { type: 'image/png' }), 'p.png');
      photos.push((await (await fetch(base + '/api/upload', { method: 'POST', body: fd })).json()).url);
    }
    await imgPage.close();
    const names = ['Tony', 'Maria', 'Jake', 'Sofia', 'Lars', 'Nina', 'Omar', 'Emma', 'Ali', 'Bea', 'Carl', 'Dina'];
    const cfg = { ...E.defaultConfig(), theme: 'christmas', seats: 10, buyIn: 200, rebuy: { enabled: true, price: 200, chips: 10000, lastLevel: 6, maxPerPlayer: 0 }, addon: { enabled: true, price: 100, chips: 15000, lastLevel: 8, maxPerPlayer: 1 } };
    let r = await (await fetch(base + '/api/setup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reset: true, config: cfg, players: names.map((name, i) => ({ name, photo: photos[i] || '' })) }) })).json();
    assert.ok(r.ok);

    /* ---------- clients ---------- */
    const speedUp = (S) => {
      const o = performance.now.bind(performance); const p0 = o(); performance.now = () => p0 + (o() - p0) * S;
      // stall detector (real ms): how long the page's main thread was frozen
      let last = Date.now(); window.__maxGap = 0;
      setInterval(() => { const n = Date.now(); window.__maxGap = Math.max(window.__maxGap, n - last - 100); last = n; }, 100);
    };
    const watch = (page, label) => {
      page.on('pageerror', (e) => errors.push(`${label}: ${e.message}`));
      page.on('console', (m) => {
        // network noise is expected while we cut Wi-Fi / restart the server
        if (m.type() === 'error' && !/WebSocket|ERR_|Failed to load resource|net::|socket\.io/i.test(m.text())) errors.push(`${label} console: ${m.text()}`);
      });
    };
    const display = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
    await display.addInitScript(speedUp, SPEED);
    watch(display, 'display');
    await display.goto(base + '/display');
    await display.waitForSelector('.seat');
    const cdp = await display.context().newCDPSession(display);
    await cdp.send('Performance.enable');
    const metrics = async () => {
      await cdp.send('HeapProfiler.collectGarbage');
      const { metrics: m } = await cdp.send('Performance.getMetrics');
      const get = (k) => m.find((x) => x.name === k).value;
      return { heapMB: get('JSHeapUsedSize') / 1e6, nodes: get('Nodes'), listeners: get('JSEventListeners') };
    };

    const phoneCtx = await browser.newContext({ ...devices['iPhone 13'] });
    await phoneCtx.addInitScript(speedUp, SPEED);
    const phone = await phoneCtx.newPage();
    watch(phone, 'phone1');
    await phone.goto(base + '/remote');
    await phone.waitForSelector('.r-seat');
    const phone2Ctx = await browser.newContext({ ...devices['Pixel 7'] });
    await phone2Ctx.addInitScript(speedUp, SPEED);
    const phone2 = await phone2Ctx.newPage();
    watch(phone2, 'phone2');
    await phone2.goto(base + '/remote');
    await phone2.waitForSelector('.r-seat');

    const bot = () => { const c = io(base, { transports: ['websocket'] }); return c; };
    bots = [bot(), bot()];
    const send = async (action, b = bots[0]) => {
      try {
        const res = await b.timeout(3000).emitWithAck('action', action);
        if (res.ok) report.actions++; else report.refused++;
        return res;
      } catch { return { ok: false, error: 'timeout' }; }
    };

    /* ---------- consistency check: TV and phone show what the server says ---------- */
    async function verify(label) {
      let lastErr;
      for (let attempt = 0; attempt < 8; attempt++) {
        const s = state();
        const d = s.derived;
        const seated = s.players.filter((p) => p.seat !== null && p.seat < s.config.seats);
        const tv = await display.evaluate(() => ({
          label: document.getElementById('lvl-label').textContent,
          blinds: document.getElementById('blinds').textContent,
          pool: document.getElementById('pool').textContent,
          timer: document.getElementById('timer').textContent,
          seats: document.querySelectorAll('.seat:not(.empty)').length,
          out: document.querySelectorAll('.seat.out').length,
          qrHidden: document.getElementById('qr-card').classList.contains('hidden'),
          seq: Number(document.body.dataset.seq),
          stall: (() => { const g = window.__maxGap; window.__maxGap = 0; return g; })(),
          finished: !document.getElementById('winner').classList.contains('hidden') || !document.getElementById('final').classList.contains('hidden'),
        }));
        const ph = await phone.evaluate(() => ({ level: document.getElementById('cc-level').textContent, players: document.querySelector('#r-stats .v').textContent }));
        const p = tv.timer.split(':').map(Number);
        const tvMs = (p.length === 3 ? p[0] * 3600 + p[1] * 60 + p[2] : p[0] * 60 + p[1]) * 1000;
        const drift = Math.abs(tvMs - d.remainingMs) / 1000;
        const expLabel = d.level.type === 'break' ? (d.level.label || 'BREAK').toUpperCase() : `LEVEL ${d.levelNumber}`;
        const problems = [];
        if (!tv.label.endsWith(expLabel)) problems.push(`label "${tv.label}" ≠ "${expLabel}"`);
        if (d.level.type !== 'break' && tv.blinds !== `${d.level.sb.toLocaleString('da-DK')} / ${d.level.bb.toLocaleString('da-DK')}`) problems.push(`blinds ${tv.blinds}`);
        if (tv.pool !== kr(d.prizePool)) problems.push(`pool ${tv.pool} ≠ ${kr(d.prizePool)}`);
        if (tv.seats !== seated.length) problems.push(`seats ${tv.seats} ≠ ${seated.length}`);
        if (tv.out !== seated.filter((x) => x.status === 'out').length) problems.push('out count');
        if (drift > 45 && d.remainingMs > 30_000) problems.push(`timer drift ${drift}s (tv ${tv.timer}, server ${Math.round(d.remainingMs / 1000)}s)`);
        if (!ph.players.startsWith(`${d.activeCount}/`)) problems.push(`phone players ${ph.players}`);
        if ((s.startedAt || s.log.length) && !tv.qrHidden) problems.push('QR code visible during live game');
        if (problems.length) problems.push(`[tv shows update #${tv.seq}, server is at #${s.seq}; tv page froze up to ${tv.stall}ms]`);
        if (!problems.length) {
          report.checks++;
          report.maxTimerDriftSec = Math.max(report.maxTimerDriftSec, Math.round(drift));
          report.levelsSeen.add(expLabel);
          return;
        }
        lastErr = `${label}: ${problems.join('; ')}`;
        await sleep(250);
      }
      throw new Error(lastErr);
    }

    const sim = () => (now() - W0);
    const active = () => state().players.filter((p) => p.status === 'active');
    const randomPlayer = () => { const ps = state().players; return ps[Math.floor(Math.random() * ps.length)]; };
    const tapPlayer = async (page, name, btn) => {
      await page.tap(`.r-seat[aria-label="${name}"], .r-rp[aria-label="${name}"]`);
      await page.waitForSelector('#sheet.show');
      if (await page.isDisabled(btn)) { await page.tap('#sh-close'); return false; }
      await page.tap(btn);
      await page.waitForSelector('#sheet:not(.show)');
      return true;
    };

    /* ---------- go ---------- */
    await phone.tap('#b-toggle');
    await display.waitForFunction(() => document.getElementById('live').textContent === 'LIVE');
    await verify('start');
    const startSim = sim();
    const m0 = await metrics();
    const done = new Set();
    const once = (key, atH) => sim() - startSim >= atH * HOUR && !done.has(key) && done.add(key);
    let nextElim = 0.25;

    while (sim() - startSim < 4 * HOUR) {
      const h = (sim() - startSim) / HOUR;

      // background noise from the "players": rebuys, add-ons, seat moves, the odd undo
      const x = Math.random();
      const p = randomPlayer();
      if (x < 0.25) await send({ type: 'player.rebuy', playerId: p.id });
      else if (x < 0.4) await send({ type: 'player.addon', playerId: p.id });
      else if (x < 0.5) await send({ type: 'player.seat', playerId: p.id, seat: Math.floor(Math.random() * 10) });
      else if (x < 0.53) await send({ type: 'undo' });

      // an elimination through the real phone UI every ~25 minutes
      if (h >= nextElim && active().length > 3) {
        const victim = active().find((a) => a.seat !== null);
        if (victim) await tapPlayer(phone, victim.name, '#a-elim');
        nextElim += 0.42;
      }

      if (once('pause', 0.5)) {
        await phone.tap('#b-toggle');
        await display.waitForFunction(() => document.getElementById('stage').classList.contains('is-paused'));
        const a = await display.textContent('#timer');
        await sleep(1500);
        assert.equal(await display.textContent('#timer'), a, 'clock frozen while paused');
        await verify('paused');
        await phone.tap('#b-toggle');
        await display.waitForFunction(() => document.getElementById('live').textContent === 'LIVE');
      }

      if (once('wifi', 1)) {
        await phoneCtx.setOffline(true);
        await sleep(1500);
        await phone.tap('#b-plus');
        await phone.waitForSelector('.toast.err', { timeout: 8000 }); // tells the host it didn't go through
        await phoneCtx.setOffline(false);
        await phone.waitForFunction(() => document.getElementById('conn').classList.contains('on'), null, { timeout: 30000 });
        await verify('phone back online');
      }

      if (once('settings', 1.5)) {
        const s = state();
        const c2 = JSON.parse(JSON.stringify(s.config));
        c2.seats = 12;
        c2.levels[c2.levels.length - 1].bb *= 2;
        const list = s.players.map((x) => ({ id: x.id, name: x.name, photo: x.photo, hat: x.hat }));
        list.push({ name: 'Late Larry' });
        r = await (await fetch(base + '/api/setup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ config: c2, players: list }) })).json();
        assert.ok(r.ok);
        await display.waitForFunction(() => document.body.textContent.includes('Late Larry'));
        await verify('after settings change');
      }

      if (once('restart', 2)) {
        bots.forEach((b) => b.close());
        await app.stop();
        app = createApp({ dataDir, port, tickMs: 50, log: quiet, now });
        await app.start();
        bots = [bot(), bot()];
        await display.waitForFunction(() => document.getElementById('conn').classList.contains('on'), null, { timeout: 30000 });
        await phone.waitForFunction(() => document.getElementById('conn').classList.contains('on'), null, { timeout: 30000 });
        assert.equal(state().derived.running, false, 'restart resumes paused, nothing lost');
        await verify('after server restart');
        await phone.tap('#b-toggle');
        await display.waitForFunction(() => document.getElementById('live').textContent === 'LIVE');
      }

      if (once('burst', 2.5)) {
        // 40 actions at once from two phones, plus both eliminating the same player
        const target = active()[0];
        const results = await Promise.all([
          send({ type: 'player.eliminate', playerId: target.id }, bots[0]),
          send({ type: 'player.eliminate', playerId: target.id }, bots[1]),
          ...Array.from({ length: 40 }, (_, i) => send({ type: i % 2 ? 'player.addon' : 'player.rebuy', playerId: randomPlayer().id }, bots[i % 2])),
        ]);
        assert.equal(results.slice(0, 2).filter((x) => x.ok).length, 1, 'double elimination counted once');
        await verify('after burst');
      }

      if (once('reload', 3)) {
        await display.reload();
        await display.waitForSelector('.seat');
        await verify('TV refreshed');
      }

      if (Math.random() < 0.3) await verify(`h=${h.toFixed(2)}`);
      await sleep(120);
    }

    /* ---------- 4 hours played: finish the tournament ---------- */
    await verify('4 hours');
    const m1 = await metrics();
    while (active().length > 1) await send({ type: 'player.eliminate', playerId: active()[0].id });
    await display.waitForSelector('#winner:not(.hidden)');
    await display.waitForSelector('#final:not(.hidden)', { timeout: 20000 });
    const s = state();
    assert.equal(await display.locator('#final tbody tr').count(), s.players.length);
    const won = s.derived.payouts.reduce((t, x) => t + x.amount, 0);
    assert.match(await display.textContent('#final tfoot'), new RegExp(kr(won).replace('.', '\\.')));
    await phone.waitForSelector('#r-final:not(.hidden)');
    await display.screenshot({ path: path.join(SHOTS, 'soak-final.png') });

    /* ---------- health ---------- */
    const stateSize = fs.statSync(path.join(dataDir, 'state.json')).size;
    report.memory = { start: m0, end: m1 };
    report.stateFileKB = Math.round(stateSize / 1024);
    report.levelsSeen = [...report.levelsSeen];
    // eslint-disable-next-line no-console
    console.log('SOAK REPORT', JSON.stringify(report, null, 2));
    assert.ok(m1.heapMB - m0.heapMB < 15, `TV memory stable (${m0.heapMB.toFixed(1)} → ${m1.heapMB.toFixed(1)} MB)`);
    assert.ok(m1.nodes - m0.nodes < 1500, `TV page size stable (${m0.nodes} → ${m1.nodes} nodes)`);
    assert.ok(m1.listeners - m0.listeners < 300, `no event-listener leak (${m0.listeners} → ${m1.listeners})`);
    assert.ok(stateSize < 300_000, 'save file stays small');
    assert.ok(report.levelsSeen.length >= 10, 'clock advanced through the structure');
    assert.deepEqual(errors, []);
    bots.forEach((b) => b.close());
  } finally {
    bots.forEach((b) => b.close());
    await browser.close();
    await app.stop().catch(() => {});
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});
