// 測試用的極小 DOM：只實作 js/ui.js 與 js/main.js 用到的部分，讓沒有瀏覽器的 Node 也能把畫面「畫出來」檢查文字、屬性與順序。
// 不是通用 DOM；真實瀏覽器的檢查見 README 的 Playwright 做法。

export class FNode {
  constructor(tag, ns = null) {
    this.tagName = tag; this.namespace = ns; this.attrs = {}; this.children = []; this.parent = null; this.listeners = {};
    this.className = ''; this.style = {}; this._text = null; this.nodeType = 1; this.disabled = false;
    const self = this;
    this.classList = { add: (c) => { self.className = (self.className + ' ' + c).trim(); }, remove: (c) => { self.className = self.className.split(' ').filter((x) => x && x !== c).join(' '); }, contains: (c) => self.className.split(' ').includes(c) };
  }
  setAttribute(k, v) { this.attrs[k] = String(v); if (k === 'disabled') this.disabled = true; }
  getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; }
  addEventListener(ev, fn) { (this.listeners[ev] ||= []).push(fn); }
  append(...kids) { for (const k of kids) { if (k == null) continue; k.parent = this; this.children.push(k); } }
  prepend(...kids) { for (const k of kids) { k.parent = this; this.children.unshift(k); } }
  replaceChildren(...kids) { this.children = []; this.append(...kids.flat()); }
  remove() { if (this.parent) this.parent.children = this.parent.children.filter((c) => c !== this); }
  get lastChild() { return this.children[this.children.length - 1]; }
  focus() {}
  set innerHTML(v) { this._html = v; }
  set textContent(v) { this.children = []; this._text = String(v); }
  get textContent() { return this._text != null ? this._text : this.children.map((c) => c.textContent).join(''); }
  click() { for (const fn of this.listeners.click || []) fn({ target: this }); }
  /** 所有後代（含自己） */
  all() { return [this, ...this.children.flatMap((c) => (c.all ? c.all() : []))]; }
  querySelectorAll(sel) { return this.all().slice(1).filter((n) => matches(n, sel)); }
  querySelector(sel) { return this.querySelectorAll(sel)[0] || null; }
}
class FText { constructor(t) { this.nodeType = 3; this._text = t; this.parent = null; } get textContent() { return this._text; } }

// 支援：tag、.class、#id、[attr]、[attr="v"]、:not([attr])，可以串在一起
function matches(n, sel) {
  const re = /(^[a-zA-Z0-9]+)|\.([^.#[:]+)|#([^.#[:]+)|\[([^\]=]+)(?:="([^"]*)")?\]|:not\(\[([^\]]+)\]\)/g;
  let m;
  while ((m = re.exec(sel))) {
    if (m[1] && n.tagName !== m[1]) return false;
    if (m[2] && !n.classList.contains(m[2])) return false;
    if (m[3] && n.attrs.id !== m[3]) return false;
    if (m[4]) { const has = m[4] in n.attrs; if (!has) return false; if (m[5] !== undefined && n.attrs[m[4]] !== m[5]) return false; }
    if (m[6] && m[6] in n.attrs) return false;
  }
  return true;
}

export function installFakeDom({ search = '' } = {}) {
  const root = new FNode('div'); root.attrs.id = 'app';
  const doc = {
    createElement: (t) => new FNode(t),
    createElementNS: (ns, t) => new FNode(t, ns),
    createTextNode: (t) => new FText(String(t)),
    getElementById: (id) => (id === 'app' ? root : null),
  };
  globalThis.document = doc;
  globalThis.window = globalThis;
  globalThis.location = { search };
  globalThis.scrollTo = () => {};
  globalThis.confirm = () => true;
  return { root, doc };
}
export function uninstallFakeDom() { for (const k of ['document', 'window', 'location', 'scrollTo', 'confirm', '__gwy']) delete globalThis[k]; }

/** 一棵樹裡所有文字與所有屬性（名稱與值）——拿來檢查有沒有洩漏 */
export function dump(node) {
  const text = node.textContent;
  const attrs = node.all().flatMap((n) => Object.entries(n.attrs).filter(([k]) => k !== 'aria-hidden').map(([k, v]) => `${k}=${v}`)); // aria-hidden 是無障礙屬性，不是隱藏數值
  const classes = node.all().map((n) => n.className).filter(Boolean);
  return { text, attrs, classes, all: [text, ...attrs, ...classes].join('\n') };
}
