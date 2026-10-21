// 畫面元件。沿用《高中，只有一次》(leway1980/Game 47wan @ ce1d972) ui.js 的 h() 小工具與畫面拆法（標題、開場、遊戲、終局）；
// 改為親子遊戲：數值條只畫長條與一個字，劑量表只畫 ▲▼ 與格數，隱藏數值在終局之前不會出現在任何元素裡。
import { REVEAL_GROUPS } from './engine/ending.js';
import { sceneSVG } from './engine/scene.js';
import { rowIcon, _icons } from './engine/icons.js';

export function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v === false || v === null || v === undefined) continue;
      if (k === 'class') el.className = v;
      else if (k === 'html') el.innerHTML = v;
      else if (k.startsWith('on')) el.addEventListener(k.slice(2).toLowerCase(), v);
      else if (v === true) el.setAttribute(k, '');
      else el.setAttribute(k, v);
    }
  }
  for (const kid of kids.flat()) {
    if (kid === null || kid === undefined || kid === false) continue;
    el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  }
  return el;
}

/* ───────────── 標題與開場 ───────────── */
export function renderTitle(root, { hasSave, onNew, onContinue }) {
  root.replaceChildren(h('main', { class: 'wrap hero' },
    h('h1', null, '陪你長大'),
    h('p', { class: 'sub' }, '台灣親職人生模擬'),
    h('p', { class: 'lede' }, '你是爸爸或媽媽。孩子從出生開始，一路陪到長大。時間自己會走，你只負責在每個小時刻做決定。'),
    h('div', { class: 'actions' },
      h('button', { class: 'btn primary block', 'data-act': 'new', onClick: onNew }, '開始新的一局'),
      hasSave && h('button', { class: 'btn block', 'data-act': 'continue', onClick: onContinue }, '繼續上次的'),
    ),
    h('p', { class: 'foot small muted' }, '遊戲裡的家庭和孩子都是抽出來的，只是教學用的抽象，不能用來判斷真實的孩子。'),
  ));
}

/** 轉盤的時間（毫秒）：第一個停在 REEL_FIRST，之後每個隔 REEL_GAP；全部不超過約 4 秒 */
export const REEL_FIRST = 900, REEL_GAP = 700;
const reduced = () => typeof globalThis.matchMedia === 'function' && globalThis.matchMedia('(prefers-reduced-motion: reduce)').matches;

export function renderIntro(root, { sections, role, portrait, flavour, seed, onStart, reels = [], instant = false }) {
  const isReel = (sec, k) => reels.some((r) => r.sec === sec.title && r.key === k);
  const win = (sec) => h('section', { class: 'sw-sec', 'aria-label': sec.title }, h('h2', null, sec.title),
    h('dl', null, sec.rows.map(([k, v]) => h('div', { class: isReel(sec, k) ? 'sw-row has-reel' : 'sw-row' }, h('span', { class: 'sw-ico', 'aria-hidden': 'true', html: rowIcon(sec, k, v) }), h('dt', null, k),
      h('dd', null, isReel(sec, k) ? h('span', { class: 'reel', 'data-reel': k }, v) : v)))));
  const startBtn = h('button', { class: 'btn primary block', 'data-act': 'start', onClick: onStart }, '開始陪伴');
  const skipBtn = h('button', { class: 'btn reel-skip', 'data-act': 'skip-roulette', type: 'button' }, '跳過');
  const winEl = h('div', { class: 'status-win', role: 'group', 'aria-label': '這一局的家庭' }, h('div', { class: 'sw-grid' }, sections.map(win)));
  root.replaceChildren(h('main', { class: 'wrap wide intro' },
    h('div', { class: 'intro-grid' },
      h('div', { class: 'intro-art' }, h('figure', { class: 'portrait', 'aria-label': `你是${role}`, html: portrait })),
      winEl),
    h('p', { class: 'flavour' }, flavour),
    h('div', { class: 'actions' }, startBtn),
    h('p', { class: 'small muted' }, `人生編號 ${seed}（網址加 ?seed=${seed} 可以重來同一個家庭）`),
  ));
  const els = [...winEl.querySelectorAll('.reel')];
  if (instant || reduced() || !els.length) return;
  // 轉盤：每個欄位是一條捲軸，經過候選字後減速停在已抽好的值（停下的值就是表格原本的字）
  startBtn.setAttribute('disabled', '');
  winEl.classList.add('roulette-on'); winEl.append(skipBtn);
  const timers = []; let done = false;
  const land = (el, final) => { el.replaceChildren(final); el.classList.remove('spinning'); el.classList.add('landed'); };
  const finish = () => {
    if (done) return; done = true; timers.forEach(clearTimeout);
    els.forEach((el) => { if (!el.classList.contains('landed')) land(el, el.dataset.final); });
    winEl.classList.remove('roulette-on'); skipBtn.remove(); startBtn.removeAttribute('disabled');
  };
  const order = reels.map((r) => els.find((e) => e.dataset.reel === r.key)).filter(Boolean);
  order.forEach((el, i) => {
    const final = el.textContent, pool = reels.find((r) => r.key === el.dataset.reel).pool.filter((x) => x !== final);
    const dur = REEL_FIRST + REEL_GAP * i, n = Math.max(8, Math.round(dur / 60));
    const items = Array.from({ length: n }, (_, j) => pool.length ? pool[(j * 7 + i * 3) % pool.length] : final);
    items.push(final); el.dataset.final = final;
    const strip = h('span', { class: 'reel-strip', 'aria-hidden': 'true' }, items.map((t) => h('span', null, t)));
    el.replaceChildren(strip); el.classList.add('spinning');
    strip.style.transition = `transform ${dur}ms cubic-bezier(.12,.6,.15,1)`;
    timers.push(setTimeout(() => { strip.style.transform = `translateY(-${(100 * (items.length - 1)) / items.length}%)`; }, 30));
    timers.push(setTimeout(() => { if (!done) land(el, final); if (i === order.length - 1) finish(); }, dur + 60));
  });
  skipBtn.addEventListener('click', finish);
}

/* ───────────── 遊戲畫面 ───────────── */
export function renderGame(root, { speed, onSpeed, onAuto, onSkipEnd, onQuit }) {
  const refs = {};
  refs.age = h('div', { class: 'date', id: 'age-label' });
  refs.speedBtns = [[0, '暫停'], [1, '1×'], [2, '2×'], [4, '4×']].map(([v, t]) => h('button', { 'data-speed': v, 'aria-pressed': String(v === speed), onClick: () => onSpeed(v) }, t));
  refs.autoBtn = h('button', { 'data-act': 'auto', 'aria-pressed': 'false', onClick: onAuto }, '讓他自己過');
  refs.prog = h('i');
  refs.scene = h('figure', { class: 'scene-box', id: 'scene' });
  refs.sceneKey = '';
  refs.panel = h('section', { class: 'panel paper', 'aria-live': 'polite', id: 'panel' });
  refs.child = h('div', { class: 'meters' });
  refs.parent = h('div', { class: 'meters' });
  refs.log = h('ol', { class: 'log' });
  refs.meterBox = h('details', { class: 'paper meter-box', 'aria-label': '狀態' });
  refs.mini = h('span', { class: 'mini' });
  refs.meterBox.append(h('summary', null, h('span', { class: 'sum-t' }, '狀態'), refs.mini),
    h('section', { 'aria-label': '孩子' }, h('h2', { class: 'sec' }, '孩子'), refs.child),
    h('section', { 'aria-label': '你' }, h('h2', { class: 'sec' }, '你'), refs.parent));
  // 寬螢幕展開、手機收合（只在建立時決定，玩家之後自己開關）
  const wide = typeof globalThis.matchMedia === 'function' && globalThis.matchMedia('(min-width: 768px)').matches;
  if (wide) refs.meterBox.setAttribute('open', '');
  refs.logBox = h('details', { class: 'paper log-box', 'aria-label': '聯絡簿' }, h('summary', null, '聯絡簿'), refs.log);
  root.replaceChildren(
    h('div', { class: 'topbar' },
      h('div', { class: 'wrap wide bar' }, refs.age,
        h('div', { class: 'ctrls' },
          h('div', { class: 'seg', role: 'group', 'aria-label': '時間速度' }, refs.speedBtns),
          h('div', { class: 'tools' }, refs.autoBtn, h('button', { 'data-act': 'skip-end', onClick: onSkipEnd }, '直接看結局'), h('button', { 'data-act': 'quit', onClick: onQuit }, '回標題')))),
      h('div', { class: 'progress', role: 'progressbar', 'aria-label': '陪伴的進度' }, refs.prog)),
    h('main', { class: 'wrap wide game layout' },
      h('div', { class: 'side' }, refs.scene, refs.meterBox, refs.logBox),
      refs.panel),
  );
  return refs;
}

/** 場景（DESIGN §8.5）：規格沒變就不重畫，所以選完選項後只有真的變了的地方才會閃一下淡入 */
export function setScene(refs, spec) {
  const svg = sceneSVG(spec);
  if (refs.sceneKey === svg) return;
  refs.sceneKey = svg;
  refs.scene.innerHTML = svg;
}
export function setSpeedButtons(refs, speed) { for (const b of refs.speedBtns) b.setAttribute('aria-pressed', String(+b.dataset.speed === speed)); }
export function setAutoButton(refs, on) { refs.autoBtn.setAttribute('aria-pressed', String(on)); }
export function setHeader(refs, label, progress) {
  refs.age.textContent = label;
  refs.prog.style.width = `${Math.round(Math.max(0, Math.min(1, progress)) * 100)}%`;
}
export function appendLog(refs, text) {
  refs.log.prepend(h('li', null, text));
  while (refs.log.children.length > 5) refs.log.lastChild.remove();
}

const meterRow = (m) => h('div', { class: 'meter' + (m.warn ? ' warn' : ''), role: 'img', 'aria-label': `${m.label}：${m.word}` },
  h('span', { class: 'ml' }, m.label), h('span', { class: 'mb' }, h('i', { style: `width:${m.pct}%` })), h('span', { class: 'mw' }, m.word));
export function renderMeters(refs, mv) {
  refs.child.replaceChildren(...mv.child.map(meterRow));
  refs.parent.replaceChildren(...mv.parent.map(meterRow));
  // 收合時摘要列直接露出 3 個重點：孩子 2 個、你 1 個（警示的優先）
  const pick = (arr, n) => [...arr.filter((m) => m.warn), ...arr.filter((m) => !m.warn)].slice(0, n);
  refs.mini.replaceChildren(...[...pick(mv.child, 2), ...pick(mv.parent, 1)].map((m) =>
    h('span', { class: 'chip' + (m.warn ? ' warn' : ''), 'aria-label': `${m.label}：${m.word}` }, `${m.label} ${m.word}`)));
}

/* 習慣的一句話（M3 B2）：灰色、放在卡片上方；第一個國中回合多一句一次性的說明。只有文字，不含任何隱藏數值 */
const habitNodes = (x) => [x.habitExplainer, x.habitLine].filter(Boolean).map((t) => h('p', { class: 'habit muted' }, t));

/* 面板：卡片 → 劑量表 → 時間流動 */
export function showCard(refs, card, eyebrow, onChoose) {
  // 注意：按鈕上只放顯示順序（data-pos），不放選項在資料裡的原始索引——原始索引洩漏了寫卡時的排列。點下去的對應關係只留在閉包裡。
  refs.panel.replaceChildren(
    h('div', { class: 'eyebrow' }, eyebrow),
    ...habitNodes(card),
    h('h2', { id: 'card-title' }, card.title),
    ...(card.loads || []).map((t) => h('p', { class: 'load muted' }, t)),
    h('p', { class: 'body' }, card.text),
    h('div', { class: 'choices' }, card.choices.map((c) =>
      h('button', { class: 'choice', 'data-act': 'choice', 'data-pos': c.pos, disabled: c.disabled, onClick: () => onChoose(c) },
        h('span', { class: 'lab' }, c.label), c.disabled && h('span', { class: 'why' }, `（${c.reason}）`)))));
  const first = refs.panel.querySelector('.choice:not([disabled])');
  if (first) first.focus({ preventScroll: true });
}
export function markPicked(refs, pos) { const b = refs.panel.querySelector(`.choice[data-pos="${pos}"]`); if (b) b.classList.add('picked'); }

const doseRow = (r) => h('div', { class: 'dose ' + (r.good ? 'good' : 'bad') },
  h('span', { class: 'arrow', 'aria-hidden': 'true' }, r.dir > 0 ? '▲' : '▼'),
  h('span', { class: 'dl' }, r.label),
  h('span', { class: 'dbar', 'aria-hidden': 'true' }, [1, 2, 3].map((n) => h('i', { class: n <= r.level ? 'on' : '' }))),
  h('span', { class: 'sr' }, `${r.dir > 0 ? '上升' : '下降'}${r.level === 3 ? '很多' : r.level === 2 ? '一些' : '一點'}`));
export function showResult(refs, { title, label, result, dose, note }, onNext, nextLabel = '繼續') {
  // dose 為 null：固定事件的回合還有第二張卡，劑量表要等第二張選完才合計
  const any = dose && dose.parent.length + dose.child.length > 0;
  refs.panel.replaceChildren(
    h('div', { class: 'eyebrow' }, title),
    h('p', { class: 'picked-label' }, `你選了：${label}`),
    result && h('p', { class: 'body' }, result),
    note ? h('aside', { class: 'note small', 'aria-label': '研究小卡' }, h('b', null, '研究小卡'), h('span', null, note)) : null,
    dose && h('div', { class: 'dosebox', 'aria-label': dose.period ? `${dose.period}的變化` : '這次的變化' },
      dose.period && any && h('div', { class: 'dperiod small muted' }, `${dose.period}的變化`),
      any ? [
        dose.child.length > 0 && h('div', { class: 'dgroup' }, h('div', { class: 'dh' }, '孩子'), dose.child.map(doseRow)),
        dose.parent.length > 0 && h('div', { class: 'dgroup' }, h('div', { class: 'dh' }, '你'), dose.parent.map(doseRow)),
      ] : h('p', { class: 'muted small' }, '這次看不出什麼明顯的變化。')),
    h('button', { class: 'btn primary block', 'data-act': 'next', onClick: onNext }, nextLabel));
  const b = refs.panel.querySelector('[data-act="next"]'); if (b) b.focus({ preventScroll: true });
}
/* 「這一年」生日小卡（M3 B3）：每個新的一歲開始前，右欄放一張小卡；只有文字與一個像素蛋糕，不含任何分數。
   onContinue／onSkip 由 main.js 接；按鈕的 data-act 是 yearly-continue／yearly-skip。 */
export function showYearly(refs, { name, y, auto = false }, onContinue, onSkip) {
  const f = y.fact;
  refs.panel.replaceChildren(
    h('div', { class: 'yearly' },
      h('div', { class: 'eyebrow' }, '這一年'),
      h('div', { class: 'yearly-head' },
        h('span', { class: 'yearly-ico', 'aria-hidden': 'true', html: _icons.cake() }),
        h('h2', { id: 'yearly-title' }, `${name} ${y.age} 歲了`)),
      y.events.length > 0
        ? h('ul', { class: 'yearly-events', 'aria-label': '這一年發生的事' }, y.events.map((e) => h('li', null, h('b', null, e.title), '　', e.label)))
        : h('p', { class: 'yearly-events muted' }, '這一年過得平平靜靜。'),
      f && h('aside', { class: 'yearly-fact', 'aria-label': '你知道嗎' },
        h('div', { class: 'yearly-q' }, '你知道嗎'),
        h('p', null, f.text),
        h('div', { class: 'small muted yearly-src' }, `${f.source.who}・${f.source.year}`)),
      y.together && h('p', { class: 'small muted' }, y.together),
      h('div', { class: 'yearly-btns' },
        h('button', { class: 'btn primary', 'data-act': 'yearly-continue', onClick: onContinue }, '繼續'),
        h('button', { class: 'btn', 'data-act': 'yearly-skip', onClick: onSkip }, '以後都跳過')),
      auto && h('p', { class: 'small muted yearly-auto' }, '讓他自己過的時候，這張小卡停 3 秒就繼續。')));
  const b = refs.panel.querySelector('[data-act="yearly-continue"]'); if (b) b.focus({ preventScroll: true });
}
export function showQuiet(refs, eyebrow, text, onNext, habit = {}) {
  refs.panel.replaceChildren(h('div', { class: 'eyebrow' }, eyebrow), ...habitNodes(habit), h('p', { class: 'body' }, text),
    h('button', { class: 'btn primary block', 'data-act': 'next', onClick: onNext }, '繼續'));
  const b = refs.panel.querySelector('[data-act="next"]'); if (b) b.focus({ preventScroll: true });
}
export function showTime(refs, { from, to, line }, onSkip) {
  refs.panel.replaceChildren(h('div', { class: 'eyebrow' }, '時間一點一點過去'),
    h('p', { class: 'body time' }, `${from} → ${to}`), line && h('p', { class: 'muted small' }, line),
    h('div', { class: 'tick', 'aria-hidden': 'true' }, h('i', { id: 'tick-bar' })),
    h('button', { class: 'btn block', 'data-act': 'skip-time', onClick: onSkip }, '直接到下一回'));
}
export function setTick(refs, frac) { const b = refs.panel.querySelector('#tick-bar'); if (b) b.style.width = `${Math.round(frac * 100)}%`; }

/* ───────────── 終局 ───────────── */
const bar3 = (label, v, hint) => h('div', { class: 'wb' }, h('div', { class: 'wl' }, label), h('div', { class: 'wbar', role: 'img', 'aria-label': `${label}` }, h('i', { style: `width:${Math.round(v / 5) * 5}%` })), hint && h('div', { class: 'small muted' }, hint));
const wbWord = (v) => (v >= 70 ? '很好' : v >= 55 ? '還不錯' : v >= 42 ? '普通' : '吃力');

export function spark(key, s) {
  const pts = s.pts.filter((x) => x != null);
  const W = 180, Hh = 46;
  const x = (i) => (pts.length > 1 ? (i / (pts.length - 1)) * (W - 4) + 2 : W / 2);
  const y = (v) => Hh - 3 - (Math.max(0, Math.min(100, v)) / 100) * (Hh - 6);
  const d = pts.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', `0 0 ${W} ${Hh}`); svg.setAttribute('class', 'spark'); svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', `${key}：從 ${Math.round(s.start)} 到 ${Math.round(s.end)}`);
  const mid = document.createElementNS(ns, 'line');
  for (const [k, v] of Object.entries({ x1: 0, x2: W, y1: y(50), y2: y(50), class: 'mid' })) mid.setAttribute(k, v);
  const pl = document.createElementNS(ns, 'polyline');
  pl.setAttribute('points', d); pl.setAttribute('class', 'line ' + (s.good ? 'up' : 'dn')); pl.setAttribute('fill', 'none');
  svg.append(mid, pl);
  return svg;
}

/** 決定鏈的小曲線：整個童年的一條隱藏數值，這一段的起訖用底色標出來（橫軸是月齡，不是筆數） */
export function chainSpark(c) {
  const cv = c.curve, pts = cv.pts, W = 200, Hh = 54;
  const m0 = pts[0].m, m1 = pts[pts.length - 1].m || 1;
  const x = (m) => 2 + ((m - m0) / Math.max(1, m1 - m0)) * (W - 4);
  const y = (v) => Hh - 3 - (Math.max(0, Math.min(100, v)) / 100) * (Hh - 6);
  const ns = 'http://www.w3.org/2000/svg', el = (t, a) => { const n = document.createElementNS(ns, t); for (const [k, v] of Object.entries(a)) n.setAttribute(k, v); return n; };
  const svg = el('svg', { viewBox: `0 0 ${W} ${Hh}`, class: 'spark chain-spark', role: 'img', 'aria-label': `${cv.node}：${c.ages}這段從 ${cv.v0} 到 ${cv.v1}` });
  svg.append(
    el('rect', { x: x(c.m0).toFixed(1), y: 0, width: Math.max(3, x(Math.max(c.m1, cv.m1)) - x(c.m0)).toFixed(1), height: Hh, class: 'win' }),
    el('line', { x1: 0, x2: W, y1: y(50), y2: y(50), class: 'mid' }),
    el('polyline', { points: pts.map((p) => `${x(p.m).toFixed(1)},${y(p.v).toFixed(1)}`).join(' '), class: 'line ' + (cv.up ? 'up' : 'dn'), fill: 'none' }),
    el('circle', { cx: x(cv.m0).toFixed(1), cy: y(cv.v0).toFixed(1), r: 3, class: 'dot' }),
    el('circle', { cx: x(cv.m1).toFixed(1), cy: y(cv.v1).toFixed(1), r: 3, class: 'dot' }));
  return svg;
}

/** 一條決定鏈：年齡、處境、選擇、曲線、後來的痕跡、研究小卡（DESIGN §11、§7.4）。陳述，不責備 */
export function chainCard(c) {
  const r = c.research;
  return h('article', { class: 'chain ' + (c.positive ? 'pos' : 'neg'), 'data-theme': c.theme },
    h('div', { class: 'chain-head' }, h('b', null, c.ages), h('span', { class: 'chain-theme' }, c.label), h('span', { class: 'chain-dir' }, c.positive ? '往好的方向' : '往吃力的方向')),
    c.situation && h('p', { class: 'small muted chain-sit' }, c.situation),
    h('ol', { class: 'chain-choices' }, c.choices.map((x) => h('li', { class: x.auto ? 'auto' : '' }, h('span', { class: 'age' }, x.age), '　', x.text,
      x.formedBy && x.formedBy.length > 0 && h('div', { class: 'small muted formed' }, '這個習慣是這幾次形成的：' + x.formedBy.map((f) => `${f.age}「${f.text}」`).join('、'))))),
    c.curve && h('figure', { class: 'chain-fig' }, chainSpark(c), h('figcaption', { class: 'small muted' }, `${c.curve.node}　${c.curve.v0} → ${c.curve.v1}（底色是這一段）`)),
    c.trace && h('p', { class: 'chain-trace small' }, h('b', null, '後來　'), c.trace.text),
    r && h('div', { class: 'research' },
      h('div', { class: 'rh' }, h('b', null, '研究怎麼說'), h('span', { class: 'level', title: r.strength }, `證據強度：${r.level}`)),
      h('p', { class: 'small' }, r.plain),
      r.facts && r.facts.length > 0 && h('p', { class: 'small muted' }, r.facts[0].text, '（', r.facts[0].url ? h('a', { href: r.facts[0].url, target: '_blank', rel: 'noopener' }, r.facts[0].cite) : r.facts[0].cite, '）'),
      h('p', { class: 'small try' }, h('b', null, '下一次可以試試　'), r.tip),
      (r.limits || c.note) && h('details', { class: 'small muted' }, h('summary', null, '限制'), r.limits, c.note && h('div', null, c.note))));
}

/** 「這些年，孩子的班上」：只陳述發生過的事，不下結論（DESIGN §1 第二主軸） */
export function classroomCard(cl) {
  return h('article', { class: 'chain classroom', id: 'ending-classroom' }, h('div', { class: 'chain-head' }, h('b', null, '這些年，孩子的班上')),
    h('ul', { class: 'cl-lines' }, cl.lines.map((l) => h('li', null, l))));
}

export function renderEnding(root, e, { seed, onSame, onNew, portrait, album, yearly = [] }) {
  const w = e.wellbeing;
  root.replaceChildren(h('main', { class: 'wrap end wide stack' },
    h('header', { class: 'head' }, h('div', { class: 'small muted' }, `陪伴到：${e.to}`), h('h1', null, '你們一起的樣子')),
    h('div', { class: 'end-top' },
    portrait && h('section', { class: 'paper', id: 'ending-portrait' },
      h('h2', { class: 'sec' }, '全家福'),
      h('figure', { class: 'portrait', html: portrait }),
      album && album.length > 0 && h('ol', { class: 'album', 'aria-label': '成長相簿' }, album.map((a) => h('li', null, h('span', { html: a.svg }), a.label)))),
    h('section', { class: 'paper', id: 'ending-wellbeing' },
      h('h2', { class: 'sec' }, '你們一起的幸福'),
      h('p', { class: 'big' }, e.line),
      e.lines.filter((l) => l.facet === '親子' || l.facet === '人際').map((l) => h('p', { class: 'small' }, l.text)),
      bar3(`${e.name}`, w.child, wbWord(w.child)), bar3('你', w.parent, wbWord(w.parent)), bar3('你們之間', w.between, wbWord(w.between)))),
    h('section', { class: 'paper', id: 'ending-growth' },
      h('h2', { class: 'sec' }, '你也重新長大了一次'),
      e.growth.lines.length > 0
        ? h('div', null, h('p', { class: 'muted small' }, '陪著孩子的這些年，你自己也跟著學了、玩了一些新東西：'), h('ul', null, e.growth.lines.map((l) => h('li', null, l))))
        : h('p', null, e.growth.none)),
    h('section', { class: 'paper stack', id: 'ending-chains' },
      h('h2', { class: 'sec' }, '回頭看'),
      h('p', { class: 'small muted' }, '單一個決定很少改變什麼；改變軌跡的是同一個方向、連續好幾次的小決定。當時那樣選，多半有當時的理由——累、忙、資訊不夠。下面把這些年連續出現的做法串起來。'),
      e.chains && e.chains.length > 0
        ? h('div', { class: 'chains' }, e.chains.map(chainCard), e.classroom && classroomCard(e.classroom))
        : h('div', { class: 'chains' }, h('p', null, '這一局沒有哪一種做法連續出現三次以上。大多數的日子，是一次一次不一樣的選擇。'), e.classroom && classroomCard(e.classroom))),
    h('section', { class: 'paper', id: 'ending-achievement' },
      h('h2', { class: 'sec' }, '孩子的學習與去向'),
      h('p', null, `${e.name}：${e.achievement.scoreWord}。`), e.lines.filter((l) => l.facet === '學習').map((l) => h('p', { class: 'small' }, l.text)), h('p', { class: 'muted small' }, e.achievement.note),
      h('p', { class: 'muted small' }, '這一項和上面的幸福分開看，兩者沒有直接加減。')),
    h('section', { class: 'paper stack', id: 'ending-review' },
      h('h2', { class: 'sec' }, '回頭看：所有的曲線'),
      h('p', { class: 'small muted' }, '遊戲中一直看不到的東西，現在攤開來。每一條曲線是這些年的變化，橫線是中間值。'),
      h('div', { class: 'route' }, h('h3', null, '你這幾年陪伴的位置'),
        bar3('溫暖陪伴', e.route.warm), bar3('規範監督', e.route.firm), bar3('替他做主', e.route.control),
        h('p', { class: 'big2' }, e.route.name), h('p', { class: 'small muted' }, '這個位置是你每個小決定累積出來的，沒有人替你選過。')),
      e.moments.length > 0 && h('div', null, h('h3', null, '影響最大的幾個時刻'),
        h('ul', { class: 'moments' }, e.moments.map((m) => h('li', null, h('b', null, `${m.when}・${m.title}`), h('div', null, `你選了：${m.label}`),
          m.did.length > 0 && h('div', { class: 'small muted' }, `這個選擇做的事：${m.did.join('、')}`),
          m.moved.length > 0 && h('div', { class: 'small muted' }, `影響到：${m.moved.map((x) => `${x.key}${x.dir > 0 ? '↑' : '↓'}`).join('、')}`))))),
      REVEAL_GROUPS.map((g) => h('div', { class: 'cgroup' }, h('h3', null, g.title),
        h('div', { class: 'curves' }, g.keys.map((k) => { const s = e.series[k]; return h('div', { class: 'curve' }, h('div', { class: 'cap' }, `${k}　${Math.round(s.start)} → ${Math.round(s.end)}`), spark(k, s)); }))))),
    yearly.length > 0 && h('details', { class: 'paper yearly-seen', id: 'ending-yearly' }, h('summary', null, '這些年你看過的小知識'),
      h('ul', null, yearly.map((x) => h('li', null, h('b', null, `${x.age} 歲`), '　', x.text, h('span', { class: 'small muted' }, `（${x.who}・${x.year}）`))))),
    h('section', { class: 'paper', id: 'ending-resources' }, h('h2', { class: 'sec' }, '如果你或孩子需要幫忙'),
      h('ul', null, e.resources.map((r) => h('li', null, h('b', null, r.name), r.tel && `　${r.tel}`, h('div', { class: 'small muted' }, r.note)))),
      h('p', { class: 'small muted' }, e.reminder)),
    h('div', { class: 'btns' },
      h('button', { class: 'btn block', 'data-act': 'same', onClick: onSame }, '同一個家庭再來一次'),
      h('button', { class: 'btn primary block', 'data-act': 'new', onClick: onNew }, '換一個家庭')),
    h('p', { class: 'small muted' }, `人生編號 ${seed}`),
  ));
}
