(function () {
  const { esc, fmtNum, fmtShort, fmtMoney, fmtClock, ordinal, avatarHTML, seatPositions, blindsText, toast } = PT;
  const $ = (id) => document.getElementById(id);
  let selectedId = null;
  PT.snow(document.getElementById('snow-host'), 70);
  let busy = false;

  const live = PT.connect({
    onState: render,
    onEvent: (e) => {
      if (e.type === 'level' && navigator.vibrate) navigator.vibrate(120);
    },
    onConn: (on) => {
      const c = $('conn');
      c.className = 'conn ' + (on ? 'on' : 'off');
      c.textContent = on ? 'Live' : 'Offline';
    },
  });

  async function send(action, okMsg) {
    if (busy) return;
    busy = true;
    const res = await live.send(action);
    busy = false;
    if (!res.ok) toast(res.error || 'Something went wrong', { error: true });
    else if (okMsg) {
      if (navigator.vibrate) navigator.vibrate(30);
      toast(okMsg, { action: { label: 'Undo', run: () => send({ type: 'undo' }, 'Undone') } });
    }
    return res;
  }

  $('b-toggle').onclick = () => send({ type: 'clock.toggle' });
  $('b-prev').onclick = () => send({ type: 'clock.prev' });
  $('b-next').onclick = () => send({ type: 'clock.next' });
  $('b-plus').onclick = () => send({ type: 'clock.adjust', ms: 60000 });
  $('b-minus').onclick = () => send({ type: 'clock.adjust', ms: -60000 });
  $('b-undo').onclick = () => send({ type: 'undo' }, null).then((r) => r && r.ok && toast('Undone'));

  /* ---------- sheet ---------- */
  function openSheet(id) {
    selectedId = id;
    renderSheet();
    $('sheet').classList.add('show');
    $('sheet-bg').classList.add('show');
    markSelected();
  }
  function closeSheet() {
    selectedId = null;
    $('sheet').classList.remove('show');
    $('sheet-bg').classList.remove('show');
    markSelected();
  }
  $('sheet-bg').onclick = closeSheet;
  $('sh-close').onclick = closeSheet;
  document.querySelectorAll('.act').forEach((btn) => {
    btn.onclick = async () => {
      const id = selectedId;
      const p = live.state && live.state.players.find((x) => x.id === id);
      if (!p) return;
      const type = btn.dataset.action;
      const label = { 'player.eliminate': `${p.name} eliminated`, 'player.rebuy': `Rebuy · ${p.name}`, 'player.addon': `Add-on · ${p.name}` }[type];
      const res = await send({ type, playerId: id }, label);
      if (res && res.ok) closeSheet();
    };
  });

  function renderSheet() {
    const s = live.state;
    if (!s || !selectedId) return;
    const p = s.players.find((x) => x.id === selectedId);
    if (!p) return closeSheet();
    const cur = s.config.currency;
    const meta = [];
    meta.push(p.status === 'out' ? `Out · ${ordinal(p.place)}` : s.derived.winnerId === p.id ? 'Champion 👑' : 'Active');
    if (p.rebuys) meta.push(`${p.rebuys} rebuy${p.rebuys > 1 ? 's' : ''}`);
    if (p.addons) meta.push(`${p.addons} add-on${p.addons > 1 ? 's' : ''}`);
    $('sh-head').innerHTML = `<div class="ring">${avatarHTML(p, 64)}</div><div><div class="nm">${esc(p.name)}</div><div class="meta">${esc(meta.join(' · '))}</div></div>`;
    $('a-elim').disabled = !p.canEliminate;
    $('w-elim').textContent = p.canEliminate ? `${ordinal(s.derived.activeCount)} place` : p.status === 'out' ? 'Already out' : '';
    $('a-rebuy').disabled = !p.canRebuy;
    $('l-rebuy').textContent = p.status === 'out' ? 'Re-entry' : 'Rebuy';
    $('w-rebuy').textContent = p.canRebuy ? `${fmtMoney(s.config.rebuy.price, cur)} · ${fmtShort(s.config.rebuy.chips)}` : p.rebuyReason || '';
    $('a-addon').disabled = !p.canAddon;
    $('w-addon').textContent = p.canAddon ? `${fmtMoney(s.config.addon.price, cur)} · ${fmtShort(s.config.addon.chips)}` : p.addonReason || '';
  }

  function markSelected() {
    document.querySelectorAll('.r-seat, .r-rp').forEach((el) => {
      el.classList.toggle('sel', !!el.dataset.id && el.dataset.id === selectedId);
      el.classList.toggle('picked', !!el.dataset.id && el.dataset.id === picked);
    });
  }

  /* ---------- render ---------- */
  function render(s) {
    const cfg = s.config;
    const d = s.derived;
    PT.useCurrency(cfg.currency);
    PT.applyTheme(cfg.theme);
    const cur = cfg.currency;
    document.title = cfg.name + ' · Remote';
    const isBreak = d.level.type === 'break';
    $('cc-level').textContent = isBreak ? 'BREAK' : `LEVEL ${d.levelNumber} OF ${d.levelCount}`;
    $('cc-blinds').textContent = isBreak ? d.level.label || 'Break' : blindsText(d.level) + (d.level.ante ? `  ·  ${fmtNum(d.level.ante)}` : '');
    $('cc-next').textContent = d.nextLevel ? `Next ${blindsText(d.nextLevel)}${d.nextLevel.ante ? ' · ' + fmtNum(d.nextLevel.ante) : ''}` : 'Final level';
    $('clock-card').classList.toggle('paused', !d.running);
    const tg = $('b-toggle');
    tg.textContent = d.running ? '❚❚' : '▶';
    tg.classList.toggle('is-running', d.running);
    tg.setAttribute('aria-label', d.running ? 'Pause' : 'Start');

    $('r-stats').innerHTML = [
      ['PLAYERS', `${d.activeCount}/${d.entries}`],
      ['PRIZE POOL', fmtMoney(d.prizePool, cur), 'gold'],
      ['AVG STACK', fmtShort(d.avgStack)],
    ].map(([k, v, c]) => `<div class="r-stat"><div class="k">${k}</div><div class="v tnum ${c || ''}">${v}</div></div>`).join('');

    $('r-felt-txt').innerHTML = d.finished
      ? `<b>👑</b>Finished`
      : `<b>${d.activeCount}</b>players left`;

    renderTable(s);

    if (s.undo) {
      $('r-undo').classList.remove('hidden');
      $('undo-text').innerHTML = `Last: <b>${esc({ eliminate: 'Eliminated', rebuy: 'Rebuy', addon: 'Add-on', seat: 'Seat move' }[s.undo.type])} · ${esc(s.undo.name)}</b>`;
    } else $('r-undo').classList.add('hidden');

    $('r-log').innerHTML = s.log.length
      ? s.log.slice(0, 10).map((l) => {
        const what = l.type === 'eliminate' ? `✕ ${esc(l.name)} out ${ordinal(l.place)}` : l.type === 'rebuy' ? `↻ ${esc(l.name)} rebuy`
          : l.type === 'seat' ? `⇄ ${esc(l.name)} → ${l.seat === null ? 'waiting list' : 'seat ' + (l.seat + 1)}` : `＋ ${esc(l.name)} add-on`;
        return `<li><span>${what}</span><span class="tm">${new Date(l.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span></li>`;
      }).join('')
      : '<li class="empty">No actions yet</li>';

    renderSheet();
    tick();
  }

  /* ---------- table, waiting list & seat arranging ---------- */
  let arranging = false;
  let picked = null; // tap-to-move selection
  const wrap = document.querySelector('.r-table-wrap');

  function renderTable(s) {
    const d = s.derived;
    const n = s.config.seats;
    const seats = $('r-seats');
    const size = n <= 8 ? 60 : n <= 10 ? 54 : 46;
    const pos = seatPositions(n, 39, 42);
    const bySeat = new Map();
    s.players.forEach((p) => { if (p.seat !== null && p.seat < n) bySeat.set(p.seat, p); });
    let html = '';
    for (let i = 0; i < n; i++) {
      const p = bySeat.get(i);
      const style = `left:${pos[i].x}%;top:${pos[i].y}%`;
      if (!p) {
        html += `<button class="r-seat empty" data-drop="seat:${i}" style="${style}" aria-label="Empty seat ${i + 1}">
          <div class="ring"><div class="avatar" style="width:${size}px;height:${size}px"></div></div><span class="nm seatno">Seat ${i + 1}</span></button>`;
        continue;
      }
      const win = d.winnerId === p.id;
      const rb = (p.rebuys ? `<span class="r">R${p.rebuys > 1 ? p.rebuys : ''}</span>` : '') + (p.addons ? `<span class="a">A</span>` : '');
      html += `<button class="r-seat ${p.status === 'out' ? 'out' : ''} ${win ? 'win' : ''}" data-id="${esc(p.id)}" data-drop="seat:${i}" style="${style}" aria-label="${esc(p.name)}">
        <div class="ring">${PT.HAT}${avatarHTML(p, size)}</div>
        ${p.status === 'out' ? `<span class="ot" style="top:${size / 2}px">${ordinal(p.place)}</span>` : ''}
        ${rb ? `<span class="rb">${rb}</span>` : ''}
        <span class="nm">${esc(p.name)}</span></button>`;
    }
    seats.innerHTML = html;
    if (!s.players.length) {
      seats.insertAdjacentHTML('beforeend', `<div class="r-empty"><div>No players yet.<br><a href="/setup#players">Add players in Settings →</a></div></div>`);
    }

    const unseated = s.players.filter((p) => p.seat === null);
    $('r-railbox').classList.toggle('hidden', !arranging && !unseated.some((p) => p.status === 'active'));
    $('rail-tip').textContent = arranging ? 'drop here to take a seat away' : `${unseated.filter((p) => p.status === 'active').length} waiting`;
    $('r-rail-list').innerHTML = unseated.length
      ? unseated.map((p) => `<button class="r-rp ${p.status === 'out' ? 'out' : ''}" data-id="${esc(p.id)}" aria-label="${esc(p.name)}">${avatarHTML(p, 46)}<span>${esc(p.name)}</span></button>`).join('')
      : '<span class="none">Nobody waiting</span>';
    markSelected();
  }

  function setArranging(on) {
    arranging = on;
    picked = null;
    wrap.classList.toggle('arranging', on);
    $('b-arrange').textContent = on ? '✓ Done' : '⇄ Arrange seats';
    $('r-hint').textContent = on ? 'Drag, or tap then tap a seat' : 'Tap a player';
    if (live.state) renderTable(live.state);
    // bring the whole table + waiting list on screen so you can drag between them
    if (on) wrap.scrollIntoView({ block: 'start' });
  }
  $('b-arrange').onclick = () => setArranging(!arranging);

  async function moveTo(id, drop) {
    const s = live.state;
    const p = s && s.players.find((x) => x.id === id);
    if (!p || !drop) return;
    const seat = drop === 'rail' ? null : Number(drop.split(':')[1]);
    if (seat === p.seat) return;
    await send({ type: 'player.seat', playerId: id, seat }, `${p.name} → ${seat === null ? 'waiting list' : 'seat ' + (seat + 1)}`);
  }

  // tap (normal mode) → open the player sheet
  wrap.addEventListener('click', (e) => {
    if (arranging) return;
    const el = e.target.closest('[data-id]');
    if (el) openSheet(el.dataset.id);
  });

  // drag & drop / tap-to-move (arrange mode) — pointer events work for touch and mouse
  let drag = null;
  wrap.addEventListener('pointerdown', (e) => {
    if (!arranging) return;
    const el = e.target.closest('[data-id]');
    drag = { id: el ? el.dataset.id : null, el, x: e.clientX, y: e.clientY, moved: false, ghost: null, hot: null };
    if (el) e.preventDefault();
  });
  window.addEventListener('pointermove', (e) => {
    if (!drag || !drag.id) return;
    if (!drag.moved && Math.hypot(e.clientX - drag.x, e.clientY - drag.y) < 8) return;
    if (!drag.moved) {
      drag.moved = true;
      const av = drag.el.querySelector('.ring, .avatar');
      drag.ghost = av.cloneNode(true);
      drag.ghost.classList.add('ghost');
      document.body.appendChild(drag.ghost);
      drag.el.classList.add('dragging');
      if (navigator.vibrate) navigator.vibrate(15);
    }
    drag.ghost.style.left = e.clientX + 'px';
    drag.ghost.style.top = e.clientY + 'px';
    const under = document.elementFromPoint(e.clientX, e.clientY);
    const hot = under && under.closest('[data-drop]');
    if (hot !== drag.hot) {
      if (drag.hot) drag.hot.classList.remove('drop-hot');
      if (hot) hot.classList.add('drop-hot');
      drag.hot = hot;
    }
  });
  function endDrag(e, cancelled) {
    if (!drag) return;
    const d = drag;
    drag = null;
    if (d.ghost) d.ghost.remove();
    if (d.hot) d.hot.classList.remove('drop-hot');
    document.querySelectorAll('.dragging').forEach((x) => x.classList.remove('dragging'));
    if (cancelled) return;
    if (d.moved) {
      if (d.hot) moveTo(d.id, d.hot.dataset.drop);
      picked = null;
      markSelected();
      return;
    }
    // a tap
    const under = document.elementFromPoint(e.clientX, e.clientY);
    const drop = under && under.closest('[data-drop]');
    if (picked && d.id !== picked && drop) {
      moveTo(picked, drop.dataset.drop);
      picked = null;
    } else if (picked && d.id === picked) {
      picked = null;
    } else if (d.id) {
      picked = d.id;
      if (navigator.vibrate) navigator.vibrate(10);
    }
    markSelected();
  }
  window.addEventListener('pointerup', (e) => endDrag(e, false));
  window.addEventListener('pointercancel', (e) => endDrag(e, true));

  /* ---------- settings shortcuts menu ---------- */
  $('b-menu').onclick = () => { $('menu').classList.add('show'); $('sheet-bg').classList.add('show'); };
  const closeMenu = () => { $('menu').classList.remove('show'); if (!selectedId) $('sheet-bg').classList.remove('show'); };
  $('menu-close').onclick = closeMenu;
  $('sheet-bg').addEventListener('click', closeMenu);

  function tick() {
    const s = live.state;
    if (!s) return;
    const rem = live.remaining();
    const el = $('cc-time');
    el.textContent = fmtClock(rem);
    el.classList.toggle('warn', s.derived.running && rem <= 60000);
    $('cc-progress').style.width = (100 * (1 - rem / s.derived.levelDurationMs)).toFixed(2) + '%';
  }
  setInterval(tick, 250);
})();
