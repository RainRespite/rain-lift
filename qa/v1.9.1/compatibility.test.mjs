import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {unpackBaseline} from '../v1.8.5/baseline.mjs';
import {Storage,createAppHarness} from '../../tests/helpers/app-harness.mjs';
import * as data from '../../dist/data.js';
import * as backup from '../../dist/backup.js';
import {makeLoad} from '../../dist/load.js';
import {HealthRepository} from '../../dist/health.js';
import {LEGACY_EXERCISE_META_KEY,ExerciseMetaRepository} from '../../dist/exercise-meta.js';
import {ProfileRepository,profileSnapshot} from '../../dist/body-profile.js';
import {deriveExerciseRecords} from '../../dist/records.js';
import {recommendProgression} from '../../dist/progression.js';

const tmp=mkdtempSync(join(tmpdir(),'rainlift-191-compat-'));
after(()=>rmSync(tmp,{recursive:true,force:true}));
unpackBaseline(tmp,'v1.9.0');
const oldModule=name=>import(pathToFileURL(join(tmp,'dist',name)).href);
const [old,oldBackup]=await Promise.all(['data.js','backup.js'].map(oldModule));
const now=Date.now(),day=86400000;
const mark={setType:'normal',toFailure:false,effort:{kind:'exact',rpe:8}};
const load=makeLoad('external','kg',40);

function setup(){
 const storage=new Storage(),db=old.initial(),plan=db.plans[0],exercise=plan.exercises[0];
 exercise.target=2;exercise.progression={enabled:true,minReps:8,maxReps:12};
 storage.setItem(data.KEY,JSON.stringify(db));
 storage.setItem(LEGACY_EXERCISE_META_KEY,JSON.stringify({format:'rainlift-exercise-meta',version:1,entries:[],bodyweightSessions:[]}));
 new ExerciseMetaRepository(storage).set(db,exercise,'external');
 const profile=new ProfileRepository(storage);profile.update({weightKg:68},now-5000);
 const file=JSON.parse(readFileSync(new URL('../../tests/fixtures/apple-health.synthetic.json',import.meta.url),'utf8'));
 new HealthRepository(storage).import(file,now);
 const snap=profileSnapshot(profile.db);
 for(const age of [4,3,2]){
  const ended=now-age*day;
  old.start(db,plan.id,snap);db.active.started=ended-60000;
  const m=db.active.movements[0];
  old.record(db,m.id,5,20,false,ended-5000,makeLoad('external','kg',20),{setType:'warmup',toFailure:false,effort:null});
  for(const reps of [12,13])old.record(db,m.id,reps,40,false,ended-4000,load,mark);
  old.finish(db);db.history[0].ended=ended;
 }
 old.deleteHistory(db,db.history[2].id,now);
 old.start(db,plan.id,snap);db.active.started=now-60000;
 storage.setItem(data.TRAINING_V2_KEY,JSON.stringify(db));
 return {storage,db};
}

test('exact v1.9.0 six-part full backup restores through v1.9.1 and back after a classified set is saved',()=>{
 const {storage,db}=setup(),oldFile=oldBackup.exportFull(storage,db,now),newer=new Storage();
 assert.equal(Object.keys(oldFile.parts).length,6);
 assert.ok(Object.values(oldFile.parts).every(part=>typeof part==='string'));
 backup.restoreFull(newer,backup.parseFull(JSON.stringify(oldFile)));
 assert.deepEqual(backup.exportFull(newer,db,now),oldFile);
 const app=createAppHarness(null,{storage:newer});
 assert.match(app.html,/本次可试 42\.5 kg/);
 app.action('record',{reps:'8'});
 const current=app.state,set=current.active.movements[0].sets[0];
 assert.equal(set.weight,40);
 assert.deepEqual(set.progressionTarget,{schemaVersion:1,target:2,minReps:8,maxReps:12});
 assert.deepEqual(current.history,db.history);
 assert.deepEqual(current.deletedHistory,db.deletedHistory);
 const candidateFile=backup.exportFull(newer,current,now);
 for(const key of Object.keys(oldFile.parts).filter(key=>key!==data.TRAINING_V2_KEY)){
  assert.equal(candidateFile.parts[key],oldFile.parts[key]);
 }
 const restored=new Storage();
 oldBackup.restoreFull(restored,oldBackup.parseFull(JSON.stringify(candidateFile)));
 const inOld=new old.Repository(restored);
 assert.deepEqual(inOld.db,current);
 assert.deepEqual(oldBackup.exportFull(restored,inOld.db,now),candidateFile);
 const continuedAt=set.date+1;
 inOld.change(d=>old.record(d,d.active.movements[0].id,9,40,true,continuedAt,load,mark));
 const reupgraded=new data.Repository(restored).db;
 assert.deepEqual(reupgraded.active.movements[0].sets[0],set);
 assert.deepEqual(reupgraded.active.movements[0].sets[1].progressionTarget,set.progressionTarget);
 assert.equal(reupgraded.active.movements[0].sets[1].performance.effort.rpe,8);
 assert.equal(recommendProgression(reupgraded,reupgraded.active.movements[0],{mode:'external',weight:40,now:continuedAt}).reps,10);
 const progress=deriveExerciseRecords(reupgraded,db.plans[0].exercises[0].id,{now,timeZone:'Asia/Shanghai'});
 assert.equal(progress.groups[0].bestLoad.weight,40);
 assert.equal(progress.groups[0].setCount,4);
});

test('downgrade and re-upgrade never interpret a legacy backup as ordinary working history',()=>{
 const db=old.initial();old.start(db,db.plans[0].id);
 const set=old.record(db,db.active.movements[0].id,9,25,false,now-20000);
 const raw=JSON.stringify(db),parsed=data.parseBackup(raw),target=new Storage();
 backup.restoreTrainingOnly(target,parsed);
 const reopened=new old.Repository(target);
 assert.deepEqual(reopened.db.active.movements[0].sets[0],set);
 const app=createAppHarness(null,{storage:target});
 assert.match(app.html,/已完成 <b class="accent">0<\/b>/);
 assert.match(app.html,/未分类 1/);
 assert.deepEqual(app.state.active.movements[0].sets[0],set);
});
