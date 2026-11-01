import test from 'node:test';
import assert from 'node:assert/strict';
import {KEY,initial,exercise,reviseExercise,start,record,finish,identityConflict,splitExerciseIdentity,parseBackup,Repository} from '../dist/data.js';
import {HEALTH_KEY} from '../dist/health.js';
import {EXERCISE_META_KEY,EXERCISE_META_MAX_BYTES,ExerciseMetaRepository,getExerciseLoadType,listExerciseLoadSettings,parseExerciseMetaImport} from '../dist/exercise-meta.js';
class Storage{
 values=new Map();getItem(key){return this.values.get(key)??null;}
 setItem(key,value){if(this.fail||this.failKey===key)throw Error('quota');this.values.set(key,String(value));}
}
const fixture=()=>{const training=initial();training.plans[0].exercises=[exercise('引体向上',68),exercise('龙悬',73),exercise('普通器械',40)];return training;};
const now=Date.parse('2026-11-01T12:00:00+08:00');

test('confirmed exact bodyweight names are local defaults; unconfirmed and similar names remain unknown',()=>{
 const training=fixture(),[pull,dragon,machine]=training.plans[0].exercises,before=structuredClone(training);
 assert.equal(getExerciseLoadType(training,pull),'bodyweight');assert.equal(getExerciseLoadType(training,dragon),'bodyweight');assert.equal(getExerciseLoadType(training,machine),'unknown');
 const similar=exercise('辅助引体向上',20);training.plans[1].exercises.push(similar);assert.equal(getExerciseLoadType(training,similar),'unknown');
 assert.equal(getExerciseLoadType(training,{...pull,id:'unseen-ID'}),'unknown');training.plans[1].exercises.pop();assert.deepEqual(training,before);
});

test('same-name distinct IDs and distinct units can be independently configured without inheritance',()=>{
 const training=fixture(),pull=training.plans[0].exercises[0],same=exercise('引体向上',68),otherUnit={...pull,unit:'lb'};
 training.plans[0].exercises.push(same);training.plans[1].exercises.push(otherUnit);const storage=new Storage(),repo=new ExerciseMetaRepository(storage);
 repo.set(training,pull,'assisted');assert.equal(getExerciseLoadType(training,pull,repo.db),'assisted');assert.equal(getExerciseLoadType(training,same,repo.db),'bodyweight');assert.equal(getExerciseLoadType(training,otherUnit,repo.db),'bodyweight');
 repo.set(training,same,'external');assert.equal(getExerciseLoadType(training,pull,repo.db),'assisted');assert.equal(getExerciseLoadType(training,same,repo.db),'external');
 const labels=listExerciseLoadSettings(training,repo.db).filter(entry=>entry.name==='引体向上').map(entry=>entry.label);assert.equal(new Set(labels).size,3);assert.ok(labels.every(label=>!label.includes(pull.id)));
});

test('explicit unknown override persists and suppresses the bodyweight default after reopening',()=>{
 const training=fixture(),pull=training.plans[0].exercises[0],storage=new Storage(),repo=new ExerciseMetaRepository(storage);
 repo.set(training,pull,'unknown');const reopened=new ExerciseMetaRepository(storage);assert.equal(reopened.writable,true);assert.equal(getExerciseLoadType(training,pull,reopened.db),'unknown');
 assert.equal(reopened.db.entries[0].exerciseID,pull.id);
});

test('trusted renames preserve defaults and independently stored types without rewriting historical snapshots',()=>{
 const training=fixture(),pull=training.plans[0].exercises[0],storage=new Storage();start(training,training.plans[0].id);record(training,training.active.movements[0].id,8,68);finish(training);
 const history=structuredClone(training.history),renamed=reviseExercise(training,pull,{name:'我的背部自重动作'});training.plans[0].exercises[0]=renamed;
 assert.equal(getExerciseLoadType(training,renamed),'bodyweight');assert.equal(getExerciseLoadType(training,history[0].movements[0].exercise),'bodyweight');
 const repo=new ExerciseMetaRepository(storage);repo.set(training,renamed,'external');assert.equal(getExerciseLoadType(training,history[0].movements[0].exercise,repo.db),'external');assert.deepEqual(training.history,history);
});

test('unresolved identity conflicts cannot use stored types or confirmed names; split IDs do not inherit metadata',()=>{
 const training=fixture(),pull=training.plans[0].exercises[0],storage=new Storage(),repo=new ExerciseMetaRepository(storage);repo.set(training,pull,'external');
 training.plans[1].exercises.push({...pull,name:'另一器械'});assert.equal(identityConflict(training,pull.id),true);assert.equal(getExerciseLoadType(training,pull,repo.db),'unknown');
 const before=storage.getItem(EXERCISE_META_KEY);assert.throws(()=>repo.set(training,pull,'bodyweight'),/归属|身份/);assert.equal(storage.getItem(EXERCISE_META_KEY),before);
 const ids=splitExerciseIdentity(training,pull.id);assert.equal(ids.length,2);const newPull=training.plans[0].exercises[0],newMachine=training.plans[1].exercises.at(-1);assert.equal(getExerciseLoadType(training,newPull,repo.db),'bodyweight');assert.equal(getExerciseLoadType(training,newMachine,repo.db),'unknown');
});

test('metadata writes never change training, health, original IDs, timestamps, deleted data or v1 backups',()=>{
 const training=fixture(),storage=new Storage();start(training,training.plans[0].id);record(training,training.active.movements[0].id,9,68);finish(training);const snapshot=JSON.stringify(training,null,2),health='health-raw-preserved';
 storage.setItem(KEY,snapshot);storage.setItem(HEALTH_KEY,health);const repo=new ExerciseMetaRepository(storage);repo.set(training,training.plans[0].exercises[0],'bodyweight');
 assert.equal(storage.getItem(KEY),snapshot);assert.equal(storage.getItem(HEALTH_KEY),health);assert.equal(JSON.stringify(training,null,2),snapshot);assert.deepEqual(parseBackup(snapshot),training);assert.equal(parseBackup(snapshot).version,1);
 new Repository(storage).restore(parseBackup(snapshot));assert.equal(getExerciseLoadType(training,training.plans[0].exercises[0],repo.db),'bodyweight');assert.equal(storage.getItem(HEALTH_KEY),health);
});

test('quota failures preserve metadata in memory and on disk, including first-write failure',()=>{
 const training=fixture(),storage=new Storage(),repo=new ExerciseMetaRepository(storage),pull=training.plans[0].exercises[0];storage.fail=true;assert.throws(()=>repo.set(training,pull,'external'),/quota/);assert.equal(repo.db.entries.length,0);assert.equal(storage.getItem(EXERCISE_META_KEY),null);
 storage.fail=false;repo.set(training,pull,'assisted');const raw=storage.getItem(EXERCISE_META_KEY),before=structuredClone(repo.db);storage.fail=true;assert.throws(()=>repo.set(training,pull,'external'),/quota/);assert.equal(storage.getItem(EXERCISE_META_KEY),raw);assert.deepEqual(repo.db,before);
});

test('stale metadata pages cannot overwrite changes from another page',()=>{
 const training=fixture(),storage=new Storage(),first=new ExerciseMetaRepository(storage),stale=new ExerciseMetaRepository(storage),pull=training.plans[0].exercises[0];first.set(training,pull,'external');const raw=storage.getItem(EXERCISE_META_KEY);
 assert.throws(()=>stale.set(training,pull,'assisted'),/其他页面/);assert.equal(storage.getItem(EXERCISE_META_KEY),raw);assert.equal(stale.db.entries.length,0);
 assert.throws(()=>stale.restore(first.export(now)),/其他页面/);assert.equal(storage.getItem(EXERCISE_META_KEY+'.before-restore'),null);
});

test('corrupt metadata blocks writes and normal exports; raw remains available and explicit restore can recover',()=>{
 const training=fixture(),storage=new Storage(),raw='{bad-json';storage.setItem(EXERCISE_META_KEY,raw);const repo=new ExerciseMetaRepository(storage);
 assert.equal(repo.writable,false);assert.match(repo.loadError,/停止/);assert.throws(()=>repo.set(training,training.plans[0].exercises[0],'bodyweight'),/读取/);assert.throws(()=>repo.export(),/读取/);assert.equal(storage.getItem(EXERCISE_META_KEY),raw);
 const clean=new ExerciseMetaRepository(new Storage()).export(now);repo.restore(clean);assert.equal(repo.writable,true);assert.equal(storage.getItem(EXERCISE_META_KEY+'.before-restore'),raw);assert.equal(repo.db.entries.length,0);
});

test('metadata exports and replacement restores are independent, validated and preserve a pre-restore copy',()=>{
 const training=fixture(),storage=new Storage(),repo=new ExerciseMetaRepository(storage),pull=training.plans[0].exercises[0];repo.set(training,pull,'assisted');const first=storage.getItem(EXERCISE_META_KEY),backup=repo.export(now);
 repo.set(training,pull,'external');repo.set(training,training.plans[0].exercises[2],'external');const original=storage.getItem(EXERCISE_META_KEY);
 const parsed=parseExerciseMetaImport(JSON.stringify(backup));assert.equal(repo.restore(parsed),1);assert.equal(storage.getItem(EXERCISE_META_KEY),first);assert.equal(storage.getItem(EXERCISE_META_KEY+'.before-restore'),original);assert.equal(getExerciseLoadType(training,pull,repo.db),'assisted');
 backup.entries[0].loadType='bodyweight';assert.equal(repo.db.entries[0].loadType,'assisted');
});

test('replacement restore failure at backup or final write never changes current metadata state',()=>{
 const training=fixture(),storage=new Storage(),repo=new ExerciseMetaRepository(storage),pull=training.plans[0].exercises[0];repo.set(training,pull,'external');const raw=storage.getItem(EXERCISE_META_KEY),before=structuredClone(repo.db),replacement=new ExerciseMetaRepository(new Storage()).export(now);
 storage.failKey=EXERCISE_META_KEY+'.before-restore';assert.throws(()=>repo.restore(replacement),/quota/);assert.equal(storage.getItem(EXERCISE_META_KEY),raw);assert.deepEqual(repo.db,before);
 storage.failKey=EXERCISE_META_KEY;assert.throws(()=>repo.restore(replacement),/quota/);assert.equal(storage.getItem(EXERCISE_META_KEY),raw);assert.deepEqual(repo.db,before);assert.equal(storage.getItem(EXERCISE_META_KEY+'.before-restore'),raw);
});

test('invalid, duplicated, oversized, unknown-version metadata imports fail before any write',()=>{
 const repo=new ExerciseMetaRepository(new Storage()),valid=repo.export(now),entry={exerciseID:'x',unit:'kg',loadType:'bodyweight'};
 for(const change of [{version:1.8},{format:'rainlift-web'},{entries:[entry,entry]},{entries:[{...entry,loadType:'magic'}]},{entries:[{...entry,exerciseID:''}]},{entries:[{...entry,unit:null}]},{exportedAt:'bad'}])assert.throws(()=>parseExerciseMetaImport(JSON.stringify({...valid,...change})));
 assert.throws(()=>parseExerciseMetaImport(' '.repeat(EXERCISE_META_MAX_BYTES+1)),/512 KiB/);assert.throws(()=>parseExerciseMetaImport(JSON.stringify({...valid,padding:'类'.repeat(EXERCISE_META_MAX_BYTES/3)})),/512 KiB/);
 assert.throws(()=>parseExerciseMetaImport(JSON.stringify({...valid,entries:Array(10001).fill(null)})),/10,000/);assert.equal(repo.storage.getItem(EXERCISE_META_KEY),null);
});

test('unknown metadata IDs remain inactive and editing a missing exercise cannot create entries',()=>{
 const training=fixture(),storage=new Storage(),repo=new ExerciseMetaRepository(storage),backup=repo.export(now);backup.entries.push({exerciseID:'not-present',unit:'kg',loadType:'bodyweight'});repo.restore(backup);
 assert.equal(getExerciseLoadType(training,{id:'not-present',name:'引体向上',unit:'kg'},repo.db),'unknown');const before=storage.getItem(EXERCISE_META_KEY);assert.throws(()=>repo.set(training,{id:'not-present',unit:'kg'},'external'),/找不到/);assert.equal(storage.getItem(EXERCISE_META_KEY),before);
});
