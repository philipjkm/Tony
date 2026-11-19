/* Shared helpers for display, remote and setup pages */
(function () {
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // Number style follows the currency: "kr." → Danish style (1.000 kr.), "$" → 1,000
  let locale = 'en-US';
  function useCurrency(cur) {
    locale = /kr/i.test(cur || '') ? 'da-DK' : 'en-US';
  }
  const fmtNum = (n) => Math.round(Number(n) || 0).toLocaleString(locale);

  function fmtShort(n) {
    n = Number(n) || 0;
    if (n >= 1e6) return +(n / 1e6).toFixed(n % 1e6 ? 2 : 0) + 'M';
    if (n >= 1e4) return +(n / 1e3).toFixed(n % 1e3 ? 1 : 0) + 'K';
    return fmtNum(n);
  }

  function fmtMoney(n, cur = 'kr.') {
    n = Number(n) || 0;
    const s = Math.abs(n % 1) > 0.001 ? n.toLocaleString(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : fmtNum(n);
    // letter currencies go after the amount (500 kr.), symbols before ($500)
    return /^[a-z.]+$/i.test(cur) ? `${s} ${cur}` : cur + s;
  }

  function fmtClock(ms) {
    const total = Math.max(0, Math.ceil(ms / 1000));
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    const mm = h ? String(m).padStart(2, '0') : String(m).padStart(2, '0');
    return (h ? h + ':' : '') + mm + ':' + String(s).padStart(2, '0');
  }

  function ordinal(n) {
    const s = ['th', 'st', 'nd', 'rd'];
    const v = n % 100;
    return n + (s[(v - 20) % 10] || s[v] || s[0]);
  }

  const palette = ['#e5173f', '#2f8cff', '#18c27a', '#f6a623', '#9b51e0', '#00b8d9', '#ff6b9a', '#7bc043', '#f45b2a', '#5c6bc0'];
  function colorFor(str) {
    let h = 0;
    for (const ch of String(str)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    return palette[h % palette.length];
  }
  const initials = (name) => String(name || '?').trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase();

  function avatarHTML(p, size) {
    const style = `width:${size}px;height:${size}px;font-size:${Math.round(size * 0.38)}px;background:${colorFor(p.name)}`;
    return p.photo
      ? `<div class="avatar" style="${style}"><img src="${esc(p.photo)}" alt="" draggable="false"></div>`
      : `<div class="avatar" style="${style}">${esc(initials(p.name))}</div>`;
  }

  function chipHTML(ch, size) {
    return ch.image
      ? `<img class="chip-img" src="${esc(ch.image)}" style="width:${size}px;height:${size}px" alt="">`
      : `<div class="chip" style="--c:${esc(ch.color)};width:${size}px;height:${size}px"></div>`;
  }

  /** Positions (in %) for n seats around an ellipse, starting bottom-centre, clockwise. */
  function seatPositions(n, rx = 50, ry = 50, startDeg = 90) {
    const out = [];
    for (let i = 0; i < n; i++) {
      const a = ((startDeg + (360 * i) / n) * Math.PI) / 180;
      out.push({ x: 50 + rx * Math.cos(a), y: 50 + ry * Math.sin(a) });
    }
    return out;
  }

  function blindsText(l, short = false) {
    if (!l) return '';
    if (l.type === 'break') return l.label || 'Break';
    const f = short ? fmtShort : fmtNum;
    return `${f(l.sb)} / ${f(l.bb)}`;
  }

  /**
   * Connect to the live tournament. onState(state) is called on each update.
   * state.clockNow() returns the live remaining ms (ticks locally between updates).
   */
  function connect({ onState, onEvent, onConn }) {
    const socket = io({ transports: ['websocket', 'polling'] });
    let state = null;
    let receivedAt = 0;
    socket.on('connect', () => onConn && onConn(true));
    socket.on('disconnect', () => onConn && onConn(false));
    socket.on('state', (s) => {
      state = s;
      receivedAt = performance.now();
      onState && onState(s);
    });
    socket.on('event', (e) => onEvent && onEvent(e));
    // phones/tablets pause timers while asleep: get a fresh state when we come back, and now and then
    document.addEventListener('visibilitychange', () => { if (!document.hidden && socket.connected) socket.emit('sync'); });
    setInterval(() => { if (socket.connected) socket.emit('sync'); }, 30000);
    const remaining = () => {
      if (!state) return 0;
      const d = state.derived;
      return d.running ? Math.max(0, d.remainingMs - (performance.now() - receivedAt)) : d.remainingMs;
    };
    const send = (action) =>
      new Promise((resolve) => {
        if (!socket.connected) return resolve({ ok: false, error: 'Not connected to the tournament server' });
        socket.timeout(5000).emit('action', action, (err, res) => resolve(err ? { ok: false, error: 'Server did not respond' } : res));
      });
    return { socket, send, remaining, get state() { return state; } };
  }

  function toast(msg, { error = false, action, ms = 3200 } = {}) {
    let box = document.querySelector('.toasts');
    if (!box) {
      box = document.createElement('div');
      box.className = 'toasts';
      document.body.appendChild(box);
    }
    box.innerHTML = ''; // only the latest toast — they never pile up over the table
    const el = document.createElement('div');
    el.className = 'toast' + (error ? ' err' : '');
    el.innerHTML = `<span class="grow">${esc(msg)}</span>`;
    if (action) {
      const b = document.createElement('button');
      b.className = 'btn btn-ghost';
      b.style.height = '34px';
      b.textContent = action.label;
      b.onclick = () => { action.run(); el.remove(); };
      el.appendChild(b);
    }
    box.appendChild(el);
    setTimeout(() => el.remove(), ms);
  }

  /* ---------- Christmas hats (one per player, picked in Settings) ---------- */
  const HATS = {
    santa: { label: '🎅 Santa hat', svg: `<path d="M14 80 Q 34 14 86 16 Q 112 18 108 56 Q 92 34 72 38 Q 84 56 90 80 Z" fill="#d7192e"/>
      <path d="M30 60 Q 50 26 84 22" stroke="#ff5a6a" stroke-width="5" fill="none" opacity=".6"/>
      <rect x="4" y="70" width="94" height="22" rx="11" fill="#fff"/><circle cx="106" cy="60" r="12" fill="#fff"/>` },
    elf: { label: '🧝 Elf hat', svg: `<path d="M18 80 Q 40 16 104 6 Q 82 34 80 52 Q 84 66 92 80 Z" fill="#1a9b4b"/>
      <path d="M30 56 Q 60 30 98 12" stroke="#2fd16f" stroke-width="5" fill="none" opacity=".55"/>
      <path d="M6 72 L16 92 L26 72 L36 92 L46 72 L56 92 L66 72 L76 92 L86 72 L96 92 L102 72 Z" fill="#d7192e"/>
      <rect x="6" y="68" width="96" height="8" rx="4" fill="#d7192e"/><circle cx="104" cy="8" r="8" fill="#f6c453" stroke="#b8862b" stroke-width="2"/>` },
    beanie: { label: '🧶 Knit beanie', svg: `<path d="M12 82 Q 10 24 60 22 Q 110 24 108 82 Z" fill="#d7192e"/>
      <path d="M14 52 Q 60 40 106 52 L106 62 Q 60 50 14 62 Z" fill="#fff"/>
      <path d="M26 46 l6 -6 l6 6 M54 40 l6 -6 l6 6 M82 46 l6 -6 l6 6" stroke="#d7192e" stroke-width="3" fill="none"/>
      <rect x="8" y="74" width="104" height="20" rx="8" fill="#a50d22"/>
      <path d="M18 76 v16 M30 76 v16 M42 76 v16 M54 76 v16 M66 76 v16 M78 76 v16 M90 76 v16 M102 76 v16" stroke="#c51530" stroke-width="3"/>
      <circle cx="60" cy="16" r="14" fill="#fff"/>` },
    antlers: { label: '🦌 Reindeer antlers', svg: `<g stroke="#8b5a2b" stroke-width="7" stroke-linecap="round" fill="none">
      <path d="M38 84 L30 48 L14 24 M30 48 L40 22 M22 36 L8 40"/><path d="M82 84 L90 48 L106 24 M90 48 L80 22 M98 36 L112 40"/></g>
      <path d="M20 92 Q 60 70 100 92" stroke="#5a3a1c" stroke-width="8" fill="none" stroke-linecap="round"/>
      <circle cx="60" cy="82" r="7" fill="#e5173f"/>` },
    tophat: { label: '🎩 Top hat', svg: `<rect x="26" y="14" width="68" height="64" rx="6" fill="#16181d"/>
      <rect x="26" y="56" width="68" height="12" fill="#d7192e"/><ellipse cx="60" cy="82" rx="54" ry="10" fill="#0d0f12"/>
      <path d="M76 52 q10 -12 18 -2 q-8 2 -6 10 q-6 -6 -12 -8z M76 52 q-4 -14 6 -18 q0 8 8 8 q-8 4 -14 10z" fill="#1a9b4b"/>
      <circle cx="76" cy="56" r="4" fill="#e5173f"/><circle cx="83" cy="58" r="4" fill="#e5173f"/>` },
    tree: { label: '🎄 Christmas tree', svg: `<path d="M60 6 L86 44 H72 L92 72 H28 L48 44 H34 Z" fill="#1a9b4b"/>
      <rect x="54" y="72" width="12" height="10" fill="#8b5a2b"/>
      <circle cx="50" cy="40" r="4" fill="#e5173f"/><circle cx="68" cy="58" r="4" fill="#f6c453"/><circle cx="46" cy="64" r="4" fill="#4ea0ff"/><circle cx="72" cy="36" r="3.5" fill="#fff"/>
      <path d="M60 0 l3 7 l7 0 l-6 4 l2 7 l-6 -4 l-6 4 l2 -7 l-6 -4 l7 0 z" fill="#f6c453"/>
      <path d="M20 92 Q 60 78 100 92" stroke="#d7192e" stroke-width="7" fill="none" stroke-linecap="round"/>` },
    crown: { label: '👑 Gold crown', svg: `<path d="M12 84 L18 30 L40 58 L60 18 L80 58 L102 30 L108 84 Z" fill="#f6c453" stroke="#b8862b" stroke-width="3"/>
      <rect x="12" y="74" width="96" height="14" rx="3" fill="#e0a92e"/>
      <circle cx="18" cy="28" r="6" fill="#fff3c4"/><circle cx="60" cy="16" r="7" fill="#fff3c4"/><circle cx="102" cy="28" r="6" fill="#fff3c4"/>
      <circle cx="36" cy="81" r="5" fill="#e5173f"/><circle cx="60" cy="81" r="5" fill="#1a9b4b"/><circle cx="84" cy="81" r="5" fill="#4ea0ff"/>` },
  };
  const AUTO_HATS = ['santa', 'elf', 'beanie', 'antlers', 'tophat', 'tree'];
  function hatFor(p) {
    let h = p && p.hat;
    if (h === 'none') return null;
    if (!HATS[h]) {
      let n = 0;
      for (const ch of String(p && p.id)) n = (n * 31 + ch.charCodeAt(0)) >>> 0;
      h = AUTO_HATS[n % AUTO_HATS.length];
    }
    return h;
  }
  /** SVG markup for a player's hat (only visible with the Christmas theme). */
  function hatHTML(p) {
    const h = hatFor(p);
    return h ? `<svg class="hat hat-${h}" viewBox="0 -4 120 104" aria-hidden="true">${HATS[h].svg}</svg>` : '';
  }

  /* ---------- final results / payout summary ---------- */
  function results(s) {
    const cfg = s.config;
    const d = s.derived;
    const won = Object.fromEntries(d.payouts.map((p) => [p.place, p.amount]));
    const rows = s.players.map((p) => {
      const paid = cfg.buyIn + cfg.entryFee + p.rebuys * cfg.rebuy.price + p.addons * cfg.addon.price;
      const w = (p.place && won[p.place]) || 0;
      return { p, place: p.place || 999, paid, won: w, net: w - paid };
    }).sort((a, b) => a.place - b.place);
    const totalPaid = rows.reduce((t, r) => t + r.paid, 0);
    const totalWon = rows.reduce((t, r) => t + r.won, 0);
    return { rows, totalPaid, totalWon };
  }
  function resultsHTML(s, avatarSize = 44) {
    const cur = s.config.currency;
    const { rows, totalPaid, totalWon } = results(s);
    const medal = { 1: '🥇', 2: '🥈', 3: '🥉' };
    const net = (n) => `<span class="net ${n > 0 ? 'pos' : n < 0 ? 'neg' : ''}">${n > 0 ? '+' : n < 0 ? '−' : ''}${fmtMoney(Math.abs(n), cur)}</span>`;
    return `<table class="results">
      <thead><tr><th>#</th><th>Player</th><th>Paid in</th><th>Won</th><th>Net</th></tr></thead>
      <tbody>${rows.map((r) => `<tr class="${r.won ? 'paid' : ''}">
        <td class="pl">${r.place === 999 ? '–' : medal[r.place] || ordinal(r.place)}</td>
        <td class="who">${avatarHTML(r.p, avatarSize)}<span>${esc(r.p.name)}${r.p.rebuys || r.p.addons ? `<small>${r.p.rebuys ? r.p.rebuys + '× rebuy' : ''}${r.p.rebuys && r.p.addons ? ' · ' : ''}${r.p.addons ? r.p.addons + '× add-on' : ''}</small>` : ''}</span></td>
        <td>${fmtMoney(r.paid, cur)}</td><td class="won">${r.won ? fmtMoney(r.won, cur) : '–'}</td><td>${net(r.net)}</td></tr>`).join('')}</tbody>
      <tfoot><tr><td></td><td>Total</td><td>${fmtMoney(totalPaid, cur)}</td><td>${fmtMoney(totalWon, cur)}</td><td>${totalPaid > totalWon ? `<small>house kept ${fmtMoney(totalPaid - totalWon, cur)}</small>` : totalWon > totalPaid ? `<small>added money ${fmtMoney(totalWon - totalPaid, cur)}</small>` : ''}</td></tr></tfoot>
    </table>`;
  }

  /** Falling snow on a canvas covering `host` (only draws while the Christmas theme is on). */
  function snow(host, count = 140) {
    const c = document.createElement('canvas');
    c.className = 'snow';
    host.appendChild(c);
    const ctx = c.getContext('2d');
    let flakes = [];
    const reset = () => {
      c.width = host.offsetWidth;
      c.height = host.offsetHeight;
      flakes = Array.from({ length: count }, () => ({
        x: Math.random() * c.width, y: Math.random() * c.height,
        r: 1 + Math.random() * 3.2, v: 0.3 + Math.random() * 1.1, p: Math.random() * 6.28,
      }));
    };
    reset();
    new ResizeObserver(reset).observe(host);
    (function frame() {
      ctx.clearRect(0, 0, c.width, c.height);
      if (document.body.classList.contains('theme-christmas')) {
        for (const f of flakes) {
          f.y += f.v;
          f.p += 0.01;
          f.x += Math.sin(f.p) * 0.4;
          if (f.y > c.height + 5) { f.y = -5; f.x = Math.random() * c.width; }
          ctx.globalAlpha = 0.35 + f.r / 8;
          ctx.beginPath();
          ctx.arc(f.x, f.y, f.r, 0, 6.283);
          ctx.fillStyle = '#fff';
          ctx.fill();
        }
      }
      requestAnimationFrame(frame);
    })();
  }

  function applyTheme(theme) {
    document.body.classList.toggle('theme-christmas', theme === 'christmas');
  }

  window.PT = { HATS, hatHTML, results, resultsHTML, snow, applyTheme, useCurrency, esc, fmtNum, fmtShort, fmtMoney, fmtClock, ordinal, colorFor, initials, avatarHTML, chipHTML, seatPositions, blindsText, connect, toast };
})();
