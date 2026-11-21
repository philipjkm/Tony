/* "Living table": quiet visual touches through the evening. No sounds. */
(function () {
  const { esc, fmtMoney, fmtShort, ordinal, avatarHTML, blindsText } = PT;
  const HOUR = 3600000;
  const now = () => performance.now();
  let stage, sky, sleigh, star, ring, ringRect, ticker, carousel, sweep;
  let state = null;
  let nextFly = null;
  let lastPlayed = null;
  let tickerIdx = 0;
  let nextTicker = 0;
  let carouselKey = '';

  /* ---------- artwork ---------- */
  function deer(x, y, flip) {
    // reindeer silhouette (galloping)
    return `<g transform="translate(${x} ${y})">
      <ellipse cx="0" cy="0" rx="17" ry="7"/>
      <path d="M13 -3 Q 20 -10 24 -16 L 30 -15 L 27 -10 Q 22 -6 17 0 Z"/>
      <path d="M25 -16 l-2 -9 M25 -21 l-5 -4 M27 -16 l4 -9 M29 -21 l5 -3" stroke-width="2.2" fill="none" stroke-linecap="round"/>
      <path d="M-12 3 L-20 ${flip ? 12 : 9} M-8 4 L-4 ${flip ? 13 : 12} M8 4 L14 ${flip ? 10 : 13} M12 3 L20 ${flip ? 12 : 8} M-16 -2 L-24 -6" stroke-width="3" fill="none" stroke-linecap="round"/>
    </g>`;
  }
  const SLEIGH = `<svg viewBox="0 0 560 120" aria-hidden="true">
    <g class="sl-body">
      ${deer(40, 50, false)}${deer(110, 40, true)}${deer(180, 50, false)}${deer(250, 40, true)}
      <circle cx="54" cy="44" r="3.2" class="nose"/>
      <path d="M262 46 Q 320 56 352 70" stroke-width="1.6" fill="none"/>
      <path d="M190 54 Q 300 70 352 74" stroke-width="1.2" fill="none" opacity=".7"/>
      <path d="M352 56 Q 350 92 380 94 L 450 94 Q 470 94 474 80 L 478 56 Q 430 64 400 58 Z"/>
      <path d="M346 100 Q 400 106 470 100 Q 486 98 486 88" stroke-width="3.5" fill="none" stroke-linecap="round"/>
      <path d="M400 58 Q 404 30 420 24 Q 438 22 442 40 L 446 58 Z"/>
      <circle cx="428" cy="20" r="9"/>
      <path d="M420 14 Q 432 -6 452 6 Q 444 6 440 14 Z"/><circle cx="453" cy="7" r="3.5"/>
      <path d="M446 40 Q 470 30 476 46 L 470 58 L 450 58 Z"/>
    </g></svg>`;

  function init(st) {
    stage = st;
    sky = document.createElement('div');
    sky.className = 'sky';
    sky.innerHTML = `<div class="aurora"><i></i><i></i><i></i></div>
      <div class="sleigh" id="sleigh">${SLEIGH}<div class="trail"></div></div>
      <div class="shooting-star" id="shooting-star"></div>`;
    stage.insertBefore(sky, stage.firstChild);
    sleigh = sky.querySelector('.sleigh');
    star = sky.querySelector('.shooting-star');

    const table = stage.querySelector('.table');
    ring = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    ring.setAttribute('class', 'rail-ring');
    ring.setAttribute('viewBox', '0 0 1040 520');
    ring.innerHTML = '<rect x="5" y="5" width="1030" height="510" rx="255" ry="255" pathLength="100"/>';
    table.appendChild(ring);
    ringRect = ring.querySelector('rect');

    sweep = document.createElement('div');
    sweep.className = 'sweep';
    stage.querySelector('.felt').appendChild(sweep);

    carousel = document.createElement('div');
    carousel.className = 'break-row hidden';
    stage.querySelector('.center').appendChild(carousel);

    ticker = document.createElement('div');
    ticker.className = 'ticker hidden';
    stage.querySelector('.chipbar').appendChild(ticker);
  }

  /* ---------- sleigh / shooting star ---------- */
  function fly() {
    const christmas = document.body.classList.contains('theme-christmas');
    const el = christmas ? sleigh : star;
    if (el.classList.contains('fly')) return; // still in the air
    el.style.setProperty('--y', (christmas ? 120 + Math.random() * 120 : 60 + Math.random() * 160) + 'px');
    el.classList.remove('fly');
    void el.offsetWidth;
    el.classList.add('fly');
    setTimeout(() => el.classList.remove('fly'), christmas ? 13000 : 2600);
  }

  /* ---------- helpers ---------- */
  function playedMs(s, rem) {
    const lv = s.config.levels;
    const idx = s.derived.levelIndex;
    let ms = 0;
    for (let i = 0; i < idx; i++) ms += Math.round(lv[i].minutes * 60000);
    return ms + Math.max(0, s.derived.levelDurationMs - rem);
  }
  const hm = (ms) => {
    const h = Math.floor(ms / HOUR);
    const m = Math.floor((ms % HOUR) / 60000);
    return h ? `${h} h ${m} min` : `${m} min`;
  };

  function facts(s, rem) {
    const d = s.derived;
    const cur = s.config.currency;
    const out = [];
    if (d.finished) return out;
    out.push(`⏱ ${hm(playedMs(s, rem))} played`);
    out.push(`👥 ${d.activeCount} of ${d.entries} still in`);
    if (!d.inTheMoney && !d.bubble && d.paidPlaces && d.activeCount > d.paidPlaces) {
      const k = d.activeCount - d.paidPlaces;
      out.push(`🏆 ${k} more ${k === 1 ? 'bust-out' : 'bust-outs'} to the money`);
    }
    if (d.inTheMoney) {
      const next = d.payouts.find((p) => p.place === d.activeCount - 1);
      if (next) out.push(`💰 Next pay jump: ${ordinal(next.place)} = ${fmtMoney(next.amount, cur)}`);
    }
    if (d.nextBreakMs != null) out.push(`☕ Break in ${hm(d.nextBreakMs - (d.remainingMs - rem))}`);
    if (d.level.type === 'level' && d.level.bb) out.push(`📊 Average stack ${fmtShort(d.avgStack)} · ${Math.round(d.avgStack / d.level.bb)} big blinds`);
    if (d.nextLevel) out.push(`📈 Next blinds: ${blindsText(d.nextLevel)}`);
    const top = [...s.players].sort((a, b) => b.rebuys - a.rebuys)[0];
    if (top && top.rebuys) out.push(`🔁 Most rebuys: ${top.name} (${top.rebuys}×)`);
    const extraMoney = d.rebuys * s.config.rebuy.price + d.addons * s.config.addon.price;
    if (extraMoney) out.push(`🎁 Rebuys & add-ons added ${fmtMoney(extraMoney, cur)}`);
    if (d.extraTotal) out.push(`🎄 ${fmtMoney(d.extraTotal, cur)} extra in the pot`);
    return out;
  }

  function showFact(s, rem) {
    const list = facts(s, rem);
    if (!list.length) { ticker.classList.add('hidden'); return; }
    tickerIdx = (tickerIdx + 1) % list.length;
    ticker.classList.remove('in');
    void ticker.offsetWidth;
    ticker.textContent = list[tickerIdx];
    ticker.classList.add('in');
  }

  function milestone(h, s) {
    const b = document.getElementById('banner');
    if (!b || document.getElementById('spotlight').classList.contains('show')) return;
    const d = s.derived;
    b.innerHTML = `<div class="t">${h} ${h === 1 ? 'HOUR' : 'HOURS'} PLAYED</div><div class="b">${document.body.classList.contains('theme-christmas') ? '🎄 ' : ''}${d.activeCount} still in · ${esc(fmtMoney(d.prizePool, s.config.currency))}</div>`;
    b.classList.add('show');
    setTimeout(() => b.classList.remove('show'), 6000);
  }

  /* ---------- per frame / per state ---------- */
  function update(s, rem) {
    state = s;
    const d = s.derived;
    const live = d.running && !d.finished;
    // countdown ring around the table during the last 30 seconds of a level
    const showRing = live && d.level.type === 'level' && rem <= 30000 && rem > 0;
    ring.classList.toggle('on', showRing);
    if (showRing) ringRect.style.strokeDasharray = `${(rem / 30000) * 100} 100`;

    // sleigh / shooting star every 12–18 minutes of play (first one ~3 minutes in)
    if (live && nextFly == null) nextFly = now() + 3 * 60000;
    if (live && nextFly != null && now() >= nextFly) {
      if (!document.getElementById('spotlight').classList.contains('show')) fly();
      nextFly = now() + (12 + Math.random() * 6) * 60000;
    }

    // hourly milestones (only when time passes naturally, not when skipping levels)
    const played = playedMs(s, rem);
    if (live && lastPlayed != null && played > lastPlayed && played - lastPlayed < 60000 && Math.floor(played / HOUR) > Math.floor(lastPlayed / HOUR)) {
      milestone(Math.floor(played / HOUR), s);
    }
    lastPlayed = played;

    // fun-facts ticker (hidden while the QR code or waiting list uses the space)
    const busy = !document.getElementById('qr-card').classList.contains('hidden') || !document.getElementById('waiting').classList.contains('hidden');
    ticker.classList.toggle('hidden', busy || d.finished);
    if (!busy && now() >= nextTicker) {
      nextTicker = now() + 10000;
      showFact(s, rem);
    }
  }

  function render(s) {
    const d = s.derived;
    // keep the current fact up to date when something happens (no re-animation)
    if (ticker.textContent) {
      const list = facts(s, d.remainingMs);
      if (list.length) ticker.textContent = list[tickerIdx % list.length];
    }
    // break: a slow carousel of everyone still in
    const isBreak = d.level.type === 'break' && !d.finished;
    const active = s.players.filter((p) => p.status === 'active');
    const key = isBreak ? active.map((p) => p.id + p.shownHat + p.photo).join(',') : '';
    carousel.classList.toggle('hidden', !isBreak);
    if (isBreak && key !== carouselKey) {
      const one = active.map((p) => `<div class="br-p"><div class="ring">${PT.hatHTML(p)}${avatarHTML(p, 70)}</div><span>${esc(p.name)}</span></div>`).join('');
      carousel.innerHTML = `<div class="br-h">Still in the game</div><div class="br-track"><div class="br-belt">${one}${one}</div></div>`;
    }
    carouselKey = key;
  }

  function onEvent(e) {
    if (e.type === 'level') {
      sweep.classList.remove('go');
      void sweep.offsetWidth;
      sweep.classList.add('go');
      const bl = document.getElementById('blinds');
      bl.classList.remove('flip');
      void bl.offsetWidth;
      bl.classList.add('flip');
    }
    if (e.type === 'rebuy' || e.type === 'addon') {
      const el = document.querySelector(`.seat[data-id="${CSS.escape(e.playerId)}"]`);
      if (el) {
        el.classList.add('sparkle');
        clearTimeout(el._sparkle);
        el._sparkle = setTimeout(() => el.classList.remove('sparkle'), 60000);
      }
    }
    if (e.type === 'resumed' && e.first) nextFly = now() + 3 * 60000;
  }

  PT.ambient = { init, update, render, onEvent, fly, facts, playedMs };
})();
