// 双语词典完整性：中英两套的键必须一一对应，所有日志 / 错误码都有翻译
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

global.wx = { getStorageSync: () => '', setStorageSync: () => {} };
const i18n = require('../../miniprogram/utils/i18n');
const { NOBLES } = require('../../miniprogram/engine/data');
const { COLORS, ALL_TOKENS, Game } = require('../../miniprogram/engine/game');
const ai = require('../../miniprogram/engine/ai');

const zh = i18n.dict('zh');
const en = i18n.dict('en');

function keyPaths(obj, prefix = '') {
  return Object.keys(obj).flatMap((k) => {
    const v = obj[k];
    const p = prefix ? `${prefix}.${k}` : k;
    return v && typeof v === 'object' && !Array.isArray(v) ? keyPaths(v, p) : [p];
  });
}

test('中英词典键完全一致', () => {
  assert.deepEqual(keyPaths(en).sort(), keyPaths(zh).sort());
  assert.equal(en.rules.length, zh.rules.length);
  for (const L of [zh, en]) {
    ALL_TOKENS.forEach((c) => assert.ok(L.color[c] && L.ore[c], c));
    NOBLES.forEach((n) => assert.ok(L.noble[n.id], n.id));
    assert.equal(L.botNames.length, 4); // 4 个座位各有自己的默认电脑名
  }
});

test('引擎抛出的每个错误码、记下的每种日志都有两种语言', () => {
  const src = fs.readFileSync(path.join(__dirname, '../../miniprogram/engine/game.js'), 'utf8');
  const errCodes = [...src.matchAll(/new IllegalMove\('(\w+)'/g)].map((m) => m[1]);
  const logKeys = [...src.matchAll(/_log\('(\w+)'/g)].map((m) => m[1]);
  assert.ok(errCodes.length > 10 && logKeys.length >= 9);
  for (const L of [zh, en]) {
    errCodes.forEach((c) => assert.ok(L.err[c], `err.${c}`));
    logKeys.forEach((k) => assert.ok(L.log[k], `log.${k}`));
  }
});

test('真实对局的每条记录都能翻译，不会漏出键名或 undefined', () => {
  for (const lang of ['zh', 'en']) {
    i18n.setLang(lang);
    for (let seed = 0; seed < 15; seed++) {
      const g = Game.create([{ name: 'P1', isAI: true }, { name: 'P2', isAI: true }, { name: 'P3', isAI: true }], seed);
      const seen = new Set();
      while (!g.isOver) {
        ai.step(g);
        g.state.log.forEach((e) => {
          const text = i18n.logText(e);
          assert.ok(text && !/undefined|NaN|\[object/.test(text), `${lang} ${e.key}: ${text}`);
          assert.notEqual(text, e.key);
          seen.add(e.key);
        });
      }
      assert.ok(seen.has('over'));
    }
  }
});

test('错误码翻译与参数', () => {
  i18n.setLang('en');
  assert.equal(i18n.errText({ code: 'empty', params: { color: 'red' } }), 'No Cinnabar left');
  assert.equal(i18n.errText({ code: 'deckEmpty', params: { tier: 3 } }), 'The City deck is empty');
  i18n.setLang('zh');
  assert.equal(i18n.errText({ code: 'needDistinct', params: { n: 3 } }), '请选择 3 种不同的矿石');
  assert.equal(i18n.t('fmt.round', 4), '第 4 轮');
  assert.equal(i18n.logText({ text: '老存档的纯文本记录' }), '老存档的纯文本记录');
  COLORS.forEach((c) => assert.ok(i18n.t(`ore.${c}`)));
});

test('云函数与网络层可能返回的每个错误码都有双语翻译', () => {
  const src = fs.readFileSync(path.join(__dirname, '../../cloudfunctions/ore/logic.js'), 'utf8');
  const idx = fs.readFileSync(path.join(__dirname, '../../cloudfunctions/ore/index.js'), 'utf8');
  const codes = new Set([
    ...[...src.matchAll(/RoomError\('(\w+)'/g)].map((m) => m[1]),
    ...[...src.matchAll(/code: '(\w+)'/g)].map((m) => m[1]),
    ...[...idx.matchAll(/code: '(\w+)'/g)].map((m) => m[1]),
    'network', // utils/online.js 的 fail 分支
  ]);
  assert.ok(codes.size >= 15, [...codes].join(','));
  for (const L of [zh, en]) codes.forEach((c) => assert.ok(L.err[c], `err.${c}`));
});
