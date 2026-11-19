(function () {
  const { esc, fmtMoney, fmtNum, fmtShort, ordinal, avatarHTML, chipHTML, toast } = PT;
  const $ = (id) => document.getElementById(id);

  let cfg = null;
  let players = [];
  let progress = {}; // id -> runtime info from server
  let dirty = false;

  /* ---------------- load ---------------- */
  async function load() {
    const s = await fetch('/api/state').then((r) => r.json());
    cfg = s.config;
    PT.useCurrency(cfg.currency);
    players = s.players.map((p) => ({ id: p.id, name: p.name, photo: p.photo, hat: p.hat }));
    PT.applyTheme(cfg.theme);
    progress = Object.fromEntries(s.players.map((p) => [p.id, p]));
    renderAll();
    setDirty(false);
  }

  function setDirty(v) {
    dirty = v;
    const st = $('s-status');
    st.textContent = v ? '● Unsaved changes' : 'All changes saved · live display updates instantly on save';
    st.classList.toggle('dirty', v);
  }
  window.addEventListener('beforeunload', (e) => { if (dirty) { e.preventDefault(); e.returnValue = ''; } });

  /* ---------------- simple field binding ---------------- */
  const getPath = (obj, path) => path.split('.').reduce((o, k) => (o == null ? o : o[k]), obj);
  const setPath = (obj, path, v) => {
    const ks = path.split('.');
    const last = ks.pop();
    ks.reduce((o, k) => o[k], obj)[last] = v;
  };

  function bindFields() {
    document.querySelectorAll('[data-k]').forEach((el) => {
      const v = getPath(cfg, el.dataset.k);
      if (el.type === 'checkbox') el.checked = !!v;
      else el.value = v ?? '';
    });
    applyShows();
  }

  $('form').addEventListener('input', (e) => {
    const el = e.target;
    if (!el.dataset || !el.dataset.k) return;
    let v = el.type === 'checkbox' ? el.checked : el.type === 'number' ? (el.value === '' ? 0 : Number(el.value)) : el.value;
    setPath(cfg, el.dataset.k, v);
    if (el.dataset.k === 'currency') { PT.useCurrency(v); renderPayouts(); }
    if (el.dataset.k === 'theme') PT.applyTheme(v);
    setDirty(true);
    applyShows();
    renderPreview();
    renderPayouts(false);
  });

  function applyShows() {
    document.querySelectorAll('[data-show]').forEach((el) => {
      const [path, val] = el.dataset.show.split('=');
      const v = getPath(cfg, path);
      el.classList.toggle('hidden', val === undefined ? !v : String(v) !== val);
    });
  }

  /* ---------------- prize preview ---------------- */
  function projectedPool() {
    const n = players.length;
    const rb = Object.values(progress).reduce((s, p) => s + (p.rebuys || 0), 0);
    const ad = Object.values(progress).reduce((s, p) => s + (p.addons || 0), 0);
    if (cfg.prizePool.mode === 'fixed') return cfg.prizePool.fixed;
    return Math.max(cfg.buyIn * n + cfg.rebuy.price * rb + cfg.addon.price * ad + cfg.prizePool.added, cfg.prizePool.guarantee);
  }
  function renderPreview() {
    const cur = cfg.currency;
    const pool = projectedPool();
    const n = players.length;
    const items = [
      ['Prize pool now', fmtMoney(pool, cur)],
      ['Players', n],
      ['Each player pays', fmtMoney(cfg.buyIn + cfg.entryFee, cur)],
      ['House collects', fmtMoney(cfg.entryFee * n, cur)],
      ['Starting chips in play', fmtShort(cfg.startingStack * n)],
    ];
    $('pool-preview').innerHTML = items.map(([k, v]) => `<div class="pv"><b>${esc(v)}</b>${esc(k)}</div>`).join('');
  }

  /* ---------------- payouts ---------------- */
  const PRESETS = {
    'Winner takes all': [100],
    'Top 2': [65, 35],
    'Top 3': [50, 30, 20],
    'Top 4': [45, 27, 17, 11],
    'Top 5': [40, 25, 16, 11, 8],
    'Top 6': [36, 23, 15, 11, 8.5, 6.5],
  };
  $('pay-presets').innerHTML = Object.keys(PRESETS).map((k) => `<button data-p="${esc(k)}">${esc(k)}</button>`).join('');
  $('pay-presets').onclick = (e) => {
    const k = e.target.dataset.p;
    if (!k) return;
    cfg.payouts.mode = 'percent';
    cfg.payouts.places = [...PRESETS[k]];
    setDirty(true);
    renderPayouts();
  };
  $('pay-mode').onclick = (e) => {
    const v = e.target.dataset.v;
    if (!v || v === cfg.payouts.mode) return;
    const pool = projectedPool();
    const total = cfg.payouts.places.reduce((s, x) => s + x, 0) || 1;
    // convert values so the switch is non-destructive
    cfg.payouts.places = v === 'amount'
      ? cfg.payouts.places.map((x) => Math.round((pool * x) / total))
      : cfg.payouts.places.map((x) => Math.round((1000 * x) / total) / 10);
    cfg.payouts.mode = v;
    setDirty(true);
    renderPayouts();
  };
  $('pay-add').onclick = () => {
    cfg.payouts.places.push(0);
    setDirty(true);
    renderPayouts();
  };

  function renderPayouts(full = true) {
    const mode = cfg.payouts.mode;
    const cur = cfg.currency;
    const pool = projectedPool();
    document.querySelectorAll('#pay-mode button').forEach((b) => b.classList.toggle('on', b.dataset.v === mode));
    const total = cfg.payouts.places.reduce((s, x) => s + Number(x || 0), 0);
    if (full) {
      $('pay-list').innerHTML = cfg.payouts.places.map((v, i) => `
        <div class="pay-row">
          <span class="pl">${ordinal(i + 1)}</span>
          ${mode === 'amount' ? `<span class="unit">${esc(cur)}</span>` : ''}
          <input type="number" min="0" step="any" value="${v}" data-pay="${i}">
          ${mode === 'percent' ? '<span class="unit">%</span>' : ''}
          <span class="amt" data-amt="${i}"></span>
          <button class="x" data-rm-pay="${i}" title="Remove">✕</button>
        </div>`).join('');
    }
    document.querySelectorAll('[data-amt]').forEach((el) => {
      const v = Number(cfg.payouts.places[el.dataset.amt] || 0);
      el.textContent = mode === 'percent' ? fmtMoney(Math.floor((pool * v) / (total || 1)), cur) : pool ? ((100 * v) / pool).toFixed(1) + '%' : '';
    });
    const sum = $('pay-sum');
    if (mode === 'percent') {
      const ok = Math.abs(total - 100) < 0.01;
      sum.textContent = `Total ${+total.toFixed(2)}%` + (ok ? ' ✓' : ' — should be 100% (will be scaled)');
      sum.className = 'sum ' + (ok ? 'good' : 'bad');
    } else {
      const ok = Math.abs(total - pool) < 0.01;
      sum.textContent = `Total ${fmtMoney(total, cur)} of ${fmtMoney(pool, cur)} pool` + (ok ? ' ✓' : '');
      sum.className = 'sum ' + (ok ? 'good' : 'bad');
    }
  }
  $('pay-list').addEventListener('input', (e) => {
    const i = e.target.dataset.pay;
    if (i === undefined) return;
    cfg.payouts.places[i] = Number(e.target.value) || 0;
    setDirty(true);
    renderPayouts(false);
  });
  $('pay-list').addEventListener('click', (e) => {
    const i = e.target.dataset.rmPay;
    if (i === undefined) return;
    if (cfg.payouts.places.length <= 1) return toast('At least one paid place is required', { error: true });
    cfg.payouts.places.splice(i, 1);
    setDirty(true);
    renderPayouts();
  });

  /* ---------------- blind levels ---------------- */
  function renderLevels() {
    let n = 0;
    $('lv-rows').innerHTML = cfg.levels.map((l, i) => {
      const acts = `<div class="lv-acts">
          <button class="x" data-mv="${i}:-1" title="Move up">↑</button>
          <button class="x" data-mv="${i}:1" title="Move down">↓</button>
          <button class="x" data-rm-lv="${i}" title="Remove">✕</button></div>`;
      if (l.type === 'break') {
        return `<div class="lv-row brk"><span class="n">☕</span>
          <div class="lbl"><input type="text" value="${esc(l.label)}" data-lv="${i}" data-f="label" maxlength="40"></div>
          <div class="mins"><input type="number" min="0.1" step="any" value="${l.minutes}" data-lv="${i}" data-f="minutes" title="Minutes"></div>${acts}</div>`;
      }
      n++;
      const inp = (f, v) => `<input type="number" min="0" step="any" value="${v}" data-lv="${i}" data-f="${f}" aria-label="${f}">`;
      return `<div class="lv-row"><span class="n">${n}</span>${inp('sb', l.sb)}${inp('bb', l.bb)}${inp('ante', l.ante)}
        <div class="mins">${inp('minutes', l.minutes)}</div>${acts}</div>`;
    }).join('');
    const mins = cfg.levels.reduce((s, l) => s + Number(l.minutes || 0), 0);
    $('lv-sum').textContent = `${n} levels · ${cfg.levels.length - n} breaks · ${Math.floor(mins / 60)}h ${Math.round(mins % 60)}m total`;
  }
  $('lv-rows').addEventListener('input', (e) => {
    const i = e.target.dataset.lv;
    if (i === undefined) return;
    const f = e.target.dataset.f;
    const l = cfg.levels[i];
    const v = f === 'label' ? e.target.value : Number(e.target.value) || 0;
    // keep the small blind at half the big blind while it still follows that rule
    if (f === 'bb' && l.sb === Math.floor(l.bb / 2)) {
      l.sb = Math.floor(v / 2);
      const sbInput = document.querySelector(`[data-lv="${i}"][data-f="sb"]`);
      if (sbInput) sbInput.value = l.sb;
    }
    l[f] = v;
    setDirty(true);
  });
  $('lv-rows').addEventListener('change', () => renderLevelsSummary());
  function renderLevelsSummary() {
    const mins = cfg.levels.reduce((s, l) => s + Number(l.minutes || 0), 0);
    const n = cfg.levels.filter((l) => l.type === 'level').length;
    $('lv-sum').textContent = `${n} levels · ${cfg.levels.length - n} breaks · ${Math.floor(mins / 60)}h ${Math.round(mins % 60)}m total`;
  }
  $('lv-rows').addEventListener('click', (e) => {
    const t = e.target;
    if (t.dataset.rmLv !== undefined) {
      const i = Number(t.dataset.rmLv);
      if (cfg.levels.filter((l) => l.type === 'level').length <= 1 && cfg.levels[i].type === 'level') return toast('Keep at least one level', { error: true });
      cfg.levels.splice(i, 1);
    } else if (t.dataset.mv) {
      const [i, d] = t.dataset.mv.split(':').map(Number);
      const j = i + d;
      if (j < 0 || j >= cfg.levels.length) return;
      [cfg.levels[i], cfg.levels[j]] = [cfg.levels[j], cfg.levels[i]];
    } else return;
    setDirty(true);
    renderLevels();
  });
  $('lv-add').onclick = () => {
    const last = [...cfg.levels].reverse().find((l) => l.type === 'level') || { sb: 25, bb: 50, ante: 0, minutes: 15 };
    const bb = niceUp(last.bb * 1.4, last.bb);
    cfg.levels.push({ type: 'level', sb: Math.floor(bb / 2), bb, ante: last.ante ? bb : 0, minutes: last.minutes });
    setDirty(true);
    renderLevels();
  };
  $('lv-break').onclick = () => {
    cfg.levels.push({ type: 'break', minutes: 10, label: 'Break' });
    setDirty(true);
    renderLevels();
  };

  const NICE = [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8];
  function niceUp(v, mustExceed = 0) {
    for (let e = 0; e < 12; e++) {
      for (const m of NICE) {
        const x = m * 10 ** e;
        if (x >= v && x > mustExceed) return x;
      }
    }
    return Math.ceil(v);
  }
  function generate({ count, minutes, startBB, growth, anteFrom, breakEvery }) {
    const levels = [];
    let bb = startBB;
    for (let i = 0; i < count; i++) {
      if (i > 0) bb = niceUp(bb * growth, bb);
      const sb = bb / 2 >= 1 ? Math.floor(bb / 2) : bb;
      levels.push({ type: 'level', sb, bb, ante: anteFrom && i + 1 >= anteFrom ? bb : 0, minutes });
      if (breakEvery && (i + 1) % breakEvery === 0 && i < count - 1) levels.push({ type: 'break', minutes: 10, label: 'Break' });
    }
    return levels;
  }
  $('g-go').onclick = () => {
    const opts = {
      count: Math.min(60, Math.max(1, Number($('g-count').value) || 16)),
      minutes: Math.max(0.1, Number($('g-min').value) || 15),
      startBB: Math.max(1, Number($('g-bb').value) || 50),
      growth: Number($('g-speed').value) || 1.35,
      anteFrom: Number($('g-ante').value) || 0,
      breakEvery: Number($('g-break').value) || 0,
    };
    cfg.levels = generate(opts);
    setDirty(true);
    renderLevels();
    toast(`Generated ${opts.count} levels`);
  };

  /* ---------------- image upload (resized in the browser) ---------------- */
  function pickImage() {
    return new Promise((resolve) => {
      const input = $('file');
      input.value = '';
      input.onchange = () => resolve(input.files[0] || null);
      input.click();
    });
  }
  async function resize(file, max, type) {
    try {
      const bmp = await createImageBitmap(file);
      const scale = Math.min(1, max / Math.max(bmp.width, bmp.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(bmp.width * scale);
      canvas.height = Math.round(bmp.height * scale);
      canvas.getContext('2d').drawImage(bmp, 0, 0, canvas.width, canvas.height);
      return await new Promise((r) => canvas.toBlob(r, type, 0.88));
    } catch {
      return file; // fall back to the original
    }
  }
  async function upload(kind) {
    const file = await pickImage();
    if (!file) return null;
    const blob = await resize(file, kind === 'chip' ? 400 : 700, kind === 'chip' ? 'image/png' : 'image/jpeg');
    const fd = new FormData();
    fd.append('file', blob, kind === 'chip' ? 'chip.png' : 'photo.jpg');
    const res = await fetch('/api/upload', { method: 'POST', body: fd }).then((r) => r.json()).catch(() => ({ ok: false, error: 'Upload failed' }));
    if (!res.ok) { toast(res.error || 'Upload failed', { error: true }); return null; }
    return res.url;
  }

  /* ---------------- players ---------------- */
  function renderPlayers() {
    $('pl-count').textContent = `${players.length} registered`;
    $('pl-grid').innerHTML = players.map((p, i) => {
      const pr = progress[p.id];
      const st = !pr ? 'New' : pr.status === 'out' ? `Out · ${ordinal(pr.place)}` : pr.place === 1 ? 'Champion' : 'Active';
      const seat = !pr ? '' : pr.seat === null ? (pr.status === 'active' ? ' · Waiting' : '') : ` · Seat ${pr.seat + 1}`;
      const extra = pr && (pr.rebuys || pr.addons) ? ` · R${pr.rebuys} A${pr.addons}` : '';
      return `<div class="pl-card ${pr && pr.status === 'out' ? 'out' : ''}" data-i="${i}">
        <button class="x" data-rm-pl="${i}" title="Remove player">✕</button>
        <button class="ph" data-photo="${i}" title="Upload photo">${PT.hatHTML(p)}${avatarHTML(p, 86)}</button>
        <input type="text" value="${esc(p.name)}" data-pl-name="${i}" maxlength="40">
        <select class="hat-pick" data-pl-hat="${i}" aria-label="Hat for ${esc(p.name)}">${hatOptions(p.hat)}</select>
        <span class="st">${esc(st + seat + extra)}</span></div>`;
    }).join('');
  }
  function hatOptions(cur) {
    const opts = [['auto', '🎲 Hat: surprise me'], ...Object.entries(PT.HATS).map(([k, v]) => [k, v.label]), ['none', 'No hat']];
    return opts.map(([k, l]) => `<option value="${k}" ${k === (cur || 'auto') ? 'selected' : ''}>${l}</option>`).join('');
  }
  $('pl-grid').addEventListener('change', (e) => {
    const i = e.target.dataset.plHat;
    if (i === undefined) return;
    players[i].hat = e.target.value;
    setDirty(true);
    renderPlayers();
  });
  $('pl-grid').addEventListener('input', (e) => {
    const i = e.target.dataset.plName;
    if (i === undefined) return;
    players[i].name = e.target.value;
    setDirty(true);
  });
  $('pl-grid').addEventListener('click', async (e) => {
    const rm = e.target.closest('[data-rm-pl]');
    if (rm) {
      const p = players[rm.dataset.rmPl];
      if (!confirm(`Remove ${p.name}?`)) return;
      players.splice(rm.dataset.rmPl, 1);
      setDirty(true);
      renderPlayers();
      renderPreview();
      renderPayouts(false);
      return;
    }
    const ph = e.target.closest('[data-photo]');
    if (ph) {
      const card = ph.closest('.pl-card');
      card.classList.add('uploading');
      const url = await upload('photo');
      card.classList.remove('uploading');
      if (url) {
        players[ph.dataset.photo].photo = url;
        setDirty(true);
        renderPlayers();
      }
    }
  });
  $('pl-add').onsubmit = (e) => {
    e.preventDefault();
    const name = $('pl-name').value.trim();
    if (!name) return $('pl-name').focus();
    players.push({ id: 'p' + Math.random().toString(36).slice(2, 10), name, photo: '' });
    $('pl-name').value = '';
    $('pl-name').focus();
    setDirty(true);
    renderPlayers();
    renderPreview();
    renderPayouts(false);
  };

  /* ---------------- chips ---------------- */
  function renderChips() {
    $('ch-list').innerHTML = cfg.chips.map((ch, i) => `
      <div class="ch-row">
        <button class="pick" data-chip-img="${i}" title="Upload chip photo">${chipHTML(ch, 54)}<small>📷</small></button>
        <label class="f"><span>Value</span><input type="number" min="0" step="any" value="${ch.value}" data-chip="${i}" data-f="value"></label>
        <div class="f"><span>Color</span><div class="clr"><input type="color" value="${esc(ch.color.length === 7 ? ch.color : '#888888')}" data-chip="${i}" data-f="color">
          ${ch.image ? `<button class="rm-img" data-chip-rmimg="${i}">remove photo</button>` : ''}</div></div>
        <button class="x" data-rm-chip="${i}" title="Remove chip">✕</button>
      </div>`).join('');
  }
  $('ch-list').addEventListener('input', (e) => {
    const i = e.target.dataset.chip;
    if (i === undefined) return;
    const f = e.target.dataset.f;
    cfg.chips[i][f] = f === 'value' ? Number(e.target.value) || 0 : e.target.value;
    setDirty(true);
    if (f === 'color') {
      const prev = e.target.closest('.ch-row').querySelector('.chip');
      if (prev) prev.style.setProperty('--c', e.target.value);
    }
  });
  $('ch-list').addEventListener('click', async (e) => {
    const t = e.target.closest('button');
    if (!t) return;
    if (t.dataset.rmChip !== undefined) {
      cfg.chips.splice(t.dataset.rmChip, 1);
    } else if (t.dataset.chipRmimg !== undefined) {
      cfg.chips[t.dataset.chipRmimg].image = '';
    } else if (t.dataset.chipImg !== undefined) {
      t.classList.add('uploading');
      const url = await upload('chip');
      t.classList.remove('uploading');
      if (!url) return;
      cfg.chips[t.dataset.chipImg].image = url;
    } else return;
    setDirty(true);
    renderChips();
  });
  $('ch-add').onclick = () => {
    if (cfg.chips.length >= 12) return toast('Up to 12 chip types', { error: true });
    const max = cfg.chips.reduce((m, c) => Math.max(m, c.value), 0);
    cfg.chips.push({ id: 'c' + Math.random().toString(36).slice(2, 8), value: max ? max * 5 : 25, color: '#2f8cff', image: '' });
    setDirty(true);
    renderChips();
  };

  /* ---------------- save ---------------- */
  async function save(reset) {
    const bad = players.findIndex((p) => !p.name.trim());
    if (bad >= 0) return toast('Every player needs a name', { error: true });
    const res = await fetch('/api/setup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ config: cfg, players, reset }),
    }).then((r) => r.json()).catch(() => ({ ok: false, error: 'Could not reach the server' }));
    if (!res.ok) return toast(res.error || 'Save failed', { error: true });
    cfg = res.state.config;
    PT.useCurrency(cfg.currency);
    players = res.state.players.map((p) => ({ id: p.id, name: p.name, photo: p.photo, hat: p.hat }));
    progress = Object.fromEntries(res.state.players.map((p) => [p.id, p]));
    renderAll();
    setDirty(false);
    toast(reset ? 'New tournament ready — press ▶ on the remote to start' : 'Saved ✓');
  }
  $('b-save').onclick = () => save(false);
  $('b-new').onclick = () => {
    if (confirm('Start a NEW tournament?\n\nThe clock goes back to level 1 and all eliminations, rebuys and add-ons are cleared. Players, photos and settings are kept.')) save(true);
  };

  function renderAll() {
    bindFields();
    renderPreview();
    renderPayouts();
    renderLevels();
    renderPlayers();
    renderChips();
  }

  load()
    .then(() => {
      // deep links from the phone remote (e.g. /setup#players): jump there once content exists
      const target = location.hash && document.querySelector(location.hash);
      if (target) target.scrollIntoView({ block: 'start' });
    })
    .catch(() => toast('Could not load the tournament', { error: true }));
})();
