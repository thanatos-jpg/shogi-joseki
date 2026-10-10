/* 将棋定跡トレーナー: 画面と操作 */
(function () {
  'use strict';
  const S = window.Shogi;
  const J = window.Joseki;
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  // ---------- データ ----------
  const lines = JOSEKI_DATA.map((def) => {
    const tree = J.build(def);
    if (tree.errors.length) console.error(tree.errors.join('\n'));
    return { def, tree, stats: J.stats(tree) };
  });

  // ---------- 学習記録（localStorage。使えなくても動く） ----------
  const store = {
    load() { try { return JSON.parse(localStorage.getItem('joseki-progress') || '{}'); } catch (e) { return {}; } },
    save(v) { try { localStorage.setItem('joseki-progress', JSON.stringify(v)); } catch (e) { /* 保存できなくても続行 */ }
    },
    clear(id, mistakes) {
      const all = this.load();
      const r = all[id] || { clears: 0, perfect: 0 };
      r.clears++;
      if (mistakes === 0) r.perfect++;
      all[id] = r;
      this.save(all);
    },
  };

  // ---------- 状態 ----------
  let cur = null; // { line, mode, flip, user }
  let tr = null; // 練習モード
  let rv = null; // 通しモード
  let timers = [];
  const later = (fn, ms) => { const t = setTimeout(fn, ms); timers.push(t); return t; };
  const clearTimers = () => { timers.forEach(clearTimeout); timers = []; };

  // ---------- 一覧 ----------
  function renderHome() {
    const prog = store.load();
    const groups = [];
    lines.forEach((l) => {
      let g = groups.find((x) => x.name === l.def.group);
      if (!g) { g = { name: l.def.group, items: [] }; groups.push(g); }
      g.items.push(l);
    });
    $('lineList').innerHTML = groups.map((g) => `
      <div class="group-title">${esc(g.name)}</div>
      ${g.items.map((l) => {
        const p = prog[l.def.id] || { clears: 0, perfect: 0 };
        const side = l.def.user === 'w' ? '後手' : '先手';
        return `<div class="card">
          <h3>${esc(l.def.title)}${l.def.verified ? '' : '<span class="badge">要確認</span>'}</h3>
          <p>${esc(l.def.summary || '')}</p>
          <div class="meta">あなたは${side} ／ 主手順 ${l.stats.mainPly}手 ／ 全${l.stats.leaves}変化 ／ 完走 ${p.clears}回（ノーミス ${p.perfect}回）</div>
          <div class="row">
            <button class="primary" data-act="train" data-id="${esc(l.def.id)}">練習する</button>
            <button data-act="review" data-id="${esc(l.def.id)}">通しで見る</button>
          </div>
        </div>`;
      }).join('')}`).join('');
  }

  $('lineList').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-act]');
    if (!b) return;
    const line = lines.find((l) => l.def.id === b.dataset.id);
    if (line.tree.errors.length) { alert('この定跡データに誤りがあります:\n' + line.tree.errors.join('\n')); return; }
    openPlay(line, b.dataset.act);
  });

  // ---------- 対局画面 ----------
  function openPlay(line, mode) {
    clearTimers();
    cur = { line, mode, user: line.def.user, flip: line.def.user === 'w' };
    $('home').hidden = true;
    $('play').hidden = false;
    $('playTitle').textContent = `${line.def.group}・${line.def.title}（${mode === 'train' ? '練習' : '通し'}）`;
    $('moveList').hidden = mode !== 'review';
    window.scrollTo(0, 0);
    if (mode === 'train') startTrain(); else startReview();
  }

  function closePlay() {
    clearTimers();
    cur = null; tr = null; rv = null;
    $('play').hidden = true;
    $('home').hidden = false;
    renderHome();
  }
  $('btnBack').addEventListener('click', closePlay);
  $('btnFlip').addEventListener('click', () => { cur.flip = !cur.flip; refresh(); });

  const bottomColor = () => (cur.flip ? S.W : S.B);

  function refresh() {
    if (cur.mode === 'train') renderTrain(); else renderReview();
  }

  // ---------- 盤の描画（SVG） ----------
  const CELL = 44;
  const PAD = { l: 6, t: 20, r: 20, b: 6 };
  const BW = CELL * 9 + PAD.l + PAD.r;
  const BH = CELL * 9 + PAD.t + PAD.b;

  function sqToXY(x, y) { // 盤上の座標 → 描画上の左上
    const col = cur.flip ? x - 1 : 9 - x;
    const row = cur.flip ? 9 - y : y - 1;
    return { px: PAD.l + col * CELL, py: PAD.t + row * CELL };
  }

  function pieceSvg(cell, px, py) {
    const c = S.cellColor(cell);
    const pt = S.cellPt(cell);
    const up = c === bottomColor();
    const cx = px + CELL / 2;
    const cy = py + CELL / 2;
    let name = S.SHORT[pt];
    if (pt === 'K') name = c === S.B ? '玉' : '王';
    const pro = S.cellPro(cell);
    const pts = [[0.5, 0.07], [0.84, 0.22], [0.92, 0.93], [0.08, 0.93], [0.16, 0.22]]
      .map(([a, b]) => `${(px + a * CELL).toFixed(1)},${(py + b * CELL).toFixed(1)}`).join(' ');
    return `<g transform="rotate(${up ? 0 : 180} ${cx} ${cy})">
      <polygon points="${pts}" fill="#f7dfa5" stroke="#5a3d12" stroke-width="1.2" stroke-linejoin="round"/>
      <text x="${cx}" y="${cy + 6}" text-anchor="middle" font-size="${name.length > 1 ? 15 : 24}" font-weight="700" fill="${pro ? '#c0392b' : '#1d1608'}">${name}</text>
    </g>`;
  }

  function renderBoard(pos, o) {
    const parts = [];
    parts.push(`<rect x="0" y="0" width="${BW}" height="${BH}" rx="8" fill="#e9c98a"/>`);
    // 格子線
    const x0 = PAD.l; const y0 = PAD.t;
    for (let i = 0; i <= 9; i++) {
      parts.push(`<line x1="${x0 + i * CELL}" y1="${y0}" x2="${x0 + i * CELL}" y2="${y0 + 9 * CELL}" stroke="#6b4a1b" stroke-width="${i % 9 === 0 ? 1.8 : 1}"/>`);
      parts.push(`<line x1="${x0}" y1="${y0 + i * CELL}" x2="${x0 + 9 * CELL}" y2="${y0 + i * CELL}" stroke="#6b4a1b" stroke-width="${i % 9 === 0 ? 1.8 : 1}"/>`);
    }
    for (const a of [3, 6]) for (const b of [3, 6]) parts.push(`<circle cx="${x0 + a * CELL}" cy="${y0 + b * CELL}" r="3" fill="#6b4a1b"/>`);
    // 筋・段の目盛り
    for (let col = 0; col < 9; col++) {
      const x = cur.flip ? col + 1 : 9 - col;
      parts.push(`<text x="${x0 + col * CELL + CELL / 2}" y="${PAD.t - 6}" text-anchor="middle" font-size="12" fill="#6b4a1b">${S.FILE_NUM[x - 1]}</text>`);
    }
    for (let row = 0; row < 9; row++) {
      const y = cur.flip ? 9 - row : row + 1;
      parts.push(`<text x="${x0 + 9 * CELL + 10}" y="${y0 + row * CELL + CELL / 2 + 4}" text-anchor="middle" font-size="12" fill="#6b4a1b">${S.RANK_NUM[y - 1]}</text>`);
    }
    // ハイライト
    const hl = (sq, fill) => { if (sq) { const { px, py } = sqToXY(sq.x, sq.y); parts.push(`<rect x="${px}" y="${py}" width="${CELL}" height="${CELL}" fill="${fill}"/>`); } };
    if (o.last) { hl(o.last.from, 'rgba(255,190,0,.25)'); hl(o.last.to, 'rgba(255,190,0,.5)'); }
    hl(o.selected, 'rgba(42,139,214,.4)');
    if (o.hintFrom) { const { px, py } = sqToXY(o.hintFrom.x, o.hintFrom.y); parts.push(`<rect x="${px + 2}" y="${py + 2}" width="${CELL - 4}" height="${CELL - 4}" fill="none" stroke="#e0861a" stroke-width="3" stroke-dasharray="6 4"/>`); }
    if (o.hintTo) { const { px, py } = sqToXY(o.hintTo.x, o.hintTo.y); parts.push(`<rect x="${px + 2}" y="${py + 2}" width="${CELL - 4}" height="${CELL - 4}" fill="rgba(224,134,26,.25)" stroke="#e0861a" stroke-width="3"/>`); }
    // 駒
    for (let y = 1; y <= 9; y++) {
      for (let x = 1; x <= 9; x++) {
        const cell = pos.board[y][x];
        if (!cell) continue;
        const { px, py } = sqToXY(x, y);
        parts.push(pieceSvg(cell, px, py));
      }
    }
    // 移動先の目印
    (o.targets || []).forEach(({ x, y }) => {
      const { px, py } = sqToXY(x, y);
      const occupied = !!pos.board[y][x];
      parts.push(occupied
        ? `<rect x="${px + 2}" y="${py + 2}" width="${CELL - 4}" height="${CELL - 4}" fill="none" stroke="#2a8bd6" stroke-width="3" rx="4"/>`
        : `<circle cx="${px + CELL / 2}" cy="${py + CELL / 2}" r="6" fill="rgba(42,139,214,.75)"/>`);
    });
    // タップ領域
    if (o.interactive) {
      for (let y = 1; y <= 9; y++) {
        for (let x = 1; x <= 9; x++) {
          const { px, py } = sqToXY(x, y);
          parts.push(`<rect data-x="${x}" data-y="${y}" x="${px}" y="${py}" width="${CELL}" height="${CELL}" fill="transparent" style="cursor:pointer"/>`);
        }
      }
    }
    const svg = $('board');
    svg.setAttribute('viewBox', `0 0 ${BW} ${BH}`);
    svg.innerHTML = parts.join('');
  }

  function renderHands(pos, o) {
    const topC = S.opp(bottomColor());
    const mine = bottomColor();
    const html = (c, interactive) => {
      const items = S.HAND_ORDER.filter((t) => pos.hands[c][t]).map((t) => {
        const n = pos.hands[c][t];
        const cls = ['hp'];
        if (o.selDrop === t && c === mine) cls.push('sel');
        if (o.hintDrop === t && c === mine) cls.push('hint');
        return `<button class="${cls.join(' ')}" ${interactive ? `data-drop="${t}"` : 'tabindex="-1"'}>${S.NAME[t]}${n > 1 ? `<small>${n}</small>` : ''}</button>`;
      }).join('');
      const who = c === S.B ? '先手' : '後手';
      return `<span class="who">${who}の持駒</span><span class="items">${items || '<span>なし</span>'}</span>`;
    };
    $('handTop').innerHTML = html(topC, false);
    $('handBottom').innerHTML = html(mine, !!o.interactive);
  }

  function setPanel(kind, mark, head, body, sub) {
    const p = $('panel');
    p.className = 'panel ' + (kind || '');
    p.innerHTML = `<div class="head"><span class="mark">${mark || ''}</span><span>${head || ''}${sub ? `<div class="sub">${esc(sub)}</div>` : ''}</span></div>${body ? `<div class="body">${esc(body)}</div>` : ''}`;
  }

  // ---------- 練習モード ----------
  const goodChildren = (n) => n.children.filter((c) => !c.bad);
  const userTurn = (n) => n.pos.turn === cur.user;

  function startTrain() {
    clearTimers();
    tr = { node: cur.line.tree.root, sel: null, mistakes: 0, done: false, locked: false, hint: null, answerAt: new Set(), msg: null };
    tr.msg = { kind: '', mark: '', head: `あなたは${cur.user === S.W ? '後手' : '先手'}です`, body: cur.line.def.summary || '' };
    if (!userTurn(tr.node) && goodChildren(tr.node).length) { tr.locked = true; later(opponentMove, 500); }
    renderTrain();
  }

  function opponentMove() {
    const kids = goodChildren(tr.node);
    if (!kids.length) return finishTrain();
    const next = kids[Math.floor(Math.random() * kids.length)];
    tr.node = next;
    tr.hint = null;
    tr.locked = false;
    tr.msg = { kind: '', mark: '', head: `相手: ${next.label}`, body: next.comment };
    if (!goodChildren(next).length) return finishTrain();
    renderTrain();
  }

  function finishTrain() {
    tr.done = true; tr.locked = false;
    store.clear(cur.line.def.id, tr.mistakes);
    const last = tr.node.comment ? tr.node.comment + '\n\n' : '';
    tr.msg = {
      kind: 'ok', mark: '🎉',
      head: tr.mistakes === 0 ? 'ノーミスで完走！' : `完走！（ミス ${tr.mistakes}回）`,
      body: last + 'この定跡の手順はここまでです。もう一度、別の変化も試してみましょう。',
    };
    renderTrain();
  }

  function tryUserMove(m) {
    const node = tr.node;
    const kids = node.children.filter((c) => S.sameMove(c.move, m));
    const good = kids.find((c) => !c.bad);
    const bad = kids.find((c) => c.bad);
    tr.sel = null; tr.hint = null;
    if (good) {
      tr.node = good;
      const more = goodChildren(good).length > 0;
      tr.msg = { kind: 'ok', mark: '〇', head: `正解！ ${good.label}`, body: good.comment };
      if (!more) { finishTrain(); return; }
      tr.locked = true;
      renderTrain();
      later(opponentMove, 650);
      return;
    }
    tr.mistakes++;
    const answers = goodChildren(node).map((c) => c.label).join(' / ');
    const label = S.moveLabel(node.pos, m, node.move);
    tr.msg = {
      kind: 'ng', mark: '×', head: `${label} は定跡外です`,
      body: (bad && bad.comment ? bad.comment + '\n\n' : '') + `定跡手: ${answers}`,
    };
    renderTrain();
  }

  function renderTrain() {
    const node = tr.node;
    const pos = node.pos;
    const my = !tr.done && !tr.locked && userTurn(node);
    let targets = []; let selected = null; let selDrop = null;
    if (my && tr.sel) {
      const legal = S.legalMoves(pos);
      if (tr.sel.drop) selDrop = tr.sel.drop; else selected = tr.sel;
      const seen = new Set();
      legal.filter(selMatch).forEach((m) => { const k = m.to.x * 10 + m.to.y; if (!seen.has(k)) { seen.add(k); targets.push(m.to); } });
    }
    const o = {
      last: node.move ? { from: node.move.from, to: node.move.to } : null,
      selected, selDrop, targets,
      hintFrom: tr.hint && tr.hint.from, hintTo: tr.hint && tr.hint.to, hintDrop: tr.hint && tr.hint.drop,
      interactive: my,
    };
    renderBoard(pos, o);
    renderHands(pos, o);
    if (tr.msg) setPanel(tr.msg.kind, tr.msg.mark, esc(tr.msg.head), tr.msg.body);
    const c = $('controls');
    if (tr.done) {
      c.innerHTML = '<button class="primary" data-c="restart">もう一度練習</button><button data-c="review">通しで見る</button>';
    } else {
      c.innerHTML = `<button data-c="hint" ${my ? '' : 'disabled'}>ヒント</button>
        <button data-c="answer" ${my ? '' : 'disabled'}>答えを見る</button>
        <button data-c="restart">やり直す</button>`;
    }
  }

  function selMatch(m) {
    if (!tr.sel) return false;
    if (tr.sel.drop) return m.drop && m.pt === tr.sel.drop;
    return !m.drop && m.from.x === tr.sel.x && m.from.y === tr.sel.y;
  }

  function askPromote(cands) {
    if (cands.length === 1) return tryUserMove(cands[0]);
    const pro = cands.find((m) => m.promote);
    const keep = cands.find((m) => !m.promote);
    $('dialogText').textContent = '成りますか？';
    $('dialog').hidden = false;
    const done = (m) => { $('dialog').hidden = true; tryUserMove(m); };
    $('dlgPromote').onclick = () => done(pro);
    $('dlgKeep').onclick = () => done(keep);
  }

  $('board').addEventListener('click', (e) => {
    if (!tr || cur.mode !== 'train') return;
    const r = e.target.closest('rect[data-x]');
    if (!r || tr.done || tr.locked) return;
    const x = Number(r.dataset.x); const y = Number(r.dataset.y);
    const pos = tr.node.pos;
    if (!userTurn(tr.node)) return;
    if (tr.sel) {
      const cands = S.legalMoves(pos).filter((m) => selMatch(m) && m.to.x === x && m.to.y === y);
      if (cands.length) { askPromote(cands); return; }
    }
    const cell = pos.board[y][x];
    if (cell && S.cellColor(cell) === cur.user && !(tr.sel && tr.sel.x === x && tr.sel.y === y)) tr.sel = { x, y };
    else tr.sel = null;
    renderTrain();
  });

  $('handBottom').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-drop]');
    if (!b || !tr || tr.done || tr.locked || !userTurn(tr.node)) return;
    const t = b.dataset.drop;
    tr.sel = tr.sel && tr.sel.drop === t ? null : { drop: t };
    renderTrain();
  });

  $('controls').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-c]');
    if (!b) return;
    const act = b.dataset.c;
    if (cur.mode === 'train') {
      if (act === 'restart') startTrain();
      else if (act === 'review') openPlay(cur.line, 'review');
      else if (act === 'hint') showHint();
      else if (act === 'answer') showAnswer();
    } else {
      reviewControl(act, b.dataset.i);
    }
  });

  function showHint() {
    const kid = goodChildren(tr.node)[0];
    if (!kid) return;
    tr.hint = kid.move.drop ? { drop: kid.move.pt } : { from: kid.move.from };
    tr.sel = null;
    tr.msg = { kind: '', mark: '💡', head: 'ヒント', body: kid.move.drop ? '持ち駒を打つ手です（点線の駒）。' : '点線で囲んだ駒を動かします。' };
    renderTrain();
  }

  function showAnswer() {
    const kids = goodChildren(tr.node);
    if (!kids.length) return;
    const kid = kids[0];
    if (!tr.answerAt.has(tr.node.id)) { tr.answerAt.add(tr.node.id); tr.mistakes++; }
    tr.sel = null;
    tr.hint = kid.move.drop ? { drop: kid.move.pt, to: kid.move.to } : { from: kid.move.from, to: kid.move.to };
    tr.msg = {
      kind: 'ng', mark: '答', head: `正解は ${kids.map((k) => k.label).join(' / ')}`,
      body: (kid.comment ? kid.comment + '\n\n' : '') + '枠の示す手を、自分で指して進めましょう。',
    };
    renderTrain();
  }

  // ---------- 通しモード ----------
  function startReview() {
    clearTimers();
    rv = { path: [cur.line.tree.root], auto: false };
    renderReview();
  }

  const rvNode = () => rv.path[rv.path.length - 1];

  function reviewControl(act, idx) {
    const n = rvNode();
    if (act === 'first') { rv.path = [rv.path[0]]; stopAuto(); }
    else if (act === 'prev') { if (rv.path.length > 1) rv.path.pop(); stopAuto(); }
    else if (act === 'next') { if (n.children.length) rv.path.push(n.children[0]); else stopAuto(); }
    else if (act === 'last') { stopAuto(); while (rvNode().children.length) rv.path.push(rvNode().children[0]); }
    else if (act === 'auto') { rv.auto ? stopAuto() : startAuto(); }
    else if (act === 'branch') { stopAuto(); rv.path.push(n.children[Number(idx)]); }
    else if (act === 'jump') { stopAuto(); rv.path = rv.full.slice(0, Number(idx) + 1); }
    renderReview();
  }

  function startAuto() {
    rv.auto = true;
    const tick = () => {
      if (!rv || !rv.auto) return;
      const n = rvNode();
      if (!n.children.length) { rv.auto = false; renderReview(); return; }
      rv.path.push(n.children[0]);
      renderReview();
      later(tick, 1500);
    };
    later(tick, 700);
  }
  function stopAuto() { if (rv) rv.auto = false; clearTimers(); }

  function renderReview() {
    const n = rvNode();
    renderBoard(n.pos, { last: n.move ? { from: n.move.from, to: n.move.to } : null });
    renderHands(n.pos, {});
    // 解説
    if (n.ply === 0) setPanel('', '', esc(cur.line.def.title), cur.line.def.summary || '', '「▶」で一手ずつ進みます');
    else setPanel('', '', esc(`${n.ply}手目 ${n.label}`), n.comment || '', n.bad ? '※ よくある悪手の例' : (n.children.length ? '' : 'この変化はここまで'));
    // 操作
    const branches = n.children.length > 1
      ? `<div class="branches">分岐:${n.children.map((c, i) => `<button data-c="branch" data-i="${i}">${esc(c.label)}${c.bad ? ' ⚠' : ''}</button>`).join('')}</div>` : '';
    $('controls').innerHTML = `${branches}
      <button data-c="first" aria-label="最初へ">⏮</button>
      <button data-c="prev" aria-label="一手戻る">◀</button>
      <button data-c="next" class="primary" aria-label="一手進む" ${n.children.length ? '' : 'disabled'}>▶</button>
      <button data-c="last" aria-label="最後へ">⏭</button>
      <button data-c="auto">${rv.auto ? '停止' : '自動'}</button>`;
    // 手順リスト（現在地以降は主手順を先読み表示）
    const full = rv.path.slice();
    while (full[full.length - 1].children.length) full.push(full[full.length - 1].children[0]);
    rv.full = full;
    $('moveList').innerHTML = full.slice(1).map((x, i) =>
      `<button data-c="jump" data-i="${i + 1}" class="${i + 1 === rv.path.length - 1 ? 'cur' : (i + 1 > rv.path.length - 1 ? 'future' : '')}">${x.ply}.${esc(x.label)}</button>`).join('');
    const curBtn = $('moveList').querySelector('.cur');
    if (curBtn) curBtn.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }

  renderHome();
})();
