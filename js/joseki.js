/*
 * 定跡データ（手順テキスト）→ 分岐つきの木構造への変換。
 *
 * 手順テキストの書き方:
 *   ▲７六歩 △３四歩 ▲２六歩 ...      手番記号つきで書く（手番の取り違えを検出するため）
 *   (△８四歩 ▲...)                  直前の手の「別の候補手」。入れ子にできる
 *   {コメント}                       直前の手の解説
 *   ▲２四歩?                        「?」付きは、よくある悪手（そのコメントを×のときに表示）
 *   # ...                           行頭が # の行は無視
 * 先に書いた手が主手順（通しモードの既定の進行）になる。
 */
var JOSEKI_DATA = typeof JOSEKI_DATA !== 'undefined' ? JOSEKI_DATA : []; // eslint-disable-line no-var
(function (g) {
  'use strict';
  const S = g.Shogi;

  function tokenize(src) {
    const text = src.split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');
    const tokens = [];
    let i = 0;
    while (i < text.length) {
      const ch = text[i];
      if (/\s/.test(ch)) { i++; continue; }
      if (ch === '(' || ch === ')') { tokens.push({ t: ch }); i++; continue; }
      if (ch === '{') {
        const end = text.indexOf('}', i);
        if (end < 0) throw new Error('コメントの } が閉じていません');
        tokens.push({ t: 'c', v: text.slice(i + 1, end).trim() });
        i = end + 1;
        continue;
      }
      let j = i;
      while (j < text.length && !/[\s(){]/.test(text[j])) j++;
      tokens.push({ t: 'm', v: text.slice(i, j) });
      i = j;
    }
    return tokens;
  }

  /**
   * def: { id, group, title, user:'b'|'w', moves, start?(SFEN), ... }
   * 戻り値: { root, nodes, errors }
   */
  function build(def) {
    const startPos = def.start ? S.Position.fromSfen(def.start) : S.startPosition();
    const root = { id: 0, parent: null, move: null, label: '', comment: '', bad: false, children: [], ply: 0, pos: startPos };
    const nodes = [root];
    const errors = [];
    // moves は文字列、または「初手からの手順」の配列（共通部分は自動で1本の木に統合される）
    const sources = Array.isArray(def.moves) ? def.moves : [def.moves];
    let tokens = [];
    let idx = 0;

    function addChild(parent, text, bad) {
      const prev = parent.move;
      let move;
      try {
        move = S.parseMove(parent.pos, text, prev);
      } catch (e) {
        errors.push(`${def.id}: ${parent.ply + 1}手目 ${text} → ${e.message}`);
        return null;
      }
      let node = parent.children.find((c) => S.sameMove(c.move, move));
      if (!node) {
        node = {
          id: nodes.length, parent, move, label: S.moveLabel(parent.pos, move, prev),
          comment: '', bad: !!bad, children: [], ply: parent.ply + 1, pos: S.applyMove(parent.pos, move),
        };
        nodes.push(node);
        parent.children.push(node);
      } else if (bad !== node.bad && !bad) {
        node.bad = false;
      }
      return node;
    }

    // 1本の手順を読む。')' で終了（呼び出し元が消費）
    function parseLine(start) {
      let cur = start;
      let last = null; // 直前に追加した手
      while (idx < tokens.length) {
        const tk = tokens[idx];
        if (tk.t === ')') return;
        idx++;
        if (tk.t === '(') {
          if (!last) throw new Error('変化「(」の前に手がありません');
          const before = last.parent;
          const savedCur = cur;
          parseLine(before);
          if (tokens[idx] && tokens[idx].t === ')') idx++;
          else throw new Error('変化の ) が閉じていません');
          cur = savedCur;
        } else if (tk.t === 'c') {
          if (!last) continue;
          last.comment = last.comment ? last.comment + '\n' + tk.v : tk.v;
        } else {
          const bad = tk.v.endsWith('?');
          const text = bad ? tk.v.slice(0, -1) : tk.v;
          const node = addChild(cur, text, bad);
          if (!node) { // 以降は意味を成さないので、この手順を読み捨てる
            skipLine();
            return;
          }
          last = node;
          cur = node;
        }
      }
    }

    function skipLine() {
      let depth = 0;
      while (idx < tokens.length) {
        const tk = tokens[idx];
        if (tk.t === '(') depth++;
        if (tk.t === ')') { if (depth === 0) return; depth--; }
        idx++;
      }
    }

    sources.forEach((src, n) => {
      try {
        tokens = tokenize(src);
        idx = 0;
        parseLine(root);
        if (idx < tokens.length) errors.push(`${def.id}[${n}]: 閉じ括弧 ) が多すぎます`);
      } catch (e) {
        errors.push(`${def.id}[${n}]: ${e.message}`);
      }
    });
    return { root, nodes, errors };
  }

  /** 木の統計 */
  function stats(tree) {
    let leaves = 0;
    let maxPly = 0;
    for (const n of tree.nodes) {
      if (!n.children.length) leaves++;
      if (n.ply > maxPly) maxPly = n.ply;
    }
    let mainPly = 0;
    for (let n = tree.root; n.children.length; n = n.children[0]) mainPly++;
    return { nodes: tree.nodes.length - 1, leaves, maxPly, mainPly };
  }

  g.Joseki = { build, stats, tokenize };
  if (typeof module !== 'undefined' && module.exports) module.exports = g.Joseki;
})(typeof globalThis !== 'undefined' ? globalThis : window);
