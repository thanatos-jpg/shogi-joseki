/*
 * 将棋エンジン（盤面・合法手生成・棋譜表記の生成/解析）
 * ブラウザでも Node でも動く。座標は x=筋(1..9), y=段(1..9)。
 * 先手(▲)は下から上へ進む。盤面は board[y][x]。
 * 駒は文字列: 先手=大文字, 後手=小文字, 成駒は先頭に '+'（例: 'P', 'p', '+B'）。
 */
(function (g) {
  'use strict';

  const B = 'b';
  const W = 'w';
  const opp = (c) => (c === B ? W : B);

  const FILE_NUM = '１２３４５６７８９';
  const RANK_NUM = '一二三四五六七八九';
  const NAME = { P: '歩', L: '香', N: '桂', S: '銀', G: '金', B: '角', R: '飛', K: '玉',
    '+P': 'と', '+L': '成香', '+N': '成桂', '+S': '成銀', '+B': '馬', '+R': '竜' };
  const SHORT = Object.assign({}, NAME, { '+L': '杏', '+N': '圭', '+S': '全' });
  const PIECE_BY_NAME = { 歩: 'P', 香: 'L', 桂: 'N', 銀: 'S', 金: 'G', 角: 'B', 飛: 'R', 玉: 'K', 王: 'K',
    と: '+P', 成香: '+L', 成桂: '+N', 成銀: '+S', 馬: '+B', 竜: '+R', 龍: '+R' };
  const HAND_ORDER = ['R', 'B', 'G', 'S', 'N', 'L', 'P'];

  const mk = (c, t, pro) => (pro ? '+' : '') + (c === B ? t : t.toLowerCase());
  const lastCh = (s) => s[s.length - 1];
  const cellColor = (s) => (lastCh(s) === lastCh(s).toUpperCase() ? B : W);
  const cellType = (s) => lastCh(s).toUpperCase();
  const cellPro = (s) => s[0] === '+';
  const cellPt = (s) => (cellPro(s) ? '+' : '') + cellType(s);

  const GOLD = [[0, -1], [-1, -1], [1, -1], [-1, 0], [1, 0], [0, 1]];
  const KING = [[-1, -1], [0, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [0, 1], [1, 1]];
  const DIAG = [[-1, -1], [1, -1], [-1, 1], [1, 1]];
  const ORTH = [[0, -1], [0, 1], [-1, 0], [1, 0]];
  const MOVES = {
    P: { steps: [[0, -1]] },
    L: { slides: [[0, -1]] },
    N: { steps: [[-1, -2], [1, -2]] },
    S: { steps: [[0, -1], [-1, -1], [1, -1], [-1, 1], [1, 1]] },
    G: { steps: GOLD },
    '+P': { steps: GOLD }, '+L': { steps: GOLD }, '+N': { steps: GOLD }, '+S': { steps: GOLD },
    B: { slides: DIAG },
    R: { slides: ORTH },
    '+B': { slides: DIAG, steps: ORTH },
    '+R': { slides: ORTH, steps: DIAG },
    K: { steps: KING },
  };
  const PROMOTABLE = { P: 1, L: 1, N: 1, S: 1, B: 1, R: 1 };
  const inBoard = (x, y) => x >= 1 && x <= 9 && y >= 1 && y <= 9;
  const inZone = (c, y) => (c === B ? y <= 3 : y >= 7);

  class Position {
    constructor() {
      this.board = [];
      for (let y = 0; y < 10; y++) this.board.push(new Array(10).fill(null));
      this.hands = { b: {}, w: {} };
      this.turn = B;
    }

    clone() {
      const p = new Position();
      for (let y = 0; y < 10; y++) p.board[y] = this.board[y].slice();
      p.hands = { b: Object.assign({}, this.hands.b), w: Object.assign({}, this.hands.w) };
      p.turn = this.turn;
      return p;
    }

    static fromSfen(sfen) {
      const [bd, turn, hand] = sfen.trim().split(/\s+/);
      const p = new Position();
      const rows = bd.split('/');
      if (rows.length !== 9) throw new Error('SFEN: 段数が不正: ' + sfen);
      rows.forEach((row, j) => {
        let x = 9;
        let pro = false;
        for (const ch of row) {
          if (ch === '+') { pro = true; continue; }
          if (/[1-9]/.test(ch)) { x -= Number(ch); continue; }
          p.board[j + 1][x] = (pro ? '+' : '') + ch;
          pro = false;
          x--;
        }
        if (x !== 0) throw new Error('SFEN: 筋数が不正: ' + row);
      });
      p.turn = turn === 'w' ? W : B;
      if (hand && hand !== '-') {
        let n = '';
        for (const ch of hand) {
          if (/[0-9]/.test(ch)) { n += ch; continue; }
          const c = ch === ch.toUpperCase() ? B : W;
          p.hands[c][ch.toUpperCase()] = n ? Number(n) : 1;
          n = '';
        }
      }
      return p;
    }

    toSfen() {
      const rows = [];
      for (let y = 1; y <= 9; y++) {
        let s = '';
        let blank = 0;
        for (let x = 9; x >= 1; x--) {
          const cell = this.board[y][x];
          if (!cell) { blank++; continue; }
          if (blank) { s += blank; blank = 0; }
          s += cell;
        }
        if (blank) s += blank;
        rows.push(s);
      }
      let h = '';
      for (const c of [B, W]) {
        for (const t of HAND_ORDER) {
          const n = this.hands[c][t];
          if (n) h += (n > 1 ? n : '') + (c === B ? t : t.toLowerCase());
        }
      }
      return rows.join('/') + ' ' + this.turn + ' ' + (h || '-');
    }
  }

  const START_SFEN = 'lnsgkgsnl/1r5b1/ppppppppp/9/9/9/PPPPPPPPP/1B5R1/LNSGKGSNL b -';
  const startPosition = () => Position.fromSfen(START_SFEN);

  /** 盤上の駒が動ける先（自玉の安全は考慮しない） */
  function targets(pos, x, y) {
    const cell = pos.board[y][x];
    const c = cellColor(cell);
    const mv = MOVES[cellPt(cell)];
    const sg = c === B ? 1 : -1;
    const out = [];
    for (const [dx, dy] of mv.steps || []) {
      const nx = x + dx;
      const ny = y + dy * sg;
      if (!inBoard(nx, ny)) continue;
      const t = pos.board[ny][nx];
      if (!t || cellColor(t) !== c) out.push([nx, ny]);
    }
    for (const [dx, dy] of mv.slides || []) {
      let nx = x + dx;
      let ny = y + dy * sg;
      while (inBoard(nx, ny)) {
        const t = pos.board[ny][nx];
        if (!t) out.push([nx, ny]);
        else {
          if (cellColor(t) !== c) out.push([nx, ny]);
          break;
        }
        nx += dx;
        ny += dy * sg;
      }
    }
    return out;
  }

  function kingSquare(pos, c) {
    const k = mk(c, 'K', false);
    for (let y = 1; y <= 9; y++) for (let x = 1; x <= 9; x++) if (pos.board[y][x] === k) return { x, y };
    return null;
  }

  function inCheck(pos, c) {
    const ks = kingSquare(pos, c);
    if (!ks) return false;
    for (let y = 1; y <= 9; y++) {
      for (let x = 1; x <= 9; x++) {
        const cell = pos.board[y][x];
        if (cell && cellColor(cell) !== c && targets(pos, x, y).some(([tx, ty]) => tx === ks.x && ty === ks.y)) return true;
      }
    }
    return false;
  }

  function pseudoMoves(pos) {
    const c = pos.turn;
    const moves = [];
    for (let y = 1; y <= 9; y++) {
      for (let x = 1; x <= 9; x++) {
        const cell = pos.board[y][x];
        if (!cell || cellColor(cell) !== c) continue;
        const pt = cellPt(cell);
        for (const [tx, ty] of targets(pos, x, y)) {
          const far = c === B ? ty : 10 - ty; // 1 = 最奥段
          const forced = (pt === 'P' || pt === 'L') ? far === 1 : pt === 'N' ? far <= 2 : false;
          const canPro = PROMOTABLE[pt] && (inZone(c, y) || inZone(c, ty));
          if (!forced) moves.push({ from: { x, y }, to: { x: tx, y: ty }, pt, promote: false, drop: false });
          if (canPro) moves.push({ from: { x, y }, to: { x: tx, y: ty }, pt, promote: true, drop: false });
        }
      }
    }
    for (const t of HAND_ORDER) {
      if (!pos.hands[c][t]) continue;
      for (let y = 1; y <= 9; y++) {
        const far = c === B ? y : 10 - y;
        if ((t === 'P' || t === 'L') && far === 1) continue;
        if (t === 'N' && far <= 2) continue;
        for (let x = 1; x <= 9; x++) {
          if (pos.board[y][x]) continue;
          if (t === 'P') {
            let dup = false;
            for (let yy = 1; yy <= 9; yy++) if (pos.board[yy][x] === mk(c, 'P', false)) dup = true;
            if (dup) continue;
          }
          moves.push({ from: null, to: { x, y }, pt: t, promote: false, drop: true });
        }
      }
    }
    return moves;
  }

  function applyMove(pos, m) {
    const p = pos.clone();
    const c = pos.turn;
    if (m.drop) {
      p.board[m.to.y][m.to.x] = mk(c, m.pt, false);
      p.hands[c][m.pt]--;
      if (!p.hands[c][m.pt]) delete p.hands[c][m.pt];
    } else {
      const cell = p.board[m.from.y][m.from.x];
      const cap = p.board[m.to.y][m.to.x];
      if (cap) {
        const bt = cellType(cap);
        p.hands[c][bt] = (p.hands[c][bt] || 0) + 1;
      }
      p.board[m.from.y][m.from.x] = null;
      p.board[m.to.y][m.to.x] = mk(c, cellType(cell), cellPro(cell) || m.promote);
    }
    p.turn = opp(c);
    return p;
  }

  function hasLegalMove(pos) {
    const c = pos.turn;
    return pseudoMoves(pos).some((m) => !inCheck(applyMove(pos, m), c));
  }

  function legalMoves(pos) {
    const c = pos.turn;
    const out = [];
    for (const m of pseudoMoves(pos)) {
      const next = applyMove(pos, m);
      if (inCheck(next, c)) continue;
      if (m.drop && m.pt === 'P' && inCheck(next, opp(c)) && !hasLegalMove(next)) continue; // 打ち歩詰め
      out.push(m);
    }
    return out;
  }

  const sameMove = (a, b) => !!a && !!b && a.drop === b.drop && a.pt === b.pt && a.promote === b.promote &&
    a.to.x === b.to.x && a.to.y === b.to.y &&
    (a.drop || (a.from.x === b.from.x && a.from.y === b.from.y));

  // ---------- 棋譜表記 ----------

  /** 右・左・直・上・引・寄 を判定する述語を作る（froms = 同じ升に動ける同種駒の元位置の集合） */
  function relPred(c, to, froms, word) {
    const r = (f) => (c === B ? -f.x : f.x);
    const fwd = (f) => (c === B ? f.y - to.y : to.y - f.y);
    switch (word) {
      case '直': return (f) => f.x === to.x && fwd(f) > 0;
      case '右': { const mx = Math.max(...froms.map(r)); return (f) => r(f) === mx && froms.filter((h) => r(h) === mx).length === 1; }
      case '左': { const mn = Math.min(...froms.map(r)); return (f) => r(f) === mn && froms.filter((h) => r(h) === mn).length === 1; }
      case '上': case '行': return (f) => fwd(f) > 0;
      case '引': return (f) => fwd(f) < 0;
      case '寄': return (f) => fwd(f) === 0;
      default: throw new Error('不明な修飾語: ' + word);
    }
  }

  function distinctFroms(moves) {
    const seen = new Set();
    const out = [];
    for (const m of moves) {
      if (m.drop) continue;
      const k = m.from.x * 10 + m.from.y;
      if (!seen.has(k)) { seen.add(k); out.push(m.from); }
    }
    return out;
  }

  /** 指し手を「７六歩」「同歩」「５八金右」「２二角成」の形式（手番記号なし）で表す */
  function moveText(pos, m, prev) {
    const c = pos.turn;
    const all = legalMoves(pos).filter((x) => x.pt === m.pt && x.to.x === m.to.x && x.to.y === m.to.y);
    const same = prev && prev.to.x === m.to.x && prev.to.y === m.to.y;
    let s = (same ? '同' : FILE_NUM[m.to.x - 1] + RANK_NUM[m.to.y - 1]) + NAME[m.pt];
    if (m.drop) {
      if (all.some((x) => !x.drop)) s += '打';
      return s;
    }
    const froms = distinctFroms(all);
    if (froms.length > 1) {
      for (const word of ['直', '右', '左', '上', '引', '寄']) {
        const pred = relPred(c, m.to, froms, word);
        if (pred(m.from) && froms.filter(pred).length === 1) { s += word; break; }
      }
    }
    if (m.promote) s += '成';
    else if (all.some((x) => !x.drop && x.promote && x.from.x === m.from.x && x.from.y === m.from.y)) s += '不成';
    return s;
  }

  const moveLabel = (pos, m, prev) => (pos.turn === B ? '▲' : '△') + moveText(pos, m, prev);

  const MOVE_RE = /^([▲△☗☖])(同|[１-９1-9][一二三四五六七八九1-9])[\s　]*(成香|成桂|成銀|歩|香|桂|銀|金|角|飛|玉|王|と|馬|竜|龍)([右左直]?)([上引寄行]?)(打?)(不成|成)?$/;

  const toNum = (ch) => {
    const i = FILE_NUM.indexOf(ch);
    if (i >= 0) return i + 1;
    const j = RANK_NUM.indexOf(ch);
    if (j >= 0) return j + 1;
    return Number(ch);
  };

  /** 「▲７六歩」形式の文字列を、この局面での合法手に解決する。曖昧・不正なら例外 */
  function parseMove(pos, text, prev) {
    const m = MOVE_RE.exec(text.trim());
    if (!m) throw new Error('指し手を解釈できません: ' + text);
    const side = m[1] === '▲' || m[1] === '☗' ? B : W;
    if (side !== pos.turn) throw new Error('手番が合いません: ' + text);
    let to;
    if (m[2] === '同') {
      if (!prev) throw new Error('「同」の直前の手がありません: ' + text);
      to = prev.to;
    } else {
      to = { x: toNum(m[2][0]), y: toNum(m[2][1]) };
    }
    const pt = PIECE_BY_NAME[m[3]];
    const [, , , , w1, w2, dropFlag, proFlag] = m;
    let cand = legalMoves(pos).filter((x) => x.pt === pt && x.to.x === to.x && x.to.y === to.y);
    if (dropFlag) cand = cand.filter((x) => x.drop);
    else if (cand.some((x) => !x.drop)) cand = cand.filter((x) => !x.drop);
    const froms = distinctFroms(cand);
    cand = cand.filter((x) => x.promote === (proFlag === '成'));
    for (const word of [w1, w2]) {
      if (!word) continue;
      const pred = relPred(pos.turn, to, froms, word);
      cand = cand.filter((x) => !x.drop && pred(x.from));
    }
    if (cand.length === 0) throw new Error('その手は指せません（反則または表記の誤り）: ' + text);
    if (cand.length > 1) throw new Error('指し手が曖昧です（右/左/上/引などが必要）: ' + text);
    return cand[0];
  }

  const api = {
    B, W, opp, NAME, SHORT, HAND_ORDER, FILE_NUM, RANK_NUM,
    Position, startPosition, START_SFEN,
    cellColor, cellType, cellPro, cellPt,
    targets, inCheck, kingSquare, legalMoves, applyMove, sameMove,
    moveText, moveLabel, parseMove,
  };
  g.Shogi = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : window);
