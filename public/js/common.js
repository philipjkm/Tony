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

  const HAT = `<svg class="hat" viewBox="0 0 120 100" aria-hidden="true">
    <defs><linearGradient id="hatg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ff3b4e"/><stop offset="1" stop-color="#a50d22"/></linearGradient></defs>
    <path d="M14 80 Q 34 14 86 16 Q 112 18 108 56 Q 92 34 72 38 Q 84 56 90 80 Z" fill="url(#hatg)"/>
    <rect x="4" y="70" width="94" height="22" rx="11" fill="#fff"/>
    <circle cx="106" cy="60" r="12" fill="#fff"/></svg>`;

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

  window.PT = { HAT, snow, applyTheme, useCurrency, esc, fmtNum, fmtShort, fmtMoney, fmtClock, ordinal, colorFor, initials, avatarHTML, chipHTML, seatPositions, blindsText, connect, toast };
})();
