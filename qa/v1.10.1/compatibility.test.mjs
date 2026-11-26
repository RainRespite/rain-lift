import test, {after} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {unpackBaseline} from '../v1.8.5/baseline.mjs';
import {Storage} from '../../tests/helpers/app-harness.mjs';
import * as data from '../../dist/data.js';
import * as backup from '../../dist/backup.js';

const tmp = mkdtempSync(join(tmpdir(), 'rainlift-1101-compat-'));
after(() => rmSync(tmp, {recursive: true, force: true}));
unpackBaseline(tmp, 'v1.9.6');
const oldModule = name => import(pathToFileURL(join(tmp, 'dist', name)).href);
const [old, oldBackup] = await Promise.all(['data.js', 'backup.js'].map(oldModule));

const now = Date.now(), day = 86400000;

// A phone still on v1.9.6 holds the released shape: no exercise carries an
// optional slot, no plan carries a daily selection, and the six-part full
// backup is still the carrier.
function releasedDb() {
  const db = old.initial(), plan = db.plans[0];
  old.syncExerciseGroup(db, plan.exercises[0].id, '背');
  old.putLibraryExercise(db, {...structuredClone(plan.exercises[1]), group: '手臂'});
  return db;
}

test('a v1.9.6 plan trains every movement as fixed and stores no day fields', () => {
  const db = releasedDb();
  assert.doesNotThrow(() => data.validate(db), 'v1.10.1 直接认旧数据');
  const plan = db.plans[0];
  assert.equal(plan.daily, undefined);
  assert.deepEqual(plan.exercises.map(e => e.optional), [undefined, undefined, undefined]);
  assert.deepEqual(data.planFixedExercises(plan).map(e => e.name), plan.exercises.map(e => e.name));
  assert.deepEqual(data.dailyExercises(db, plan), [], '没有当日选');
  assert.deepEqual(data.todayExercises(db, plan).map(e => e.name), plan.exercises.map(e => e.name), '全部照旧开练');
  data.start(db, plan.id);
  assert.deepEqual(db.active.movements.map(m => m.exercise.name), plan.exercises.map(e => e.name));
  assert.equal(Object.hasOwn(db.active.movements[0].exercise, 'optional'), false, '快照里不会冒出槽位字段');
  assert.equal(db.plans[0].daily, undefined);
});

test('v1.9.6 code reads a plan with day picks and keeps both fields untouched', () => {
  const db = releasedDb(), plan = db.plans[0];
  plan.exercises[2].optional = true;
  const bench = db.plans[1].exercises[0];
  data.pickDailyExercises(db, plan, [plan.exercises[2].id, bench.id]);
  assert.deepEqual(plan.daily, {date: data.dayKey(), ids: [plan.exercises[2].id, bench.id]});
  const storage = new Storage();
  storage.setItem(data.KEY, JSON.stringify(db));
  const file = backup.exportFull(storage, new data.Repository(storage).db, now);
  const phone = new Storage();
  oldBackup.restoreFull(phone, oldBackup.parseFull(JSON.stringify(file)));
  const reopened = new old.Repository(phone);
  assert.deepEqual(reopened.db, db, '旧版读得懂当日选，原样保留不改写');
  assert.equal(reopened.db.plans[0].exercises[2].optional, true);
  old.start(reopened.db, reopened.db.plans[0].id);
  assert.deepEqual(reopened.db.active.movements.map(m => m.exercise.name), ['宽距高位下拉', '坐姿划船', '哑铃弯举'],
    '旧版没有当日页，把计划里的动作全部练一遍');
  old.record(reopened.db, reopened.db.active.movements[0].id, 10, 40, true, now - day);
  const again = new Storage();
  again.setItem(data.KEY, JSON.stringify(reopened.db));
  const back = backup.exportFull(again, reopened.db, now);
  assert.equal(back.minimumAppVersion, file.minimumAppVersion, '备份格式未变，不提高最低版本');
  const storage2 = new Storage();
  backup.restoreFull(storage2, backup.parseFull(JSON.stringify(back)));
  const current = new data.Repository(storage2);
  assert.deepEqual(current.db, reopened.db, '旧版再导出后固定动作、当日选和新增组都完整回来');
  assert.deepEqual(data.todayExercises(current.db, current.db.plans[0]).map(e => e.name), ['宽距高位下拉', '坐姿划船', '哑铃弯举', '卧推']);
});

test('a v1.9.6 session already in progress finishes on v1.10.1 unchanged', () => {
  const db = releasedDb();
  old.start(db, db.plans[0].id);
  old.record(db, db.active.movements[0].id, 10, 40, true, now - day);
  old.record(db, db.active.movements[1].id, 8, 35, true, now - day + 60000);
  const storage = new Storage();
  storage.setItem(data.KEY, JSON.stringify(db));
  const repository = new data.Repository(storage);
  const snapshot = structuredClone(repository.db);
  assert.doesNotThrow(() => data.validate(repository.db));
  assert.equal(repository.db.active.movements.length, 3, '进行中的训练不会偷偷长动作');
  repository.change(d => data.record(d, d.active.movements[2].id, 12, 20, true, now));
  assert.equal(repository.db.active.movements[2].sets.length, 1);
  repository.change(d => data.finish(d));
  assert.equal(repository.db.active, null);
  assert.deepEqual(repository.db.history[0].movements.map(m => m.exercise.name), snapshot.active.movements.map(m => m.exercise.name));
  assert.equal(repository.db.plans[0].daily, undefined, '结束训练不会写下当日选');
  assert.deepEqual(repository.db.plans[0].exercises.map(e => e.optional), [undefined, undefined, undefined]);
});
