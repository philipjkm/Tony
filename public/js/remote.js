(function () {
  const { esc, fmtNum, fmtShort, fmtMoney, fmtClock, ordinal, avatarHTML, seatPositions, blindsText, toast } = PT;
  const $ = (id) => document.getElementById(id);
  let selectedId = null;
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
    document.querySelectorAll('.r-seat').forEach((el) => el.classList.toggle('sel', el.dataset.id === selectedId));
  }

  /* ---------- render ---------- */
  function render(s) {
    const cfg = s.config;
    const d = s.derived;
    const cur = cfg.currency;
    $('t-name').textContent = cfg.name;
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

    const seats = $('r-seats');
    const n = s.players.length;
    if (!n) {
      seats.innerHTML = `<div class="r-empty"><div>No players yet.<br><a href="/setup">Add players in Settings →</a></div></div>`;
    } else {
      const size = n <= 8 ? 54 : n <= 10 ? 48 : n <= 12 ? 42 : 36;
      const pos = seatPositions(n, 39, 42);
      seats.innerHTML = s.players.map((p, i) => {
        const win = d.winnerId === p.id;
        const rb = (p.rebuys ? `<span class="r">R${p.rebuys > 1 ? p.rebuys : ''}</span>` : '') + (p.addons ? `<span class="a">A</span>` : '');
        return `<button class="r-seat ${p.status === 'out' ? 'out' : ''} ${win ? 'win' : ''}" data-id="${esc(p.id)}" style="left:${pos[i].x}%;top:${pos[i].y}%" aria-label="${esc(p.name)}">
          <div class="ring">${avatarHTML(p, size)}</div>
          ${p.status === 'out' ? `<span class="ot" style="top:${size / 2}px">${ordinal(p.place)}</span>` : ''}
          ${rb ? `<span class="rb">${rb}</span>` : ''}
          <span class="nm">${esc(p.name)}</span></button>`;
      }).join('');
      seats.querySelectorAll('.r-seat').forEach((el) => { el.onclick = () => openSheet(el.dataset.id); });
      markSelected();
    }

    if (s.undo) {
      $('r-undo').classList.remove('hidden');
      $('undo-text').innerHTML = `Last: <b>${esc({ eliminate: 'Eliminated', rebuy: 'Rebuy', addon: 'Add-on' }[s.undo.type])} · ${esc(s.undo.name)}</b>`;
    } else $('r-undo').classList.add('hidden');

    $('r-log').innerHTML = s.log.length
      ? s.log.slice(0, 10).map((l) => {
        const what = l.type === 'eliminate' ? `✕ ${esc(l.name)} out ${ordinal(l.place)}` : l.type === 'rebuy' ? `↻ ${esc(l.name)} rebuy` : `＋ ${esc(l.name)} add-on`;
        return `<li><span>${what}</span><span class="tm">${new Date(l.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span></li>`;
      }).join('')
      : '<li class="empty">No actions yet</li>';

    renderSheet();
    tick();
  }

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
