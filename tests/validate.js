// node tests/validate.js  — data/ 内の全定跡を読み込み、手順の合法性・表記の曖昧さを検証する
const fs = require('fs');
const path = require('path');
const vm = require('vm');
global.JOSEKI_DATA = [];
require('../js/shogi.js');
const J = require('../js/joseki.js');

const dir = path.join(__dirname, '..', 'data');
for (const f of fs.readdirSync(dir).filter((n) => n.endsWith('.js')).sort()) {
  vm.runInThisContext(fs.readFileSync(path.join(dir, f), 'utf8'), { filename: f });
}
let bad = 0;
const ids = new Set();
for (const d of JOSEKI_DATA) {
  if (ids.has(d.id)) { console.error('id重複: ' + d.id); bad++; }
  ids.add(d.id);
  if (!['b', 'w'].includes(d.user)) { console.error(d.id + ': user は b か w'); bad++; }
  const t = J.build(d);
  const st = J.stats(t);
  console.log(`${d.id}: ${st.nodes}手(ノード) 変化${st.leaves}本 主手順${st.mainPly}手 ${d.verified ? '検証済み' : '要確認'}`);
  t.errors.forEach((e) => { console.error('  ERROR ' + e); bad++; });
}
if (bad) { console.error(`\n${bad}件の問題があります`); process.exit(1); }
console.log('\n定跡データの検証に成功しました');
