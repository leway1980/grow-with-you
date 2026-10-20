// 開場狀態視窗的 16×16 像素小圖示（純函式、無 DOM、不用外部圖片）：回傳 SVG 字串。
// 顏色全用 --sc-* 變數（淺色／深色各一組）或固定的膚色、髮色；外框是暖褐色，所以深色模式也看得清楚。
// 一律 aria-hidden：文字標籤才是無障礙的內容。
const SZ = 16;
const PAL = {
  s: '#f2cfae', h: '#5a3b28', g: '#d6d1c8', e: '#3b2a24', p: '#f4bdb4', m: 'var(--sc-mouth)',
  r: 'var(--sc-red)', y: 'var(--sc-sun)', b: 'var(--sc-c3)', G: 'var(--sc-c4)', w: 'var(--sc-paperw)', M: 'var(--sc-metal)',
  W: 'var(--sc-wood)', n: 'var(--sc-wood2)', P: 'var(--sc-c5)', O: 'var(--sc-ball)', K: 'var(--sc-c6)', d: 'var(--sc-p1)',
  u: 'var(--sc-skyd)', c: 'var(--sc-c2)', k: 'var(--sc-c1)', L: 'var(--sc-leaf)', l: 'var(--sc-leaf2)', C: 'var(--sc-pet1)',
  D: 'var(--sc-pet2)', f: 'var(--sc-fish)', t: 'var(--sc-water)', S: 'var(--sc-skyline)', o: 'var(--sc-frame)', B: 'var(--sc-brick)', R: 'var(--sc-roof)',
};
const blank = () => Array.from({ length: SZ }, () => Array(SZ).fill(null));
const put = (g, x, y, c) => { if (c && x >= 0 && x < SZ && y >= 0 && y < SZ) g[y][x] = c; };
const rect = (g, x, y, w, h, c) => { for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) put(g, x + i, y + j, c); };
const disc = (g, cx, cy, r, c) => { for (let y = 0; y < SZ; y++) for (let x = 0; x < SZ; x++) if ((x - cx) ** 2 + (y - cy) ** 2 <= r * r) put(g, x, y, c); };
/** 字串圖：'.' 透明，其他字元查 PAL */
const art = (rows, g = blank()) => { rows.forEach((row, y) => { for (let x = 0; x < SZ; x++) { const ch = row[x]; if (ch && ch !== '.' && PAL[ch]) put(g, x, y, ch); } }); return g; };
/** 在所有有色格的外圈加 1px 暖褐外框 */
const outline = (g) => {
  const add = [];
  for (let y = 0; y < SZ; y++) for (let x = 0; x < SZ; x++) if (!g[y][x] && [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => g[y + dy] && g[y + dy][x + dx])) add.push([x, y]);
  for (const [x, y] of add) g[y][x] = 'o';
  return g;
};
const col = (c) => (c.length === 1 ? PAL[c] : c);

function svgOf(g) {
  const rects = [];
  for (let y = 0; y < SZ; y++) {
    let x = 0;
    while (x < SZ) {
      const c = g[y][x];
      if (!c) { x++; continue; }
      let w = 1; while (x + w < SZ && g[y][x + w] === c) w++;
      rects.push(`<rect x="${x}" y="${y}" width="${w}" height="1" fill="${col(c)}"/>`);
      x += w;
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" class="ico" viewBox="0 0 16 16" aria-hidden="true" focusable="false" shape-rendering="crispEdges">${rects.join('')}</svg>`;
}

/* ───────────── 臉（和場景裡的人物同一種畫風：圓角、小圓眼、小彎嘴、淡腮紅） ───────────── */
const SPAN = [[2, 7], [1, 8], [0, 9], [0, 9], [0, 9], [0, 9], [0, 9], [0, 9], [0, 9], [0, 9], [1, 8], [2, 7]];
function face(o) {
  const g = blank(), ox = 3, oy = 3;
  const P = (x, y, c) => put(g, ox + x, oy + y, c);
  const inSp = (x, y) => y >= 0 && y < 12 && x >= SPAN[y][0] && x <= SPAN[y][1];
  for (let y = 0; y < 12; y++) for (let x = SPAN[y][0]; x <= SPAN[y][1]; x++) P(x, y, inSp(x - 1, y) && inSp(x + 1, y) && inSp(x, y - 1) && inSp(x, y + 1) ? 's' : '#d9b697');
  const hc = o.hair || 'h';
  const H = (x0, x1, y) => { for (let x = x0; x <= x1; x++) P(x, y, hc); };
  const top = o.style === 'bald' ? 1 : 3;
  for (let y = 0; y <= top; y++) if (o.style === 'bald' && y < 2) continue; else H(SPAN[y][0], SPAN[y][1], y);
  if (o.style === 'bald') { P(0, 3, hc); P(9, 3, hc); P(0, 4, hc); P(9, 4, hc); P(0, 5, hc); P(9, 5, hc); } else { H(0, 3, 4); H(6, 9, 4); H(0, 0, 5); H(9, 9, 5); }
  if (o.style === 'girl') { for (let y = 5; y <= 9; y++) { P(-1, y, hc); P(10, y, hc); } P(-1, 5, 'K'); P(10, 5, 'K'); }
  if (o.style === 'long') for (let y = 5; y <= 11; y++) { P(0, y, hc); P(9, y, hc); P(-1, y, hc); P(10, y, hc); }
  if (o.style === 'bun') { H(3, 6, -2); H(2, 7, -1); H(2, 7, 0); }
  if (o.style === 'baby') { P(4, -1, hc); P(5, -1, hc); }
  P(2, 7, 'e'); P(2, 8, 'e'); P(7, 7, 'e'); P(7, 8, 'e');
  if (o.bags) { P(1, 9, '#b9a6b8'); P(2, 9, '#b9a6b8'); P(7, 9, '#b9a6b8'); P(8, 9, '#b9a6b8'); } else { P(1, 9, '#f4bdb4'); P(2, 9, '#f4bdb4'); P(7, 9, '#f4bdb4'); P(8, 9, '#f4bdb4'); }
  for (const [x, y] of [[3, 9], [4, 10], [5, 10], [6, 9]]) P(x, y, 'm');
  return g; // 臉自己有外框
}
const faceBaby = (girl) => svgOf(face({ style: girl ? 'girl' : 'baby', hair: 'h' }));
const faceParent = (role) => svgOf(face({ style: role === '爸爸' ? 'boy' : 'bun', hair: 'h' }));
const faceElder = () => svgOf(face({ style: 'bun', hair: 'g' }));

/* ───────────── 物件 ───────────── */
const A = (rows, extra) => { const g = art(rows); if (extra) extra(g); return svgOf(outline(g)); };

const ICONS = {
  cake: () => A(['', '.......y........', '.......y........', '.......b........', '.......b........', '..pppppppppppp..', '..pwpwpwpwpwpp..', '..kkkkkkkkkkkk..', '..kkkkkkkkkkkk..', '..pppppppppppp..', '..cccccccccccc..', '..cccccccccccc..', '.WWWWWWWWWWWWWW.']),
  calendar: () => A(['', '', '...o......o....', '..rrrrrrrrrrrr..', '..rrrrrrrrrrrr..', '..wwwwwwwwwwww..', '..wowowowowoww..', '..wwwwwwwwwwww..', '..wowowrrwowow..', '..wwwwwwwwwwww..', '..wowowowowoww..', '..wwwwwwwwwwww..'], (g) => { put(g, 3, 2, 'M'); put(g, 3, 3, 'M'); put(g, 12, 2, 'M'); put(g, 12, 3, 'M'); }),
  heart: () => A(['', '', '', '...rrr....rrr...', '..rrrrr..rrrrr..', '.rrwrrrrrrrrrrr.', '.rrrrrrrrrrrrrr.', '.rrrrrrrrrrrrrr.', '..rrrrrrrrrrrr..', '...rrrrrrrrrr...', '....rrrrrrrr....', '.....rrrrrr.....', '......rrrr......', '.......rr.......']),
  family: () => { const g = blank(); disc(g, 5, 4, 2, 's'); rect(g, 3, 6, 5, 6, 'd'); disc(g, 11, 6, 2, 's'); rect(g, 9, 8, 5, 4, 'K'); rect(g, 4, 12, 3, 2, 'S'); rect(g, 10, 12, 3, 2, 'S'); rect(g, 3, 2, 5, 2, 'h'); rect(g, 9, 4, 5, 2, 'h'); return svgOf(outline(g)); },
  briefcase: () => A(['', '', '', '.....WWWWWW.....', '.....WW..WW.....', '.....WW..WW.....', '..nnnnnnnnnnnn..', '..nnnnnnnnnnnn..', '..WWWWWyyWWWWW..', '..nnnnnnnnnnnn..', '..nnnnnnnnnnnn..', '..nnnnnnnnnnnn..', '..nnnnnnnnnnnn..']),
  laptop: () => A(['', '', '', '...wwwwwwwwww...', '...wuuuuuuuuw...', '...wuuyuuuuuw...', '...wuuuuuuuuw...', '...wuuuuuuuuw...', '...wwwwwwwwww...', '.MMMMMMMMMMMMMM.', '.MwMwMwMwMwMwMM.', '..MMMMMMMMMMMM..']),
  gear: () => { const g = blank(); disc(g, 8, 8, 5, 'M'); for (const [x, y] of [[7, 1], [8, 1], [7, 14], [8, 14], [1, 7], [1, 8], [14, 7], [14, 8], [3, 3], [12, 3], [3, 12], [12, 12]]) rect(g, x, y, 1, 1, 'M'); rect(g, 7, 2, 2, 2, 'M'); rect(g, 7, 12, 2, 2, 'M'); rect(g, 2, 7, 2, 2, 'M'); rect(g, 12, 7, 2, 2, 'M'); disc(g, 8, 8, 2, 'w'); return svgOf(outline(g)); },
  hammer: () => A(['', '', '..MMMMMMMMMM....', '..MMMMMMMMMMM...', '..MMMMMMMMMMM...', '..MMMMMMMMMM....', '.......WW.......', '.......WW.......', '.......WW.......', '.......WW.......', '.......WW.......', '.......WW.......', '.......nn.......']),
  stall: () => A(['', '', '..rrwwrrwwrrww..', '.rrwwrrwwrrwwrr.', '.rrwwrrwwrrwwrr.', '.rwrwrwrwrwrwrw.', '..n..........n..', '..n..yyOOkk..n..', '..n..........n..', '..WWWWWWWWWWWW..', '..WWWWWWWWWWWW..', '..nnnnnnnnnnnn..', '..n..........n..', '..n..........n..']),
  key: () => A(['', '', '', '', '..yyyyy.........', '.yyyyyyy........', '.yy...yyyyyyyyy.', '.yy...yyyyyyyyy.', '.yyyyyyy..yy.yy.', '..yyyyy...yy.yy.']),
  steth: () => { const g = blank(); for (const x of [3, 11]) rect(g, x, 2, 1, 5, 'M'); put(g, 3, 1, 'd'); put(g, 11, 1, 'd'); rect(g, 4, 7, 1, 1, 'M'); rect(g, 10, 7, 1, 1, 'M'); rect(g, 5, 8, 1, 1, 'M'); rect(g, 9, 8, 1, 1, 'M'); rect(g, 6, 9, 3, 1, 'M'); rect(g, 7, 10, 1, 2, 'M'); disc(g, 9, 13, 2, 'M'); put(g, 9, 13, 'w'); return svgOf(outline(g)); },
  board: () => A(['', '', '', '.wwwwwwwwwwwwww.', '.wLLLLLLLLLLLLw.', '.wLwwwLLLLLLLLw.', '.wLLLLLLLwwwLLw.', '.wLwwwwwLLLLLLw.', '.wLLLLLLLLLLLLw.', '.wwwwwwwwwwwwww.', '.WWWWWWWWWWWWWW.', '..n..........n..', '..n..........n..']),
  wheel: () => { const g = blank(); disc(g, 8, 8, 7, 'd'); disc(g, 8, 8, 4, null); for (let y = 0; y < SZ; y++) for (let x = 0; x < SZ; x++) if ((x - 8) ** 2 + (y - 8) ** 2 <= 16) g[y][x] = null; rect(g, 2, 8, 12, 2, 'd'); rect(g, 7, 9, 2, 5, 'd'); disc(g, 8, 8, 2, 'M'); return svgOf(outline(g)); },
  clock: () => { const g = blank(); disc(g, 8, 8, 6, 'w'); for (const [x, y] of [[8, 3], [8, 13], [3, 8], [13, 8]]) put(g, x, y, 'e'); rect(g, 8, 5, 1, 4, 'e'); rect(g, 8, 8, 3, 1, 'r'); return svgOf(outline(g)); },
  bag: () => A(['', '', '', '......PP.PP.....', '.....P..P..P....', '.....P..P..P....', '...PPPPPPPPPPP..', '...PPPPPPPPPPP..', '...PPPPPPPPPPP..', '...PPyyPPPPPPP..', '...PPPPPPPPPPP..', '...PPPPPPPPPPP..', '...PPPPPPPPPPP..']),
  book: () => A(['', '', '', '', '..bbbbbbbbbbbb..', '.bwwwwwwbwwwwwb.', '.bwooowwbwooowb.', '.bwwwwwwbwwwwwb.', '.bwooowwbwooowb.', '.bwwwwwwbwwwwwb.', '.bwooowwbwooowb.', '..bbbbbbbbbbbb..']),
  badge: () => { const g = blank(); const pts = [[8, 2], [8, 3], [7, 4], [8, 4], [9, 4], [3, 5], [4, 5], [5, 5], [6, 5], [7, 5], [8, 5], [9, 5], [10, 5], [11, 5], [12, 5], [4, 6], [5, 6], [6, 6], [7, 6], [8, 6], [9, 6], [10, 6], [11, 6], [5, 7], [6, 7], [7, 7], [8, 7], [9, 7], [10, 7], [5, 8], [6, 8], [7, 8], [8, 8], [9, 8], [10, 8], [4, 9], [5, 9], [6, 9], [9, 9], [10, 9], [11, 9], [4, 10], [5, 10], [10, 10], [11, 10], [3, 11], [4, 11], [11, 11], [12, 11]]; for (const [x, y] of pts) put(g, x, y, 'y'); return svgOf(outline(g)); },
  person: () => { const g = blank(); disc(g, 8, 5, 3, 'd'); rect(g, 4, 9, 8, 5, 'd'); rect(g, 3, 11, 10, 3, 'd'); return svgOf(outline(g)); },
  apart: () => { const g = blank(); disc(g, 4, 6, 2, 'd'); rect(g, 1, 9, 6, 5, 'd'); disc(g, 12, 6, 2, 'M'); rect(g, 9, 9, 6, 5, 'M'); return svgOf(outline(g)); },
  bow: () => A(['', '', '', '', '...KKK....KKK...', '..KKKKK..KKKKK..', '..KKKKKKKKKKKK..', '..KKKKKKKKKKKK..', '..KKKKK..KKKKK..', '...KKK....KKK...', '.....K....K.....']),
  cap: () => A(['', '', '', '.....bbbbbb.....', '...bbbbbbbbbb...', '..bbbbbbbbbbbb..', '..bbbbbbbbbbbb..', '..bbbbbbbbbbbb..', '..dddddddddddddd', '..dddddddddddd..']),
  pin: () => { const g = blank(); disc(g, 8, 6, 5, 'r'); for (let i = 0; i < 6; i++) rect(g, 8 - (5 - i), 9 + i, (5 - i) * 2, 1, 'r'); rect(g, 5, 9, 6, 1, 'r'); disc(g, 8, 6, 2, 'w'); return svgOf(outline(g)); },
  core: () => A(['', '..S.............', '..SSS......dd...', '..SwSwS....dd...', '..SSSSS..ddddd..', '..SwSwS..dwdwd..', '..SSSSS..ddddd..', '..SwSwSdddwdwd..', '..SSSSSdddddddd.', '..SwSwSdddwdwdd.', '..SSSSSdddddddd.', '..SwSwSdddwdwdd.', '..SSSSSdddddddd.']),
  outer: () => A(['', '', '', '', '.dddddddddd.....', '.dwdwdwdwdd.....', '.dddddddddd.....', '.dwdwdwdwddSSSS.', '.dddddddddSwSwS.', '.dwdwdwdwdSSSSS.', '.dddddddddSwSwS.', '.dddddddddSSSSS.', '.dddddddddSSSSS.']),
  town: () => A(['', '', '', '', '..r.......r.....', '.rrr.....rrr....', 'rrrrr...rrrrr...', 'wwwww...wwwww...', 'wbwbw...wbwbw...', 'wwwww.rrwwwww...', 'wwwww.rrwwwww...', 'wwwwwrrrwwwww...']),
  rural: () => A(['', '', '..........yy....', '.....L....yy....', '....LLL.........', '...LLLLL..rrr...', '...LLLLL.rrrrr..', '.....n...wwwww..', '.....n...wbwbw..', '.....n...wwwww..', 'GGGGGGGGGGGGGGGG', 'GGGGGGGGGGGGGGGG']),
  island: () => A(['', '', '......LL.LL.....', '....LLLLLLLL....', '.....LL.nL.L....', '........n.......', '........n.......', '.......nn.......', '.....yyyyyy.....', '..yyyyyyyyyyyy..', 'tttttttttttttttt', 'tbtbtbtbtbtbtbtb', 'tttttttttttttttt']),
  house: (rent) => A(['', '', '.......rr.......', '......rrrr......', '.....rrrrrr.....', '....rrrrrrrr....', '...rrrrrrrrrr...', '..rrrrrrrrrrrr..', '...wwwwwwwwww...', '...wuuwwwwbbw...', '...wuuwwwwbbw...', '...wwwwwwwbbw...', '...wwwwwwwbbw...'], rent ? (g) => { for (let y = 2; y <= 7; y++) for (let x = 0; x < SZ; x++) if (g[y][x] === 'r') g[y][x] = 'b'; put(g, 11, 10, 'y'); } : null),
  desk: () => A(['', '', '', '..........yyy...', '.........yyyyy..', '..........yyy...', '.....bbbb..yy...', '.....bwwb..yy...', '.WWWWWWWWWWWWWW.', '.nnnnnnnnnnnnnn.', '.nn.......n..nn.', '.nn.......n..nn.', '.nn.......n..nn.', '.nn.........nnn.']),
  scooter: () => { const g = blank(); disc(g, 3, 12, 2, 'e'); disc(g, 13, 12, 2, 'e'); rect(g, 4, 10, 8, 2, 'k'); rect(g, 10, 4, 1, 6, 'M'); rect(g, 9, 4, 4, 1, 'M'); rect(g, 10, 6, 4, 1, 'M'); rect(g, 2, 9, 5, 1, 'k'); rect(g, 5, 7, 4, 3, 'k'); disc(g, 3, 12, 0, 'M'); put(g, 3, 12, 'M'); put(g, 13, 12, 'M'); return svgOf(outline(g)); },
  car: () => A(['', '', '', '', '....kkkkkkk.....', '...kkuukkuukk...', '..kkkuukkuuukk..', '.kkkkkkkkkkkkkk.', '.kkkkkkkkkkkkkk.', '.kkykkkkkkkkykk.', '..ee.......ee...', '..ee.......ee...'], (g) => { rect(g, 3, 11, 3, 2, 'e'); rect(g, 11, 11, 3, 2, 'e'); }),
  bus: () => A(['', '', '', '..GGGGGGGGGGGG..', '..GuuGuuGuuGGG..', '..GuuGuuGuuGGG..', '..GGGGGGGGGGGG..', '..GGGGGGGGGGGG..', '..yGGGGGGGGGGy..', '..GGGGGGGGGGGG..', '..GGGGGGGGGGGG..', '...ee......ee...', '...ee......ee...']),
  elder: faceElder,
  lantern: () => A(['', '......yy........', '......yy........', '....nnnnnn......', '...rrrrrrrr.....', '..rrrryyrrrr....', '..rrryyyyrrr....', '..rrryyyyrrr....', '..rrrryyrrrr....', '...rrrrrrrr.....', '....nnnnnn......', '......yy........', '.....yyyy.......', '......yy........'], (g) => { for (let y = 0; y < SZ; y++) for (let x = 15; x > 0; x--) g[y][x] = g[y][x - 1]; for (let y = 0; y < SZ; y++) g[y][0] = null; }),
  school: () => A(['', '......y.........', '......yyyy......', '......o.........', '...wwwwwwww.....', '..wwwwwwwwww....', '.wwwwwbbwwwww...', '.wuuwwbbwwuuw...', '.wuuwwbbwwuuw...', '.wwwwwbbwwwww...', '.wuuwwbbwwuuw...', '.wwwwwbbwwwww...', '.RRRRRRRRRRRRR..'].map((r) => r.padEnd(16, '.').slice(0, 16)), (g) => { for (let y = 0; y < SZ; y++) for (let x = 14; x > 0; x--) g[y][x + 1] = g[y][x]; for (let y = 0; y < SZ; y++) g[y][0] = null; }),
  paw: () => { const g = blank(); disc(g, 8, 11, 3, 'D'); for (const [x, y] of [[4, 7], [7, 5], [10, 5], [13, 7]]) disc(g, x, y, 1, 'D'); return svgOf(outline(g)); },
  speech: () => A(['', '', '', '..wwwwwwwwwwww..', '.wwwwwwwwwwwwww.', '.wweeweeweewwww.', '.wwwwwwwwwwwwww.', '..wwwwwwwwwwww..', '....ww..........', '...ww...........']),
};

/* ───────────── 寵物（正面臉） ───────────── */
function animal(kind) {
  const g = blank();
  const body = (c) => { rect(g, 3, 6, 10, 7, c); rect(g, 4, 5, 8, 1, c); rect(g, 4, 13, 8, 1, c); };
  switch (kind) {
    case '狗': body('C'); rect(g, 2, 4, 3, 7, 'D'); rect(g, 11, 4, 3, 7, 'D'); rect(g, 6, 10, 4, 3, 'w'); rect(g, 7, 10, 2, 1, 'e'); put(g, 5, 8, 'e'); put(g, 10, 8, 'e'); break;
    case '貓': body('#e0b57a'); put(g, 3, 4, '#e0b57a'); put(g, 4, 3, '#e0b57a'); put(g, 4, 4, '#e0b57a'); put(g, 12, 4, '#e0b57a'); put(g, 11, 3, '#e0b57a'); put(g, 11, 4, '#e0b57a'); rect(g, 5, 8, 1, 2, 'e'); rect(g, 10, 8, 1, 2, 'e'); put(g, 7, 10, 'm'); put(g, 8, 10, 'm'); rect(g, 7, 7, 2, 1, '#c98c58'); break;
    case '倉鼠': body('#e8c89a'); disc(g, 4, 5, 1, 'p'); disc(g, 11, 5, 1, 'p'); rect(g, 4, 10, 3, 2, 'p'); rect(g, 9, 10, 3, 2, 'p'); rect(g, 5, 6, 6, 3, 'w'); put(g, 5, 8, 'e'); put(g, 10, 8, 'e'); put(g, 7, 10, 'm'); put(g, 8, 10, 'm'); break;
    case '兔子': rect(g, 4, 0, 2, 6, 'w'); rect(g, 10, 0, 2, 6, 'w'); rect(g, 4, 1, 1, 4, 'p'); rect(g, 11, 1, 1, 4, 'p'); body('w'); put(g, 5, 8, 'e'); put(g, 10, 8, 'e'); put(g, 7, 10, 'p'); put(g, 8, 10, 'p'); rect(g, 4, 10, 1, 1, 'p'); rect(g, 11, 10, 1, 1, 'p'); break;
    case '烏龜': rect(g, 3, 4, 10, 6, 'L'); rect(g, 4, 3, 8, 1, 'L'); rect(g, 5, 5, 2, 2, 'l'); rect(g, 9, 5, 2, 2, 'l'); rect(g, 7, 4, 2, 1, 'l'); rect(g, 12, 9, 3, 3, 's'); rect(g, 2, 10, 2, 2, 's'); rect(g, 10, 10, 2, 2, 's'); rect(g, 5, 10, 3, 2, 'l'); put(g, 14, 10, 'e'); rect(g, 2, 10, 10, 1, 'L'); break;
    case '魚': rect(g, 2, 3, 12, 11, 't'); rect(g, 3, 4, 10, 8, 'u'); rect(g, 4, 8, 6, 3, 'f'); rect(g, 10, 7, 2, 5, 'f'); rect(g, 9, 9, 1, 1, 'f'); put(g, 5, 9, 'e'); rect(g, 3, 12, 10, 2, 'G'); rect(g, 7, 6, 1, 1, 'w'); break;
    default: body('C'); put(g, 5, 8, 'e'); put(g, 10, 8, 'e');
  }
  return svgOf(outline(g));
}

/* ───────────── 欄位 → 圖示 ───────────── */
const jobIcon = (job = '') => {
  if (/科技業|外商|金融|保險|自由接案/.test(job)) return 'laptop';
  if (/工廠|科技廠/.test(job)) return 'gear';
  if (/水電|裝潢|工地|營造/.test(job)) return 'hammer';
  if (/早餐|小吃|攤商|美髮|美甲|便利商店|門市/.test(job)) return 'stall';
  if (/房仲/.test(job)) return 'key';
  if (/醫生|護理|藥師|醫檢|照服/.test(job)) return 'steth';
  if (/教師|教授/.test(job)) return 'board';
  if (/計程車|貨運|外送/.test(job)) return 'wheel';
  return 'briefcase';
};
export const jobIconName = jobIcon;
const URBAN = { 都會核心: 'core', 都會外圍: 'outer', 中小城鎮: 'town', 偏鄉: 'rural', 離島: 'island' };
const COINS = { 吃緊: 1, 小康: 2, 寬裕: 3 };
function coins(n) {
  const g = blank();
  for (let i = 0; i < n; i++) { const y = 11 - 3 * i; rect(g, 3, y, 10, 3, 'c'); rect(g, 4, y - 1, 8, 1, 'c'); rect(g, 4, y, 8, 1, 'y'); rect(g, 6, y + 1, 1, 1, 'y'); }
  return svgOf(outline(g));
}
const vehicle = (t = '') => (t.startsWith('汽車') ? 'car' : t.startsWith('機車') ? 'scooter' : 'bus');

/** 狀態視窗的一列要配哪個圖示（回傳 SVG 字串；沒有對應就回空字串）。sec：{title, rows}，k：標籤，v：數值（文字不變）。 */
export function rowIcon(sec, k, v) {
  const val = String(v || '');
  const sexRow = (sec.rows.find((r) => r[0] === '性別') || [])[1];
  const girl = sexRow === '女孩';
  const I = (n, ...a) => (typeof ICONS[n] === 'function' ? ICONS[n](...a) : '');
  switch (sec.title) {
    case '孩子':
      return k === '名字' ? faceBaby(girl) : k === '性別' ? I(girl ? 'bow' : 'cap') : k === '出生月份' ? I('calendar') : k === '氣質' ? I('heart') : k === '排行／手足' ? I('family') : '';
    case '你':
      return k === '身分' ? faceParent(val) : k === '職業' ? I(jobIcon(val)) : k === '職位' ? I('badge') : k === '工時型態' ? I('clock') : k === '回家帶不帶工作' ? I('bag') : k === '教養背景' ? I('book') : '';
    case '另一半':
      return k === '職業' ? I(jobIcon(val)) : k === '現況' ? I(/分開|外地/.test(val) ? 'apart' : 'person') : k === '對教養的態度' ? I('speech') : '';
    case '家': {
      switch (k) {
        case '地點': return I('pin');
        case '城鄉': return I(URBAN[val] || 'town');
        case '經濟': return coins(COINS[val] || 2);
        case '家庭型態': return I('family');
        case '住屋': return I('house', /租/.test(val));
        case '孩子寫功課的地方': return I('desk');
        case '交通': return I(vehicle(val));
        case '長輩': return faceElder();
        case '寵物': return val === '沒有' ? I('paw') : animal(val.replace(/「.*/, ''));
        case '族群與文化': return I('lantern');
        default: return '';
      }
    }
    case '學區': return I('school');
    default: return '';
  }
}
export const ICON_NAMES = Object.keys(ICONS);
export const petIcon = animal;
export { ICONS as _icons, faceBaby, faceParent, faceElder, coins };
