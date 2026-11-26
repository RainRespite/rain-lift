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

const tmp = mkdtempSync(join(tmpdir(), 'rainlift-196-compat-'));
after(() => rmSync(tmp, {recursive: true, force: true}));
unpackBaseline(tmp, 'v1.9.5');
const oldModule = name => import(pathToFileURL(join(tmp, 'dist', name)).href);
const [old, oldBackup] = await Promise.all(['data.js', 'backup.js'].map(oldModule));

const now = Date.now(), day = 86400000;

// A phone still on v1.9.5 holds the released shape: optional groups, an
// optional library, and the six-part full backup as the carrier.
function releasedDb({withLibrary = true} = {}) {
  const db = old.initial(), plan = db.plans[0];
  old.syncExerciseGroup(db, plan.exercises[0].id, '背');
  if (withLibrary) old.putLibraryExercise(db, {...structuredClone(plan.exercises[1]), group: '手臂'});
  return db;
}

function releasedBackup(options) {
  const db = releasedDb(options);
  old.start(db, db.plans[0].id);
  old.record(db, db.active.movements[0].id, 10, 40, true, now - 3 * day);
  old.record(db, db.active.movements[1].id, 12, 35, true, now - 3 * day + 60000);
  const storage = new Storage();
  storage.setItem(data.KEY, JSON.stringify(db));
  return {db, file: oldBackup.exportFull(storage, db, now)};
}

test('a v1.9.5 full backup opens unchanged and only gains library edits when used', () => {
  const {db, file} = releasedBackup();
  const storage = new Storage();
  backup.restoreFull(storage, backup.parseFull(JSON.stringify(file)));
  const current = new data.Repository(storage);
  assert.deepEqual(current.db, db, '导入后记录与 v1.9.5 完全一致');
  assert.equal(current.db.library.length, 1);
  current.change(d => {
    const e = d.plans[0].exercises[0];
    data.putLibraryExercise(d, {...structuredClone(e), group: '胸'});
    data.syncExerciseGroup(d, e.id, '胸');
  });
  assert.equal(current.db.library.length, 2);
  assert.equal(current.db.plans[0].exercises[0].group, '胸');
  const upgraded = backup.exportFull(storage, current.db, now);
  assert.equal(upgraded.minimumAppVersion, file.minimumAppVersion, '备份格式未变，不提高最低版本');
  const part = JSON.parse(upgraded.parts[data.KEY]);
  assert.equal(part.library[0].group, '手臂');
  assert.equal(part.library[1].group, '胸');
  for (const key of Object.keys(file.parts).filter(key => key !== data.KEY && key !== data.TRAINING_V2_KEY))
    assert.equal(upgraded.parts[key], file.parts[key], key + ' 分区保持原样');
});

test('v1.9.5 code accepts a backup with a library and keeps recording on it', () => {
  const {db, file} = releasedBackup({withLibrary: false});
  const storage = new Storage();
  backup.restoreFull(storage, backup.parseFull(JSON.stringify(file)));
  const current = new data.Repository(storage);
  current.change(d => {
    for (const e of d.plans[0].exercises.slice(0, 2)) {
      data.putLibraryExercise(d, structuredClone(e));
      data.syncExerciseGroup(d, e.id, '背');
    }
    data.putLibraryExercise(d, {...old.exercise('库内动作', 10, [8, 9, 10], 60), group: '手臂'});
  });
  const upgraded = backup.exportFull(storage, current.db, now);
  const phone = new Storage();
  oldBackup.restoreFull(phone, oldBackup.parseFull(JSON.stringify(upgraded)));
  const reopened = new old.Repository(phone);
  assert.deepEqual(reopened.db, current.db, '旧版读得懂动作库，原样保留不改写');
  reopened.change(d => old.record(d, d.active.movements[0].id, 8, 45, true, now - day));
  assert.equal(reopened.db.active.movements[0].sets.length, 2);
  assert.equal(reopened.db.library.length, 3);
  const roundTrip = new Storage();
  backup.restoreFull(roundTrip, backup.parseFull(JSON.stringify(oldBackup.exportFull(phone, reopened.db, now))));
  const back = new data.Repository(roundTrip);
  assert.deepEqual(back.db, reopened.db, '旧版再导出后动作库、分类和新增组都完整回来');
  assert.equal(data.libraryExercises(back.db).map(e => e.name).includes('库内动作'), true);
});

test('a v1.9.5 training-only import has no library and stays editable', () => {
  const {db, file} = releasedBackup({withLibrary: false});
  const storage = new Storage();
  storage.setItem(data.KEY, JSON.stringify(db));
  const current = new data.Repository(storage);
  current.change(d => data.putLibraryExercise(d, structuredClone(d.plans[1].exercises[0])));
  const legacy = oldBackup.parseFull(JSON.stringify(file)).parts[data.KEY];
  backup.restoreTrainingOnly(storage, data.parseBackup(legacy), {expected: backup.restoreFingerprint(storage)});
  const restored = new data.Repository(storage);
  assert.equal(restored.db.library, undefined, '训练单独备份整体替换，不保留目标端动作库');
  assert.equal(restored.db.plans[0].exercises[0].group, '背');
  restored.change(d => data.putLibraryExercise(d, {...structuredClone(d.plans[0].exercises[0]), group: '腿'}));
  assert.equal(restored.db.library[0].group, '腿', '升级后仍可在动作库分类');
});