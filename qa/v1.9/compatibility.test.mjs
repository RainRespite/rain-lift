import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {unpackBaseline} from '../v1.8.5/baseline.mjs';
import {Storage} from '../../tests/helpers/app-harness.mjs';
import * as current from '../../dist/data.js';
import * as backup from '../../dist/backup.js';
import {unknownSnapshot,makeLoad} from '../../dist/load.js';
import {setPerformance} from '../../dist/performance.js';
import {recommendProgression} from '../../dist/progression.js';

const tag=process.env.RAINLIFT_COMPAT_BASELINE??'v1.8.6';
const tmp=mkdtempSync(join(tmpdir(),'rainlift-190-compat-'));
after(()=>rmSync(tmp,{force:true,recursive:true}));
unpackBaseline(tmp,tag);
const oldModule=name=>import(pathToFileURL(join(tmp,'dist',name)).href);
const [old,oldBackup,oldUI]=await Promise.all(['data.js','backup.js','body-ui.js'].map(oldModule));
const now=Date.parse('2026-11-05T01:00:00Z'),day=86400000;
const mark={setType:'normal',toFailure:false,effort:{kind:'exact',rpe:8}};
const load=makeLoad('external','kg',40);
const movement=d=>d.active.movements[0];
const start=d=>current.start(d,d.plans[0].id,unknownSnapshot());
const propose=d=>recommendProgression(d,movement(d),{now,mode:'external',weight:40});
const add=(d,date)=>current.record(d,movement(d).id,12,40,true,date,load,mark);

function fixture(){
 const d=current.initial(),storage=new Storage(),e=d.plans[0].exercises[0];
 e.progression={enabled:true,minReps:8,maxReps:12};e.target=1;
 for(const age of [3,2,1]){
  start(d);const ended=now-age*day;d.active.started=ended-60000;add(d,ended-5000);
  current.finish(d);d.history[0].ended=ended;
 }
 current.deleteHistory(d,d.history[2].id,now);
 start(d);d.active.started=now-10000;
 storage.setItem(current.TRAINING_V2_KEY,JSON.stringify(d));
 return {d,storage};
}

test(`v1.9.0 → original ${tag} → v1.9.0 retains plan configuration and set snapshots in both files`,()=>{
 const {d,storage}=fixture();
 assert.equal(propose(d).kind,'increase');
 const full=backup.exportFull(storage,d,now),recovered=new Storage();
 oldBackup.restoreFull(recovered,oldBackup.parseFull(JSON.stringify(full)));
 const viaOld=oldBackup.exportFull(recovered,new old.Repository(recovered).db,now);
 const target=new Storage();backup.restoreFull(target,backup.parseFull(JSON.stringify(viaOld)));
 const restored=new current.Repository(target).db;
 assert.deepEqual(restored,d);assert.deepEqual(viaOld.parts,full.parts);
 assert.equal(propose(restored).weight,42.5);
 const training=old.parseBackup(JSON.stringify(d));
 assert.deepEqual(current.parseBackup(JSON.stringify(training)),d);
});

test(`original ${tag} plan and set editing preserve evidence and its previous conditions`,()=>{
 const {d,storage}=fixture(),older=new old.Repository(storage);
 const set=d.history[0].movements[0].sets[0];
 older.change(next=>{
  const definition=next.plans[0].exercises[0];
  next.plans[0].exercises[0]=old.reviseExercise(next,definition,{...definition,step:3});
  oldUI.createBodyUI({storage}).editSet(next.history[0].movements[0].sets[0],40,13,'kg','');
 });
 const newer=new current.Repository(storage).db,edited=newer.history[0].movements[0].sets[0];
 assert.deepEqual(newer.plans[0].exercises[0].progression,d.plans[0].exercises[0].progression);
 assert.deepEqual(edited.progressionTarget,set.progressionTarget);
 assert.deepEqual(edited.performance,set.performance);
 assert.equal(edited.reps,13);assert.equal(propose(newer).reason,'stale_effort');
});

test(`groups created by original ${tag} have no retroactive evidence after re-upgrade`,()=>{
 const {storage}=fixture(),older=new old.Repository(storage);
 older.change(d=>{
  const row=old.record(d,movement(d).id,12,40,true,now-4000,load,mark);
  assert.equal(row.progressionTarget,undefined);
  old.finish(d);d.history[0].ended=now-3000;
 });
 const latest=new current.Repository(storage);
 latest.change(d=>{
  setPerformance(d.history[0].movements[0].sets[0],mark);
  start(d);d.active.started=now-2000;
 });
 assert.equal(propose(latest.db).reason,'no_target_snapshot');
 assert.equal(latest.db.history[0].movements[0].sets[0].progressionTarget,undefined);
});
