'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const Core = require('../src/core.js');
const Markdown = require('../src/markdown.js');
const catalog = require('../src/catalog.json');
const source = fs.readFileSync(path.join(__dirname, '../src/ui.js'), 'utf8');
const coreSource = fs.readFileSync(path.join(__dirname, '../src/core.js'), 'utf8');
const managerSource = fs.readFileSync(path.join(__dirname, '../src/manager.js'), 'utf8');
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
  const modal = element(), scrolls = [];
  const dialog = { open: false, classList: { add() {} }, addEventListener() {}, showModal() { this.open = true; }, close() { this.open = false; } };
  modal.querySelector = selector => selector === 'dialog' && modal.innerHTML ? dialog : null;
  const elements = new Map([['app', app], ['modal-root', modal], ['toast', element()],
    ['catalog-data', { textContent: JSON.stringify(catalog) }]]);
  const control = { close() {}, enhance() {} };
  const document = {
    activeElement: null,
    documentElement: { clientWidth: 1280, style: { setProperty() {} } },
    getElementById: id => elements.get(id) || null,
    querySelectorAll: () => [],
    addEventListener: (name, handler) => events.set(name, handler)
  };
  const context = vm.createContext({
    window: { PlannerSelect: control, PlannerDate: control, PlannerEditor: control, PlannerMarkdown: Markdown,
      innerWidth: 1280, addEventListener() {}, scrollTo(value) { scrolls.push(value); } },
    document, location: { hash: '', href: 'https://study.example.test/' }, URL, URLSearchParams,
    localStorage: { getItem: key => storage.get(key) || null,
      setItem: (key, content) => storage.set(key, content), removeItem: key => storage.delete(key) },
    setTimeout: () => 1, clearTimeout() {},
    FormData: class { constructor(form) { this.form = form; } get(key) { return this.form.values[key] || ''; } has(key) { return Object.hasOwn(this.form.values, key); } [Symbol.iterator]() { return Object.entries(this.form.values)[Symbol.iterator](); } }
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
    modal: () => modal.innerHTML,
    scrolls: () => scrolls.length,
    banner: () => app.innerHTML.split('<div class="focus-banner">')[1].split('<div class="split">')[0],
    saved: () => JSON.parse(storage.get(STORE)).state,
    change(id, value, extra = {}) { return events.get('change')({ target: { id, value, ...extra } }); },
    input(id, value, dataset = {}) { events.get('input')({ target: { id, value, dataset } }); },
    submit(type, values, extra = {}) {
      events.get('submit')({ preventDefault() {}, target: { dataset: { form: type, ...extra }, values, querySelector: () => ({}) } });
    },
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

test('review scheduling uses actual today after browsing a different date, without recording practice', () => {
  const app = openApp(initialState('independent'));
  app.click('previous-day');
  app.click('page', { page: 'review' });
  assert.match(app.html(), /加入今日清单/);
  app.click('add-review', { id: '283' });
  assert.equal(app.saved().plans[0].date, '2026-10-18');
  assert.equal(app.saved().plans[0].purpose, 'review');
  assert.equal(app.saved().records.length, 1);
  assert.match(app.html(), /已在今日清单/);
});

test('route scheduling names the selected date and direct recording still names actual today', () => {
  const app = openApp(initialState());
  app.click('previous-day');
  app.click('page', { page: 'route' });
  assert.match(app.html(), /加入 10\/17 清单/);
  app.click('add-plan', { id: '283' });
  assert.equal(app.saved().plans[0].date, '2026-10-17');
  app.click('inspect', { id: '283' });
  app.click('record', { id: '283' });
  assert.match(app.modal(), /name="date"[^>]*value="2026-10-18"/);
  assert.match(app.html(), /<h1>题型路线<\/h1>/);
});

test('route details open and close in place with filters, page, scroll and learning data intact', () => {
  const value = initialState('solution');
  const app = openApp(value);
  app.click('page', { page: 'route' });
  app.input('route-search', '移动零');
  const before = app.html(), scrolls = app.scrolls();
  app.click('inspect', { id: '283' });
  assert.equal(app.html(), before);
  assert.match(app.modal(), /problem-inspector/);
  assert.match(app.modal(), /记录本次练习/);
  app.click('close-modal');
  assert.equal(app.modal(), '');
  assert.equal(app.html(), before);
  assert.equal(app.scrolls(), scrolls);
  assert.deepEqual(app.saved().records, value.records);
});

test('note history flushes pending Markdown and does not leave the note editor or add an attempt', () => {
  const app = openApp(initialState('independent'));
  app.click('page', { page: 'notes' });
  app.click('note-mode');
  app.input('note-editor', '## 核心思路\n先查再存。', { problem: '283' });
  const before = app.html(), scrolls = app.scrolls();
  app.click('history', { id: '283' });
  assert.match(app.modal(), /练习历史/);
  assert.equal(app.html(), before);
  app.click('close-modal');
  assert.equal(app.html(), before);
  assert.equal(app.scrolls(), scrolls);
  assert.equal(app.saved().notes['283'].content, '## 核心思路\n先查再存。');
  assert.equal(app.saved().records.length, 1);
  assert.doesNotMatch(app.html(), /data-action="(?:record|animation-link|topic-doc-manage)"/);
});

test('retired status annotations survive while redundant status and maintenance controls disappear', () => {
  const value = initialState();
  value.dayStates['2026-10-18'] = 'stop';
  value.topicStates['topic-2'] = 'paused';
  value.notes['283'] = { content: '关键笔记', updatedAt: null, versions: [] };
  const app = openApp(value);
  assert.doesNotMatch(app.html(), /data-action="(?:toggle-rest|topic-state|animation-link|topic-doc-manage)"/);
  assert.equal((app.html().match(/data-action="notes"/g) || []).length, 1);
  app.click('add-plan', { id: '283' });
  assert.equal(app.saved().dayStates['2026-10-18'], 'stop');
  assert.equal(app.saved().topicStates['topic-2'], 'paused');
  assert.equal(app.saved().notes['283'].content, '关键笔记');
  app.click('page', { page: 'route' });
  assert.doesNotMatch(app.html(), /data-action="(?:record|notes|animation-link|topic-doc-manage)"/);
});

test('review can schedule a future date or remain unplanned without changing the browsed day', () => {
  const app = openApp(initialState('independent'));
  app.click('previous-day');
  app.click('page', { page: 'review' });
  app.click('schedule-review', { id: '283' });
  app.submit('schedule-review', { date: '2026-11-01' }, { id: '283' });
  app.submit('schedule-review', { date: '' }, { id: '283' });
  assert.deepEqual(app.saved().plans.map(p => p.date), ['2026-11-01', null]);
  app.click('page', { page: 'route' });
  assert.match(app.html(), /加入 10\/17 清单/);
  assert.equal(app.saved().records.length, 1);
});

test('management changes its primary action with the subpage and shows sorting and bulk actions on demand', () => {
  const app = openApp(initialState());
  app.click('page', { page: 'manage' });
  assert.match(app.html(), /data-action="manage-new-problem"/);
  assert.doesNotMatch(app.html(), /data-action="manage-(?:move|delete-selected)"/);
  app.change('manage-select-all', '', { checked: true });
  assert.match(app.html(), /data-action="manage-move"/);
  app.click('manage-tab', { tab: 'categories' });
  assert.match(app.html(), /data-action="manage-new-category"/);
  assert.doesNotMatch(app.html(), /data-action="manage-(?:new-problem|order-category|order-pattern)"/);
  assert.match(app.html(), /data-action="manage-delete-category" data-id="topic-2" disabled/);
  assert.match(app.html(), /维护文档/);
  app.click('manage-sort');
  assert.match(app.html(), /data-action="manage-order-category"/);
  assert.match(app.html(), /data-action="manage-order-pattern"/);
  assert.doesNotMatch(app.html(), /data-action="manage-delete-category"/);
  app.click('manage-sort');
  assert.doesNotMatch(app.html(), /data-action="manage-order-category"/);
  app.click('manage-category', { id: 'trash' });
  assert.doesNotMatch(app.html(), /data-action="manage-new-(?:category|problem)"/);
  assert.match(app.html(), /data-action="manage-restore-problem"/);
});

test('global review preference lives in settings and disabled review supplies a settings entry', () => {
  const value = initialState();
  value.settings.reviewEnabled = false;
  const app = openApp(value);
  app.click('page', { page: 'review' });
  assert.match(app.html(), /前往设置/);
  assert.doesNotMatch(app.html(), /data-action="toggle-review"/);
});

test('detail note excerpts render Markdown safely and editing history retains its original record identity', () => {
  const value = initialState('solution');
  value.notes['283'] = { content: '## 核心思路\n<script>alert(1)</script>', updatedAt: null, versions: [] };
  value.records[0].note = '旧版随记';
  value.records[0].minutes = 18;
  const app = openApp(value);
  app.click('inspect', { id: '283' });
  assert.match(app.html(), /detail-note-preview"><h2>核心思路<\/h2>/);
  assert.doesNotMatch(app.html(), /<script>/);
  app.click('page', { page: 'calendar' });
  app.click('edit-record', { record: 'attempt-283' });
  app.click('save-outcome', { outcome: 'independent' }, { dataset: { record: 'attempt-283' }, values: { date: '2026-10-17' }, querySelector: () => ({}) });
  assert.equal(app.saved().records.length, 1);
  assert.equal(app.saved().records[0].id, 'attempt-283');
  assert.equal(app.saved().records[0].note, '旧版随记');
  assert.equal(app.saved().records[0].minutes, 18);
  assert.equal(app.saved().records[0].date, '2026-10-17');
  assert.equal(app.saved().notes['283'].content, value.notes['283'].content);
});
