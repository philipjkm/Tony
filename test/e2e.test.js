'use strict';
/**
 * End-to-end QA: real server + real Chromium.
 * Drives Settings (desktop), TV Display (1920x1080) and Phone Remote (iPhone) together.
 * Screenshots are written to docs/screenshots.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createApp } = require('../server');

let chromium, devices;
try {
  ({ chromium, devices } = require('playwright'));
} catch {
  // eslint-disable-next-line no-console
  console.warn('playwright not installed — skipping e2e tests (npm i -D playwright && npx playwright install chromium)');
}

const SHOTS = path.join(__dirname, '..', 'docs', 'screenshots');
const NAMES = ['Tony', 'Maria', 'Jake', 'Sofia', 'Lars', 'Nina', 'Omar', 'Emma'];

async function makeImages(browser, dir) {
  // render simple portrait/chip images with the browser itself (no binary fixtures in the repo)
  const page = await browser.newPage({ viewport: { width: 300, height: 300 } });
  const files = [];
  const hues = [0, 210, 140, 35, 280, 190, 330, 90];
  for (let i = 0; i < NAMES.length; i++) {
    await page.setContent(`<body style="margin:0;width:300px;height:300px;background:linear-gradient(135deg,hsl(${hues[i]},70%,55%),hsl(${hues[i] + 40},70%,25%));display:grid;place-items:center;font:900 140px sans-serif;color:rgba(255,255,255,.92)">${NAMES[i][0]}</body>`);
    const f = path.join(dir, `photo-${i}.png`);
    await page.screenshot({ path: f });
    files.push(f);
  }
  await page.setContent(`<body style="margin:0;width:300px;height:300px;background:transparent;display:grid;place-items:center">
    <div style="width:290px;height:290px;border-radius:50%;background:repeating-conic-gradient(#fff 0 15deg,#1b4fd6 15deg 45deg);display:grid;place-items:center">
    <div style="width:190px;height:190px;border-radius:50%;background:#1b4fd6;display:grid;place-items:center;font:900 70px sans-serif;color:#fff">1K</div></div></body>`);
  const chip = path.join(dir, 'chip.png');
  await page.screenshot({ path: chip, omitBackground: true });
  await page.close();
  return { photos: files, chip };
}

test('end-to-end: settings → display → phone remote', { skip: !chromium, timeout: 180000 }, async (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'poker-e2e-'));
  const app = createApp({ dataDir, port: 0, log: () => {} });
  const port = await app.start();
  const base = `http://127.0.0.1:${port}`;
  const browser = await chromium.launch();
  fs.mkdirSync(SHOTS, { recursive: true });
  const errors = [];
  const watch = (page, label) => {
    page.on('pageerror', (e) => errors.push(`${label}: ${e.message}`));
    page.on('console', (m) => { if (m.type() === 'error') errors.push(`${label} console: ${m.text()}`); });
  };

  try {
    const imgs = await makeImages(browser, dataDir);

    /* ---------------- settings ---------------- */
    const setup = await browser.newPage({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1 });
    watch(setup, 'setup');
    setup.on('dialog', (d) => d.accept());
    await setup.goto(base + '/setup');
    await setup.waitForSelector('#lv-rows .lv-row');

    await t.test('general + money settings', async () => {
      await setup.fill('[data-k="name"]', 'Tony’s Home Game');
      await setup.fill('[data-k="buyIn"]', '40');
      await setup.fill('[data-k="startingStack"]', '20000');
      await setup.fill('[data-k="prizePool.added"]', '20');
      await setup.selectOption('[data-k="prizePool.mode"]', 'fixed');
      assert.ok(await setup.isVisible('[data-k="prizePool.fixed"]'), 'custom amount field shows');
      assert.ok(!(await setup.isVisible('[data-k="prizePool.added"]')), 'added money hides in fixed mode');
      await setup.selectOption('[data-k="prizePool.mode"]', 'auto');
      await setup.fill('[data-k="rebuy.price"]', '40');
      await setup.fill('[data-k="rebuy.lastLevel"]', '6');
      await setup.fill('[data-k="addon.price"]', '20');
      await setup.fill('[data-k="addon.lastLevel"]', '0');
    });

    await t.test('blind structure generator and manual edits', async () => {
      await setup.fill('#g-count', '12');
      await setup.fill('#g-min', '20');
      await setup.fill('#g-bb', '100');
      await setup.fill('#g-break', '4');
      await setup.click('#g-go');
      assert.equal(await setup.locator('#lv-rows .lv-row:not(.brk)').count(), 12);
      assert.equal(await setup.locator('#lv-rows .lv-row.brk').count(), 2);
      await setup.click('#lv-add');
      assert.equal(await setup.locator('#lv-rows .lv-row:not(.brk)').count(), 13);
      // editing BB keeps SB at half
      const bb = setup.locator('#lv-rows [data-lv="0"][data-f="bb"]');
      await bb.fill('200');
      assert.equal(await setup.inputValue('#lv-rows [data-lv="0"][data-f="sb"]'), '100');
    });

    await t.test('payout presets', async () => {
      await setup.click('#pay-presets button:has-text("Top 4")');
      assert.equal(await setup.locator('#pay-list .pay-row').count(), 4);
      assert.match(await setup.textContent('#pay-sum'), /100%/);
    });

    await t.test('players with photo uploads', async () => {
      for (const n of NAMES) {
        await setup.fill('#pl-name', n);
        await setup.press('#pl-name', 'Enter');
      }
      assert.equal(await setup.locator('.pl-card').count(), NAMES.length);
      for (let i = 0; i < NAMES.length; i++) {
        const [chooser] = await Promise.all([setup.waitForEvent('filechooser'), setup.click(`[data-photo="${i}"]`)]);
        await chooser.setFiles(imgs.photos[i]);
        await setup.waitForSelector(`[data-photo="${i}"] img`);
      }
    });

    await t.test('chip image upload', async () => {
      // set chip #4 to 1000 with a photo
      const [chooser] = await Promise.all([setup.waitForEvent('filechooser'), setup.click('[data-chip-img="3"]')]);
      await chooser.setFiles(imgs.chip);
      await setup.waitForSelector('[data-chip-img="3"] img');
      await setup.fill('[data-chip="3"][data-f="value"]', '1000');
    });

    await t.test('save as new tournament', async () => {
      await setup.click('#b-new');
      await setup.waitForFunction(() => !document.getElementById('s-status').classList.contains('dirty'));
      const s = await (await fetch(base + '/api/state')).json();
      assert.equal(s.config.name, 'Tony’s Home Game');
      assert.equal(s.config.buyIn, 40);
      assert.equal(s.config.startingStack, 20000);
      assert.equal(s.players.length, NAMES.length);
      assert.ok(s.players.every((p) => /^\/uploads\/[\w.-]+\.jpg$/.test(p.photo)), 'all photos uploaded');
      assert.match(s.config.chips[3].image, /^\/uploads\/.+\.png$/);
      assert.deepEqual(s.config.payouts.places, [45, 27, 17, 11]);
      assert.equal(s.derived.prizePool, 40 * NAMES.length + 20);
      assert.equal(s.config.levels[0].bb, 200);
      const img = await fetch(base + s.players[0].photo);
      assert.equal(img.status, 200);
      await setup.screenshot({ path: path.join(SHOTS, 'settings.png'), fullPage: true });
    });

    /* ---------------- display + remote ---------------- */
    const display = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
    watch(display, 'display');
    await display.goto(base + '/display');
    await display.waitForSelector('.seat');

    const phoneCtx = await browser.newContext({ ...devices['iPhone 13'] });
    const phone = await phoneCtx.newPage();
    watch(phone, 'remote');
    await phone.goto(base + '/remote');
    await phone.waitForSelector('.r-seat');

    await t.test('display shows table, players, pool and chips', async () => {
      assert.equal(await display.locator('.seat:not(.empty)').count(), NAMES.length);
      assert.equal(await display.locator('.seat.empty').count(), 10 - NAMES.length, 'empty seats drawn');
      assert.equal(await display.locator('.seat.empty .plate').count(), 0, 'no seat-number labels on the TV');
      assert.equal(await display.locator('.felt-logo').count(), 0, 'no suit graphic on the felt');
      const photo = await display.locator('.seat:not(.empty) .avatar').first().boundingBox();
      assert.ok(photo.width >= 125, `profile photos are big (${photo.width}px)`);
      assert.ok(await display.locator('#waiting.hidden').count(), 'no waiting list when everyone is seated');
      assert.equal(await display.locator('.seat img').count(), NAMES.length, 'player photos shown');
      assert.equal(await display.textContent('#pool'), '340 kr.');
      assert.equal(await display.textContent('#blinds'), '100 / 200');
      assert.doesNotMatch(await display.textContent('.topbar'), /Tony’s Home Game/, 'no name top-left');
      assert.ok(await display.locator('#chips .chip-img').count() >= 1, 'uploaded chip image shown');
      assert.equal(await display.locator('#payouts li').count(), 4);
      const clipped = await display.evaluate(() => {
        const box = document.querySelector('.payouts').getBoundingClientRect();
        return [...document.querySelectorAll('#payouts li')].some((li) => li.getBoundingClientRect().bottom > box.bottom + 1);
      });
      assert.equal(clipped, false, 'payout rows fit in their card');
      // all seats inside the visible stage
      const boxes = await display.locator('.seat').evaluateAll((els) => els.map((e) => e.getBoundingClientRect()).map((r) => [r.left, r.top, r.right, r.bottom]));
      for (const [l, tp, r, b] of boxes) assert.ok(l >= 0 && tp >= 0 && r <= 1920 && b <= 1080, `seat inside screen ${[l, tp, r, b]}`);
      assert.ok(await display.locator('#stage').evaluate((el) => el.classList.contains('is-paused')));
    });

    await t.test('phone starts the clock → display runs', async () => {
      await phone.tap('#b-toggle');
      await display.waitForFunction(() => document.getElementById('live').textContent === 'LIVE');
      const t1 = await display.textContent('#timer');
      await display.waitForTimeout(1300);
      const t2 = await display.textContent('#timer');
      assert.notEqual(t1, t2, 'clock is ticking on the TV');
      assert.equal(await phone.textContent('#b-toggle'), '❚❚');
    });

    await t.test('phone pause → display paused', async () => {
      await phone.tap('#b-toggle');
      await display.waitForFunction(() => document.getElementById('stage').classList.contains('is-paused'));
      const a = await display.textContent('#timer');
      await display.waitForTimeout(1200);
      assert.equal(await display.textContent('#timer'), a, 'clock frozen while paused');
      await phone.tap('#b-toggle');
      await display.waitForFunction(() => !document.getElementById('stage').classList.contains('is-paused'));
    });

    await t.test('tap player → sheet with 3 options → eliminate', async () => {
      await phone.tap('.r-seat[aria-label="Jake"]');
      await phone.waitForSelector('#sheet.show');
      assert.equal(await phone.locator('#sheet .act').count(), 3);
      assert.equal(await phone.textContent('#sh-head .nm'), 'Jake');
      await phone.waitForTimeout(350); // sheet slide-in animation
      await phone.screenshot({ path: path.join(SHOTS, 'remote-sheet.png') });
      await phone.tap('#a-elim');
      await phone.waitForSelector('#sheet:not(.show)');
      await display.waitForSelector('#spotlight.show');
      assert.match(await display.textContent('#spotlight'), /ELIMINATED[\s\S]*Jake[\s\S]*8th/);
      await display.screenshot({ path: path.join(SHOTS, 'display-eliminated.png') });
      await display.waitForSelector('.seat.out');
      assert.match(await display.textContent('.seat.out'), /OUT · 8th/);
      assert.match(await phone.textContent('#r-undo'), /Eliminated · Jake/);
    });

    await t.test('re-entry (rebuy for an eliminated player)', async () => {
      await phone.tap('.r-seat[aria-label="Jake"]');
      await phone.waitForSelector('#sheet.show');
      assert.ok(await phone.isDisabled('#a-elim'));
      assert.equal(await phone.textContent('#l-rebuy'), 'Re-entry');
      await phone.tap('#a-rebuy');
      await display.waitForFunction(() => !document.querySelector('.seat.out'));
      const s = await (await fetch(base + '/api/state')).json();
      assert.equal(s.derived.prizePool, 40 * NAMES.length + 20 + 40);
      assert.equal(s.derived.rebuys, 1);
    });

    await t.test('add-on and undo', async () => {
      await phone.tap('.r-seat[aria-label="Tony"]');
      await phone.waitForSelector('#sheet.show');
      await phone.tap('#a-addon');
      await display.waitForFunction(() => /400 kr\./.test(document.getElementById('pool').textContent));
      assert.equal(await display.textContent('.seat[data-id] .badge.a'), 'A');
      await phone.waitForTimeout(400);
      await phone.tap('#b-undo');
      await display.waitForFunction(() => /380 kr\./.test(document.getElementById('pool').textContent));
      // add it back for the screenshots
      await phone.tap('.r-seat[aria-label="Tony"]');
      await phone.waitForSelector('#sheet.show');
      await phone.tap('#a-addon');
      await display.waitForFunction(() => /400 kr\./.test(document.getElementById('pool').textContent));
    });

    await t.test('next level from phone updates display', async () => {
      await phone.tap('#b-next');
      await display.waitForFunction(() => document.getElementById('lvl-label').textContent === 'LEVEL 2');
      await phone.waitForFunction(() => document.getElementById('cc-level').textContent === 'LEVEL 2 OF 13');
      await display.waitForSelector('#banner.show');
      await phone.tap('#b-plus');
      await phone.waitForFunction(() => document.getElementById('cc-time').textContent.startsWith('20:') || document.getElementById('cc-time').textContent.startsWith('21:'));
    });

    await t.test('more eliminations show places and paid finishes', async () => {
      for (const n of ['Omar', 'Emma', 'Nina']) {
        await phone.tap(`.r-seat[aria-label="${n}"]`);
        await phone.waitForSelector('#sheet.show');
        await phone.tap('#a-elim');
        await phone.waitForSelector('#sheet:not(.show)');
        await phone.waitForTimeout(300);
      }
      await display.waitForFunction(() => document.querySelectorAll('.seat.out').length === 3);
      await display.waitForFunction(() => document.getElementById('spotlight').dataset.busy === '0', null, { timeout: 30000 });
      await display.waitForTimeout(500);
      await display.screenshot({ path: path.join(SHOTS, 'display.png') });
      await phone.screenshot({ path: path.join(SHOTS, 'remote.png'), fullPage: true });
    });

    await t.test('two remotes stay in sync', async () => {
      const phone2 = await phoneCtx.newPage();
      await phone2.goto(base + '/remote');
      await phone2.waitForSelector('.r-seat');
      assert.equal(await phone2.locator('.r-seat.out').count(), 3);
      await phone2.close();
    });

    await t.test('play to the end → champion screen', async () => {
      for (const n of ['Lars', 'Sofia', 'Maria', 'Jake']) {
        await phone.tap(`.r-seat[aria-label="${n}"]`);
        await phone.waitForSelector('#sheet.show');
        await phone.tap('#a-elim');
        await phone.waitForSelector('#sheet:not(.show)');
        await phone.waitForTimeout(300);
      }
      await display.waitForSelector('#winner:not(.hidden)');
      assert.ok(!(await display.locator('#spotlight.show').count()), 'no spotlight over the champion screen');
      assert.match(await display.textContent('#winner'), /CHAMPION[\s\S]*Tony/);
      const s = await (await fetch(base + '/api/state')).json();
      assert.equal(s.derived.finished, true);
      assert.equal(s.derived.running, false);
      const tony = s.players.find((p) => p.name === 'Tony');
      assert.equal(tony.place, 1);
      await display.waitForTimeout(600);
      await display.screenshot({ path: path.join(SHOTS, 'display-champion.png') });
    });

    await t.test('payout summary after the tournament (TV + phone)', async () => {
      await display.waitForSelector('#final:not(.hidden)', { timeout: 20000 });
      assert.ok(await display.locator('#winner.hidden').count(), 'champion screen gives way to results');
      assert.equal(await display.locator('#final tbody tr').count(), NAMES.length);
      const first = await display.textContent('#final tbody tr:first-child');
      assert.match(first, /Tony[\s\S]*180 kr\./, 'winner first with prize');
      // totals: paid in = 8 buy-ins + 1 rebuy + 1 add-on; paid out = pool (400) since there is no entry fee
      assert.match(await display.textContent('#final tfoot'), /380 kr\.[\s\S]*400 kr\./);
      await display.screenshot({ path: path.join(SHOTS, 'display-results.png') });
      await phone.waitForSelector('#r-final:not(.hidden)');
      assert.equal(await phone.locator('#r-final tbody tr').count(), NAMES.length);
      const over = await phone.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      assert.ok(over <= 0, `results table fits on the phone (${over}px over)`);
    });

    await t.test('pages have no JS errors', () => {
      assert.deepEqual(errors, []);
    });

    await t.test('phone layout fits without horizontal scroll', async () => {
      const over = await phone.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      assert.ok(over <= 0, `remote overflows by ${over}px`);
      const sm = await browser.newPage({ viewport: { width: 375, height: 800 } });
      await sm.goto(base + '/setup');
      await sm.waitForSelector('#lv-rows .lv-row');
      const over2 = await sm.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      assert.ok(over2 <= 0, `settings overflows on phone by ${over2}px`);
      await sm.close();
    });
  } finally {
    await browser.close();
    await app.stop();
  }

  await t.test('state survives a server restart', async () => {
    const again = createApp({ dataDir, port: 0, log: () => {} });
    const p2 = await again.start();
    try {
      const s = await (await fetch(`http://127.0.0.1:${p2}/api/state`)).json();
      assert.equal(s.config.name, 'Tony’s Home Game');
      assert.equal(s.derived.finished, true);
      assert.equal(s.players.length, NAMES.length);
    } finally {
      await again.stop();
      fs.rmSync(dataDir, { recursive: true, force: true });
    }
  });
});

test('API hardening', { timeout: 30000 }, async (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'poker-api-'));
  const app = createApp({ dataDir, port: 0, log: () => {} });
  const port = await app.start();
  const base = `http://127.0.0.1:${port}`;
  try {
    await t.test('upload rejects non-images', async () => {
      const fd = new FormData();
      fd.append('file', new Blob(['<script>alert(1)</script>'], { type: 'text/html' }), 'x.html');
      const r = await fetch(base + '/api/upload', { method: 'POST', body: fd });
      assert.equal(r.status, 400);
    });
    await t.test('setup rejects unsafe image URLs and bad numbers', async () => {
      const r = await fetch(base + '/api/setup', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reset: true, config: { buyIn: 'x', chips: [{ value: 1, image: 'http://evil/x.png' }] }, players: [{ name: '<b>x</b>', photo: '../../etc/passwd' }] }),
      });
      const j = await r.json();
      assert.equal(j.ok, true);
      assert.equal(j.state.config.chips[0].image, '');
      assert.equal(j.state.players[0].photo, '');
      assert.equal(j.state.players[0].name, '<b>x</b>', 'stored raw, escaped when rendered');
    });
    await t.test('socket actions with bad input return errors, not crashes', async () => {
      const { io } = require('socket.io-client');
      const c = io(base, { transports: ['websocket'] });
      await new Promise((r) => c.on('connect', r));
      const res = await c.timeout(2000).emitWithAck('action', { type: 'player.eliminate', playerId: 'missing' });
      assert.equal(res.ok, false);
      const res2 = await c.timeout(2000).emitWithAck('action', { type: 'clock.adjust', ms: 'abc' });
      assert.equal(res2.ok, true);
      c.close();
    });
    await t.test('QR endpoint returns SVG', async () => {
      const r = await fetch(base + '/api/qr.svg?path=/remote');
      assert.equal(r.headers.get('content-type').split(';')[0], 'image/svg+xml');
      assert.match(await r.text(), /<svg/);
    });
  } finally {
    await app.stop();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test('seat arranging: waiting list, drag & drop, tap-to-move, undo, settings shortcuts', { skip: !chromium, timeout: 120000 }, async (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'poker-seats-'));
  const app = createApp({ dataDir, port: 0, log: () => {} });
  const port = await app.start();
  const base = `http://127.0.0.1:${port}`;
  const browser = await chromium.launch();
  const errors = [];
  const api = async () => (await fetch(base + '/api/state')).json();
  const seatOf = async (name) => (await api()).players.find((p) => p.name === name).seat;
  try {
    const names = ['Ann', 'Ben', 'Cat', 'Dan', 'Eve'];
    const r = await fetch(base + '/api/setup', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reset: true, config: { seats: 4 }, players: names.map((name) => ({ name })) }),
    });
    assert.equal((await r.json()).ok, true);
    assert.equal(await seatOf('Eve'), null, '5th player waits when 4 seats');

    const display = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
    display.on('pageerror', (e) => errors.push('display: ' + e.message));
    await display.goto(base + '/display');
    await display.waitForSelector('#waiting:not(.hidden)');
    assert.match(await display.textContent('#wl'), /Eve/);

    const ctx = await browser.newContext({ ...devices['iPhone 13'] });
    const phone = await ctx.newPage();
    phone.on('pageerror', (e) => errors.push('remote: ' + e.message));
    await phone.goto(base + '/remote');
    await phone.waitForSelector('.r-rp[aria-label="Eve"]');

    await t.test('drag a waiting player onto a seat swaps them', async () => {
      await phone.tap('#b-arrange');
      await phone.waitForSelector('.r-table-wrap.arranging');
      const from = await phone.locator('.r-rp[aria-label="Eve"]').boundingBox();
      const to = await phone.locator('.r-seat[aria-label="Ann"]').boundingBox();
      await phone.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
      await phone.mouse.down();
      for (let i = 1; i <= 12; i++) {
        await phone.mouse.move(from.x + from.width / 2 + ((to.x - from.x) * i) / 12, from.y + from.height / 2 + ((to.y - from.y) * i) / 12);
      }
      await phone.mouse.move(to.x + to.width / 2, to.y + to.height / 2);
      await phone.mouse.up();
      await phone.waitForSelector('.r-rp[aria-label="Ann"]');
      assert.equal(await seatOf('Eve'), 0);
      assert.equal(await seatOf('Ann'), null);
      await display.waitForFunction(() => /Ann/.test(document.getElementById('wl').textContent));
    });

    await t.test('tap-to-move: tap player, then tap a seat', async () => {
      await phone.tap('.r-rp[aria-label="Ann"]');
      await phone.waitForSelector('.r-rp.picked');
      await phone.tap('.r-seat[aria-label="Ben"]');
      await phone.waitForSelector('.r-rp[aria-label="Ben"]');
      assert.equal(await seatOf('Ann'), 1);
    });

    await t.test('send a seated player to the waiting list, then into the empty seat', async () => {
      await phone.tap('.r-seat[aria-label="Cat"]');
      await phone.tap('#r-railbox .r-rail-h');
      await phone.waitForSelector('.r-rp[aria-label="Cat"]');
      assert.equal(await seatOf('Cat'), null);
      await display.waitForSelector('.seat.empty');
      await phone.tap('.r-rp[aria-label="Ben"]');
      await phone.tap('.r-seat.empty');
      await phone.waitForFunction(() => !document.querySelector('.r-rp[aria-label="Ben"]'));
      assert.equal(await seatOf('Ben'), 2);
      await phone.screenshot({ path: path.join(SHOTS, 'remote-arrange.png') });
      await display.waitForTimeout(800);
      await display.screenshot({ path: path.join(SHOTS, 'display-waiting.png') });
    });

    await t.test('undo a seat move', async () => {
      await phone.tap('#b-undo');
      await phone.waitForSelector('.r-rp[aria-label="Ben"]');
      assert.equal(await seatOf('Ben'), null);
    });

    await t.test('normal mode: tapping a waiting player opens the action sheet', async () => {
      await phone.tap('#b-arrange');
      await phone.tap('.r-rp[aria-label="Ben"]');
      await phone.waitForSelector('#sheet.show');
      assert.equal(await phone.textContent('#sh-head .nm'), 'Ben');
      await phone.tap('#sh-close');
    });

    await t.test('settings shortcut menu deep-links into setup', async () => {
      await phone.tap('#b-menu');
      await phone.waitForSelector('#menu.show');
      await phone.tap('#menu a[href="/setup#players"]');
      await phone.waitForURL(/\/setup#players$/);
      await phone.waitForSelector('.pl-card');
      await phone.waitForFunction(() => Math.abs(document.getElementById('players').getBoundingClientRect().top) < 200);
      assert.match(await phone.textContent('.pl-card:has(input[value="Ben"]) .st'), /Waiting/);
      assert.match(await phone.textContent('.pl-card:has(input[value="Eve"]) .st'), /Seat 1/);
      assert.ok(await phone.isVisible('.s-top-links a[href="/remote"]'), 'way back to the remote on phone');
    });

    await t.test('no JS errors', () => assert.deepEqual(errors, []));
  } finally {
    await browser.close();
    await app.stop();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test('TV display fills any screen shape (no black bars, everything on screen)', { skip: !chromium, timeout: 90000 }, async (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'poker-fit-'));
  const app = createApp({ dataDir, port: 0, log: () => {} });
  const port = await app.start();
  const base = `http://127.0.0.1:${port}`;
  const browser = await chromium.launch();
  try {
    await fetch(base + '/api/setup', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reset: true, config: { seats: 10 }, players: Array.from({ length: 10 }, (_, i) => ({ name: 'Player ' + (i + 1) })) }),
    });
    const screens = [[1920, 1080, '16:9 TV'], [1440, 900, '16:10 MacBook'], [2560, 1272, '2:1 wide'], [3440, 1440, '21:9 ultrawide'], [1024, 768, '4:3']];
    for (const [w, h, label] of screens) {
      await t.test(label, async () => {
        const page = await browser.newPage({ viewport: { width: w, height: h } });
        await page.goto(base + '/display');
        await page.waitForSelector('.seat');
        await page.waitForTimeout(700); // seat move animation
        const r = await page.evaluate(() => {
          const rect = (el) => el.getBoundingClientRect();
          const st = rect(document.getElementById('stage'));
          const seats = [...document.querySelectorAll('.seat')].map(rect);
          const side = rect(document.querySelector('.side'));
          const chip = rect(document.querySelector('.chipbar'));
          return { st, seats, side, chip, W: innerWidth, H: innerHeight };
        });
        assert.ok(Math.abs(r.st.left) < 1 && Math.abs(r.st.top) < 1, `stage at 0,0 (${r.st.left},${r.st.top})`);
        assert.ok(Math.abs(r.st.width - r.W) < 1 && Math.abs(r.st.height - r.H) < 1, `stage fills screen ${r.st.width}x${r.st.height} vs ${r.W}x${r.H}`);
        for (const s of r.seats) {
          assert.ok(s.left >= 0 && s.top >= 0 && s.bottom <= r.chip.top + 2, `seat on screen and above chip bar (${label})`);
          assert.ok(s.right <= r.side.left + 2, `seat does not overlap side panel (${label})`);
        }
        if (label === '16:10 MacBook') await page.screenshot({ path: path.join(SHOTS, 'display-macbook.png') });
        await page.close();
      });
    }
  } finally {
    await browser.close();
    await app.stop();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test('Christmas theme, kr. formatting and ka-ching on rebuy', { skip: !chromium, timeout: 90000 }, async (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'poker-xmas-'));
  const app = createApp({ dataDir, port: 0, log: () => {} });
  const port = await app.start();
  const base = `http://127.0.0.1:${port}`;
  const browser = await chromium.launch();
  const errors = [];
  try {
    const r = await fetch(base + '/api/setup', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reset: true, config: { theme: 'christmas', buyIn: 500 }, players: ['Tony', 'Maria', 'Jake', 'Sofia', 'Lars', 'Nina', 'Omar', 'Emma'].map((name) => ({ name })) }),
    });
    const st = (await r.json()).state;
    assert.equal(st.config.currency, 'kr.', 'kr. is the default currency');
    const display = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
    display.on('pageerror', (e) => errors.push(e.message));
    // count sounds: wrap the oscillator factory once audio is enabled
    await display.goto(base + '/display');
    await display.waitForSelector('.seat');
    await display.click('body');
    await display.evaluate(() => {
      window.__osc = 0;
      const orig = AudioContext.prototype.createBufferSource;
      AudioContext.prototype.createBufferSource = function () { window.__osc++; return orig.call(this); };
    });

    await t.test('theme visuals', async () => {
      assert.ok(await display.evaluate(() => document.body.classList.contains('theme-christmas')));
      assert.equal(await display.locator('.seat:not(.empty) .hat').count(), 8, 'Santa hats on every player');
      assert.ok(await display.isVisible('.hat'));
      assert.ok(await display.isVisible('#lights'));
      assert.ok(await display.locator('#stage canvas.snow').count() === 1, 'snow canvas');
      const kinds = await display.locator('.seat .hat').evaluateAll((els) => new Set(els.map((e) => e.getAttribute('class'))).size);
      assert.ok(kinds >= 3, `players get different hats (${kinds} kinds)`);
      assert.ok(await display.isVisible('.pool-bow'), 'gift-wrapped prize pool');
      const fs1 = await display.locator('#pool').evaluate((e) => parseFloat(getComputedStyle(e).fontSize));
      assert.ok(fs1 >= 90, `prize pool is big (${fs1}px)`);
    });

    await t.test('kr. after the amount with Danish thousands separator', async () => {
      assert.equal(await display.textContent('#pool'), '4.000 kr.');
      assert.match(await display.textContent('#payouts'), /2\.000 kr\./);
    });

    await t.test('rebuy plays the ka-ching (noise burst)', async () => {
      const id = st.players[0].id;
      const { io } = require('socket.io-client');
      const c = io(base, { transports: ['websocket'] });
      await new Promise((res) => c.on('connect', res));
      await c.timeout(2000).emitWithAck('action', { type: 'player.rebuy', playerId: id });
      c.close();
      await display.waitForFunction(() => window.__osc > 0);
      await display.waitForSelector('#spotlight:not(.show)', { timeout: 10000 });
      await display.waitForTimeout(600);
      await display.screenshot({ path: path.join(SHOTS, 'display-christmas.png') });
    });

    await t.test('custom hat per player from Settings', async () => {
      const s0 = await (await fetch(base + '/api/state')).json();
      const players = s0.players.map((p, i) => ({ id: p.id, name: p.name, photo: p.photo, hat: i === 0 ? 'antlers' : i === 1 ? 'none' : 'crown' }));
      await fetch(base + '/api/setup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ config: s0.config, players }) });
      await display.waitForFunction((id) => !!document.querySelector(`.seat[data-id="${id}"] .hat-antlers`), s0.players[0].id);
      assert.equal(await display.locator(`.seat[data-id="${s0.players[1].id}"] .hat`).count(), 0, 'no hat');
      assert.equal(await display.locator('.seat .hat-crown').count(), 6);
      const setup = await browser.newPage({ viewport: { width: 1280, height: 900 } });
      await setup.goto(base + '/setup#players');
      await setup.waitForSelector('.pl-card .hat-antlers');
      assert.equal(await setup.inputValue('[data-pl-hat="0"]'), 'antlers');
      await setup.selectOption('[data-pl-hat="2"]', 'elf');
      await setup.waitForSelector('.pl-card[data-i="2"] .hat-elf');
      await setup.click('#b-save');
      await display.waitForFunction((id) => !!document.querySelector(`.seat[data-id="${id}"] .hat-elf`), s0.players[2].id);
      await setup.screenshot({ path: path.join(SHOTS, 'settings-hats.png') });
      await setup.close();
      // mix them back up for the screenshot
      const mix = ['santa', 'elf', 'antlers', 'beanie', 'tophat', 'tree', 'crown', 'auto'];
      await fetch(base + '/api/setup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ config: s0.config, players: s0.players.map((p, i) => ({ ...p, hat: mix[i] })) }) });
      await display.waitForSelector('.seat .hat-tophat');
      await display.waitForTimeout(500);
      await display.screenshot({ path: path.join(SHOTS, 'display-christmas.png') });
    });

    await t.test('remote shows the theme too', async () => {
      const ctx = await browser.newContext({ ...devices['iPhone 13'] });
      const phone = await ctx.newPage();
      phone.on('pageerror', (e) => errors.push(e.message));
      await phone.goto(base + '/remote');
      await phone.waitForSelector('.r-seat .hat');
      assert.ok(await phone.evaluate(() => document.body.classList.contains('theme-christmas')));
      assert.match(await phone.textContent('#r-stats'), /4\.050 kr\./);
      assert.equal(await phone.locator('.seatno:visible').count(), 0, 'no seat numbers outside arrange mode');
      await phone.screenshot({ path: path.join(SHOTS, 'remote-christmas.png') });
      await ctx.close();
    });

    await t.test('no JS errors', () => assert.deepEqual(errors, []));
  } finally {
    await browser.close();
    await app.stop();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test('saved games from before switch from $ to kr. once', async () => {
  const E = require('../src/engine');
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'poker-mig-'));
  try {
    // an old save: $ currency and no migration flag
    const old = E.createTournament({ ...E.defaultConfig(), currency: '$' }, [{ name: 'Tony' }]);
    delete old.migratedCurrency;
    fs.writeFileSync(path.join(dataDir, 'state.json'), JSON.stringify(old));
    let app = createApp({ dataDir, port: 0, log: () => {} });
    let port = await app.start();
    let s = await (await fetch(`http://127.0.0.1:${port}/api/state`)).json();
    assert.equal(s.config.currency, 'kr.');
    assert.equal(s.players[0].name, 'Tony', 'players kept');
    // the host now deliberately picks $ → must survive a restart
    await fetch(`http://127.0.0.1:${port}/api/setup`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ config: { ...s.config, currency: '$' }, players: s.players }),
    });
    await app.stop();
    app = createApp({ dataDir, port: 0, log: () => {} });
    port = await app.start();
    s = await (await fetch(`http://127.0.0.1:${port}/api/state`)).json();
    assert.equal(s.config.currency, '$');
    await app.stop();
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test('a refused action right at a level change still updates every screen', async () => {
  const { io } = require('socket.io-client');
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'poker-race-'));
  let fake = 1_700_000_000_000;
  // tick very slowly so only the action can notice the level change
  const app = createApp({ dataDir, port: 0, tickMs: 60_000, log: () => {}, now: () => fake });
  const port = await app.start();
  const c = io(`http://127.0.0.1:${port}`, { transports: ['websocket'] });
  try {
    const states = [];
    c.on('state', (s) => states.push(s));
    await new Promise((r) => c.on('connect', r));
    await c.emitWithAck('action', { type: 'clock.start' });
    fake += 15 * 60_000 + 1000; // level 1 is over
    const res = await c.emitWithAck('action', { type: 'player.eliminate', playerId: 'nobody' });
    assert.equal(res.ok, false);
    await new Promise((r) => setTimeout(r, 200));
    assert.equal(states[states.length - 1].derived.levelNumber, 2, 'screens were told about level 2');
  } finally {
    c.close();
    await app.stop();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test('Santa announcer and bubble / in-the-money / heads-up moments', { skip: !chromium, timeout: 120000 }, async (t) => {
  const { io } = require('socket.io-client');
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'poker-voice-'));
  const app = createApp({ dataDir, port: 0, log: () => {} });
  const port = await app.start();
  const base = `http://127.0.0.1:${port}`;
  const browser = await chromium.launch();
  const c = io(base, { transports: ['websocket'] });
  const errors = [];
  // capture speech instead of playing it
  const fakeSpeech = () => {
    window.__said = [];
    const fake = { speaking: false, speak(u) { window.__said.push({ text: u.text, pitch: u.pitch, rate: u.rate, lang: u.lang }); setTimeout(() => u.onend && u.onend(), 0); }, cancel() {}, getVoices() { return []; }, onvoiceschanged: null };
    Object.defineProperty(window, 'speechSynthesis', { value: fake, configurable: true });
  };
  try {
    const names = ['Tony', 'Maria', 'Jake', 'Sofia', 'Lars'];
    const r = await (await fetch(base + '/api/setup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reset: true, config: { theme: 'christmas', buyIn: 100, payouts: { mode: 'percent', places: [50, 30, 20] } }, players: names.map((name) => ({ name })) }) })).json();
    const ids = Object.fromEntries(r.state.players.map((p) => [p.name, p.id]));
    assert.deepEqual(r.state.config.announcer, { voice: 'santa', lang: 'en' }, 'Santa in English by default');
    const display = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
    await display.addInitScript(fakeSpeech);
    display.on('pageerror', (e) => errors.push(e.message));
    await display.goto(base + '/display');
    await display.waitForSelector('.seat');
    await new Promise((res) => (c.connected ? res() : c.on('connect', res)));
    const act = (a) => c.emitWithAck('action', a);
    const said = () => display.evaluate(() => window.__said.map((x) => x.text).join(' | '));
    const waitSaid = (re) => display.waitForFunction((src) => new RegExp(src).test(window.__said.map((x) => x.text).join(' | ')), re.source);

    await t.test('shuffle up and deal + level announcements in a deep Santa voice', async () => {
      await act({ type: 'clock.start' });
      await waitSaid(/Shuffle up and deal/);
      await act({ type: 'clock.next' });
      await waitSaid(/Level 2! The blinds are now 50 and 100/);
      const u = await display.evaluate(() => window.__said[0]);
      assert.ok(u.pitch < 0.7 && u.rate < 1, 'deep, slow Santa voice');
    });

    await t.test('bubble', async () => {
      await act({ type: 'player.eliminate', playerId: ids.Lars });
      await waitSaid(/Lars .* 5th place/);
      await waitSaid(/on the bubble/);
      await display.waitForFunction(() => document.getElementById('moment').textContent.includes('BUBBLE'));
      await display.waitForFunction(() => /ON THE BUBBLE/.test(document.getElementById('spotlight').textContent), null, { timeout: 15000 });
      await display.waitForTimeout(600);
      await display.screenshot({ path: path.join(SHOTS, 'display-bubble.png') });
    });

    await t.test('bubble bursts → in the money', async () => {
      await act({ type: 'player.eliminate', playerId: ids.Sofia });
      await waitSaid(/Sofia bursts the bubble in 4th place/);
      await display.waitForFunction(() => document.getElementById('moment').textContent.includes('IN THE MONEY'));
      await display.waitForFunction(() => /IN THE MONEY[\s\S]*Sofia burst the bubble/.test(document.getElementById('spotlight').textContent), null, { timeout: 20000 });
      await display.waitForTimeout(600);
      await display.screenshot({ path: path.join(SHOTS, 'display-in-the-money.png') });
    });

    await t.test('heads up', async () => {
      await act({ type: 'player.eliminate', playerId: ids.Jake });
      await waitSaid(/Jake .* 3rd place.*100 kroner/);
      await waitSaid(/Heads up! (Tony|Maria) versus (Tony|Maria)/);
      await display.waitForFunction(() => document.getElementById('moment').textContent.includes('HEADS UP'));
      await display.waitForFunction(() => /VS[\s\S]*HEADS UP/.test(document.getElementById('spotlight').textContent), null, { timeout: 20000 });
      await display.waitForTimeout(600);
      await display.screenshot({ path: path.join(SHOTS, 'display-heads-up.png') });
    });

    await t.test('champion', async () => {
      await act({ type: 'player.eliminate', playerId: ids.Maria });
      await waitSaid(/Merry Christmas, Tony! You are the champion, and win 250 kroner/);
      await display.waitForFunction(() => document.getElementById('moment').classList.contains('hidden'));
    });

    await t.test('Danish, normal voice, and off', async () => {
      await act({ type: 'undo' }); // back to heads up
      const s0 = await (await fetch(base + '/api/state')).json();
      const setCfg = (announcer) => fetch(base + '/api/setup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ config: { ...s0.config, announcer }, players: s0.players }) });
      await setCfg({ voice: 'normal', lang: 'da' });
      await display.waitForFunction(() => true);
      await new Promise((res) => setTimeout(res, 300));
      await act({ type: 'clock.next' });
      await waitSaid(/Niveau 3\. Blinds er nu 75 og 150/);
      const last = await display.evaluate(() => window.__said[window.__said.length - 1]);
      assert.equal(last.lang, 'da-DK');
      assert.equal(last.pitch, 1);
      await setCfg({ voice: 'off', lang: 'en' });
      await new Promise((res) => setTimeout(res, 300));
      const before = (await said()).length;
      await act({ type: 'clock.next' });
      await new Promise((res) => setTimeout(res, 500));
      assert.equal((await said()).length, before, 'silent when off');
    });

    await t.test('"Hear the announcer" button in Settings', async () => {
      const setup = await browser.newPage();
      await setup.addInitScript(fakeSpeech);
      await setup.goto(base + '/setup');
      await setup.waitForSelector('#lv-rows .lv-row');
      await setup.selectOption('[data-k="announcer.voice"]', 'santa');
      await setup.click('#b-voice');
      await setup.waitForFunction(() => window.__said.some((x) => /Santa will be your announcer/.test(x.text)));
      await setup.close();
    });

    await t.test('no JS errors', () => assert.deepEqual(errors, []));
  } finally {
    c.close();
    await browser.close();
    await app.stop();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test('9 different hats, payout % on TV, payouts changed mid-game from the phone, saved default', { skip: !chromium, timeout: 120000 }, async (t) => {
  const { io } = require('socket.io-client');
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'poker-def-'));
  let app = createApp({ dataDir, port: 0, log: () => {} });
  const port = await app.start();
  const base = `http://127.0.0.1:${port}`;
  const browser = await chromium.launch();
  const c = io(base, { transports: ['websocket'] });
  const errors = [];
  const names = ['Tony', 'Maria', 'Jake', 'Sofia', 'Lars', 'Nina', 'Omar', 'Emma', 'Ali'];
  try {
    const r = await (await fetch(base + '/api/setup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reset: true, config: { theme: 'christmas', seats: 9, buyIn: 100, payouts: { mode: 'percent', places: [50, 30, 20] } }, players: names.map((name) => ({ name })) }) })).json();
    const display = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
    display.on('pageerror', (e) => errors.push(e.message));
    await display.goto(base + '/display');
    await display.waitForSelector('.seat .hat');

    await t.test('every one of the 9 players wears a different hat by default', async () => {
      const hats = await display.locator('.seat .hat').evaluateAll((els) => els.map((e) => e.getAttribute('class')));
      assert.equal(hats.length, 9);
      assert.equal(new Set(hats).size, 9, hats.join(', '));
      await display.waitForTimeout(400);
      await display.screenshot({ path: path.join(SHOTS, 'display-9-hats.png') });
    });

    await t.test('payout percentages are shown on the TV', async () => {
      const txt = await display.textContent('#payouts');
      assert.match(txt, /1st[\s\S]*50%[\s\S]*450 kr\./);
      assert.match(txt, /3rd[\s\S]*20%[\s\S]*180 kr\./);
    });

    await t.test('switch to top 4 and custom % from the phone during the game', async () => {
      await new Promise((res) => (c.connected ? res() : c.on('connect', res)));
      await c.emitWithAck('action', { type: 'clock.start' });
      await c.emitWithAck('action', { type: 'player.eliminate', playerId: r.state.players[8].id });
      const ctx = await browser.newContext({ ...devices['iPhone 13'] });
      const phone = await ctx.newPage();
      phone.on('pageerror', (e) => errors.push(e.message));
      phone.on('dialog', (d) => d.accept());
      await phone.goto(base + '/remote');
      await phone.tap('#b-menu');
      await phone.tap('#menu a[href="/setup#payouts"]');
      await phone.waitForSelector('#pay-list .pay-row');
      await phone.tap('#pay-presets button:has-text("Top 4")');
      assert.equal(await phone.locator('#pay-list .pay-row').count(), 4);
      // custom: 40 / 30 / 20 / 10
      for (const [i, v] of [[0, '40'], [1, '30'], [2, '20'], [3, '10']]) await phone.fill(`[data-pay="${i}"]`, v);
      assert.match(await phone.textContent('#pay-sum'), /100%/);
      await phone.tap('#b-save');
      await display.waitForFunction(() => document.querySelectorAll('#payouts li').length === 4);
      assert.match(await display.textContent('#payouts'), /1st[\s\S]*40%[\s\S]*360 kr\.[\s\S]*4th[\s\S]*10%[\s\S]*90 kr\./);
      const s = await (await fetch(base + '/api/state')).json();
      assert.equal(s.derived.running, true, 'clock kept running');
      assert.equal(s.players.find((p) => p.name === 'Ali').status, 'out', 'progress kept');
      await ctx.close();
    });

    await t.test('save as my default → used after a fresh start, and loadable in Settings', async () => {
      const setup = await browser.newPage({ viewport: { width: 1280, height: 900 } });
      setup.on('pageerror', (e) => errors.push(e.message));
      setup.on('dialog', (d) => d.accept());
      await setup.goto(base + '/setup');
      await setup.waitForSelector('.pl-card');
      await setup.selectOption('[data-pl-hat="0"]', 'crown');
      await setup.click('#b-default-save');
      await setup.waitForSelector('.toast:has-text("Saved as your default")');
      const def = JSON.parse(fs.readFileSync(path.join(dataDir, 'default.json'), 'utf8'));
      assert.equal(def.players.length, 9);
      assert.equal(def.players[0].hat, 'crown');
      assert.deepEqual(def.config.payouts.places, [40, 30, 20, 10]);
      assert.ok(!('status' in def.players[0]), 'no game progress in the default');

      // something else gets set up, then "Load my default" brings it back into the form
      await fetch(base + '/api/setup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reset: true, config: { name: 'Other' }, players: [{ name: 'X' }, { name: 'Y' }] }) });
      await setup.reload();
      await setup.waitForSelector('.pl-card');
      assert.equal(await setup.locator('.pl-card').count(), 2);
      await setup.click('#b-default-load');
      await setup.waitForFunction(() => document.querySelectorAll('.pl-card').length === 9);
      assert.equal(await setup.inputValue('[data-pl-hat="0"]'), 'crown');
      await setup.close();

      // fresh start (no saved game) → the default is used
      await app.stop();
      fs.unlinkSync(path.join(dataDir, 'state.json'));
      app = createApp({ dataDir, port: 0, log: () => {} });
      const p2 = await app.start();
      const s = await (await fetch(`http://127.0.0.1:${p2}/api/state`)).json();
      assert.equal(s.players.length, 9);
      assert.ok(s.players.every((p) => p.status === 'active'));
      assert.deepEqual(s.config.payouts.places, [40, 30, 20, 10]);
    });

    await t.test('no JS errors', () => assert.deepEqual(errors, []));
  } finally {
    c.close();
    await browser.close();
    await app.stop();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test('real Santa voice via ElevenLabs (mock API): connect, pick voice, cache, play on TV, fallback', { skip: !chromium, timeout: 120000 }, async (t) => {
  const express = require('express');
  const { io } = require('socket.io-client');
  // a tiny valid WAV so the browser can actually play the "clip"
  const wav = (() => {
    const rate = 8000, n = 2400, b = Buffer.alloc(44 + n * 2);
    b.write('RIFF', 0); b.writeUInt32LE(36 + n * 2, 4); b.write('WAVEfmt ', 8); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22);
    b.writeUInt32LE(rate, 24); b.writeUInt32LE(rate * 2, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(n * 2, 40);
    for (let i = 0; i < n; i++) b.writeInt16LE(Math.round(Math.sin(i / 8) * 3000), 44 + i * 2);
    return b;
  })();
  const calls = [];
  let ttsFails = false;
  const mock = express();
  mock.use(express.json());
  const auth = (req, res, next) => (req.get('xi-api-key') === 'good-key' ? next() : res.status(401).json({ detail: { status: 'invalid_api_key', message: 'Invalid API key' } }));
  mock.get('/v1/voices', auth, (req, res) => res.json({ voices: [{ voice_id: 'mine1', name: 'My voice' }] }));
  mock.get('/v1/shared-voices', auth, (req, res) => {
    calls.push({ kind: 'search', q: req.query.search, page_size: req.query.page_size });
    res.json({ has_more: false, voices: [
      { public_owner_id: 'own1', voice_id: 'lib1', name: 'Santa Claus', description: 'Jolly old Saint Nick', preview_url: `http://127.0.0.1:${mockPort}/preview.wav`, free_users_allowed: true },
      { public_owner_id: 'own2', voice_id: 'lib2', name: 'Father Christmas', description: 'British Santa', preview_url: '', free_users_allowed: false },
    ] });
  });
  mock.post('/v1/voices/add/:owner/:voice', auth, (req, res) => { calls.push({ kind: 'add', owner: req.params.owner, voice: req.params.voice, new_name: req.body.new_name }); res.json({ voice_id: 'added1' }); });
  mock.post('/v1/text-to-speech/:voice', auth, (req, res) => {
    calls.push({ kind: 'tts', voice: req.params.voice, format: req.query.output_format, ...req.body });
    if (ttsFails) return res.status(500).json({ detail: 'boom' });
    res.type('audio/wav').send(wav);
  });
  mock.get('/preview.wav', (req, res) => res.type('audio/wav').send(wav));
  const mockServer = await new Promise((r) => { const s = mock.listen(0, () => r(s)); });
  const mockPort = mockServer.address().port;

  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'poker-santa-'));
  const app = createApp({ dataDir, port: 0, log: () => {}, elevenLabsUrl: `http://127.0.0.1:${mockPort}` });
  const port = await app.start();
  const base = `http://127.0.0.1:${port}`;
  const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  const c = io(base, { transports: ['websocket'] });
  const errors = [];
  const tts = () => calls.filter((x) => x.kind === 'tts');
  const spy = () => {
    window.__played = []; window.__said = [];
    const orig = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function () { window.__played.push(decodeURIComponent(this.src)); return orig.call(this); };
    Object.defineProperty(window, 'speechSynthesis', { configurable: true, value: { speaking: false, speak(u) { window.__said.push(u.text); setTimeout(() => u.onend && u.onend(), 0); }, cancel() {}, getVoices() { return []; } } });
  };
  try {
    const r = await (await fetch(base + '/api/setup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reset: true, config: { theme: 'christmas', buyIn: 100, levels: [{ type: 'level', sb: 25, bb: 50, ante: 0, minutes: 15 }, { type: 'level', sb: 50, bb: 100, ante: 0, minutes: 15 }, { type: 'break', minutes: 10, label: 'Break' }] }, players: ['Tony', 'Maria', 'Jake', 'Sofia'].map((name) => ({ name })) }) })).json();
    const ids = Object.fromEntries(r.state.players.map((p) => [p.name, p.id]));
    const setup = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await setup.addInitScript(spy);
    setup.on('pageerror', (e) => errors.push(e.message));
    setup.on('dialog', (d) => d.accept());
    await setup.goto(base + '/setup#santa');
    await setup.waitForSelector('#sv-status');

    await t.test('a wrong key is refused with a clear message', async () => {
      await setup.fill('#sv-key', 'bad-key');
      await setup.click('#sv-key-save');
      await setup.waitForFunction(() => /did not accept the API key/.test(document.getElementById('sv-key-note').textContent));
    });

    await t.test('connect, search Santa voices, use one', async () => {
      await setup.fill('#sv-key', 'good-key');
      await setup.click('#sv-key-save');
      await setup.waitForSelector('.sv-voice');
      assert.equal(await setup.locator('.sv-voice').count(), 2);
      assert.match(await setup.textContent('.sv-voice[data-i="1"]'), /Paid ElevenLabs plans only/);
      assert.equal(calls.find((x) => x.kind === 'search').q, 'santa claus');
      await setup.click('[data-use="0"]');
      await setup.waitForFunction(() => /Using "Santa Claus"/.test(document.getElementById('sv-status').textContent));
      assert.deepEqual(calls.find((x) => x.kind === 'add'), { kind: 'add', owner: 'own1', voice: 'lib1', new_name: 'Santa Claus' });
      await setup.locator('#santa').screenshot({ path: path.join(SHOTS, 'settings-santa-voice.png') });
    });

    await t.test('the API key never leaves this computer', async () => {
      const st = await (await fetch(base + '/api/state')).text();
      const v = await (await fetch(base + '/api/voice')).text();
      assert.ok(!st.includes('good-key') && !v.includes('good-key'));
      assert.match(v, /••••-key/);
      assert.equal(JSON.parse(st).voice.ready, true);
      assert.equal(JSON.parse(fs.readFileSync(path.join(dataDir, 'voice.json'), 'utf8')).apiKey, 'good-key');
    });

    await t.test('Hear Santa makes a real ElevenLabs request', async () => {
      await setup.click('#sv-hear');
      await setup.waitForFunction(() => window.__played.some((s) => /Santa will be your announcer/.test(s)));
      const call = tts()[0];
      assert.equal(call.voice, 'added1');
      assert.equal(call.model_id, 'eleven_multilingual_v2');
      assert.equal(call.format, 'mp3_44100_128');
      assert.match(call.text, /Ho ho ho! Merry Christmas! Santa will be your announcer tonight\./);
      assert.ok(call.voice_settings && call.voice_settings.stability > 0);
      assert.deepEqual(await setup.evaluate(() => window.__said), [], 'no robot voice');
    });

    await t.test('prepare lines ahead; second time everything is cached', async () => {
      const before = tts().length;
      await setup.click('#sv-prepare');
      await setup.waitForFunction(() => /✓ Ready/.test(document.getElementById('sv-prep').textContent), null, { timeout: 30000 });
      const made = tts().length - before;
      assert.ok(made >= 10, `made ${made} lines`);
      assert.ok(tts().some((x) => /Level 2! The blinds are now 50 and 100/.test(x.text)));
      assert.ok(tts().some((x) => /Maria buys back in/.test(x.text)));
      await setup.click('#sv-prepare');
      await setup.waitForFunction(() => /0 new/.test(document.getElementById('sv-prep').textContent), null, { timeout: 30000 });
      assert.equal(tts().length - before, made, 'nothing paid for twice');
    });

    const display = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
    await display.addInitScript(spy);
    display.on('pageerror', (e) => errors.push(e.message));
    await display.goto(base + '/display');
    await display.waitForSelector('.seat');
    await display.click('body');
    await new Promise((res) => (c.connected ? res() : c.on('connect', res)));

    await t.test('TV plays Santa clips: prepared lines from cache, new lines generated', async () => {
      const before = tts().length;
      await c.emitWithAck('action', { type: 'clock.start' });
      await display.waitForFunction(() => window.__played.some((s) => /Shuffle up and deal/.test(s)));
      assert.equal(tts().length, before, 'start line came from the cache');
      await c.emitWithAck('action', { type: 'player.eliminate', playerId: ids.Sofia });
      await display.waitForFunction(() => window.__played.some((s) => /Sofia/.test(s)), null, { timeout: 15000 });
      assert.ok(tts().some((x) => /Sofia/.test(x.text)), 'new line generated');
      assert.deepEqual(await display.evaluate(() => window.__said), [], 'no robot voice used');
    });

    await t.test('if ElevenLabs fails, the built-in voice says it instead', async () => {
      ttsFails = true;
      await c.emitWithAck('action', { type: 'player.eliminate', playerId: ids.Jake });
      await display.waitForFunction(() => window.__said.some((s) => /Jake/.test(s)), null, { timeout: 20000 });
      ttsFails = false;
    });

    await t.test('Danish lines go to the same Santa voice', async () => {
      const s0 = await (await fetch(base + '/api/state')).json();
      await fetch(base + '/api/setup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ config: { ...s0.config, announcer: { voice: 'santa', lang: 'da' } }, players: s0.players }) });
      await new Promise((res) => setTimeout(res, 300));
      await c.emitWithAck('action', { type: 'clock.next' });
      await display.waitForFunction(() => window.__played.some((s) => /Niveau 2! Blinds er nu 50 og 100/.test(s)), null, { timeout: 15000 });
    });

    await t.test('no JS errors', () => assert.deepEqual(errors, []));
  } finally {
    c.close();
    await browser.close();
    await app.stop();
    mockServer.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});
