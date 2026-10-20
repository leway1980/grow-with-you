// 畫面元件。沿用《高中，只有一次》(leway1980/Game 47wan @ ce1d972) ui.js 的 h() 小工具與畫面拆法（標題、開場、遊戲、終局）；
// 改為親子遊戲：數值條只畫長條與一個字，劑量表只畫 ▲▼ 與格數，隱藏數值在終局之前不會出現在任何元素裡。
import { REVEAL_GROUPS } from './engine/ending.js';

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

export function renderIntro(root, { paras, tags, seed, role, startMode, onRole, onMode, onStart, onReroll }) {
  const seg = (items, cur, on, label) => h('div', { class: 'seg wide', role: 'group', 'aria-label': label },
    items.map(([v, t]) => h('button', { 'data-v': v, 'aria-pressed': String(v === cur), onClick: () => on(v) }, t)));
  root.replaceChildren(h('main', { class: 'wrap intro stack' },
    h('div', { class: 'paper opening' }, paras.map((p, i) => h('p', { class: i === 0 ? 'big' : '' }, p)),
      h('div', { class: 'tags' }, tags.map((t) => h('span', { class: 'tag' }, t)))),
    h('div', { class: 'paper stack' },
      h('div', null, h('div', { class: 'small muted' }, '你是'), seg([['爸爸', '爸爸'], ['媽媽', '媽媽']], role, onRole, '你是爸爸還是媽媽')),
      h('div', null, h('div', { class: 'small muted' }, '從哪裡開始'), seg([['birth', '從出生開始'], ['elementary', '從國小開始']], startMode, onMode, '起點')),
    ),
    h('div', { class: 'actions' },
      h('button', { class: 'btn primary block', 'data-act': 'start', onClick: onStart }, '開始陪伴'),
      h('button', { class: 'btn block', 'data-act': 'reroll', onClick: onReroll }, '換一個家庭')),
    h('p', { class: 'small muted' }, `人生編號 ${seed}（網址加 ?seed=${seed} 可以重來同一個家庭）`),
  ));
}

/* ───────────── 遊戲畫面 ───────────── */
export function renderGame(root, { speed, onSpeed, onAuto, onSkipEnd, onQuit }) {
  const refs = {};
  refs.age = h('div', { class: 'date', id: 'age-label' });
  refs.speedBtns = [[0, '暫停'], [1, '1×'], [2, '2×'], [4, '4×']].map(([v, t]) => h('button', { 'data-speed': v, 'aria-pressed': String(v === speed), onClick: () => onSpeed(v) }, t));
  refs.autoBtn = h('button', { 'data-act': 'auto', 'aria-pressed': 'false', onClick: onAuto }, '讓他自己過');
  refs.prog = h('i');
  refs.panel = h('section', { class: 'panel paper', 'aria-live': 'polite', id: 'panel' });
  refs.child = h('div', { class: 'meters' });
  refs.parent = h('div', { class: 'meters' });
  refs.log = h('ol', { class: 'log' });
  root.replaceChildren(
    h('div', { class: 'topbar' },
      h('div', { class: 'wrap bar' }, refs.age, h('div', { class: 'seg', role: 'group', 'aria-label': '時間速度' }, refs.speedBtns)),
      h('div', { class: 'wrap bar tools' }, refs.autoBtn, h('button', { 'data-act': 'skip-end', onClick: onSkipEnd }, '直接看結局'), h('button', { 'data-act': 'quit', onClick: onQuit }, '回標題')),
      h('div', { class: 'progress', role: 'progressbar', 'aria-label': '陪伴的進度' }, refs.prog)),
    h('main', { class: 'wrap game' },
      refs.panel,
      h('div', { class: 'two-col' },
        h('section', { class: 'paper', 'aria-label': '孩子' }, h('h2', { class: 'sec' }, '孩子'), refs.child),
        h('section', { class: 'paper', 'aria-label': '你' }, h('h2', { class: 'sec' }, '你'), refs.parent)),
      h('section', { class: 'paper', 'aria-label': '聯絡簿' }, h('h2', { class: 'sec' }, '聯絡簿'), refs.log)),
  );
  return refs;
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
}

/* 面板：卡片 → 劑量表 → 時間流動 */
export function showCard(refs, card, eyebrow, onChoose) {
  // 注意：按鈕上只放顯示順序（data-pos），不放選項在資料裡的原始索引——原始索引洩漏了寫卡時的排列。點下去的對應關係只留在閉包裡。
  refs.panel.replaceChildren(
    h('div', { class: 'eyebrow' }, eyebrow),
    h('h2', { id: 'card-title' }, card.title),
    (card.loads || []).map((t) => h('p', { class: 'load muted' }, t)),
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
export function showResult(refs, { title, label, result, dose }, onNext, nextLabel = '繼續') {
  // dose 為 null：固定事件的回合還有第二張卡，劑量表要等第二張選完才合計
  const any = dose && dose.parent.length + dose.child.length > 0;
  refs.panel.replaceChildren(
    h('div', { class: 'eyebrow' }, title),
    h('p', { class: 'picked-label' }, `你選了：${label}`),
    result && h('p', { class: 'body' }, result),
    dose && h('div', { class: 'dosebox', 'aria-label': '這次的變化' },
      any ? [
        dose.child.length > 0 && h('div', { class: 'dgroup' }, h('div', { class: 'dh' }, '孩子'), dose.child.map(doseRow)),
        dose.parent.length > 0 && h('div', { class: 'dgroup' }, h('div', { class: 'dh' }, '你'), dose.parent.map(doseRow)),
      ] : h('p', { class: 'muted small' }, '這次看不出什麼明顯的變化。')),
    h('button', { class: 'btn primary block', 'data-act': 'next', onClick: onNext }, nextLabel));
  const b = refs.panel.querySelector('[data-act="next"]'); if (b) b.focus({ preventScroll: true });
}
export function showQuiet(refs, eyebrow, text, onNext) {
  refs.panel.replaceChildren(h('div', { class: 'eyebrow' }, eyebrow), h('p', { class: 'body' }, text),
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

export function renderEnding(root, e, { seed, onSame, onNew }) {
  const w = e.wellbeing;
  root.replaceChildren(h('main', { class: 'wrap end stack' },
    h('header', { class: 'head' }, h('div', { class: 'small muted' }, `陪伴到：${e.to}`), h('h1', null, '你們一起的樣子')),
    h('section', { class: 'paper', id: 'ending-wellbeing' },
      h('h2', { class: 'sec' }, '你們一起的幸福'),
      h('p', { class: 'big' }, e.line),
      bar3(`${e.name}`, w.child, wbWord(w.child)), bar3('你', w.parent, wbWord(w.parent)), bar3('你們之間', w.between, wbWord(w.between))),
    h('section', { class: 'paper', id: 'ending-growth' },
      h('h2', { class: 'sec' }, '你也重新長大了一次'),
      e.growth.lines.length > 0
        ? h('div', null, h('p', { class: 'muted small' }, '陪著孩子的這些年，你自己也跟著學了、玩了一些新東西：'), h('ul', null, e.growth.lines.map((l) => h('li', null, l))))
        : h('p', null, e.growth.none)),
    h('section', { class: 'paper', id: 'ending-achievement' },
      h('h2', { class: 'sec' }, '孩子的學習與去向'),
      h('p', null, `${e.name}：${e.achievement.scoreWord}。`), h('p', { class: 'muted small' }, e.achievement.note),
      h('p', { class: 'muted small' }, '這一項和上面的幸福分開看，兩者沒有直接加減。')),
    h('section', { class: 'paper stack', id: 'ending-review' },
      h('h2', { class: 'sec' }, '回頭看'),
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
    h('section', { class: 'paper', id: 'ending-resources' }, h('h2', { class: 'sec' }, '如果你或孩子需要幫忙'),
      h('ul', null, e.resources.map((r) => h('li', null, h('b', null, r.name), r.tel && `　${r.tel}`, h('div', { class: 'small muted' }, r.note)))),
      h('p', { class: 'small muted' }, e.reminder)),
    h('div', { class: 'btns' },
      h('button', { class: 'btn block', 'data-act': 'same', onClick: onSame }, '同一個家庭再來一次'),
      h('button', { class: 'btn primary block', 'data-act': 'new', onClick: onNew }, '換一個家庭')),
    h('p', { class: 'small muted' }, `人生編號 ${seed}`),
  ));
}
