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
import {EXERCISE_META_KEY, LEGACY_EXERCISE_META_KEY} from '../../dist/exercise-meta.js';
import {HEALTH_KEY} from '../../dist/health.js';
import {PROFILE_KEY} from '../../dist/body-profile.js';

const tmp = mkdtempSync(join(tmpdir(), 'rainlift-192-compat-'));
after(() => rmSync(tmp, {recursive: true, force: true}));
unpackBaseline(tmp, 'v1.9.1');
const oldModule = name => import(pathToFileURL(join(tmp, 'dist', name)).href);
const [old, oldBackup] = await Promise.all(['data.js', 'backup.js'].map(oldModule));

const now = Date.now(), day = 86400000;
const KEYS = [data.KEY, data.TRAINING_V2_KEY, HEALTH_KEY, EXERCISE_META_KEY, LEGACY_EXERCISE_META_KEY, PROFILE_KEY];
const snapshot = storage => Object.fromEntries(KEYS.map(key => [key, storage.getItem(key)]));
const classifyAll = d => {for (const e of d.plans[0].exercises) data.syncExerciseGroup(d, e.id, '背');};

// A phone still on v1.9.1 holds the released shape: no exercise carries a
// category, and the six-part full backup is the only cross-device carrier.
function shippedBackup() {
  const db = old.initial(), plan = db.plans[0];
  old.start(db, plan.id);
  old.record(db, db.active.movements[0].id, 10, 40, true, now - 3 * day);
  old.record(db, db.active.movements[1].id, 12, 35, true, now - 3 * day + 60000);
  const storage = new Storage();
  storage.setItem(data.KEY, JSON.stringify(db));
  return {db, file: oldBackup.exportFull(storage, db, now)};
}

test('a v1.9.1 full backup opens unchanged and only gains the optional field when used', () => {
  const {db, file} = shippedBackup();
  const storage = new Storage();
  backup.restoreFull(storage, backup.parseFull(JSON.stringify(file)));
  const current = new data.Repository(storage);
  assert.deepEqual(current.db, db, '导入后记录与 v1.9.1 完全一致');
  assert.equal(Object.hasOwn(current.db.plans[0].exercises[0], 'group'), false);
  current.change(classifyAll);
  assert.equal(data.usedExerciseGroups(current.db).includes('背'), true);
  const upgraded = backup.exportFull(storage, current.db, now);
  assert.equal(upgraded.minimumAppVersion, file.minimumAppVersion, '备份格式未变，不提高最低版本');
  assert.equal(JSON.parse(upgraded.parts[data.KEY]).plans[0].exercises[0].group, '背');
  for (const key of Object.keys(file.parts).filter(key => key !== data.KEY && key !== data.TRAINING_V2_KEY))
    assert.equal(upgraded.parts[key], file.parts[key], key + ' 分区保持原样');
});

test('v1.9.1 code accepts a categorized backup and keeps recording on it', () => {
  const {db, file} = shippedBackup();
  const storage = new Storage();
  storage.setItem(data.KEY, JSON.stringify(db));
  const current = new data.Repository(storage);
  current.change(classifyAll);
  const categorized = backup.exportFull(storage, current.db, now);
  const phone = new Storage();
  oldBackup.restoreFull(phone, oldBackup.parseFull(JSON.stringify(categorized)));
  const reopened = new old.Repository(phone);
  assert.deepEqual(reopened.db, current.db, '旧版原样保留主类，不改写也不丢弃');
  reopened.change(d => old.record(d, d.active.movements[0].id, 8, 45, true, now - day));
  assert.equal(reopened.db.active.movements[0].sets.length, 2);
  assert.equal(reopened.db.active.movements[0].exercise.group, '背');
  const roundTrip = new Storage();
  backup.restoreFull(roundTrip, backup.parseFull(JSON.stringify(oldBackup.exportFull(phone, reopened.db, now))));
  assert.deepEqual(new data.Repository(roundTrip).db, reopened.db, '旧版再导出后分类和新增组都完整回来');
});

test('a v1.9.1 training-only import replaces categories with that file', () => {
  const {db, file} = shippedBackup();
  const storage = new Storage();
  storage.setItem(data.KEY, JSON.stringify(db));
  const current = new data.Repository(storage);
  current.change(classifyAll);
  const legacy = oldBackup.parseFull(JSON.stringify(file)).parts[data.KEY];
  storage.setItem(EXERCISE_META_KEY, JSON.stringify({format: 'rainlift-exercise-meta', version: 1, entries: [], bodyweightSessions: [{sessionID: 'missing', unit: 'kg', bodyWeight: 68}]}));
  backup.restoreTrainingOnly(storage, data.parseBackup(legacy), {expected: JSON.stringify(snapshot(storage))});
  const restored = new data.Repository(storage);
  assert.deepEqual(restored.db, db, '训练分区整体来自这份旧文件');
  assert.equal(storage.getItem(data.KEY), legacy);
  assert.equal(Object.hasOwn(restored.db.plans[0].exercises[1], 'group'), false);
  assert.notEqual(storage.getItem(backup.FULL_BEFORE_KEY), null, '恢复前副本已保存');
  assert.equal(JSON.parse(storage.getItem(EXERCISE_META_KEY + '.before-training-restore')).bodyweightSessions[0].sessionID, 'missing', '清理孤立的自重确认前先保留原分区');
});
