// node tests/engine.test.js
const assert = require('assert');
const S = require('../js/shogi.js');

function perft(pos, d) {
  if (d === 0) return 1;
  let n = 0;
  for (const m of S.legalMoves(pos)) n += perft(S.applyMove(pos, m), d - 1);
  return n;
}

// 平手初期局面の perft（将棋の既知の値: 30, 900, 25470, 719731）
const start = S.startPosition();
assert.strictEqual(perft(start, 1), 30);
assert.strictEqual(perft(start, 2), 900);
assert.strictEqual(perft(start, 3), 25470);
assert.strictEqual(perft(start, 4), 719731);

// SFEN の往復
assert.strictEqual(start.toSfen(), S.START_SFEN);

// 表記: 解析と生成が一致する
function play(texts) {
  let pos = S.startPosition();
  let prev = null;
  for (const t of texts) {
    const m = S.parseMove(pos, t, prev);
    assert.strictEqual(S.moveLabel(pos, m, prev), t, 'label roundtrip: ' + t);
    pos = S.applyMove(pos, m);
    prev = m;
  }
  return pos;
}
// 角交換と同の表記、成・打
const p = play(['▲７六歩', '△３四歩', '▲２二角成', '△同銀', '▲４五角']);
assert.ok(p);

// 曖昧な表記は例外になる
assert.throws(() => S.parseMove(S.startPosition(), '▲５八金', null), /曖昧/);
// 初期局面の金は 4九/6九 → 5八 に動ける: 右/左で一意
const m1 = S.parseMove(S.startPosition(), '▲５八金右', null);
assert.deepStrictEqual(m1.from, { x: 4, y: 9 }); // 先手から見て右 = 4筋側
const m2 = S.parseMove(S.startPosition(), '▲５八金左', null);
assert.deepStrictEqual(m2.from, { x: 6, y: 9 });

// 後手の左右は逆: 後手の 4一金→5二 は「左」
const g = play(['▲７六歩', '△３四歩', '▲２六歩']);
const m3 = S.parseMove(g, '△５二金左', null);
assert.deepStrictEqual(m3.from, { x: 4, y: 1 });

// 二歩・打ち歩詰め・行き所のない駒
const nifu = S.Position.fromSfen('4k4/9/9/9/9/9/P8/9/4K4 b P');
assert.ok(!S.legalMoves(nifu).some((m) => m.drop && m.to.x === 9)); // 9筋に歩がある
const uchifu = S.Position.fromSfen('7nk/9/7PP/9/9/9/9/9/K8 b P'); // 1二への歩打ちは打ち歩詰め
assert.ok(!S.legalMoves(uchifu).some((m) => m.drop && m.pt === 'P' && m.to.x === 1 && m.to.y === 2));
const knight = S.Position.fromSfen('4k4/9/9/9/9/9/9/9/K8 b N');
assert.ok(!S.legalMoves(knight).some((m) => m.drop && m.to.y <= 2)); // 桂は1,2段に打てない

console.log('engine tests passed');
