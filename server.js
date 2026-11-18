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

function createApp({ dataDir = path.join(__dirname, 'data'), port = 3000, tickMs = 250, log = console.log } = {}) {
  const uploadsDir = path.join(dataDir, 'uploads');
  fs.mkdirSync(uploadsDir, { recursive: true });
  const stateFile = path.join(dataDir, 'state.json');

  /* ---------- state + persistence ---------- */
  let t;
  try {
    t = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
    t.config = engine.normalizeConfig(t.config);
    if (t.clock && t.clock.running) {
      // server was stopped while running: restore the time left at the last save, paused
      const elapsed = Math.max(0, (t.savedAt || t.clock.anchor) - t.clock.anchor);
      t.clock.remainingMs = Math.max(1000, t.clock.remainingMs - elapsed);
      t.clock.running = false;
      t.clock.anchor = Date.now();
    }
  } catch {
    t = engine.createTournament(engine.defaultConfig(), []);
  }
  let saveTimer = null;
  const saveNow = () => {
    clearTimeout(saveTimer);
    saveTimer = null;
    const tmp = stateFile + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify({ ...t, savedAt: Date.now() }));
    fs.renameSync(tmp, stateFile);
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

  const broadcast = (events = []) => {
    const state = engine.publicState(t, Date.now());
    io.emit('state', state);
    for (const e of events) io.emit('event', e);
    save();
  };

  app.get('/api/state', (req, res) => res.json(engine.publicState(t, Date.now())));

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
    try {
      if (reset) t = engine.createTournament(config, players, Date.now());
      else engine.updateSetup(t, config, players, Date.now());
      broadcast([{ type: reset ? 'reset' : 'setup' }]);
      saveNow();
      res.json({ ok: true, state: engine.publicState(t, Date.now()) });
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
    socket.emit('state', engine.publicState(t, Date.now()));
    socket.on('action', (action, ack) => {
      const reply = typeof ack === 'function' ? ack : () => {};
      try {
        const { events } = engine.apply(t, action, Date.now());
        broadcast(events);
        reply({ ok: true });
      } catch (e) {
        if (!(e instanceof engine.ActionError)) log('action error', e);
        reply({ ok: false, error: e.message });
      }
    });
  });

  const timer = setInterval(() => {
    const events = engine.tick(t, Date.now());
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
    }),
  };
}

module.exports = { createApp, lanAddresses };

if (require.main === module) {
  const port = Number(process.env.PORT) || 3000;
  const inst = createApp({ port });
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
