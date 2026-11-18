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
      assert.equal(await display.locator('.seat').count(), NAMES.length);
      assert.equal(await display.locator('.seat img').count(), NAMES.length, 'player photos shown');
      assert.equal(await display.textContent('#pool'), '$340');
      assert.equal(await display.textContent('#blinds'), '100 / 200');
      assert.equal(await display.textContent('#t-name'), 'Tony’s Home Game');
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
      await display.waitForFunction(() => /\$400/.test(document.getElementById('pool').textContent));
      assert.equal(await display.textContent('.seat[data-id] .badge.a'), 'A');
      await phone.waitForTimeout(400);
      await phone.tap('#b-undo');
      await display.waitForFunction(() => /\$380/.test(document.getElementById('pool').textContent));
      // add it back for the screenshots
      await phone.tap('.r-seat[aria-label="Tony"]');
      await phone.waitForSelector('#sheet.show');
      await phone.tap('#a-addon');
      await display.waitForFunction(() => /\$400/.test(document.getElementById('pool').textContent));
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
