(function () {
  const { esc, fmtNum, fmtShort, fmtMoney, fmtClock, ordinal, avatarHTML, chipHTML, seatPositions, blindsText } = PT;
  const $ = (id) => document.getElementById(id);
  const stage = $('stage');

  /* ---------- scale the 1920x1080 stage to any screen ---------- */
  // The stage is designed at 1920x1080 but stretches to the screen's shape (no black bars):
  // wider screens get a wider stage, taller screens (e.g. 16:10 MacBooks) a taller one.
  function fit() {
    const W = window.innerWidth, H = window.innerHeight;
    let sw = 1920, sh = 1080;
    if (W / H > 1920 / 1080) sw = Math.round((1080 * W) / H);
    else sh = Math.round((1920 * H) / W);
    stage.style.width = sw + 'px';
    stage.style.height = sh + 'px';
    stage.style.setProperty('--scale', W / sw);
    if (live && live.state) renderSeats(live.state);
  }
  window.addEventListener('resize', fit);

  /* ---------- sound (WebAudio, needs one click) ---------- */
  let audio = null;
  function enableAudio() {
    if (!audio) audio = new (window.AudioContext || window.webkitAudioContext)();
    if (audio.state === 'suspended') audio.resume();
  }
  function tone(freq, start, dur, type = 'sine', gain = 0.18) {
    if (!audio) return;
    const t0 = audio.currentTime + start;
    const o = audio.createOscillator();
    const g = audio.createGain();
    o.type = type;
    o.frequency.value = freq;
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(gain, t0 + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g).connect(audio.destination);
    o.start(t0);
    o.stop(t0 + dur + 0.05);
  }
  const sounds = {
    level: () => { tone(660, 0, 0.35); tone(880, 0.18, 0.35); tone(1320, 0.36, 0.6); },
    warn: () => { tone(880, 0, 0.15, 'square', 0.06); tone(880, 0.25, 0.15, 'square', 0.06); },
    bust: () => { tone(330, 0, 0.3, 'sawtooth', 0.08); tone(220, 0.2, 0.5, 'sawtooth', 0.08); },
    good: () => { tone(523, 0, 0.2); tone(784, 0.12, 0.4); },
    // cash register "ka-ching": drawer clunk + bell + a few coins
    kaching: () => {
      if (!audio) return;
      const t0 = audio.currentTime;
      const len = Math.floor(audio.sampleRate * 0.06);
      const buf = audio.createBuffer(1, len, audio.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
      const src = audio.createBufferSource();
      const bp = audio.createBiquadFilter();
      const g = audio.createGain();
      src.buffer = buf;
      bp.type = 'bandpass';
      bp.frequency.value = 1800;
      g.gain.value = 0.5;
      src.connect(bp).connect(g).connect(audio.destination);
      src.start(t0);
      tone(180, 0, 0.08, 'square', 0.08);
      [2637, 3520, 5274, 7040].forEach((f, i) => tone(f, 0.09, 1.1 - i * 0.2, 'sine', 0.14 / (i + 1)));
      for (let i = 0; i < 6; i++) tone(3800 + Math.random() * 3200, 0.16 + i * 0.045, 0.07, 'triangle', 0.035);
    },
    // sleigh bells before Santa speaks
    jingle: () => { for (let i = 0; i < 9; i++) { tone(2400 + Math.random() * 1600, i * 0.06, 0.12, 'triangle', 0.035); tone(5200 + Math.random() * 900, i * 0.06 + 0.02, 0.08, 'sine', 0.02); } },
    heartbeat: () => { [0, 0.22, 0.9, 1.12, 1.8, 2.02].forEach((t, i) => tone(i % 2 ? 50 : 62, t, 0.18, 'sine', 0.5)); },
    win: () => { [523, 659, 784, 1046, 784, 1046].forEach((f, i) => tone(f, i * 0.16, 0.4, 'triangle', 0.15)); },
  };

  document.addEventListener('click', () => {
    enableAudio();
    PT.announcer.unlock(); // this TV page is now the one that speaks
    $('hint').classList.add('gone');
    if (!document.fullscreenElement && document.documentElement.requestFullscreen) {
      document.documentElement.requestFullscreen().catch(() => {});
    }
  });

  // hide the mouse cursor when idle (it's a TV)
  let cursorTimer;
  document.addEventListener('mousemove', () => {
    document.body.classList.remove('cursor-hidden');
    clearTimeout(cursorTimer);
    cursorTimer = setTimeout(() => document.body.classList.add('cursor-hidden'), 2500);
  });

  /* ---------- live connection ---------- */
  let live = null;
  // Christmas extras: snowfall + string lights
  PT.snow(stage, 160);
  $('lights').innerHTML = Array.from({ length: 44 }, (_, i) => `<i style="animation-delay:${(i % 7) * 0.35}s"></i>`).join('');

  live = PT.connect({
    onState: render,
    onEvent: handleEvent,
    onConn: (on) => {
      const c = $('conn');
      c.className = 'conn ' + (on ? 'on' : 'off');
      c.textContent = on ? 'Synced' : 'Offline';
    },
  });

  // QR for the phone remote
  fetch('/api/info').then((r) => r.json()).then((info) => {
    const url = (info.urls[0] || info.local) + '/remote';
    $('qr').src = '/api/qr.svg?path=/remote';
    $('qr-url').textContent = url.replace(/^http:\/\//, '');
  }).catch(() => { $('qr').dataset.failed = '1'; $('qr-card').classList.add('hidden'); });

  /* ---------- render ---------- */
  const seatEls = new Map();
  let lastLayoutKey = '';
  fit();

  function render(s) {
    const cfg = s.config;
    const d = s.derived;
    document.body.dataset.seq = s.seq; // lets tests see which update the screen is showing
    PT.useCurrency(cfg.currency);
    PT.applyTheme(cfg.theme);
    PT.announcer.configure(cfg.announcer, s.voice);
    const mo = $('moment');
    const moment = d.headsUp ? ['duel', '⚔ HEADS UP'] : d.bubble ? ['bubble', '🫧 BUBBLE'] : d.inTheMoney ? ['money', (cfg.theme === 'christmas' ? '🎁' : '🏆') + ' IN THE MONEY'] : null;
    mo.classList.toggle('hidden', !moment);
    if (moment) { mo.className = 'moment ' + moment[0]; mo.textContent = moment[1]; }
    const cur = cfg.currency;
    document.title = cfg.name + ' · Live';
    const isBreak = d.level.type === 'break';
    $('level-pill').textContent = isBreak ? 'BREAK' : `LEVEL ${d.levelNumber} / ${d.levelCount}`;
    const paused = !d.running && !d.finished;
    $('lvl-label').textContent = (paused ? '❚❚ PAUSED · ' : '') + (isBreak ? (d.level.label || 'BREAK').toUpperCase() : `LEVEL ${d.levelNumber}`);
    $('blinds').textContent = isBreak ? 'Break' : blindsText(d.level);
    $('ante').textContent = !isBreak && d.level.ante ? `ANTE ${fmtNum(d.level.ante)}` : '';
    const nl = d.nextLevel;
    $('next').textContent = d.finished ? 'Tournament complete' : nl
      ? `NEXT  ${blindsText(nl)}${nl.ante ? '  ·  ante ' + fmtNum(nl.ante) : ''}`
      : 'FINAL LEVEL';
    document.querySelector('.felt').classList.toggle('is-break', isBreak);
    stage.classList.toggle('is-paused', !d.running && !d.finished);
    const liveEl = $('live');
    liveEl.textContent = d.finished ? 'FINISHED' : d.running ? 'LIVE' : 'PAUSED';
    liveEl.classList.toggle('off', !d.running);

    // side panel
    const num = fmtMoney(d.prizePool, '');
    const unit = `<span class="unit">${esc(cur)}</span>`;
    $('pool').innerHTML = /^[a-z.]+$/i.test(cur) ? `${num} ${unit}` : unit + num;
    fitText($('pool'), 128, 40);
    $('pool-sub').textContent = `${d.entries} ${d.entries === 1 ? 'entry' : 'entries'}`
      + (d.rebuys ? ` · ${d.rebuys} rebuy${d.rebuys > 1 ? 's' : ''}` : '')
      + (d.addons ? ` · ${d.addons} add-on${d.addons > 1 ? 's' : ''}` : '')
      + (d.extraTotal ? ` · +${fmtMoney(d.extraTotal, cur)} extra` : '');
    const placeName = {};
    s.players.forEach((p) => { if (p.place) placeName[p.place] = p.name; });
    const pays = d.payouts.slice(0, 9);
    $('payouts').innerHTML = pays.map((p) => `
      <li><span class="pl">${ordinal(p.place)}</span><span class="who">${esc(placeName[p.place] || '')}</span><span class="pct tnum">${+p.pct.toFixed(1)}%</span><span class="amt tnum">${fmtMoney(p.amount, cur)}</span></li>`).join('')
      + (d.payouts.length > 9 ? `<li><span class="pl">+${d.payouts.length - 9}</span><span class="who"></span><span class="amt">more</span></li>` : '');
    const stats = [
      ['PLAYERS', `${d.activeCount}<small> / ${d.entries}</small>`],
      ['AVG STACK', fmtShort(d.avgStack)],
      ['REBUYS', d.rebuys],
      ['ADD-ONS', d.addons],
      ['CHIPS IN PLAY', fmtShort(d.totalChips)],
      ['NEXT BREAK', '<span id="next-break">–</span>'],
    ];
    $('stats').innerHTML = stats.map(([k, v]) => `<div class="stat"><div class="k">${k}</div><div class="v tnum">${v}</div></div>`).join('');

    // chips
    const chips = [...cfg.chips].sort((a, b) => a.value - b.value);
    $('chips').innerHTML = chips.map((ch) => `<div class="chipv">${chipHTML(ch, 72)}<span class="val tnum">${fmtShort(ch.value)}</span></div>`).join('');

    const live_ = !!s.startedAt || d.running || d.finished || s.log.length > 0;
    $('qr-card').classList.toggle('hidden', live_ || $('qr').dataset.failed === '1');
    renderSeats(s);
    renderWinner(s);
    tickClock();
  }

  function seatSig(p, isWinner, size) {
    return [p.name, p.photo, p.hat, p.shownHat, p.status, p.rebuys, p.addons, p.place, isWinner, size].join('|');
  }
  function seatInner(p, isWinner, size) {
    const badges = (p.rebuys ? `<span class="badge r">R${p.rebuys > 1 ? '×' + p.rebuys : ''}</span>` : '')
      + (p.addons ? `<span class="badge a">A${p.addons > 1 ? '×' + p.addons : ''}</span>` : '');
    return `
      ${isWinner ? '<div class="crown">👑</div>' : ''}
      <div class="ring">${PT.hatHTML(p)}${avatarHTML(p, size)}</div>
      ${p.status === 'out' ? `<div class="outtag" style="top:${size / 2 - 6}px">OUT · ${ordinal(p.place)}</div>` : ''}
      <div class="plate"><div class="name" style="font-size:${size < 90 ? 17 : 22}px">${esc(p.name)}</div><div class="badges">${badges}</div></div>`;
  }

  function renderSeats(s) {
    PT.assignHats(s.players);
    const n = s.config.seats;
    const players = s.players;
    $('empty').classList.toggle('hidden', players.length > 0);
    $('seats').classList.toggle('hidden', players.length === 0);
    const size = n <= 6 ? 156 : n <= 8 ? 144 : n <= 10 ? 130 : 112;
    // ellipse radii in px of the 1400x820 table area, centre (700,410)
    const area = document.querySelector('.table-area');
    const cx = area.offsetWidth / 2, cy = area.offsetHeight / 2;
    // spread seats a little on bigger areas, but keep them hugging the table
    const rx = Math.min(640, Math.max(600, cx - 100)), ry = Math.min(360, Math.max(326, cy - 84));
    const pos = seatPositions(n, 1, 1);
    const bySeat = new Map();
    players.forEach((p) => { if (p.seat !== null && p.seat < n) bySeat.set(p.seat, p); });
    const container = $('seats');
    const alive = new Set();
    for (let i = 0; i < n; i++) {
      const p = bySeat.get(i);
      const key = p ? p.id : 'empty-' + i;
      alive.add(key);
      let el = seatEls.get(key);
      if (!el) {
        el = document.createElement('div');
        el.dataset.id = key;
        container.appendChild(el);
        seatEls.set(key, el);
      }
      el.style.left = cx + (pos[i].x - 50) * rx + 'px';
      el.style.top = cy + (pos[i].y - 50) * ry + 'px';
      el.style.width = size + 60 + 'px';
      if (!p) {
        el.className = 'seat empty';
        if (el.dataset.sig !== 'empty' + size) {
          el.dataset.sig = 'empty' + size;
          el.innerHTML = `<div class="ring"><div class="avatar" style="width:${size}px;height:${size}px"></div></div>`;
        }
        continue;
      }
      const isWinner = s.derived.winnerId === p.id;
      el.classList.add('seat');
      el.classList.remove('empty');
      el.classList.toggle('out', p.status === 'out');
      el.classList.toggle('winner', isWinner);
      const sig = seatSig(p, isWinner, size);
      if (el.dataset.sig !== sig) {
        el.dataset.sig = sig;
        el.innerHTML = seatInner(p, isWinner, size);
      }
    }
    for (const [id, el] of seatEls) {
      if (!alive.has(id)) { el.remove(); seatEls.delete(id); }
    }
    // waiting list (active players without a seat)
    const waiting = players.filter((p) => p.seat === null && p.status === 'active');
    $('waiting').classList.toggle('hidden', !waiting.length);
    $('wl').innerHTML = waiting.map((p) => `<div class="wp">${avatarHTML(p, 52)}<span>${esc(p.name)}</span></div>`).join('');
  }

  let winnerShownFor = null;
  let resultsTimer = null;

  function renderFinal(s) {
    const cur = s.config.currency;
    $('final').innerHTML = `<div class="final-box">
      <div class="final-h"><div><div class="t">🏆 FINAL RESULTS</div><div class="nm">${esc(s.config.name)}</div></div>
        <div class="pp"><div class="k">PRIZE POOL</div><div class="v">${fmtMoney(s.derived.prizePool, cur)}</div></div></div>
      ${PT.resultsHTML(s, s.players.length > 10 ? 40 : 52)}</div>`;
  }

  /** Shrink an element's font until its content fits its width. */
  function fitText(el, max, min) {
    let size = max;
    el.style.fontSize = size + 'px';
    // shrink until it fits the width, and the whole box (label, amount, subline) fits its height
    const box = el.parentElement;
    // measure only the text blocks (decorations like the holly may hang over the edge on purpose)
    const first = box.querySelector('.k') || el;
    const last = el.nextElementSibling || el;
    const tooTall = () => first.offsetTop < 0 || last.offsetTop + last.offsetHeight > box.clientHeight;
    while (size > min && (el.scrollWidth > el.clientWidth + 1 || tooTall())) {
      size -= 4;
      el.style.fontSize = size + 'px';
    }
  }
  function renderWinner(s) {
    const d = s.derived;
    const box = $('winner');
    if (!d.finished) {
      box.classList.add('hidden');
      $('final').classList.add('hidden');
      clearTimeout(resultsTimer);
      winnerShownFor = null;
      return;
    }
    if (winnerShownFor === d.winnerId) {
      if (!$('final').classList.contains('hidden')) renderFinal(s);
      return;
    }
    winnerShownFor = d.winnerId;
    // champion first, then the full payout summary stays on screen
    clearTimeout(resultsTimer);
    resultsTimer = setTimeout(() => {
      box.classList.add('hidden');
      renderFinal(live.state);
      $('final').classList.remove('hidden');
    }, 12000);
    // the champion screen takes over: drop any queued spotlights
    spotQueue.length = 0;
    $('spotlight').classList.remove('show');
    const w = s.players.find((p) => p.id === d.winnerId);
    const prize = (d.payouts.find((p) => p.place === 1) || {}).amount || 0;
    const colors = ['#f6c453', '#e5173f', '#2f8cff', '#18c27a', '#ffffff'];
    let confetti = '';
    for (let i = 0; i < 70; i++) {
      confetti += `<i class="confetti" style="left:${Math.random() * 100}%;background:${colors[i % colors.length]};animation-duration:${3 + Math.random() * 4}s;animation-delay:${-Math.random() * 6}s"></i>`;
    }
    box.innerHTML = `${confetti}<div>
      <div class="crown">👑</div>
      <div class="ring">${avatarHTML(w, 300)}</div>
      <div class="tag">CHAMPION</div>
      <div class="nm">${esc(w.name)}</div>
      <div class="sub">${fmtMoney(prize, s.config.currency)}</div></div>`;
    box.classList.remove('hidden');
  }

  /* ---------- clock tick ---------- */
  let warned = false;
  function tickClock() {
    const s = live.state;
    if (!s) return;
    const d = s.derived;
    const rem = live.remaining();
    const t = $('timer');
    t.textContent = fmtClock(rem);
    const warn = d.running && rem <= 60000 && d.level.type !== 'break';
    t.classList.toggle('warn', warn);
    if (warn && !warned && rem > 55000) { sounds.warn(); PT.announcer.handle({ type: 'minute' }, s); }
    warned = warn;
    $('progress').style.width = (100 * (1 - rem / d.levelDurationMs)).toFixed(2) + '%';
    const nb = document.getElementById('next-break');
    if (nb) nb.textContent = d.nextBreakMs == null ? (d.level.type === 'break' ? 'Now' : '–') : fmtClock(d.nextBreakMs - (d.remainingMs - rem));
    const now = new Date();
    $('wall').textContent = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }
  setInterval(tickClock, 200);

  /* ---------- events ---------- */
  let bannerTimer;
  function banner(top, big, ms = 6000) {
    const b = $('banner');
    b.innerHTML = `<div class="t">${esc(top)}</div><div class="b">${esc(big)}</div>`;
    b.classList.add('show');
    clearTimeout(bannerTimer);
    bannerTimer = setTimeout(() => b.classList.remove('show'), ms);
  }

  const spotQueue = [];
  let spotBusy = false;
  function spotlight(html, ms = 4200) {
    spotQueue.push({ html, ms });
    if (!spotBusy) nextSpot();
  }
  function nextSpot() {
    const item = spotQueue.shift();
    const el = $('spotlight');
    if (!item) { spotBusy = false; el.dataset.busy = '0'; return; }
    spotBusy = true;
    el.dataset.busy = '1';
    el.innerHTML = item.html;
    requestAnimationFrame(() => el.classList.add('show'));
    setTimeout(() => {
      el.classList.remove('show');
      setTimeout(nextSpot, 450);
    }, item.ms);
  }

  function pulseSeat(id, cls) {
    const el = seatEls.get(id);
    if (!el) return;
    el.classList.remove(cls);
    void el.offsetWidth;
    el.classList.add(cls);
    // drop the class afterwards so a later redraw of the seat doesn't replay it
    clearTimeout(el['t_' + cls]);
    el['t_' + cls] = setTimeout(() => el.classList.remove(cls), 1400);
  }

  PT.announcer.onBeforeSpeak(() => sounds.jingle());

  function handleEvent(e) {
    PT.announcer.handle(e, live.state);
    const s = live.state;
    const cur = s ? s.config.currency : '$';
    switch (e.type) {
      case 'level': {
        const l = s && s.config.levels[e.levelIndex];
        if (!l) break;
        sounds.level();
        if (l.type === 'break') banner('BREAK TIME', `${l.label || 'Break'} · ${l.minutes} min`);
        else banner(`LEVEL ${PT.fmtNum(s.derived.levelNumber)}`, `Blinds ${blindsText(l)}${l.ante ? ' · Ante ' + fmtNum(l.ante) : ''}`);
        break;
      }
      case 'eliminated':
        sounds.bust();
        pulseSeat(e.playerId, 'bust');
        if (s && s.derived.finished) break; // final bust → champion screen instead
        spotlight(`<div class="spot"><div class="ring">${avatarHTML(e, 260)}</div>
          <div class="tag">ELIMINATED</div><div class="nm">${esc(e.name)}</div>
          <div class="sub">Finishes ${ordinal(e.place)}${e.prize ? ` · wins <b>${fmtMoney(e.prize, cur)}</b>` : ''}</div></div>`);
        break;
      case 'rebuy':
        sounds.kaching();
        pulseSeat(e.playerId, 'flash');
        spotlight(`<div class="spot good"><div class="ring">${avatarHTML(e, 200)}</div>
          <div class="tag">${e.reentry ? 'RE-ENTRY' : 'REBUY'}</div><div class="nm">${esc(e.name)}</div>
          <div class="sub">${s ? '+' + fmtNum(s.config.rebuy.chips) + ' chips' : ''}</div></div>`, 2800);
        break;
      case 'addon':
        sounds.kaching();
        pulseSeat(e.playerId, 'flash');
        spotlight(`<div class="spot addon"><div class="ring">${avatarHTML(e, 200)}</div>
          <div class="tag">ADD-ON</div><div class="nm">${esc(e.name)}</div>
          <div class="sub">${s ? '+' + fmtNum(s.config.addon.chips) + ' chips' : ''}</div></div>`, 2800);
        break;
      case 'bubble':
        sounds.heartbeat();
        spotlight(`<div class="spot bubble"><div class="big">🫧</div>
          <div class="tag">ON THE BUBBLE</div><div class="nm">One more out…</div>
          <div class="sub">…and everyone left is in the money</div></div>`, 5000);
        break;
      case 'inTheMoney': {
        sounds.win();
        let coins = '';
        for (let i = 0; i < 40; i++) coins += `<i class="coin" style="left:${Math.random() * 100}%;animation-duration:${2 + Math.random() * 2.5}s;animation-delay:${-Math.random() * 3}s">🪙</i>`;
        const icon = s && s.config.theme === 'christmas' ? '🎁' : '🏆';
        spotlight(`${coins}<div class="spot money"><div class="big">${icon}</div>
          <div class="tag">IN THE MONEY</div><div class="nm">Everyone gets paid!</div>
          <div class="sub">${esc(e.bubbleBoy)} burst the bubble</div></div>`, 5500);
        break;
      }
      case 'headsUp':
        sounds.heartbeat();
        spotlight(`<div class="spot duel"><div class="vs">
            <div><div class="ring">${avatarHTML(e.a, 230)}</div><div class="nm2">${esc(e.a.name)}</div></div>
            <div class="vs-x">VS</div>
            <div><div class="ring">${avatarHTML(e.b, 230)}</div><div class="nm2">${esc(e.b.name)}</div></div></div>
          <div class="tag">HEADS UP</div></div>`, 5000);
        break;
      case 'winner':
        sounds.win();
        break;
      case 'paused':
        banner('CLOCK', 'Paused', 2500);
        break;
      case 'resumed':
        banner('CLOCK', 'Shuffle up & deal', 2500);
        break;
      case 'undo':
        banner('CORRECTION', `Undo ${e.what} · ${e.name}`, 3000);
        break;
      case 'reset':
        $('winner').classList.add('hidden');
        winnerShownFor = null;
        break;
    }
  }
})();
