import test from 'node:test';
import assert from 'node:assert/strict';
import {KEY,initial,validate,parseBackup,start,record,finish,identityConflict,splitExerciseIdentity,Repository} from '../dist/data.js';

class Storage{
 values=new Map();
 getItem(key){return this.values.get(key)??null;}
 setItem(key,value){if(this.fail)throw Error('quota');this.values.set(key,value);}
}

test('finish records only movements with sets, including a skipped movement that was partly trained',()=>{
 const d=initial(),plans=structuredClone(d.plans);start(d,d.plans[0].id);
 const [trained,skippedEmpty,untrained]=d.active.movements;
 record(d,trained.id,10,40);trained.skipped=true;skippedEmpty.skipped=true;
 const active=d.active,snapshot=structuredClone(active);
 finish(d);
 assert.equal(d.history.length,1);assert.equal(d.history[0].movements.length,1);
 assert.deepEqual(d.history[0].movements[0],snapshot.movements[0]);
 assert.equal(d.history[0].movements[0].skipped,true);
 assert.equal(d.history[0].movements.some(m=>[skippedEmpty.id,untrained.id].includes(m.id)),false);
 assert.deepEqual(active,snapshot);assert.deepEqual(d.plans,plans);
 assert.equal(d.active,null);assert.equal(d.rest,null);assert.ok(d.history[0].ended>=d.history[0].started);
 active.movements[0].sets[0].weight=99;
 assert.equal(d.history[0].movements[0].sets[0].weight,40);validate(d);
});

test('a recorded zero-weight set is retained in history',()=>{
 const d=initial();start(d,d.plans[0].id);
 record(d,d.active.movements[1].id,20,0,false);
 finish(d);
 assert.equal(d.history.length,1);assert.equal(d.history[0].movements.length,1);
 assert.equal(d.history[0].movements[0].sets[0].weight,0);
 assert.equal(d.history[0].movements[0].sets[0].reps,20);validate(d);
});

test('finishing entirely unrecorded or empty training clears active state without creating history',()=>{
 for(const emptyArrangement of [false,true]){
  const d=initial();start(d,d.plans[0].id);
  if(emptyArrangement)d.active.movements=[];
  else d.active.movements[0].skipped=true;
  const plans=structuredClone(d.plans);finish(d);
  assert.deepEqual(d.history,[]);assert.equal(d.active,null);assert.equal(d.rest,null);
  assert.deepEqual(d.plans,plans);validate(d);
 }
});

test('finishing persists only recorded movements while old history and plans survive reload unchanged',()=>{
 const d=initial();start(d,d.plans[0].id);record(d,d.active.movements[0].id,8,30,false);finish(d);
 // Old backups can contain unperformed movements; loading and a new finish do not rewrite them.
 const legacyEmpty={id:'old-unperformed',exercise:structuredClone(d.plans[0].exercises[1]),sets:[],skipped:true};
 d.history[0].movements.push(legacyEmpty);
 start(d,d.plans[1].id);record(d,d.active.movements[0].id,10,20);
 d.active.movements[1].skipped=true;
 const oldHistory=structuredClone(d.history),plans=structuredClone(d.plans),raw=JSON.stringify(d);
 const storage=new Storage();storage.setItem(KEY,raw);
 const repo=new Repository(storage);
 assert.equal(storage.getItem(KEY),raw);assert.deepEqual(repo.db,d);assert.deepEqual(parseBackup(raw),d);
 repo.change(finish);
 const loaded=new Repository(storage).db;
 assert.equal(loaded.history.length,2);assert.equal(loaded.history[0].movements.length,1);
 assert.equal(loaded.history[0].movements[0].sets[0].weight,20);
 assert.deepEqual(loaded.history.slice(1),oldHistory);assert.deepEqual(loaded.plans,plans);
 assert.equal(loaded.active,null);assert.equal(loaded.rest,null);validate(loaded);
});

test('an entirely unrecorded finish preserves existing history through persistence',()=>{
 const storage=new Storage(),repo=new Repository(storage);
 repo.change(d=>{start(d,d.plans[0].id);record(d,d.active.movements[0].id,8,40,false);finish(d);});
 const oldHistory=structuredClone(repo.db.history);
 repo.change(d=>start(d,d.plans[1].id));repo.change(finish);
 const loaded=new Repository(storage).db;
 assert.deepEqual(loaded.history,oldHistory);assert.equal(loaded.active,null);assert.equal(loaded.rest,null);
});

test('failed persistence never discards an active training or records a partial finish',()=>{
 const storage=new Storage(),repo=new Repository(storage);
 repo.change(d=>{start(d,d.plans[0].id);record(d,d.active.movements[0].id,10,40);});
 const before=structuredClone(repo.db),raw=storage.getItem(KEY);storage.fail=true;
 assert.throws(()=>repo.change(finish),/quota/);
 assert.deepEqual(repo.db,before);assert.equal(storage.getItem(KEY),raw);
});

test('omitting unperformed movements cannot silently erase an active-only identity conflict',()=>{
 const d=initial();start(d,d.plans[0].id);
 const duplicate=structuredClone(d.active.movements[0]);duplicate.id='different-active-movement';duplicate.exercise.name='不同动作';
 d.active.movements.push(duplicate);const exerciseID=duplicate.exercise.id;
 assert.equal(identityConflict(d,exerciseID),true);
 const storage=new Storage(),raw=JSON.stringify(d);storage.setItem(KEY,raw);const repo=new Repository(storage);
 assert.throws(()=>repo.change(finish),/请先整理/);
 assert.equal(storage.getItem(KEY),raw);assert.deepEqual(repo.db,d);
 repo.repairIdentity(next=>splitExerciseIdentity(next,exerciseID));repo.change(finish);
 assert.equal(repo.db.active,null);assert.deepEqual(repo.db.history,[]);
});
