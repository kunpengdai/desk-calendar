const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const I18N = require('../src/renderer/i18n');

const { zh, en } = I18N.MESSAGES;
const base = key => key.replace(/\.one$/, '');
const placeholders = text => [...text.matchAll(/\{(\w+)\}/g)].map(m => m[1]).sort();

test('every key exists in both languages', () => {
  const zhKeys = Object.keys(zh), enKeys = Object.keys(en).filter(k => !k.endsWith('.one'));
  assert.deepStrictEqual(zhKeys.filter(k => !(k in en)), [], 'missing in English');
  assert.deepStrictEqual(enKeys.filter(k => !(k in zh)), [], 'missing in Chinese');
  for (const key of Object.keys(en).filter(k => k.endsWith('.one'))) assert.ok(base(key) in en, `${key} has no plural base`);
});

test('placeholders match between languages', () => {
  for (const key of Object.keys(zh)) assert.deepStrictEqual(placeholders(en[key]), placeholders(zh[key]), key);
});

test('English has no Chinese characters', () => {
  const leftovers = Object.entries(en).filter(([, v]) => /[一-鿿]/.test(v)).map(([k]) => k);
  assert.deepStrictEqual(leftovers, []);
});

test('every key used in the UI is defined', () => {
  const dir = path.join(__dirname, '..', 'src');
  const files = ['renderer/index.html', 'renderer/app.js', 'renderer/editing.js', 'main.js', 'google.js', 'store.js', 'demo.js'];
  const used = new Set();
  for (const file of files) {
    const text = fs.readFileSync(path.join(dir, file), 'utf8');
    for (const m of text.matchAll(/data-i18n(?:-title|-placeholder|-aria)?="([\w.]+)"/g)) used.add(m[1]);
    for (const m of text.matchAll(/\b(?:tr|t)\(\s*'([\w.]+)'/g)) used.add(m[1]);
  }
  const missing = [...used].filter(k => !(k in zh));
  assert.deepStrictEqual(missing, []);
  assert.ok(used.size > 150, `found ${used.size} keys`);
});

test('t() interpolates, uses English plural for 1 and falls back to Chinese', () => {
  I18N.setLang('en');
  assert.strictEqual(I18N.t('agenda.events', { n: 3 }), '3 events');
  assert.strictEqual(I18N.t('agenda.events', { n: 1 }), '1 event');
  assert.strictEqual(I18N.t('toast.taskAdded', { title: 'Milk' }), 'Added: Milk');
  assert.strictEqual(I18N.locale(), 'en-US');
  I18N.setLang('zh');
  assert.strictEqual(I18N.t('agenda.events', { n: 1 }), '1 项日程');
  assert.strictEqual(I18N.t('no.such.key'), 'no.such.key');
});

test('resolveLang follows the system locale for "auto"', () => {
  assert.strictEqual(I18N.resolveLang('auto', 'zh-CN'), 'zh');
  assert.strictEqual(I18N.resolveLang('auto', 'zh-TW'), 'zh');
  assert.strictEqual(I18N.resolveLang('auto', 'en-US'), 'en');
  assert.strictEqual(I18N.resolveLang('auto', 'ja'), 'en');
  assert.strictEqual(I18N.resolveLang('en', 'zh-CN'), 'en');
  assert.strictEqual(I18N.resolveLang('zh', 'en-US'), 'zh');
});
