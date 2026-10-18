'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Core = require('./core.js');
const base = require('./catalog.json');
const clone = x => JSON.parse(JSON.stringify(x));
const fresh = () => Core.createState(base, '2026-10-18');
const mutate = (s, action, data) => Core.mutateCatalog(s, base, action, data);
const resolve = s => Core.resolveCatalog(base, s.catalogEdits);
const add = (s, extra = {}) => mutate(s, 'addProblem', { id: '242', title: '有效的字母异位词', url: 'https://leetcode.cn/problems/valid-anagram/', categoryId: 'topic-1', patternId: 'topic-1-pattern-2', role: 'extra', key: '统计字母频次', animation: 'https://example.org/242', ...extra });
function withHistory(s) {
  s.focus = { categoryId: 'topic-1', problemId: '1' };
  s.topicBookmarks['topic-1'] = '1';
  s.notes['1'] = { content: '# 原有笔记\n```go\nmap[int]int{}\n```', updatedAt: null, versions: [{ id: 'old-version', createdAt: '2026-10-17T08:00:00Z', content: '旧内容' }] };
  s.records.push({ id: 'record-one', problemId: '1', date: '2026-10-17', createdAt: '2026-10-17T08:00:00Z', outcome: 'hint', purpose: 'learn', minutes: 35, note: '原有随记', planId: 'plan-one' });
  s.plans.push({ id: 'plan-one', problemId: '1', date: '2026-10-20', createdAt: '2026-10-17T08:00:00Z', purpose: 'learn' });
  s.reviewOverrides['1'] = { paused: false, date: '2026-10-21' };
  return s;
}

test('untouched catalog keeps the chosen 140 problems and 16 categories; retired graphs stay hidden', () => {
  const s = fresh(), c = resolve(s);
  assert.equal(c.problems.length, 140); assert.equal(c.categories.length, 16);
  assert.equal(c.retiredProblems.length, 7); assert.equal(c.retiredCategories.length, 1);
  assert.equal(c.problems.some(p => ['200', '54', '48', '73', '240'].includes(p.id)), false);
  assert.deepEqual(base, require('./catalog.json'));
});

test('new problem becomes a route variant and backup restores all metadata without bundling it into source', () => {
  const s = add(fresh()), c = resolve(s);
  assert.equal(c.problems.length, 141);
  assert(c.categories[0].patterns.find(p => p.id === 'topic-1-pattern-2').extraIds.includes('242'));
  assert.equal(s.animationLinks['242'], 'https://example.org/242');
  const restored = Core.parseBackup(JSON.stringify(Core.backupEnvelope(s, base.version)), base);
  assert.deepEqual(restored, s); assert.deepEqual(resolve(restored), c);
  assert.equal(base.problems.some(p => p.id === '242'), false);
});

test('problem titles cannot change, while editing links keeps identity and every learning artifact', () => {
  const s = withHistory(fresh()), before = clone(s);
  const p = base.problems.find(p => p.id === '1');
  assert.throws(() => mutate(s, 'editProblem', { ...p, title: '两数之和（补数法）', animation: s.animationLinks['1'] }), /题名创建后固定/);
  assert.deepEqual(s, before);
  const edited = mutate(s, 'editProblem', { ...p, url: 'https://example.org/two-sum', animation: s.animationLinks['1'] });
  assert.equal(resolve(edited).problems.find(p => p.id === '1').title, p.title);
  assert.equal(resolve(edited).problems.find(p => p.id === '1').url, 'https://example.org/two-sum');
  for (const key of ['notes', 'plans', 'records', 'reviewOverrides']) assert.deepEqual(edited[key], before[key]);
  assert.deepEqual(s, before);
});

test('new and restored custom questions keep the title fixed after the first save', () => {
  let s = add(fresh());
  for (let step = 0; step < 2; step += 1) {
    const p = resolve(s).problems.find(p => p.id === '242');
    const before = clone(s);
    assert.throws(() => mutate(s, 'editProblem', { ...p, title: '改成别的题名', animation: s.animationLinks['242'] }), /题名创建后固定/);
    assert.deepEqual(s, before);
    if (step === 0) s = mutate(mutate(s, 'deleteProblems', { ids: ['242'] }), 'restoreProblems', { ids: ['242'] });
  }
  assert.equal(resolve(s).problems.find(p => p.id === '242').title, '有效的字母异位词');
});

test('existing title overrides are preserved and locked instead of resetting to bundled names', () => {
  const s = withHistory(fresh()), original = base.problems.find(p => p.id === '1');
  s.catalogEdits.problems.push({ ...original, title: '以前保存的题名' });
  const restored = Core.parseBackup(JSON.stringify(Core.backupEnvelope(s)), base);
  const saved = mutate(restored, 'editProblem', { ...original, title: '以前保存的题名', url: 'https://example.org/one', animation: s.animationLinks['1'] });
  assert.equal(resolve(saved).problems.find(p => p.id === '1').title, '以前保存的题名');
  assert.deepEqual(saved.notes, s.notes); assert.deepEqual(saved.records, s.records);
  assert.throws(() => mutate(saved, 'editProblem', { ...original, animation: s.animationLinks['1'] }), /题名创建后固定/);
});

test('moving problems derives both route memberships and repairs focus/bookmarks without rewriting learning data', () => {
  const s = withHistory(fresh());
  const moved = mutate(s, 'moveProblems', { ids: ['1', '49'], categoryId: 'topic-2', patternId: 'topic-2-pattern-3' });
  const c = resolve(moved);
  assert.deepEqual(moved.focus, { categoryId: 'topic-2', problemId: '1' });
  assert.equal(moved.topicBookmarks['topic-1'], undefined);
  assert(!c.categories.find(c => c.id === 'topic-1').patterns.flatMap(p => p.coreIds.concat(p.extraIds)).includes('1'));
  assert(c.categories.find(c => c.id === 'topic-2').patterns.find(p => p.id === 'topic-2-pattern-3').coreIds.includes('1'));
  assert.deepEqual(moved.records, s.records); assert.deepEqual(moved.notes, s.notes); assert.deepEqual(moved.plans, s.plans);
  assert.deepEqual(Core.validateState(moved, base), moved);
});

test('batch deletion removes route/review eligibility and focus but preserves every learning artifact for restore', () => {
  const s = withHistory(fresh());
  const deleted = mutate(s, 'deleteProblems', { ids: ['1', '49'] }), c = resolve(deleted);
  assert(!c.problems.some(p => p.id === '1')); assert(c.retiredProblems.some(p => p.id === '1'));
  assert.equal(deleted.focus.problemId, null); assert.equal(deleted.topicBookmarks['topic-1'], undefined);
  for (const key of ['notes', 'plans', 'records', 'reviewOverrides', 'animationLinks']) assert.deepEqual(deleted[key], s[key]);
  const restored = mutate(deleted, 'restoreProblems', { ids: ['1', '49'] });
  assert.equal(resolve(restored).problems.length, 140);
  assert.deepEqual(restored.notes, s.notes); assert.deepEqual(restored.records, s.records);
  assert.deepEqual(Core.parseBackup(JSON.stringify(Core.backupEnvelope(deleted)), base), deleted);
});

test('duplicate question IDs, including those in trash, cannot create disconnected copies', () => {
  const s = fresh();
  assert.throws(() => add(s, { id: '1' }), /已存在/);
  assert.throws(() => add(s, { id: '200' }), /回收站/);
  assert.throws(() => add(s, { id: '0242' }), /正整数/);
  assert.throws(() => add(s, { id: '242.5' }), /正整数/);
  assert.throws(() => add(s, { title: '  ' }), /不能为空/);
  assert.equal(resolve(s).problems.length, 140);
});

test('creating, renaming, sorting and recycling a category retains its document and stable identity', () => {
  let s = mutate(fresh(), 'saveCategory', { id: null, title: '自选练习' });
  const category = resolve(s).categories.find(c => c.title === '自选练习');
  assert.equal(category.patterns[0].title, '未分类');
  s.topicDocs[category.id] = { content: '## 预备知识\n保留这份文档', fileName: '自选练习.md', updatedAt: null };
  s = mutate(s, 'saveCategory', { id: category.id, title: '个人精选' });
  s = mutate(s, 'orderCategory', { id: category.id, direction: -1 });
  assert.equal(resolve(s).categories.at(-2).id, category.id);
  const deleted = mutate(s, 'deleteCategory', { id: category.id });
  assert(!resolve(deleted).categories.some(c => c.id === category.id));
  assert.equal(deleted.topicDocs[category.id].content, s.topicDocs[category.id].content);
  const restored = mutate(deleted, 'restoreCategory', { id: category.id });
  assert.equal(resolve(restored).categories.find(c => c.id === category.id).title, '个人精选');
  assert.deepEqual(restored.topicDocs, s.topicDocs);
});

test('nonempty category cannot be deleted, and deleting an empty one never loses its recycled problems', () => {
  const s = fresh();
  assert.throws(() => mutate(s, 'deleteCategory', { id: 'topic-1' }), /先转移/);
  const ids = base.problems.filter(p => p.categoryId === 'topic-1').map(p => p.id);
  const deleted = mutate(mutate(s, 'deleteProblems', { ids }), 'deleteCategory', { id: 'topic-1' });
  const restored = mutate(deleted, 'restoreProblems', { ids: ['1'] });
  assert(resolve(restored).categories.some(c => c.id === 'topic-1'));
  assert(resolve(restored).problems.some(p => p.id === '1'));
  assert(!resolve(restored).problems.some(p => p.id === '49'));
});

test('pattern renames and ordering preserve problem references; used patterns and last pattern cannot be removed', () => {
  let s = mutate(fresh(), 'savePattern', { categoryId: 'topic-1', id: 'topic-1-pattern-1', title: '补数配对', key: '先查再存' });
  assert.equal(resolve(s).categories[0].patterns[0].title, '补数配对');
  assert.equal(resolve(s).problems.find(p => p.id === '1').patternId, 'topic-1-pattern-1');
  s = mutate(s, 'orderPattern', { categoryId: 'topic-1', id: 'topic-1-pattern-1', direction: 1 });
  assert.equal(resolve(s).categories[0].patterns[1].id, 'topic-1-pattern-1');
  assert.throws(() => mutate(s, 'deletePattern', { categoryId: 'topic-1', id: 'topic-1-pattern-1' }), /先转移/);
  s = mutate(s, 'saveCategory', { id: null, title: '空专题' });
  const c = resolve(s).categories.find(c => c.title === '空专题');
  assert.throws(() => mutate(s, 'deletePattern', { categoryId: c.id, id: c.patterns[0].id }), /至少保留/);
  s = mutate(s, 'savePattern', { categoryId: c.id, id: null, title: '新小题型', key: '' });
  s = mutate(s, 'deletePattern', { categoryId: c.id, id: c.patterns[0].id });
  assert.equal(resolve(s).categories.find(x => x.id === c.id).patterns.length, 1);
});

test('restoring a legacy retired problem explicitly restores its category, without restoring all its peers', () => {
  const restored = mutate(fresh(), 'restoreProblems', { ids: ['200'] });
  assert(resolve(restored).categories.some(c => c.id === 'topic-13'));
  assert(resolve(restored).problems.some(p => p.id === '200'));
  assert(!resolve(restored).problems.some(p => p.id === '695'));
});

test('catalog edits reject orphan links, duplicate names and unsafe URLs atomically', () => {
  const s = fresh(), before = clone(s);
  assert.throws(() => add(s, { categoryId: 'missing' }), /目标专题/);
  assert.throws(() => add(s, { patternId: 'topic-2-pattern-1' }), /小题型/);
  assert.throws(() => add(s, { url: 'javascript:alert(1)' }), /HTTP|http/);
  assert.throws(() => add(s, { animation: 'data:text/html,no' }), /HTTP|http/);
  assert.throws(() => mutate(s, 'saveCategory', { id: null, title: '哈希表与计数' }), /重复/);
  assert.throws(() => mutate(s, 'savePattern', { categoryId: 'topic-1', id: null, title: '查找配对', key: '' }), /重复/);
  assert.deepEqual(s, before);
});

test('malformed catalog overrides and prototype keys are rejected during backup restoration', () => {
  const s = add(fresh());
  let bad = clone(s); bad.catalogEdits.problems[0].patternId = 'unknown-pattern';
  assert.throws(() => Core.validateState(bad, base), /归属/);
  bad = clone(s); bad.catalogEdits.problemStates['999999'] = false;
  assert.throws(() => Core.validateState(bad, base), /未知/);
  bad = clone(s); bad.catalogEdits.categoryOrder = ['unknown-category'];
  assert.throws(() => Core.validateState(bad, base), /未知/);
  bad = clone(s); bad.catalogEdits.problems[0].injected = true;
  assert.throws(() => Core.validateState(bad, base), /未知字段/);
  const raw = JSON.stringify(Core.backupEnvelope(s)).replace('"categoryStates":{}', '"categoryStates":{"__proto__":true}');
  assert.throws(() => Core.parseBackup(raw, base), /危险字段/);
});

test('v2 backup upgrades without changing personal data or making retired categories active', () => {
  const old = withHistory(fresh()); old.schemaVersion = 2; delete old.catalogEdits;
  const envelope = { app: Core.APP_NAME, schemaVersion: 2, catalogVersion: old.catalogVersion, exportedAt: '2026-10-17T08:00:00Z', state: old };
  const upgraded = Core.parseBackup(JSON.stringify(envelope), base);
  assert.equal(upgraded.schemaVersion, 3);
  for (const key of ['notes', 'records', 'plans', 'focus', 'topicBookmarks', 'reviewOverrides', 'animationLinks', 'topicDocs']) assert.deepEqual(upgraded[key], old[key]);
  assert.deepEqual(upgraded.catalogEdits, Core.emptyCatalogEdits());
  assert.equal(resolve(upgraded).problems.length, 140);
});

test('new bundled problems survive later upgrades while user overrides and deletions take precedence', () => {
  let s = add(fresh()); s = mutate(s, 'deleteProblems', { ids: ['1'] });
  const upgradedBase = clone(base);
  upgradedBase.version = 'future-base';
  upgradedBase.problems.push({ ...base.problems[0], id: '9999', title: '新内置题目' });
  const restored = Core.parseBackup(JSON.stringify(Core.backupEnvelope(s)), upgradedBase);
  const c = Core.resolveCatalog(upgradedBase, restored.catalogEdits);
  assert(c.problems.some(p => p.id === '9999')); assert(c.problems.some(p => p.id === '242'));
  assert(!c.problems.some(p => p.id === '1'));
});

test('catalog mutations handle deleting every active question/category without invalid focus or references', () => {
  let s = withHistory(fresh());
  s = mutate(s, 'deleteProblems', { ids: base.problems.map(p => p.id) });
  for (const c of base.categories) s = mutate(s, 'deleteCategory', { id: c.id });
  assert.equal(resolve(s).problems.length, 0); assert.equal(resolve(s).categories.length, 0);
  assert.deepEqual(s.focus, { categoryId: null, problemId: null });
  assert.deepEqual(Core.parseBackup(JSON.stringify(Core.backupEnvelope(s)), base), s);
  s = mutate(s, 'restoreProblems', { ids: ['1'] });
  assert.equal(resolve(s).problems.length, 1); assert.equal(resolve(s).categories.length, 1);
  assert.equal(s.notes['1'].content, '# 原有笔记\n```go\nmap[int]int{}\n```');
});
