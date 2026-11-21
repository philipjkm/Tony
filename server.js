'use strict';
const path = require('path');
const fs = require('fs');
const os = require('os');
const http = require('http');
const crypto = require('crypto');
const express = require('express');
const multer = require('multer');
const QRCode = require('qrcode');
const { Server } = require('socket.io');
const engine = require('./src/engine');
const { createVoice } = require('./src/voice');

function lanAddresses() {
  const out = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const a of list || []) {
      if (a.family === 'IPv4' && !a.internal) out.push(a.address);
    }
  }
  // prefer typical home-network ranges
  return out.sort((a, b) => Number(!/^(192\.168|10\.)/.test(a)) - Number(!/^(192\.168|10\.)/.test(b)));
}

// Monotonic clock: immune to the Mac's wall clock being adjusted (time sync) mid-game.
const WALL0 = Date.now();
const PERF0 = performance.now();
const monotonicNow = () => WALL0 + (performance.now() - PERF0);

function createApp({ dataDir = path.join(__dirname, 'data'), port = 3000, tickMs = 250, log = console.log, now = monotonicNow, elevenLabsUrl = process.env.ELEVENLABS_URL || 'https://api.elevenlabs.io' } = {}) {
  const uploadsDir = path.join(dataDir, 'uploads');
  fs.mkdirSync(uploadsDir, { recursive: true });
  const stateFile = path.join(dataDir, 'state.json');

  /* ---------- state + persistence ---------- */
  let t;
  try {
    t = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
    t.config = engine.normalizeConfig(t.config);
    engine.fixSeats(t); // older saves have no seats yet
    // one-time switch from the old $ default to kr. (a later deliberate choice of $ is kept)
    if (!t.migratedCurrency) {
      if (t.config.currency === '$') t.config.currency = 'kr.';
      t.migratedCurrency = true;
    }
    if (t.clock && t.clock.running) {
      // server was stopped while running: restore the time left at the last save, paused
      const elapsed = Math.max(0, (t.savedAt || t.clock.anchor) - t.clock.anchor);
      t.clock.remainingMs = Math.max(1000, t.clock.remainingMs - elapsed);
      t.clock.running = false;
      t.clock.anchor = now();
    }
  } catch {
    // fresh install / no saved game: start from the host's saved default if there is one
    let def = null;
    try { def = JSON.parse(fs.readFileSync(path.join(dataDir, 'default.json'), 'utf8')); } catch { /* none */ }
    t = def ? engine.createTournament(def.config, def.players, now()) : engine.createTournament(engine.defaultConfig(), []);
  }
  let saveTimer = null;
  const saveNow = () => {
    clearTimeout(saveTimer);
    saveTimer = null;
    try {
      const tmp = stateFile + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify({ ...t, savedAt: now() }));
      fs.renameSync(tmp, stateFile);
    } catch (e) {
      // e.g. disk full: keep the game running, try again on the next change
      log('could not save state:', e.message);
    }
  };
  const save = () => {
    if (!saveTimer) saveTimer = setTimeout(saveNow, 300);
  };

  /* ---------- http ---------- */
  const app = express();
  const server = http.createServer(app);
  const io = new Server(server, { maxHttpBufferSize: 1e6 });

  app.disable('x-powered-by');
  app.use(express.json({ limit: '1mb' }));
  app.use('/uploads', express.static(uploadsDir, { maxAge: '7d', immutable: true }));
  app.use(express.static(path.join(__dirname, 'public'), { extensions: ['html'] }));

  const voice = createVoice({ dataDir, baseUrl: elevenLabsUrl, log });
  // what clients see: game state + whether the real Santa voice is ready (never the API key)
  const pub = () => ({ ...engine.publicState(t, now()), voice: { ready: voice.status().ready, name: voice.status().voiceName } });

  const broadcast = (events = []) => {
    const state = pub();
    io.emit('state', state);
    for (const e of events) io.emit('event', e);
    save();
  };

  app.get('/api/state', (req, res) => res.json(pub()));

  app.get('/api/info', (req, res) => {
    const actualPort = server.address() ? server.address().port : port;
    const ips = lanAddresses();
    res.json({
      port: actualPort,
      urls: ips.map((ip) => `http://${ip}:${actualPort}`),
      local: `http://localhost:${actualPort}`,
    });
  });

  app.get('/api/qr.svg', async (req, res) => {
    const actualPort = server.address() ? server.address().port : port;
    const ip = lanAddresses()[0] || 'localhost';
    const p = String(req.query.path || '/remote').replace(/[^\w/-]/g, '');
    const svg = await QRCode.toString(`http://${ip}:${actualPort}${p}`, {
      type: 'svg', margin: 1, color: { dark: '#0b0e14', light: '#ffffff' },
    });
    res.type('image/svg+xml').send(svg);
  });

  app.post('/api/setup', (req, res) => {
    const { config, players, reset } = req.body || {};
    const pending = engine.tick(t, now());
    if (pending.length) broadcast(pending);
    try {
      if (reset) t = engine.createTournament(config, players, now());
      else engine.updateSetup(t, config, players, now());
      broadcast([{ type: reset ? 'reset' : 'setup' }]);
      saveNow();
      res.json({ ok: true, state: pub() });
    } catch (e) {
      res.status(400).json({ ok: false, error: e.message });
    }
  });

  /* ---------- real Santa voice (ElevenLabs) ---------- */
  const voiceRoute = (fn) => async (req, res) => {
    try {
      res.json({ ok: true, ...(await fn(req)) });
    } catch (e) {
      res.status(e.status === 401 ? 401 : 400).json({ ok: false, error: e.message });
    }
  };
  const announceVoice = () => io.emit('state', pub());
  app.get('/api/voice', voiceRoute(async () => ({ status: voice.status() })));
  app.post('/api/voice/key', voiceRoute(async (req) => { const st = await voice.setKey(req.body && req.body.apiKey); announceVoice(); return { status: st }; }));
  app.get('/api/voice/search', voiceRoute(async (req) => ({ voices: await voice.search(req.query.q) })));
  app.get('/api/voice/mine', voiceRoute(async () => ({ voices: await voice.myVoices() })));
  app.post('/api/voice/use', voiceRoute(async (req) => { const st = await voice.useVoice(req.body || {}); announceVoice(); return { status: st }; }));
  app.post('/api/voice/prepare', voiceRoute(async (req) => {
    const texts = Array.isArray(req.body && req.body.texts) ? req.body.texts.slice(0, 50) : [];
    let made = 0, cached = 0;
    const failed = [];
    for (const text of texts) {
      if (voice.isCached(text)) { cached++; continue; }
      try { await voice.tts(text); made++; } catch (e) { failed.push(e.message); if (e.status === 401 || e.status === 402) break; }
    }
    return { made, cached, failed };
  }));
  app.get('/api/tts', async (req, res) => {
    try {
      const { file, type } = await voice.tts(req.query.text);
      res.type(type).set('Cache-Control', 'public, max-age=31536000').sendFile(file);
    } catch (e) {
      res.status(502).json({ ok: false, error: e.message });
    }
  });

  const defaultFile = path.join(dataDir, 'default.json');
  app.get('/api/default', (req, res) => {
    try {
      const def = JSON.parse(fs.readFileSync(defaultFile, 'utf8'));
      res.json({ ok: true, config: engine.normalizeConfig(def.config), players: def.players || [] });
    } catch {
      res.status(404).json({ ok: false, error: 'No default saved yet' });
    }
  });
  app.post('/api/default', (req, res) => {
    const { config, players } = req.body || {};
    try {
      // keep it clean: settings + who plays (names, photos, hats), no game progress
      const tmp = engine.createTournament(config, players, now());
      const def = { savedAt: new Date().toISOString(), config: tmp.config, players: tmp.players.map(({ id, name, photo, hat }) => ({ id, name, photo, hat })) };
      fs.writeFileSync(defaultFile, JSON.stringify(def, null, 2));
      res.json({ ok: true });
    } catch (e) {
      res.status(400).json({ ok: false, error: e.message });
    }
  });

  const upload = multer({
    storage: multer.diskStorage({
      destination: uploadsDir,
      filename: (req, file, cb) => {
        const ext = ({ 'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp', 'image/gif': '.gif' })[file.mimetype] || '.img';
        cb(null, crypto.randomBytes(8).toString('hex') + ext);
      },
    }),
    limits: { fileSize: 15 * 1024 * 1024 },
    fileFilter: (req, file, cb) => cb(null, /^image\/(png|jpeg|webp|gif)$/.test(file.mimetype)),
  });
  app.post('/api/upload', (req, res) => {
    upload.single('file')(req, res, (err) => {
      if (err) return res.status(400).json({ ok: false, error: err.message });
      if (!req.file) return res.status(400).json({ ok: false, error: 'Please upload a PNG, JPG, WEBP or GIF image' });
      res.json({ ok: true, url: '/uploads/' + req.file.filename });
    });
  });

  /* ---------- realtime ---------- */
  io.on('connection', (socket) => {
    socket.emit('state', pub());
    // clients ask for a fresh copy after waking up (phones pause their timers while asleep)
    socket.on('sync', () => socket.emit('state', pub()));
    socket.on('action', (action, ack) => {
      const reply = typeof ack === 'function' ? ack : () => {};
      // bring the clock up to date and announce any level change first, so a refused
      // action right at a level boundary can never leave the screens behind
      const pending = engine.tick(t, now());
      if (pending.length) broadcast(pending);
      try {
        const { events } = engine.apply(t, action, now());
        broadcast(events);
        reply({ ok: true });
      } catch (e) {
        if (!(e instanceof engine.ActionError)) log('action error', e);
        reply({ ok: false, error: e.message });
      }
    });
  });

  const timer = setInterval(() => {
    const events = engine.tick(t, now());
    if (events.length) broadcast(events);
  }, tickMs);
  // keep the saved clock fresh while running (crash / restart safety)
  const autosave = setInterval(() => { if (t.clock.running) save(); }, 5000);

  return {
    app,
    server,
    io,
    getTournament: () => t,
    start: () => new Promise((resolve) => server.listen(port, () => resolve(server.address().port))),
    stop: () => new Promise((resolve) => {
      clearInterval(timer);
      clearInterval(autosave);
      if (saveTimer) saveNow();
      io.close();
      server.close(() => resolve());
      server.closeAllConnections(); // don't wait for idle keep-alive connections
    }),
  };
}

module.exports = { createApp, lanAddresses };

if (require.main === module) {
  const port = Number(process.env.PORT) || 3000;
  const inst = createApp({ port, ...(process.env.DATA_DIR ? { dataDir: process.env.DATA_DIR } : {}) });
  inst.start().then((p) => {
    const urls = lanAddresses().map((ip) => `http://${ip}:${p}`);
    const lan = urls[0] || `http://localhost:${p}`;
    console.log('\n  ♠ ♥  Tony Poker Tournament  ♦ ♣\n');
    console.log(`  Home / links :  http://localhost:${p}`);
    console.log(`  TV display   :  http://localhost:${p}/display`);
    console.log(`  Settings     :  http://localhost:${p}/setup`);
    console.log(`  Phone remote :  ${lan}/remote   (same Wi-Fi)\n`);
  });
  const shutdown = () => inst.stop().then(() => process.exit(0));
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}
