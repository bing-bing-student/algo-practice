'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const Core = require('./core.js');
const catalog = require('./catalog.json');
const source = fs.readFileSync(path.join(__dirname, 'ui.js'), 'utf8');
const coreSource = fs.readFileSync(path.join(__dirname, 'core.js'), 'utf8');
const managerSource = fs.readFileSync(path.join(__dirname, 'manager.js'), 'utf8');
const STORE = 'leetcode-study-planner:v1';

function initialState(outcome) {
  const value = Core.createState(catalog);
  value.focus = { categoryId: 'topic-2', problemId: '283' };
  value.topicBookmarks['topic-2'] = '283';
  if (outcome) value.records.push({ id: 'attempt-283', problemId: '283', outcome,
    date: '2026-10-18', createdAt: '2026-10-18T08:00:00.000Z',
    minutes: null, note: '', planId: null, purpose: 'learn' });
  return value;
}

// Run the actual UI entry point and event handlers against isolated in-memory storage.
// These tests check generated content and actions; they do not emulate CSS layout.
function openApp(value) {
  const storage = new Map([[STORE, JSON.stringify(Core.backupEnvelope(value, catalog.version))]]);
  const events = new Map();
  const element = () => ({ innerHTML: '', classList: { add() {}, remove() {}, toggle() {} }, querySelector: () => null });
  const app = element();
  const elements = new Map([['app', app], ['modal-root', element()], ['toast', element()],
    ['catalog-data', { textContent: JSON.stringify(catalog) }]]);
  const control = { close() {}, enhance() {} };
  const document = {
    activeElement: null,
    getElementById: id => elements.get(id) || null,
    querySelectorAll: () => [],
    addEventListener: (name, handler) => events.set(name, handler)
  };
  const context = vm.createContext({
    window: { PlannerSelect: control, PlannerDate: control, PlannerEditor: control,
      addEventListener() {}, scrollTo() {} },
    document, location: { hash: '', href: 'https://study.example.test/' }, URL, URLSearchParams,
    localStorage: { getItem: key => storage.get(key) || null,
      setItem: (key, content) => storage.set(key, content), removeItem: key => storage.delete(key) },
    setTimeout: () => 1, clearTimeout() {},
    FormData: class { constructor(form) { this.form = form; } get(key) { return this.form.values[key] || ''; } }
  });
  vm.runInContext(coreSource, context, { filename: 'core.js' });
  vm.runInContext(`
    window.PlannerCore = PlannerCore;
    PlannerCore.todayInZone = () => '2026-10-18';
    const parseBackup = PlannerCore.parseBackup;
    PlannerCore.parseBackup = (raw, selectedCatalog) => parseBackup(raw, selectedCatalog, '2026-10-18');
  `, context);
  vm.runInContext(managerSource, context, { filename: 'manager.js' });
  vm.runInContext(source, context, { filename: 'ui.js' });
  return {
    html: () => app.innerHTML,
    banner: () => app.innerHTML.split('<div class="focus-banner">')[1].split('<div class="split">')[0],
    saved: () => JSON.parse(storage.get(STORE)).state,
    click(action, dataset = {}, form = null) {
      const target = { dataset: { action, ...dataset }, disabled: false,
        closest: selector => selector === '[data-action]' ? target : selector === 'form' ? form : null };
      events.get('click')({ target, preventDefault() {} });
    },
    saveOutcome(outcome) {
      this.click('save-outcome', { outcome }, { dataset: { record: '', plan: '', purpose: '' },
        values: { problemId: '283', date: '2026-10-18' }, querySelector: () => ({}) });
    }
  };
}

test('an existing completed bookmark renders the next question and Continue adds that same question', () => {
  const app = openApp(initialState('solution'));
  assert.match(app.banner(), /88\. 合并两个有序数组/);
  assert.doesNotMatch(app.banner(), /283\. 移动零/);
  app.click('continue');
  assert.equal(app.saved().plans[0].problemId, '88');
  assert.equal(app.saved().records.length, 1);
});

test('saving a completed attempt updates the banner immediately, before reopening the page', () => {
  const app = openApp(initialState());
  assert.match(app.banner(), /283\. 移动零/);
  app.saveOutcome('solution');
  assert.match(app.banner(), /88\. 合并两个有序数组/);
  app.click('continue');
  assert.equal(app.saved().plans[0].problemId, '88');
  assert.equal(app.saved().records[0].outcome, 'solution');
});

test('saving an unfinished attempt retains the current question in the banner and Continue action', () => {
  const app = openApp(initialState());
  app.saveOutcome('thinking');
  assert.match(app.banner(), /283\. 移动零/);
  app.click('continue');
  assert.equal(app.saved().plans[0].problemId, '283');
});

test('Continue selects an already planned recommendation without creating a duplicate', () => {
  const value = initialState('solution');
  value.plans.push({ id: 'plan-88', problemId: '88', date: '2026-10-18', purpose: 'learn', createdAt: '2026-10-18T08:00:00.000Z' });
  const app = openApp(value);
  app.click('inspect', { id: '283' });
  app.click('continue');
  assert.match(app.html().split('<aside class="panel">')[1], /<h2>88\. 合并两个有序数组<\/h2>/);
  assert.equal(app.saved().plans.length, 1);
});

test('a fully practiced topic shows completion and removes the Continue action', () => {
  const value = initialState('solution');
  value.records = catalog.problems.filter(p => p.categoryId === 'topic-2').map(p => ({ ...value.records[0], id: 'attempt-' + p.id, problemId: p.id }));
  const app = openApp(value);
  assert.match(app.banner(), /本专题的题目已练过一轮/);
  assert.doesNotMatch(app.banner(), /data-action="continue"/);
  assert.equal(app.saved().focus.categoryId, 'topic-2');
});
