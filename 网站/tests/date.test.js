'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const D = require('../src/date.js');

test('calendar weeks start on Monday and include leap day and adjacent month dates', () => {
  const days = D.monthGrid('2024-02-15');
  assert.equal(days.length, 42);
  assert.equal(days[0], '2024-01-29');
  assert.equal(days[41], '2024-03-10');
  assert.equal(days.filter(day => day === '2024-02-29').length, 1);
});
test('month navigation preserves a day when possible and clamps end-of-month dates', () => {
  assert.equal(D.shiftMonth('2024-01-31', 1), '2024-02-29');
  assert.equal(D.shiftMonth('2023-01-31', 1), '2023-02-28');
  assert.equal(D.shiftMonth('2024-02-29', 12), '2025-02-28');
  assert.equal(D.shiftMonth('2026-12-17', 1), '2027-01-17');
  assert.equal(D.shiftMonth('2026-01-17', -1), '2025-12-17');
});
test('practice cutoff disables future dates while unbounded plans allow them', () => {
  assert.equal(D.allowed('2026-10-17', '', '2026-10-17'), true);
  assert.equal(D.allowed('2026-10-18', '', '2026-10-17'), false);
  assert.equal(D.allowed('2026-10-18', '', ''), true);
  assert.equal(D.allowed('2026-10-15', '2026-10-16', ''), false);
  assert.equal(D.allowed('2026-02-30', '', ''), false);
});
test('month navigation remains available when only part of that month is selectable', () => {
  assert.equal(D.monthAllowed('2026-10-01', '2026-10-16', '2026-10-17'), true);
  assert.equal(D.monthAllowed('2026-09-01', '2026-10-16', '2026-10-17'), false);
  assert.equal(D.monthAllowed('2026-11-01', '', '2026-10-17'), false);
  assert.equal(D.monthAllowed('9999-12-01', '', '9999-12-31'), true);
});
test('calendar navigation handles the supported year limits without overflowing', () => {
  assert.equal(D.shiftMonth('0001-01-01', -1), null);
  assert.equal(D.shiftMonth('9999-12-31', 1), null);
  assert.equal(D.monthGrid('0001-01-01')[0], '0001-01-01');
  const end = D.monthGrid('9999-12-01');
  assert.ok(end.includes('9999-12-31'));
  assert.ok(end.includes(null));
  assert.ok(end.filter(Boolean).every(day => /^\d{4}-\d{2}-\d{2}$/.test(day)));
});
test('invalid dates cannot enter a date picker calculation', () => {
  assert.deepEqual(D.monthGrid('2026-02-30'), []);
  assert.equal(D.shiftMonth('2026-02-30', 1), null);
  assert.equal(D.shiftMonth('2026-10-17', 0.5), null);
  assert.equal(D.monthAllowed('invalid', '', ''), false);
});
