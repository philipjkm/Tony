/* Voice announcer for the TV (browser speech, nothing to install). Styles: santa / normal / off. */
(function () {
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

  // number words for speech: no thousands separators ("2000", not "2.000" or "2,000")
  const n = (x) => String(Math.round(Number(x) || 0));

  const LINES = {
    en: {
      money: (amt, cur) => (/kr/i.test(cur) ? `${n(amt)} kroner` : `${cur}${n(amt)}`),
      place: (p) => PT.ordinal(p),
      start: { normal: ['Shuffle up and deal!'], santa: ['Ho ho ho! Shuffle up and deal, and may Santa bring you good cards!'] },
      level: {
        normal: (lv, sb, bb, ante) => `Level ${lv}. Blinds are now ${n(sb)} and ${n(bb)}${ante ? `, with an ante of ${n(ante)}` : ''}.`,
        santa: (lv, sb, bb, ante) => `Ho ho ho! Level ${lv}! The blinds are now ${n(sb)} and ${n(bb)}${ante ? `, with an ante of ${n(ante)}` : ''}.`,
      },
      break: {
        normal: (min) => `Break time. ${min} minutes.`,
        santa: (min) => pick([`Ho ho ho! Break time! ${min} minutes for milk and cookies.`, `Time to feed the reindeer! We're on a ${min} minute break.`]),
      },
      minute: { normal: ['One minute left in this level.'], santa: ['One minute left in this level. Hurry up, the elves are watching!'] },
      out: {
        normal: (name, pl, prize) => `${name} is out in ${pl} place${prize ? `, and wins ${prize}` : ''}.`,
        santa: (name, pl, prize) => pick([
          `Oh no! ${name} is out in ${pl} place${prize ? `, and takes home ${prize}` : ''}. Back to the North Pole!`,
          `Ho ho ho! ${name} goes on the naughty list in ${pl} place${prize ? `, but still wins ${prize}` : ''}.`,
          `${name} is out in ${pl} place${prize ? `, with ${prize} in the stocking` : ''}. Santa saw that one coming!`,
        ]),
      },
      burst: {
        normal: (name, pl) => `${name} bursts the bubble in ${pl} place. Everyone left is in the money!`,
        santa: (name, pl) => `Ho ho ho! ${name} bursts the bubble in ${pl} place! Everyone left is in the money. Merry Christmas!`,
      },
      bubble: {
        normal: () => 'We are on the bubble. One more player out, and everyone left gets paid.',
        santa: () => 'Ho ho ho! We are on the bubble! One more player out, and everyone left gets a present.',
      },
      headsUp: { normal: (a, b) => `We are heads up! ${a} versus ${b}.`, santa: (a, b) => `Heads up! ${a} versus ${b}. Only one can be top of Santa's list!` },
      rebuy: { normal: (name) => `${name} buys back in.`, santa: (name) => `Ho ho ho! More presents under the tree. ${name} buys back in!` },
      reentry: { normal: (name) => `${name} is back in the game.`, santa: (name) => `${name} is back in the game! Santa believes in second chances.` },
      addon: { normal: (name) => `${name} takes the add-on.`, santa: (name) => `${name} takes the add-on. Ka-ching!` },
      winner: {
        normal: (name, prize) => `${name} is the champion${prize ? `, winning ${prize}` : ''}! Congratulations!`,
        santa: (name, prize) => `Ho ho ho! Merry Christmas, ${name}! You are the champion${prize ? `, and win ${prize}` : ''}!`,
      },
      test: { normal: 'Hello! This is your tournament announcer.', santa: 'Ho ho ho! Merry Christmas! Santa will be your announcer tonight.' },
    },
    da: {
      money: (amt, cur) => (/kr/i.test(cur) ? `${n(amt)} kroner` : `${n(amt)} ${cur}`),
      place: (p) => `${p}.`,
      start: { normal: ['Bland kortene og del ud!'], santa: ['Ho ho ho! Bland kortene og del ud. Julemanden ønsker jer gode kort!'] },
      level: {
        normal: (lv, sb, bb, ante) => `Niveau ${lv}. Blinds er nu ${n(sb)} og ${n(bb)}${ante ? `, med en ante på ${n(ante)}` : ''}.`,
        santa: (lv, sb, bb, ante) => `Ho ho ho! Niveau ${lv}! Blinds er nu ${n(sb)} og ${n(bb)}${ante ? `, med en ante på ${n(ante)}` : ''}.`,
      },
      break: {
        normal: (min) => `Pause. ${min} minutter.`,
        santa: (min) => pick([`Ho ho ho! Pause! ${min} minutter til gløgg og æbleskiver.`, `Nu skal rensdyrene fodres! Vi holder ${min} minutters pause.`]),
      },
      minute: { normal: ['Ét minut tilbage af dette niveau.'], santa: ['Ét minut tilbage af dette niveau. Skynd jer, nisserne holder øje!'] },
      out: {
        normal: (name, pl, prize) => `${name} er ude på en ${pl} plads${prize ? ` og vinder ${prize}` : ''}.`,
        santa: (name, pl, prize) => pick([
          `Åh nej! ${name} er ude på en ${pl} plads${prize ? ` og tager ${prize} med hjem` : ''}. Tilbage til Nordpolen!`,
          `Ho ho ho! ${name} ryger på den frække liste på en ${pl} plads${prize ? `, men vinder stadig ${prize}` : ''}.`,
          `${name} er ude på en ${pl} plads${prize ? ` med ${prize} i julestrømpen` : ''}. Det så julemanden komme!`,
        ]),
      },
      burst: {
        normal: (name, pl) => `${name} sprænger boblen på en ${pl} plads. Alle tilbageværende er i pengene!`,
        santa: (name, pl) => `Ho ho ho! ${name} sprænger boblen på en ${pl} plads! Alle tilbageværende er i pengene. Glædelig jul!`,
      },
      bubble: {
        normal: () => 'Vi er på boblen. Én spiller mere ud, så får alle tilbageværende penge.',
        santa: () => 'Ho ho ho! Vi er på boblen! Én spiller mere ud, så får alle tilbageværende en gave.',
      },
      headsUp: { normal: (a, b) => `Heads up! ${a} mod ${b}.`, santa: (a, b) => `Heads up! ${a} mod ${b}. Kun én kan stå øverst på julemandens liste!` },
      rebuy: { normal: (name) => `${name} laver et rebuy.`, santa: (name) => `Ho ho ho! Flere gaver under træet. ${name} laver et rebuy!` },
      reentry: { normal: (name) => `${name} laver et rebuy og er tilbage i spillet.`, santa: (name) => `${name} laver et rebuy og er tilbage i spillet! Julemanden tror på en chance mere.` },
      addon: { normal: (name) => `${name} tager add-on.`, santa: (name) => `${name} tager add-on. Ka-ching!` },
      winner: {
        normal: (name, prize) => `${name} er mester${prize ? ` og vinder ${prize}` : ''}! Tillykke!`,
        santa: (name, prize) => `Ho ho ho! Glædelig jul, ${name}! Du er mester${prize ? ` og vinder ${prize}` : ''}!`,
      },
      test: { normal: 'Hej! Jeg er jeres turneringsspeaker.', santa: 'Ho ho ho! Glædelig jul! Julemanden er jeres speaker i aften.' },
    },
  };

  let cfg = { voice: 'santa', lang: 'en' };
  let beforeSpeak = null;
  let queued = 0;
  let realVoice = false; // ElevenLabs Santa is set up on the server

  /* ---------- who may speak ----------
   * Only a page that has been clicked (browsers block sound before that) speaks, and if several
   * TV pages are open (a second tab, a MacBook window + the TV), only the one clicked last speaks.
   */
  let enabled = false;
  let speaker = true;
  const myId = Math.random().toString(36).slice(2);
  let channel = null;
  try {
    channel = new BroadcastChannel('poker-announcer');
    channel.onmessage = (m) => { if (m.data && m.data.claim && m.data.claim !== myId) speaker = false; };
  } catch { /* old browser: just speak */ }

  /* ---------- real Santa voice: play server-made clips in order (Web Audio) ----------
   * One AudioContext, unlocked by the click, plays every clip — no per-clip autoplay blocks.
   * Never mixes voices: a clip that fails is skipped; only if ElevenLabs keeps failing do we
   * switch to the built-in voice for the rest of the night.
   */
  let ctx = null;
  let failsInARow = 0;
  let realVoiceBroken = false;
  const clipQueue = [];
  let clipPlaying = false;
  function audioCtx() {
    if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
    return ctx;
  }
  function fetchClip(text) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 20000);
    return fetch('/api/tts?text=' + encodeURIComponent(text), { signal: ctl.signal })
      .then((r) => { if (!r.ok) throw new Error('clip ' + r.status); return r.arrayBuffer(); })
      .then((buf) => new Promise((res, rej) => audioCtx().decodeAudioData(buf, res, rej)))
      .finally(() => clearTimeout(timer));
  }
  function playClip(text, lang) {
    if (clipQueue.length >= 4) clipQueue.splice(0, clipQueue.length - 3); // don't fall far behind
    const item = { text, lang, buffer: fetchClip(text) }; // starts generating/downloading right away
    item.buffer.catch(() => {}); // handled when its turn comes
    clipQueue.push(item);
    nextClip();
  }
  function nextClip() {
    if (clipPlaying) return;
    const item = clipQueue.shift();
    if (!item) return;
    clipPlaying = true;
    const done = () => { clipPlaying = false; nextClip(); };
    item.buffer.then((buffer) => {
      failsInARow = 0;
      if (beforeSpeak) beforeSpeak();
      const c = audioCtx();
      if (c.state === 'suspended') c.resume();
      const src = c.createBufferSource();
      src.buffer = buffer;
      src.connect(c.destination);
      src.onended = done;
      src.start(c.currentTime + (beforeSpeak ? 0.45 : 0));
      document.dispatchEvent(new CustomEvent('announcer:clip', { detail: item.text }));
    }).catch(() => {
      failsInARow++;
      if (failsInARow >= 3) {
        realVoiceBroken = true; // ElevenLabs is clearly unavailable tonight: one consistent voice from now on
        browserSay(item.text, { voice: 'santa', lang: item.lang });
      }
      done();
    });
  }

  function synth() { return window.speechSynthesis || null; }

  function pickVoice(lang, style) {
    const s = synth();
    const voices = s ? s.getVoices() : [];
    const ok = (v) => (lang === 'da' ? /^da/i.test(v.lang) : /^en/i.test(v.lang));
    const prefs = lang === 'da'
      ? [/Magnus/i, /Google dansk/i]
      : style === 'santa'
        ? [/Grandpa/i, /Ralph/i, /Rocko/i, /Fred/i, /Daniel/i, /Google UK English Male/i, /\bMale\b/i, /Alex/i]
        : [/Daniel/i, /Samantha/i, /Google US English/i];
    for (const p of prefs) {
      const v = voices.find((x) => p.test(x.name) && ok(x));
      if (v) return v;
    }
    return voices.find(ok) || null;
  }

  function say(text, opts = {}) {
    const style = opts.voice || cfg.voice;
    const lang = opts.lang || cfg.lang;
    if (style === 'off' || !text) return;
    if (lang === 'da') text = speakDanish(text);
    if (style === 'santa' && realVoice && !realVoiceBroken && !opts.browser) return playClip(text, lang);
    browserSay(text, { voice: style, lang });
  }

  /* ---------- Danish numbers as words (so 4060 is "fire tusind og tres", not "forty sixty") ---------- */
  const DA_ONES = ['nul', 'en', 'to', 'tre', 'fire', 'fem', 'seks', 'syv', 'otte', 'ni', 'ti', 'elleve', 'tolv', 'tretten', 'fjorten', 'femten', 'seksten', 'sytten', 'atten', 'nitten'];
  const DA_TENS = ['', '', 'tyve', 'tredive', 'fyrre', 'halvtreds', 'tres', 'halvfjerds', 'firs', 'halvfems'];
  const DA_ORD = ['', 'første', 'anden', 'tredje', 'fjerde', 'femte', 'sjette', 'syvende', 'ottende', 'niende', 'tiende', 'ellevte', 'tolvte', 'trettende', 'fjortende', 'femtende', 'sekstende', 'syttende', 'attende', 'nittende', 'tyvende'];
  function da99(n) {
    if (n < 20) return DA_ONES[n];
    const t = Math.floor(n / 10), o = n % 10;
    return o ? `${DA_ONES[o]}og${DA_TENS[t]}` : DA_TENS[t];
  }
  function da999(n) { // 1..999, "og" before a last part under 100
    const h = Math.floor(n / 100), r = n % 100;
    if (!h) return da99(r);
    const hs = `${h === 1 ? 'et' : DA_ONES[h]} hundrede`;
    return r ? `${hs} og ${da99(r)}` : hs;
  }
  function daNumber(n, neuter) {
    n = Math.floor(Math.abs(n));
    if (n === 0) return 'nul';
    if (n === 1) return neuter ? 'et' : 'en';
    const parts = [];
    const mio = Math.floor(n / 1e6), th = Math.floor((n % 1e6) / 1000), rest = n % 1000;
    if (mio) parts.push(mio === 1 ? 'en million' : `${da999(mio)} millioner`);
    if (th) parts.push(`${th === 1 ? 'et' : da999(th)} tusind`);
    if (rest) parts.push(parts.length && rest < 100 ? `og ${da99(rest)}` : da999(rest));
    return parts.join(' ');
  }
  /** Rewrite digits in a Danish sentence as words, e.g. "på en 5. plads … 4060 kroner" → "på en femte plads … fire tusind og tres kroner". */
  function speakDanishNumbers(text) {
    return String(text)
      .replace(/(\d+)\.(?=\s*plads)/g, (m, d) => DA_ORD[+d] || daNumber(+d))
      .replace(/(\d{1,3}(?:\.\d{3})+|\d+)/g, (m, d, off, str) => {
        const n = Number(d.replace(/\./g, ''));
        const before = str.slice(Math.max(0, off - 8), off);
        return daNumber(n, /niveau\s*$/i.test(before));
      });
  }
  PT.speakDanishNumbers = speakDanishNumbers;
  /** Everything Santa says in Danish: numbers as words, and "rebuy" spelled the way it should sound. */
  function speakDanish(text, rebuySay) {
    const say = rebuySay || cfg.rebuySay || 'ri-bai';
    return speakDanishNumbers(String(text).replace(/\b(re-?buy)(s?)\b/gi, (m, w, plural) => say + (plural ? 's' : '')));
  }
  PT.speakDanish = speakDanish;

  function browserSay(text, opts) {
    const s = synth();
    const style = opts.voice;
    const lang = opts.lang;
    if (!s || !text) return;
    // never build a long backlog: if things pile up, skip ahead to the newest
    if (queued >= 3) { s.cancel(); queued = 0; }
    if (style === 'santa' && beforeSpeak && !s.speaking) beforeSpeak();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = lang === 'da' ? 'da-DK' : 'en-US';
    const v = pickVoice(lang, style);
    if (v) u.voice = v;
    u.pitch = style === 'santa' ? 0.55 : 1;
    if (typeof window !== 'undefined') window.__lastVoice = 'browser';
    u.rate = style === 'santa' ? 0.88 : 1;
    u.volume = 1;
    queued++;
    u.onend = u.onerror = () => { queued = Math.max(0, queued - 1); };
    s.speak(u);
  }

  /** Speak for a game event (from the TV display). */
  /* ---------- fun facts & shout-outs about players (rebuy / bust-out) ---------- */
  const dur = (ms, lang) => {
    const h = Math.floor(ms / 3600000);
    const m = Math.round((ms % 3600000) / 60000);
    if (lang === 'da') return h ? `${h} ${h === 1 ? 'time' : 'timer'} og ${m} minutter` : `${m} minutter`;
    return h ? `${h} ${h === 1 ? 'hour' : 'hours'} and ${m} minutes` : `${m} minutes`;
  };
  // built-in shout-outs (needling, situation-aware), used when a player's own lines run out.
  // `when` picks the right moment; lines without `when` fit any time.
  const SHOUT = {
    da: {
      rebuy: [
        { when: (x) => x.rebuys >= 3, say: (p, x) => `Rebuy nummer ${x.rebuys}, ${p.name}? Nisserne er begyndt at føre et særskilt regnskab over dig.` },
        { when: (x) => x.rebuys >= 2, say: (p, x) => `${p.name} har nu lavet ${x.rebuys} rebuys. Julemanden overvejer at sende en regning i stedet for gaver.` },
        { when: (x) => x.reentry && x.minutes >= 1 && x.minutes < 30, say: (p) => `Det tog ikke lang tid, ${p.name}. Stolen var knap nok blevet kold.` },
        { say: (p) => `Pengene ruller, ${p.name}. Bare den forkerte vej.` },
        { say: (p) => `Tak for bidraget til præmiepuljen, ${p.name}. Resten af bordet siger glædelig jul!` },
        { say: (p) => `Bare rolig, ${p.name}. Det er kun penge … og lidt stolthed.` },
        { say: (p) => `${p.name} er tilbage! Julemanden beundrer optimismen. Kortspillet, knap så meget.` },
        { say: (p) => `${p.name} tror stadig på julemirakler. Det er også nødvendigt nu.` },
      ],
      out: [
        { when: (x) => x.bubble, say: (p) => `${p.name} snublede lige før pengene. Årets boble-dreng, og det med stil!` },
        { when: (x) => x.minutes >= 1 && x.minutes < 45, say: (p, x) => `${p.name} nåede knap at få varmen i stolen. Efter ${x.played} var festen slut.` },
        { when: (x) => x.prize > 0, say: (p, x) => `${p.name} går hjem med ${x.money}. Ikke dårligt, når man tænker på, hvordan der blev spillet.` },
        { when: (x) => x.rebuys >= 2, say: (p, x) => `${x.rebuys} rebuys, og alligevel ude. ${p.name}, julemanden beundrer din gavmildhed.` },
        { when: (x) => x.minutes >= 45, say: (p, x) => `${p.name} holdt ud i ${x.played}. Der er stadig gløgg tilbage, så aftenen er ikke helt tabt.` },
        { say: (p) => `${p.name}, du står stadig på den søde liste … men kun fordi julemanden har ondt af dig.` },
        { say: (p) => `Der står risalamande i køkkenet, ${p.name}. Den er nok nemmere at vinde over.` },
        { say: (p) => `Selv Rudolf havde spillet den hånd bedre, ${p.name}.` },
        { say: (p) => `${p.name} er ude. Nu kan du heppe på dem, der stadig kan spille.` },
      ],
    },
    en: {
      rebuy: [
        { when: (x) => x.rebuys >= 3, say: (p, x) => `Rebuy number ${x.rebuys}, ${p.name}? The elves have started a separate ledger just for you.` },
        { when: (x) => x.rebuys >= 2, say: (p, x) => `${p.name} has now bought back in ${x.rebuys} times. Santa is thinking of sending a bill instead of presents.` },
        { when: (x) => x.reentry && x.minutes >= 1 && x.minutes < 30, say: (p) => `That didn't take long, ${p.name}. The chair was still warm.` },
        { say: (p) => `The money keeps flowing, ${p.name}. Just in the wrong direction.` },
        { say: (p) => `Thanks for the donation to the prize pool, ${p.name}. The rest of the table says Merry Christmas!` },
        { say: (p) => `Don't worry, ${p.name}. It's only money … and a little pride.` },
        { say: (p) => `${p.name} is back! Santa admires the optimism. The card play, not so much.` },
        { say: (p) => `${p.name} still believes in Christmas miracles. Which is just as well.` },
      ],
      out: [
        { when: (x) => x.bubble, say: (p) => `${p.name} tripped right before the money. Bubble boy of the year, and in style!` },
        { when: (x) => x.minutes >= 1 && x.minutes < 45, say: (p, x) => `${p.name} barely warmed the chair. After ${x.played}, the party was over.` },
        { when: (x) => x.prize > 0, say: (p, x) => `${p.name} goes home with ${x.money}. Not bad, considering how that was played.` },
        { when: (x) => x.rebuys >= 2, say: (p, x) => `${x.rebuys} rebuys and still out. ${p.name}, Santa admires your generosity.` },
        { when: (x) => x.minutes >= 45, say: (p, x) => `${p.name} lasted ${x.played}. There's still mulled wine left, so the night isn't completely lost.` },
        { say: (p) => `${p.name}, you're still on the nice list … but only because Santa feels sorry for you.` },
        { say: (p) => `There's rice pudding in the kitchen, ${p.name}. Probably easier to beat.` },
        { say: (p) => `Even Rudolph would have played that hand better, ${p.name}.` },
        { say: (p) => `${p.name} is out. Now you can cheer for the ones who can still play.` },
      ],
    },
  };
  const storeKey = (state, id) => `pt-shout:${state.id}:${id}`;
  function nextShout(kind, p, state, lang, x) {
    const list = (SHOUT[lang] || SHOUT.en)[kind];
    let used = [];
    try { used = JSON.parse(localStorage.getItem(storeKey(state, p.id)) || '[]'); } catch { /* private mode */ }
    const keyOf = (i) => kind + i;
    const fits = (i) => !list[i].when || list[i].when(x);
    // the most fitting line not yet used for this player: the first matching situation line (they are
    // listed most important first, e.g. bubble boy before a quick exit), otherwise a random general one
    const first = list.findIndex((l, i) => l.when && !used.includes(keyOf(i)) && fits(i));
    let pool = first >= 0 ? [first] : [];
    if (!pool.length) pool = list.map((_, i) => i).filter((i) => !used.includes(keyOf(i)) && !list[i].when);
    if (!pool.length) { used = used.filter((k) => !k.startsWith(kind)); pool = list.map((_, i) => i).filter((i) => fits(i)); }
    const i = pool[Math.floor(Math.random() * pool.length)];
    try { localStorage.setItem(storeKey(state, p.id), JSON.stringify([...used, keyOf(i)])); } catch { /* ignore */ }
    return list[i].say(p, x);
  }
  /** The extra sentence about a player: one of their own lines first, then a situation-aware shout-out. */
  function extraFor(e, state) {
    if (e.type !== 'eliminated' && e.type !== 'rebuy') return '';
    const lang = cfg.lang;
    const kind = e.type === 'rebuy' ? 'rebuy' : 'out';
    const p = state.players.find((x) => x.id === e.playerId) || { id: e.playerId, name: e.name, rebuys: e.rebuys || 0 };
    if (e.fact) return /[.!?…]$/.test(e.fact) ? e.fact : e.fact + '.'; // the host's line is the joke: said as written
    if (cfg.voice === 'normal') return '';
    const end = kind === 'out' ? (p.eliminatedAt || 0) : Date.now();
    const ms = state.startedAt && end ? Math.max(0, end - state.startedAt) : 0;
    const d = state.derived;
    const x = {
      rebuys: kind === 'rebuy' ? (e.rebuys || p.rebuys || 1) : (p.rebuys || 0),
      reentry: !!e.reentry,
      minutes: ms / 60000,
      played: dur(ms, lang),
      place: e.place,
      prize: e.prize || 0,
      money: e.prize ? (LINES[lang] || LINES.en).money(e.prize, state.config.currency) : '',
      bubble: kind === 'out' && !!e.burstBubble,
    };
    return nextShout(kind, p, state, lang, x);
  }

  function handle(e, state) {
    if (state && (e.type === 'eliminated' || e.type === 'rebuy') && e.extra === undefined) e.extra = extraFor(e, state);
    if (!state || cfg.voice === 'off' || !enabled || !speaker) return;
    const withExtra = (txt) => (e.extra ? `${txt} ${e.extra}` : txt);
    const L = LINES[cfg.lang] || LINES.en;
    const st = cfg.voice === 'santa' ? 'santa' : 'normal';
    const cur = state.config.currency;
    const money = (a) => (a ? L.money(a, cur) : '');
    const line = (k) => { const x = L[k][st]; return Array.isArray(x) ? pick(x) : x; };
    switch (e.type) {
      case 'resumed':
        if (e.first) say(line('start'));
        break;
      case 'level': {
        const lv = state.config.levels[e.levelIndex];
        if (!lv) break;
        if (lv.type === 'break') say(line('break')(lv.minutes));
        else say(line('level')(PT.levelNumberAt(state.config.levels, e.levelIndex), lv.sb, lv.bb, lv.ante));
        break;
      }
      case 'eliminated':
        if (state.derived.finished) say(withExtra(line('out')(e.name, L.place(e.place), money(e.prize))));
        else if (e.burstBubble) say(withExtra(line('burst')(e.name, L.place(e.place))));
        else say(withExtra(line('out')(e.name, L.place(e.place), money(e.prize))));
        break;
      case 'bubble': say(line('bubble')()); break;
      case 'headsUp': say(line('headsUp')(e.a.name, e.b.name)); break;
      case 'rebuy': say(withExtra(line(e.reentry ? 'reentry' : 'rebuy')(e.name))); break;
      case 'addon': say(line('addon')(e.name)); break;
      case 'winner': say(line('winner')(e.name, money(e.prize))); break;
      case 'minute': say(line('minute')); break;
    }
  }

  function levelNumberAt(levels, idx) {
    let k = 0;
    for (let i = 0; i <= idx && i < levels.length; i++) if (levels[i].type === 'level') k++;
    return Math.max(1, k);
  }

  PT.levelNumberAt = levelNumberAt;
  PT.announcer = {
    configure(c, voiceStatus) {
      if (c) cfg = { voice: c.voice || 'santa', lang: c.lang || 'en', rebuySay: c.rebuySay || 'ri-bai' };
      if (voiceStatus) realVoice = !!voiceStatus.ready;
    },
    /** Every line that can be prepared before game night (no prize amounts in them). */
    fixedLines(state, c) {
      const L = LINES[(c && c.lang) || cfg.lang] || LINES.en;
      const st = 'santa';
      const out = new Set();
      const all = (x, ...args) => { for (let i = 0; i < 12; i++) out.add(typeof x === 'function' ? x(...args) : Array.isArray(x) ? x[i % x.length] : x); };
      all(L.start[st]); all(L.minute[st]); all(L.bubble[st]); all(L.test[st]);
      const levels = state.config.levels;
      levels.forEach((lv, i) => {
        if (lv.type === 'break') all(L.break[st], lv.minutes);
        else out.add(L.level[st](levelNumberAt(levels, i), lv.sb, lv.bb, lv.ante));
      });
      for (const p of state.players) {
        out.add(L.rebuy[st](p.name)); out.add(L.reentry[st](p.name)); out.add(L.addon[st](p.name));
      }
      const isDa = ((c && c.lang) || cfg.lang) === 'da';
      return [...out].filter(Boolean).map((t) => (isDa ? speakDanish(t, c && c.rebuySay) : t));
    },
    onBeforeSpeak(fn) { beforeSpeak = fn; },
    handle,
    extraFor,
    say,
    test(c, opts = {}) { this.unlock({ claim: false }); const lang = (c && c.lang) || cfg.lang; const v = (c && c.voice) || cfg.voice; say((LINES[lang] || LINES.en).test[v === 'santa' ? 'santa' : 'normal'], { voice: v === 'off' ? 'normal' : v, lang, browser: opts.browser }); },
    get realVoice() { return realVoice; },
    get speaking() { return enabled && speaker; },
    /** Call from a click: allows sound on this page and makes it the one that speaks. */
    unlock({ claim = true } = {}) {
      enabled = true;
      try { audioCtx().resume(); } catch { /* no audio */ }
      if (claim) {
        speaker = true;
        if (channel) channel.postMessage({ claim: myId });
      }
    },
    lines: LINES,
  };
  // voices load asynchronously in Chrome
  if (synth() && synth().onvoiceschanged !== undefined) synth().onvoiceschanged = () => {};
})();
