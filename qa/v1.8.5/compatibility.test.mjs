import test, {after} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, readFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {unpackBaseline} from './baseline.mjs';
import {Storage, createAppHarness} from '../../tests/helpers/app-harness.mjs';
import * as data from '../../dist/data.js';
import * as backup from '../../dist/backup.js';
import {prepareStorage} from '../../dist/body-ui.js';
import {HEALTH_KEY, HealthRepository} from '../../dist/health.js';
import {EXERCISE_META_KEY, LEGACY_EXERCISE_META_KEY, ExerciseMetaRepository} from '../../dist/exercise-meta.js';
import {PROFILE_KEY, ProfileRepository, profileSnapshot} from '../../dist/body-profile.js';
import {makeLoad} from '../../dist/load.js';
import {performanceDetails, setPerformance} from '../../dist/performance.js';

const oldPath=mkdtempSync(join(tmpdir(),'rainlift-184-test-'));
after(()=>rmSync(oldPath,{recursive:true,force:true}));
const baselineTag=process.env.RAINLIFT_COMPAT_BASELINE??'v1.8.4';
unpackBaseline(oldPath,baselineTag);
const fromOld = name => import(pathToFileURL(join(oldPath,'dist',name)).href);
const [old,oldBackup,oldUI]=await Promise.all(['data.js','backup.js','body-ui.js'].map(fromOld));
const now=Date.parse('2026-11-05T01:00:00Z');
const mark=(setType,effort=null,toFailure=false)=>({setType,toFailure,effort});
const synthHealth=readFileSync(new URL('../../tests/fixtures/apple-health.synthetic.json',import.meta.url),'utf8');
const fixture = (annotated=true) => {
 const storage=new Storage(),db=old.initial(),exercise=db.plans[0].exercises[0];
 exercise.name='合成引体动作';
 old.start(db,db.plans[0].id);
 const movement=db.active.movements[0];
 old.record(db,movement.id,8,73,false,now-2000);
 old.finish(db);
 storage.setItem(old.KEY,JSON.stringify(db));
 storage.setItem(LEGACY_EXERCISE_META_KEY,JSON.stringify({format:'rainlift-exercise-meta',version:1,entries:[],bodyweightSessions:[]}));
 const metadata=new ExerciseMetaRepository(storage);
 metadata.set(db,exercise,'bodyweight');
 metadata.setSessionBodyWeight(db,db.history[0].id,'kg',68);
 const profile=new ProfileRepository(storage);profile.update({weightKg:68},now-100);
 const health=new HealthRepository(storage);
 health.import(JSON.parse(synthHealth),now);
 const snapshot=profileSnapshot(profile.db),load=makeLoad('bodyweight_plus_extra','kg',5,snapshot);
 const module=annotated?data:old;
 for(const timing of [false,true]){
  module.start(db,db.plans[0].id,snapshot);
  module.record(db,db.active.movements[0].id,9,5,timing,now,load,annotated?mark(timing?'drop':'normal',{kind:'at_most',rpe:5},timing):undefined);
  if(!timing){module.finish(db);module.deleteHistory(db,db.history[0].id,now);}
 }
 if(annotated)db.effortDisplay='rir';
 storage.setItem(data.TRAINING_V2_KEY,JSON.stringify(db));
 return {storage,db};
};

test(`original ${baselineTag} full file → current → quick set keeps authoritative v2, exact v1 and independent parts`,()=>{
 const {storage,db}=fixture(false);
 const original=oldBackup.exportFull(storage,db,now),target=new Storage();
 backup.restoreFull(target,backup.parseFull(JSON.stringify(original)));
 assert.deepEqual(backup.exportFull(target,new data.Repository(target).db,now).parts,original.parts);
 const app=createAppHarness(null,{storage:target});
 app.action('next-set-type',{type:'warmup'});app.action('record',{reps:'8'});
 assert.equal(app.state.active.movements[0].sets[0].performance,undefined);
 assert.equal(app.state.active.movements[0].sets[1].performance.setType,'warmup');
 const exported=backup.exportFull(target,app.state,now);
 assert.deepEqual(Object.keys(exported.parts),Object.keys(original.parts));
 for(const key of Object.keys(original.parts).filter(key=>key!==data.TRAINING_V2_KEY))assert.equal(exported.parts[key],original.parts[key]);
});

test('old v1 active workout and Swift training export are accepted without reinterpreting old sets',()=>{
 const db=old.initial();old.start(db,db.plans[0].id);
 const m=db.active.movements[0],initial=old.record(db,m.id,9,73,true,now);
 const app=createAppHarness(db);
 app.action('record',{reps:'8'});
 assert.equal(app.state.version,1);
 assert.deepEqual(app.state.active.movements[0].sets[0],initial);
 assert.equal(app.state.active.movements[0].sets[1].performance.setType,'normal');
 app.action('finish');app.modalAction('confirm');
 assert.deepEqual(app.state.history[0].movements[0].sets[0],initial);

 const swift=old.initial();delete swift.format;
 old.start(swift,swift.plans[0].id);swift.active.started=820000000;
 old.record(swift,swift.active.movements[0].id,8,73,false,820000001);
 const imported=data.parseBackup(JSON.stringify(swift));
 assert.equal(imported.active.movements[0].sets[0].date,(820000001+978307200)*1000);
 assert.equal(imported.active.movements[0].sets[0].weight,73);
 assert.equal(imported.active.movements[0].sets[0].performance,undefined);
});

test(`same storage writes by original ${baselineTag} and re-upgrade retain annotations and invalidate changed basis`,()=>{
 const {storage,db}=fixture();
 const before=backup.exportFull(storage,db,now).parts;
 const set=db.active.movements[0].sets[0],prior=structuredClone(set.performance);
 const staleNew=new data.Repository(storage),older=new old.Repository(storage);
 older.change(next=>{
  oldUI.createBodyUI({storage}).editSet(next.active.movements[0].sets[0],7,8,'kg','68');
  old.record(next,next.active.movements[0].id,9,5,false,now,makeLoad('bodyweight_plus_extra','kg',5,next.active.bodyWeightSnapshot));
  next.plans[0].exercises[0].target=4;
  old.restoreHistory(next,next.deletedHistory[0].session.id);
  old.finish(next);
  old.deleteHistory(next,next.history[0].id,now);
  old.restoreHistory(next,next.deletedHistory[0].session.id);
 });
 assert.throws(()=>staleNew.change(next=>{next.effortDisplay='off';}),/其他页面修改/);
 const reopened=new data.Repository(storage),finished=reopened.db.history.find(s=>s.id===db.active.id);
 const sets=finished.movements[0].sets;
 assert.deepEqual(sets[0].performance,prior);
 assert.deepEqual(performanceDetails(sets[0]),{setType:'drop',toFailure:true,effort:null,effortNeedsConfirmation:true});
 assert.equal(sets[0].id,set.id);
 assert.equal(sets[0].date,set.date);
 assert.equal(sets[0].load.bodyWeightKg,set.load.bodyWeightKg);
 assert.equal(sets[1].performance,undefined);
 assert.equal(reopened.db.effortDisplay,'rir');
 assert.deepEqual(reopened.db.history.find(s=>s.id===db.deletedHistory[0].session.id),db.deletedHistory[0].session);
 assert.deepEqual(reopened.db.history.find(s=>s.id===db.history[0].id),db.history[0]);
 for(const key of [data.KEY,HEALTH_KEY,EXERCISE_META_KEY,LEGACY_EXERCISE_META_KEY,PROFILE_KEY])assert.equal(storage.getItem(key),before[key]);
});

test('new file → original full restore/export → new full restore preserves every part including active and deleted',()=>{
 const {storage,db}=fixture();
 const newer=backup.exportFull(storage,db,now);
 const target=new Storage();
 oldBackup.restoreFull(target,oldBackup.parseFull(JSON.stringify(newer)));
 const oldExport=oldBackup.exportFull(target,new old.Repository(target).db,now);
 const final=new Storage();
 backup.restoreFull(final,backup.parseFull(JSON.stringify(oldExport)));
 assert.deepEqual(backup.exportFull(final,new data.Repository(final).db,now),newer);
 assert.deepEqual(new data.Repository(final).db.rest,db.rest);
 assert.equal(new data.Repository(final).db.deletedHistory.length,1);
});

test('training file roundtrip through original retains performance, and changed legacy confirmations go to the before-image',()=>{
 const {storage,db}=fixture();
 const incoming=structuredClone(db);
 setPerformance(incoming.history[0].movements[0].sets[0],mark(null,{kind:'exact',rpe:8}));
 const trainingFile=JSON.stringify(incoming),parsed=old.parseBackup(trainingFile);
 oldBackup.restoreTrainingOnly(storage,parsed);
 const oldExport=JSON.stringify(new old.Repository(storage).db),newer=data.parseBackup(oldExport);
 assert.deepEqual(newer,incoming);
 assert.equal(new ExerciseMetaRepository(storage).db.bodyweightSessions.length,0);
 assert.equal(JSON.parse(storage.getItem(EXERCISE_META_KEY+'.before-training-restore')).bodyweightSessions[0].bodyWeight,68);
 const target=new Storage();backup.restoreTrainingOnly(target,newer);
 assert.deepEqual(new data.Repository(target).db,newer);
});

test('interrupted six-part recovery preserves the exact before-image and restores marked groups on retry',()=>{
 const source=fixture(),target=fixture(),incoming=backup.exportFull(source.storage,source.db,now);
 const before=backup.restoreFingerprint(target.storage);
 const originalSet=target.storage.setItem.bind(target.storage);
 let writes=0;
 target.storage.setItem=(key,value)=>{if(++writes>=4)throw new DOMException('Injected quota','QuotaExceededError');originalSet(key,value);};
 assert.throws(()=>backup.restoreFull(target.storage,incoming,{expected:before}),/锁定写入/);
 assert.equal(new data.Repository(prepareStorage(target.storage)).writable,false);
 target.storage.setItem=originalSet;
 assert.equal(backup.recoverRestore(target.storage),true);
 assert.equal(backup.restoreFingerprint(target.storage),before);
 backup.restoreFull(target.storage,incoming,{expected:before});
 assert.deepEqual(backup.exportFull(target.storage,new data.Repository(target.storage).db,now),incoming);
 assert.equal(target.storage.getItem(backup.JOURNAL_KEY),null);
});
