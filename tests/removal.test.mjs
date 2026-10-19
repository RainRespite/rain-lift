import test from 'node:test';
import assert from 'node:assert/strict';
import {initial, start, record, finish, Repository} from '../dist/data.js';
import {createAppHarness} from './helpers/app-harness.mjs';

function shoulderTraining({recorded = false} = {}) {
  const d = initial(), plan = d.plans[1];
  plan.name = '肩';
  start(d, plan.id);
  if (recorded) record(d, d.active.movements[0].id, 10, 20);
  return d;
}

test('removing a fixed-plan exercise saves through actual editor callback and reload', () => {
  const d = shoulderTraining(), planID = d.plans[1].id, removedID = d.plans[1].exercises[0].id;
  const h = createAppHarness(d);
  h.action('plan-edit', {id: planID});
  h.modalAction('remove-0');
  h.submit();
  const reloaded = new Repository(h.storage).db;
  assert.equal(reloaded.plans[1].exercises.some(e => e.id === removedID), false);
  assert.equal(reloaded.active.movements.some(m => m.exercise.id === removedID), true);
});

test('an unrecorded selected movement can be removed from shoulder training', () => {
  const d = shoulderTraining(), movementID = d.active.movements[0].id;
  const h = createAppHarness(d);
  h.action('select', {id: movementID});
  h.action('manage');
  h.modalAction('remove-0');
  assert.equal(h.state.active.movements.some(m => m.id === movementID), false);
  assert.equal(new Repository(h.storage).db.active.movements.some(m => m.id === movementID), false);
  assert.equal(h.state.plans[1].exercises.length, d.plans[1].exercises.length);
  assert.match(h.html, new RegExp(h.state.active.movements[0].exercise.name));
});

test('removing all unrecorded movements leaves an editable empty workout', () => {
  const h = createAppHarness(shoulderTraining());
  h.action('manage');
  while (h.state.active.movements.length) h.modalAction('remove-0');
  assert.match(h.html, /添加今天的动作/);
  assert.match(h.modalHtml, /data-modal="add"/);
  assert.equal(new Repository(h.storage).db.active.movements.length, 0);
});

test('removal affects the fixed plan only after explicitly saving this arrangement', () => {
  const d = shoulderTraining(), removedID = d.active.movements[0].exercise.id;
  const h = createAppHarness(d);
  h.action('manage');
  h.modalAction('remove-0');
  assert.equal(h.state.plans[1].exercises.some(e => e.id === removedID), true);
  h.modalAction('template');
  h.modalAction('confirm');
  assert.equal(new Repository(h.storage).db.plans[1].exercises.some(e => e.id === removedID), false);
});

test('a stale remove callback cannot delete sets recorded after the dialog opened', () => {
  const h = createAppHarness(shoulderTraining());
  h.action('manage');
  h.run('repo.change(d=>record(d,d.active.movements[0].id,10,20))');
  const before = h.state;
  h.modalAction('remove-0');
  assert.deepEqual(h.state, before);
  assert.match(h.toast, /已有记录/);
});

test('a storage failure leaves the selected exercise and original plan intact', () => {
  const h = createAppHarness(shoulderTraining());
  h.action('manage');
  const before = h.state;
  h.storage.fail = true;
  h.modalAction('remove-0');
  assert.deepEqual(h.state, before);
  assert.equal(h.modalOpen, true);
  assert.notEqual(h.toast, '已从本次训练移除');
});

test('skipping a recorded movement preserves sets and rest through updating its plan', () => {
  const d = shoulderTraining({recorded: true}), m = d.active.movements[0];
  const h = createAppHarness(d);
  h.action('manage');
  assert.doesNotMatch(h.modalHtml, /data-modal="remove-0"/);
  h.modalAction('skip-0');
  h.modalAction('template');
  h.modalAction('confirm');
  const saved = new Repository(h.storage).db;
  assert.equal(saved.active.movements[0].skipped, true);
  assert.deepEqual(saved.active.movements[0].sets, m.sets);
  assert.deepEqual(saved.rest, d.rest);
  assert.equal(saved.plans[1].exercises.some(e => e.id === m.exercise.id), false);
  finish(saved);
  assert.deepEqual(saved.history[0].movements[0].sets, m.sets);
});
