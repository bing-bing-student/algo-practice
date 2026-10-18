'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Core = require('./core.js');

const catalog = {
  version: '2026-10-16',
  categories: [{ id: 'linked-list', patterns: [] }, { id: 'dp', patterns: [] }],
  problems: [
    { id: '1', categoryId: 'linked-list' },
    { id: '206', categoryId: 'linked-list' },
    { id: '92', categoryId: 'linked-list' },
    { id: '70', categoryId: 'dp' }
  ]
};
let serial = 0;
function record(date, outcome = 'independent', overrides = {}) {
  serial += 1;
  return { id: 'record-' + serial, problemId: '206', date,
    createdAt: date + 'T08:00:00.000Z', outcome, minutes: null, note: '', planId: null, purpose: 'review', ...overrides };
}
function state() { return Core.createState(catalog, '2026-10-16'); }
function clone(input) { return JSON.parse(JSON.stringify(input)); }
function result(records) { return Core.reviewFor('206', records, [1, 3, 7, 14, 30]); }
function validate(input, selectedCatalog = catalog) { return Core.validateState(input, selectedCatalog, '2026-10-16'); }
function restore(source, selectedCatalog = catalog) { return Core.parseBackup(source, selectedCatalog, '2026-10-16'); }
function legacyState() {
  const legacy = state();
  legacy.schemaVersion = 1;
  delete legacy.animationLinks;
  delete legacy.topicDocs;
  delete legacy.catalogEdits;
  return legacy;
}
function legacyBackup(data) {
  return JSON.stringify({ app: Core.APP_NAME, schemaVersion: 1, catalogVersion: data.catalogVersion,
    exportedAt: '2026-10-16T08:00:00.000Z', state: data });
}

test('calendar dates reject rollovers and support leap years', () => {
  for (const value of ['2024-02-29', '2000-02-29', '0001-01-01', '9999-12-31']) assert.equal(Core.isDate(value), true, value);
  for (const value of ['2026-02-29', '1900-02-29', '2026-04-31', '2026-13-01', '2026-1-01', '0000-01-01', null]) {
    assert.equal(Core.isDate(value), false, String(value));
  }
});

test('date arithmetic works across month, year, leap day and DST boundaries', () => {
  assert.equal(Core.addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(Core.addDays('2024-02-28', 2), '2024-03-01');
  assert.equal(Core.addDays('2026-03-08', 1), '2026-03-09');
  assert.equal(Core.addDays('2026-01-01', -1), '2025-12-31');
  assert.throws(() => Core.addDays('2026-02-30', 1));
  assert.throws(() => Core.addDays('2026-01-01', 0.5));
});

test('today uses the requested calendar zone rather than the machine zone', () => {
  const instant = '2026-10-16T16:30:00.000Z';
  assert.equal(Core.todayInZone('Asia/Shanghai', instant), '2026-10-17');
  assert.equal(Core.todayInZone('America/Los_Angeles', instant), '2026-10-16');
});

test('new state has no generated tasks, dates, schedules or learning requirements', () => {
  const fresh = state();
  assert.deepEqual(fresh.focus, { categoryId: null, problemId: null });
  assert.deepEqual(fresh.plans, []);
  assert.deepEqual(fresh.dayStates, {});
  assert.deepEqual(validate(fresh, catalog), fresh);
  const review = result([]);
  assert.equal(review.status, 'unseen');
  assert.equal(review.nextDate, null);
});

test('same-day independent repetitions preserve all attempts but advance only once', () => {
  const records = [record('2026-10-01'), record('2026-10-01', 'independent', { createdAt: '2026-10-01T09:00:00.000Z' })];
  assert.deepEqual(result(records), {
    nextDate: '2026-10-02', stage: 1, latestResult: 'independent', attempts: 2,
    independentDays: 1, independentDates: ['2026-10-01'], lastDate: '2026-10-01', status: 'review'
  });
});

test('reading a solution or a hint makes later same-day reproduction ineligible for advancement', () => {
  for (const assistance of ['hint', 'solution']) {
    const review = result([record('2026-10-01', assistance),
      record('2026-10-01', 'independent', { createdAt: '2026-10-01T09:00:00.000Z' })]);
    assert.equal(review.stage, 0);
    assert.equal(review.status, 'learning');
    assert.equal(review.independentDays, 1);
    assert.equal(review.attempts, 2);
    assert.equal(review.nextDate, '2026-10-02');
  }
});

test('an independent solution after unassisted thinking may start review', () => {
  const review = result([record('2026-10-01', 'thinking'),
    record('2026-10-01', 'independent', { createdAt: '2026-10-01T09:00:00.000Z' })]);
  assert.equal(review.stage, 1);
  assert.equal(review.independentDays, 1);
});

test('later thinking on the same day does not erase an earlier independent history count', () => {
  const review = result([record('2026-10-01'),
    record('2026-10-01', 'thinking', { createdAt: '2026-10-01T09:00:00.000Z' })]);
  assert.equal(review.stage, 0);
  assert.equal(review.latestResult, 'thinking');
  assert.equal(review.independentDays, 1);
  assert.deepEqual(review.independentDates, ['2026-10-01']);
});

test('due cross-day reviews lengthen intervals while early repetitions keep the suggestion', () => {
  const records = [record('2026-10-01'), record('2026-10-02'), record('2026-10-04')];
  assert.equal(result(records).stage, 2);
  assert.equal(result(records).nextDate, '2026-10-05');
  records.push(record('2026-10-20'));
  assert.equal(result(records).stage, 3);
  assert.equal(result(records).nextDate, '2026-10-27');
  assert.equal(result(records).independentDays, 4);
});

test('continued learning does not masquerade as repeated successful review', () => {
  const records = [record('2026-10-01', 'independent', { purpose: 'learn' }),
    record('2026-10-05', 'independent', { purpose: 'learn' })];
  assert.equal(result(records).stage, 1);
  assert.equal(result(records).nextDate, '2026-10-06');
  assert.equal(result(records).attempts, 2);
  assert.equal(result(records).independentDays, 2);
});

test('many days of thinking remain learning and do not create empty-day work', () => {
  const records = [record('2026-10-01', 'thinking'), record('2026-10-03', 'thinking'), record('2026-10-09', 'thinking')];
  const review = result(records);
  assert.equal(review.stage, 0);
  assert.equal(review.nextDate, '2026-10-10');
  assert.equal(review.independentDays, 0);
  assert.equal(review.attempts, 3);
  assert.equal(records.length, 3);
});

test('struggling after previous success shortens advice but retains independent history', () => {
  const review = result([record('2026-10-01'), record('2026-10-02'), record('2026-10-08', 'hint')]);
  assert.equal(review.stage, 0);
  assert.equal(review.nextDate, '2026-10-09');
  assert.equal(review.independentDays, 2);
});

test('backfilling and correcting actual dates recomputes chronology instead of append order', () => {
  const recent = record('2026-10-10');
  const backfilled = record('2026-10-01', 'thinking', { createdAt: '2026-10-15T08:00:00.000Z' });
  assert.equal(result([recent, backfilled]).latestResult, 'independent');
  assert.equal(result([recent, backfilled]).stage, 1);
  backfilled.date = '2026-10-12';
  assert.equal(result([recent, backfilled]).latestResult, 'thinking');
  assert.equal(result([recent, backfilled]).stage, 0);
  assert.equal(result([recent, backfilled]).nextDate, '2026-10-13');
});

test('same-day order uses absolute creation time even when ISO offsets differ', () => {
  const review = result([
    record('2026-10-01', 'independent', { createdAt: '2026-10-01T10:00:00+08:00' }),
    record('2026-10-01', 'thinking', { createdAt: '2026-10-01T03:00:00Z' })
  ]);
  assert.equal(review.latestResult, 'thinking');
  assert.equal(review.stage, 0);
});

test('breaks are not an input to review, do not decay stages and create no tasks', () => {
  const data = state();
  data.records = [record('2026-10-01'), record('2026-10-02')];
  const before = result(data.records);
  data.dayStates['2026-10-03'] = 'stop';
  data.dayStates['2026-11-01'] = 'stop';
  assert.deepEqual(result(validate(data, catalog).records), before);
  assert.equal(data.plans.length, 0);
});

test('custom review intervals are respected without altering record history', () => {
  const records = [record('2026-10-01'), record('2026-10-03')];
  assert.equal(Core.reviewFor('206', records, [2, 4, 8, 16, 32]).nextDate, '2026-10-07');
  assert.equal(records.length, 2);
  assert.throws(() => Core.reviewFor('206', records, [0, 3, 7, 14, 30]));
});

test('editing notes alone preserves records and scheduled review', () => {
  const data = state();
  data.records = [record('2026-10-01')];
  const before = result(data.records);
  data.notes['206'] = { content: '还需要想一想\n循环不变量\n先保存 next', updatedAt: null, versions: [] };
  assert.deepEqual(result(validate(data, catalog).records), before);
  assert.equal(data.records.length, 1);
});

test('snapshot backup retains long notes, Go code, drafts and every saved version', () => {
  const data = state();
  const long = '心得：constructor 只是正文\n```go\nfunc reverseList() {}\n```\n'.repeat(12000);
  data.notes['206'] = { content: long, updatedAt: null,
    versions: Array.from({ length: 42 }, (_, i) => ({ id: 'version-' + i, createdAt: '2026-10-01T08:00:00.000Z',
      content: '历史 ' + i + '\n' + long.slice(0, 1000 + i) + '\n独立保存版本' })) };
  data.records = [record('2026-10-01', 'thinking', { note: long }), record('2026-10-01')];
  const restored = restore(JSON.stringify(Core.backupEnvelope(data, catalog.version)), catalog);
  assert.deepEqual(restored, data);
  assert.equal(restored.notes['206'].content.length, long.length);
  assert.equal(restored.notes['206'].versions.length, 42);
  restored.notes['206'].content = '修改恢复数据';
  assert.equal(data.notes['206'].content, long);
});

test('snapshot restoration replaces state and preserves deletion instead of merging', () => {
  const earlier = state();
  earlier.records.push(record('2026-10-01'));
  const later = clone(earlier);
  later.records = [];
  const restored = restore(JSON.stringify(Core.backupEnvelope(later, catalog.version)), catalog);
  assert.equal(restored.records.length, 0);
  assert.equal(earlier.records.length, 1);
});

test('old record shapes receive learn purpose and dangling plan links can retain their history', () => {
  const data = state();
  data.records = [record('2026-10-01', 'independent', { planId: 'removed-plan' })];
  delete data.records[0].purpose;
  const normalized = validate(data, catalog);
  assert.equal(normalized.records[0].purpose, 'learn');
  assert.equal(normalized.records[0].planId, 'removed-plan');
});

test('future plans and unscheduled plans are distinct from actual practice', () => {
  const data = state();
  data.plans = [
    { id: 'plan-1', problemId: '206', date: null, purpose: 'learn', createdAt: '2026-10-01T08:00:00.000Z' },
    { id: 'plan-2', problemId: '92', date: '2027-01-01', purpose: 'review', createdAt: '2026-10-01T08:00:00.000Z' }
  ];
  const normalized = validate(data, catalog);
  assert.equal(normalized.plans[0].date, null);
  assert.equal(normalized.plans[1].date, '2027-01-01');
  assert.equal(normalized.records.length, 0);
});

test('future actual records are rejected both by direct validation and backup restoration', () => {
  const data = state();
  data.records = [record('2026-10-17')];
  assert.throws(() => validate(data), /未来日期只能安排计划/);
  assert.throws(() => restore(JSON.stringify(Core.backupEnvelope(data, catalog.version))), /未来日期只能安排计划/);
  assert.equal(Core.validateState(data, catalog, '2026-10-17').records.length, 1);
  assert.equal(Core.parseBackup(JSON.stringify(Core.backupEnvelope(data, catalog.version)), catalog, '2026-10-17').records.length, 1);
});

test('default actual-record cutoff uses the current Shanghai calendar day', () => {
  const data = state();
  data.records = [record(Core.addDays(Core.todayInZone('Asia/Shanghai'), 1))];
  assert.throws(() => Core.validateState(data, catalog), /未来日期只能安排计划/);
});

test('strict restore rejects unknown versions, foreign apps and unknown fields', () => {
  const envelope = Core.backupEnvelope(state(), catalog.version);
  assert.throws(() => restore(JSON.stringify({ ...envelope, schemaVersion: 999 }), catalog), /更高版本/);
  assert.throws(() => restore(JSON.stringify({ ...envelope, app: 'another-app' }), catalog));
  assert.throws(() => validate({ ...state(), quota: 90 }, catalog), /未知字段/);
  assert.throws(() => restore('[]', catalog));
  assert.throws(() => restore('{', catalog), /JSON/);
});

test('strict restore rejects invalid dates, timestamps, outcomes and duplicate record IDs', () => {
  const badDate = state();
  badDate.records = [record('2026-02-30')];
  assert.throws(() => validate(badDate, catalog), /日期/);
  badDate.records[0] = record('2026-10-01', 'independent', { createdAt: '2026-10-01T24:00:00Z' });
  assert.throws(() => validate(badDate, catalog), /时分秒/);
  badDate.records[0] = record('2026-10-01', 'done');
  assert.throws(() => validate(badDate, catalog), /结果/);
  badDate.records = [record('2026-10-01', 'thinking'), record('2026-10-02')];
  badDate.records[1].id = badDate.records[0].id;
  assert.throws(() => validate(badDate, catalog), /重复/);
});

test('unknown problem IDs and cross-topic bookmarks cannot corrupt references', () => {
  const data = state();
  data.records = [record('2026-10-01', 'independent', { problemId: '999999' })];
  assert.throws(() => validate(data, catalog), /未知/);
  data.records = [];
  data.topicBookmarks['linked-list'] = '70';
  assert.throws(() => validate(data, catalog), /不属于/);
});

test('dangerous object keys, non-plain objects, cycles and getters are rejected before mutation', () => {
  const envelope = Core.backupEnvelope(state(), catalog.version);
  for (const key of ['__proto__', 'constructor', 'prototype']) {
    const raw = JSON.stringify(envelope).replace('"topicBookmarks":{}', '"topicBookmarks":{"' + key + '":{}}');
    assert.throws(() => restore(raw, catalog), /危险字段/);
  }
  const polluted = state();
  polluted.notes = Object.create({ pollution: true });
  assert.throws(() => validate(polluted, catalog), /普通数据对象/);
  const cyclic = state();
  cyclic.notes.self = cyclic;
  assert.throws(() => validate(cyclic, catalog), /循环引用/);
  const accessor = state();
  let ran = false;
  Object.defineProperty(accessor.notes, '206', { enumerable: true, get() { ran = true; return {}; } });
  assert.throws(() => validate(accessor, catalog), /访问器/);
  assert.equal(ran, false);
  assert.equal({}.pollution, undefined);
});

test('export metadata is independent of the source state and stays internally consistent', () => {
  const data = state();
  data.catalogVersion = 'old-catalog';
  const exported = Core.backupEnvelope(data, catalog.version);
  assert.equal(exported.state.catalogVersion, catalog.version);
  assert.equal(data.catalogVersion, 'old-catalog');
  assert.equal(restore(JSON.stringify(exported), catalog).catalogVersion, catalog.version);
});

test('retiring graph search preserves its existing personal data alongside active study history', () => {
  const graph = { id: 'topic-13', patterns: [{ id: 'graph-search', coreIds: ['200'], extraIds: [] }] };
  const graphProblem = { id: '200', categoryId: 'topic-13' };
  const oldCatalog = { ...catalog, categories: [...catalog.categories, graph], problems: [...catalog.problems, graphProblem] };
  const revisedCatalog = { ...catalog, version: '2026-10-16-no-graphs', retiredCategories: [graph], retiredProblems: [graphProblem] };
  const before = Core.createState(oldCatalog, '2026-10-16');
  before.focus = { categoryId: 'topic-13', problemId: '200' };
  before.topicBookmarks = { 'topic-13': '200', 'linked-list': '206' };
  before.topicStates['topic-13'] = 'paused';
  before.plans = [{ id: 'old-graph-plan', problemId: '200', date: '2026-10-17', purpose: 'review', createdAt: '2026-10-01T08:00:00.000Z' }];
  before.records = [record('2026-10-01', 'independent', { problemId: '200', planId: 'old-graph-plan' }), record('2026-10-02')];
  before.notes['200'] = {
    content: '岛屿题的历史心得\n已写下的 DFS 分析和 Go 代码\n原有总结继续保留', updatedAt: '2026-10-01T08:00:00.000Z',
    versions: [{ id: 'old-graph-note-version', createdAt: '2026-10-01T08:00:00.000Z',
      content: '最初想法\n早期分析\n旧总结' }]
  };
  before.notes['206'] = { content: '活跃题型笔记', updatedAt: null, versions: [] };
  before.reviewOverrides['200'] = { date: '2026-11-01', paused: true };
  const source = JSON.stringify(Core.backupEnvelope(before, oldCatalog.version));
  const restored = Core.parseBackup(source, revisedCatalog, '2026-10-16');
  assert.deepEqual(restored, before);
  assert.equal(restored.records.length, 2);
  assert.equal(restored.notes['200'].versions.length, 1);
  const fresh = Core.createState(revisedCatalog, '2026-10-16');
  assert.deepEqual(fresh.focus, { categoryId: null, problemId: null });
  assert.deepEqual(fresh.plans, []);
  assert.equal(revisedCatalog.categories.some(category => category.id === 'topic-13'), false);
  assert.equal(revisedCatalog.problems.some(problem => problem.id === '200'), false);
  const unknown = clone(restored);
  unknown.records.push(record('2026-10-03', 'independent', { problemId: '999999' }));
  assert.throws(() => Core.validateState(unknown, revisedCatalog, '2026-10-16'), /未知/);
  assert.throws(() => Core.createState({ ...revisedCatalog, retiredProblems: [{ id: '200', categoryId: 'unknown-topic' }] }), /未知专题/);
});

test('current schema stores free-form notes, links and documents without generating activity', () => {
  const data = state();
  assert.equal(Core.SCHEMA_VERSION, 3);
  assert.deepEqual(data.animationLinks, { '1': 'https://www.algomooc.com/leetcode-animation/two-sum' });
  assert.deepEqual(data.topicDocs, {});
  const long = '专题文档\n```go\nfunc main() {}\n```\n'.repeat(8000);
  data.notes['206'] = { content: '自由组织笔记\n## 自己的标题\n```go\nnext := node.Next\n```', updatedAt: null,
    versions: [{ id: 'free-version', createdAt: '2026-10-01T08:00:00.000Z', content: '之前的自由笔记' }] };
  data.animationLinks['206'] = 'https://example.org/animation/reverse-list?lang=zh#start';
  data.animationLinks['92'] = '';
  data.topicDocs['linked-list'] = { content: long, fileName: '链表前置知识.md', updatedAt: '2026-10-02T08:00:00.000Z' };
  const restored = restore(JSON.stringify(Core.backupEnvelope(data, catalog.version)));
  assert.deepEqual(restored, data);
  assert.equal(restored.topicDocs['linked-list'].content.length, long.length);
  assert.equal(restored.records.length, 0);
  assert.equal(result(restored.records).stage, 0);
  assert.equal(restored.notes['206'].versions[0].content, '之前的自由笔记');
});

test('legacy three-column notes and all versions migrate losslessly exactly once', () => {
  const old = legacyState();
  const thoughts = '\n心得 constructor 只是正文\n'.repeat(10000);
  const analysis = '```go\nfunc reverseList() {}\n```\n'.repeat(12000);
  const summary = '  首尾空白也保留\n';
  old.notes['206'] = { thoughts, analysis, summary, updatedAt: '2026-10-01T08:00:00.000Z',
    versions: [
      { id: 'legacy-long-version', createdAt: '2026-10-01T07:00:00.000Z', fields: { thoughts, analysis, summary } },
      { id: 'legacy-empty-version', createdAt: '2026-10-01T06:00:00.000Z', fields: { thoughts: '', analysis: '  \n', summary: '' } }
    ] };
  old.notes['92'] = { thoughts: '', analysis: '', summary: '', updatedAt: null, versions: [] };
  old.plans = [{ id: 'legacy-plan', problemId: '206', date: null, purpose: 'learn', createdAt: '2026-10-01T08:00:00.000Z' }];
  old.records = [record('2026-10-01', 'thinking', { planId: 'legacy-plan', note: thoughts }), record('2026-10-02')];
  old.topicBookmarks['linked-list'] = '206';
  old.topicStates['linked-list'] = 'paused';
  old.dayStates['2026-10-03'] = 'stop';
  old.reviewOverrides['206'] = { date: '2026-11-01', paused: true };
  const before = clone(old);
  const migrated = restore(legacyBackup(old));
  const expected = '## 心得想法\n\n' + thoughts + '\n\n## 解题分析\n\n' + analysis + '\n\n## 总结复盘\n\n' + summary;
  assert.equal(migrated.schemaVersion, 3);
  assert.equal(migrated.notes['206'].content, expected);
  assert.equal(migrated.notes['206'].updatedAt, old.notes['206'].updatedAt);
  assert.equal(migrated.notes['206'].versions[0].content, expected);
  assert.equal(migrated.notes['206'].versions[0].id, 'legacy-long-version');
  assert.equal(migrated.notes['206'].versions[0].createdAt, '2026-10-01T07:00:00.000Z');
  assert.equal(migrated.notes['206'].versions[1].content, '## 解题分析\n\n  \n');
  assert.equal(migrated.notes['92'].content, '');
  for (const key of ['records', 'plans', 'topicBookmarks', 'topicStates', 'dayStates', 'reviewOverrides']) assert.deepEqual(migrated[key], old[key]);
  assert.deepEqual(old, before);
  assert.deepEqual(validate(old), migrated);
  assert.deepEqual(validate(migrated), migrated);
  assert.deepEqual(restore(JSON.stringify(Core.backupEnvelope(migrated, catalog.version))), migrated);
});

test('legacy migration also preserves retired references and old notes versions', () => {
  const revisedCatalog = { ...catalog, retiredCategories: [{ id: 'topic-13', patterns: [] }],
    retiredProblems: [{ id: '200', categoryId: 'topic-13' }] };
  const old = legacyState();
  old.focus = { categoryId: 'topic-13', problemId: '200' };
  old.topicBookmarks['topic-13'] = '200';
  old.records = [record('2026-10-01', 'thinking', { problemId: '200' }), record('2026-10-02')];
  old.notes['200'] = { thoughts: '岛屿原有心得', analysis: '旧图搜索分析', summary: '历史总结', updatedAt: null,
    versions: [{ id: 'retired-v1', createdAt: '2026-10-01T08:00:00.000Z', fields: { thoughts: '旧版', analysis: '', summary: '' } }] };
  const migrated = restore(legacyBackup(old), revisedCatalog);
  assert.deepEqual(migrated.focus, old.focus);
  assert.deepEqual(migrated.records, old.records);
  assert.equal(migrated.notes['200'].content, '## 心得想法\n\n岛屿原有心得\n\n## 解题分析\n\n旧图搜索分析\n\n## 总结复盘\n\n历史总结');
  assert.equal(migrated.notes['200'].versions[0].content, '## 心得想法\n\n旧版');
});

test('legacy data is strictly checked before migration instead of dropping unsupported content', () => {
  const valid = legacyState();
  valid.notes['206'] = { thoughts: '想法', analysis: '', summary: '', updatedAt: null,
    versions: [{ id: 'v1', createdAt: '2026-10-01T08:00:00.000Z', fields: { thoughts: '', analysis: '旧分析', summary: '' } }] };
  const extraNote = clone(valid); extraNote.notes['206'].custom = '不能静默丢弃';
  assert.throws(() => validate(extraNote), /未知字段/);
  const extraVersion = clone(valid); extraVersion.notes['206'].versions[0].fields.custom = '不能丢弃';
  assert.throws(() => restore(legacyBackup(extraVersion)), /未知字段/);
  const badText = clone(valid); badText.notes['206'].analysis = null;
  assert.throws(() => validate(badText), /文本/);
  const badFuture = clone(valid); badFuture.records = [record('2026-10-17')];
  assert.throws(() => restore(legacyBackup(badFuture)), /未来/);
  const badUnknown = clone(valid); badUnknown.animationLinks = {};
  assert.throws(() => validate(badUnknown), /未知字段/);
  const dangerous = legacyBackup(valid).replace('"thoughts":"想法"', '"__proto__":{},"thoughts":"想法"');
  assert.throws(() => restore(dangerous), /危险字段/);
  assert.throws(() => Core.backupEnvelope(valid, catalog.version), /validateState/);
  const mismatched = JSON.parse(legacyBackup(valid)); mismatched.schemaVersion = 2;
  assert.throws(() => restore(JSON.stringify(mismatched)), /数据版本不一致/);
  const future = JSON.parse(legacyBackup(valid)); future.schemaVersion = 4; future.state.schemaVersion = 4;
  assert.throws(() => restore(JSON.stringify(future)), /更高版本/);
});

test('animation URL normalization trims safe addresses and rejects executable or credential URLs', () => {
  assert.equal(Core.normalizeWebUrl('  https://example.org/animation?id=1#play  '), 'https://example.org/animation?id=1#play');
  assert.equal(Core.normalizeWebUrl(' \n '), '');
  assert.equal(Core.normalizeWebUrl('http://localhost:8080/two-sum'), 'http://localhost:8080/two-sum');
  for (const unsafe of ['javascript:alert(1)', 'data:text/html,<script>alert(1)</script>', 'file:///etc/passwd',
    'https://user:secret@example.org/a', 'https://user@example.org', '//example.org/a', 'not a url', 'https://exam\nple.org']) {
    assert.throws(() => Core.normalizeWebUrl(unsafe), undefined, unsafe);
    const data = state(); data.animationLinks['206'] = unsafe;
    assert.throws(() => restore(JSON.stringify(Core.backupEnvelope(data, catalog.version))), undefined, unsafe);
  }
  const data = state(); data.animationLinks['206'] = '  https://example.org/safe  ';
  assert.equal(validate(data).animationLinks['206'], 'https://example.org/safe');
  data.animationLinks = {};
  assert.deepEqual(restore(JSON.stringify(Core.backupEnvelope(data, catalog.version))).animationLinks, {});
});

test('topic documents and animation links require known references and strict shapes', () => {
  const data = state();
  data.animationLinks['999999'] = 'https://example.org/video';
  assert.throws(() => validate(data), /未知/);
  delete data.animationLinks['999999'];
  data.topicDocs['unknown-category'] = { content: '内容', fileName: 'doc.md', updatedAt: null };
  assert.throws(() => validate(data), /未知/);
  delete data.topicDocs['unknown-category'];
  data.topicDocs['linked-list'] = { content: '内容', fileName: 'doc.md', updatedAt: null, hiddenData: '不能丢弃' };
  assert.throws(() => validate(data), /未知字段/);
  delete data.topicDocs['linked-list'].hiddenData;
  data.topicDocs['linked-list'].updatedAt = '2026-02-30T08:00:00.000Z';
  assert.throws(() => validate(data), /ISO/);
  data.topicDocs['linked-list'].updatedAt = null;
  data.topicDocs['linked-list'].fileName = 123;
  assert.throws(() => validate(data), /文本/);
});
