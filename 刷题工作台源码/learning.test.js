'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Core = require('./core.js');
const catalog = require('./catalog.json');
const categoryId = 'topic-2';

function state(problemId = '283') {
  const value = Core.createState(catalog);
  value.focus = { categoryId, problemId };
  value.topicBookmarks[categoryId] = problemId;
  return value;
}

function record(problemId, outcome = 'solution', date = '2026-10-18', createdAt = date + 'T08:00:00.000Z') {
  return { id: 'record-' + problemId + '-' + createdAt, problemId, outcome, date, createdAt,
    minutes: null, note: '', planId: null, purpose: 'learn' };
}

test('the saved move-zeroes reproduction recommends merge-sorted-array without changing personal data or review', () => {
  const value = state();
  value.records.push(record('283'));
  value.notes['283'] = { content: '我的双指针分析', updatedAt: null, versions: [] };
  const before = structuredClone(value);
  assert.equal(Core.nextLearningProblemId(value, catalog), '88');
  assert.deepEqual(value, before);
  const review = Core.reviewFor('283', value.records);
  assert.equal(review.independentDays, 0);
  assert.equal(review.stage, 0);
  assert.equal(review.nextDate, '2026-10-19');
});

test('all three completed outcomes advance learning while unfinished thinking retains its position', () => {
  for (const outcome of ['independent', 'hint', 'solution', 'thinking']) {
    const value = state();
    value.records.push(record('283', outcome));
    assert.equal(Core.nextLearningProblemId(value, catalog), outcome === 'thinking' ? '283' : '88', outcome);
  }
  assert.equal(Core.nextLearningProblemId(state(), catalog), '283');
});

test('recommendations follow the displayed pattern order and skip previously completed questions', () => {
  const value = state();
  value.records = ['283', '88', '11'].map(id => record(id));
  assert.equal(Core.nextLearningProblemId(value, catalog), '15');
  value.records.push(record('15'));
  assert.equal(Core.nextLearningProblemId(value, catalog), '167');
  value.records.push(record('167'));
  assert.equal(Core.nextLearningProblemId(value, catalog), '42');
});

test('actual practice chronology controls resuming even when historical attempts are appended later', () => {
  const value = state();
  const completed = record('283');
  const olderThinking = record('283', 'thinking', '2026-10-17', '2026-10-18T09:00:00.000Z');
  value.records = [completed, olderThinking];
  assert.equal(Core.nextLearningProblemId(value, catalog), '88');
  value.records.push(record('283', 'thinking', '2026-10-18', '2026-10-18T09:00:00.000Z'));
  assert.equal(Core.nextLearningProblemId(value, catalog), '283');
});

test('editing or deleting completion records immediately updates the recommendation', () => {
  const value = state();
  value.records.push(record('283'));
  assert.equal(Core.nextLearningProblemId(value, catalog), '88');
  value.records[0].outcome = 'thinking';
  assert.equal(Core.nextLearningProblemId(value, catalog), '283');
  value.records[0].outcome = 'independent';
  assert.equal(Core.nextLearningProblemId(value, catalog), '88');
  value.records = [];
  assert.equal(Core.nextLearningProblemId(value, catalog), '283');
});

test('finishing a topic returns no next question and never switches to another topic', () => {
  const value = state('189');
  value.records = catalog.problems.filter(p => p.categoryId === categoryId).map(p => record(p.id));
  assert.equal(Core.nextLearningProblemId(value, catalog), null);
  assert.equal(value.focus.categoryId, categoryId);
  value.records = value.records.filter(r => r.problemId !== '88');
  assert.equal(Core.nextLearningProblemId(value, catalog), '88');
});

test('reopening an existing backup resolves its completed bookmark without migration or another attempt', () => {
  const value = state();
  value.records.push(record('283'));
  const restored = Core.parseBackup(JSON.stringify(Core.backupEnvelope(value, catalog.version)), catalog, '2026-10-18');
  assert.equal(Core.nextLearningProblemId(restored, catalog), '88');
  assert.equal(restored.records.length, 1);
  assert.deepEqual(restored.plans, []);
  assert.deepEqual(restored.topicBookmarks, value.topicBookmarks);
});

test('unselected and retired topics have no active recommendation, and other topics keep their own position', () => {
  const value = Core.createState(catalog);
  assert.equal(Core.nextLearningProblemId(value, catalog), null);
  assert.equal(Core.nextLearningProblemId(value, catalog, 'retired-topic'), null);
  value.focus = { categoryId: 'topic-1', problemId: '1' };
  value.topicBookmarks[categoryId] = '88';
  value.records.push(record('283'), record('1'));
  assert.equal(Core.nextLearningProblemId(value, catalog), '49');
  assert.equal(Core.nextLearningProblemId(value, catalog, categoryId), '88');
  assert.deepEqual(value.focus, { categoryId: 'topic-1', problemId: '1' });
});
