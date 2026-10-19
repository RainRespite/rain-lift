import test from 'node:test';
import assert from 'node:assert/strict';
import {KEY,exercise,initial,validate,parseBackup,identityConflict,reviseExercise,previous,suggested,start,record,removeSet,finish,remaining,Repository} from '../dist/data.js';
class Storage{m=new Map();getItem(k){return this.m.get(k)??null;}setItem(k,v){if(this.fail)throw Error('quota');this.m.set(k,v);}}
test('record starts timer; supplement does not replace timer',()=>{const d=initial();start(d,d.plans[0].id);const m=d.active.movements[0];const s=record(d,m.id,9,40,true,1000);assert.equal(d.rest.end,91000);record(d,m.id,6,35,false,2000);assert.equal(d.rest.setID,s.id);assert.equal(m.sets.length,2);});
test('undo cancels only associated rest',()=>{const d=initial();start(d,d.plans[0].id);const m=d.active.movements[0],s=record(d,m.id,9,40),extra=record(d,m.id,6,35,false);removeSet(d,m.id,extra.id);assert.equal(d.rest.setID,s.id);removeSet(d,m.id,s.id);assert.equal(d.rest,null);});
test('historical corresponding weights and override',()=>{const d=initial();start(d,d.plans[0].id);let m=d.active.movements[0];record(d,m.id,9,40);record(d,m.id,8,35);finish(d);start(d,d.plans[0].id);m=d.active.movements[0];assert.equal(suggested(d,m),40);record(d,m.id,9,40);assert.equal(suggested(d,m),35);m.overrideWeight=42.5;assert.equal(suggested(d,m),42.5);});
test('unfinished training survives persisted reload',()=>{const storage=new Storage(),r=new Repository(storage);r.change(d=>start(d,d.plans[0].id));r.change(d=>record(d,d.active.movements[0].id,9,40));const next=new Repository(storage);assert.equal(next.db.active.movements[0].sets.length,1);assert.equal(next.db.rest.end,r.db.rest.end);});
test('write failure does not acknowledge a new set',()=>{const st=new Storage(),r=new Repository(st);r.change(d=>start(d,d.plans[0].id));st.fail=true;assert.throws(()=>r.change(d=>record(d,d.active.movements[0].id,9,40)));assert.equal(r.db.active.movements[0].sets.length,0);});
test('corrupt storage is protected from overwrite',()=>{const s=new Storage();s.setItem(KEY,'broken');const r=new Repository(s);assert.equal(r.writable,false);assert.throws(()=>r.change(()=>{}));assert.equal(s.getItem(KEY),'broken');});
test('snapshot protects history against renamed and deleted plans',()=>{const d=initial();start(d,d.plans[0].id);const m=d.active.movements[0],name=m.exercise.name;record(d,m.id,9,40);finish(d);d.plans[0].exercises[0].name='new';d.plans=[];assert.equal(d.history[0].movements[0].exercise.name,name);validate(d);});
test('native Swift backup timestamps migrate correctly',()=>{const d=initial();start(d,d.plans[0].id);record(d,d.active.movements[0].id,9,40);delete d.format;const original=d.active.started;d.active.started=d.active.started/1000-978307200;delete d.active.ended;for(const m of d.active.movements)for(const s of m.sets)s.date=s.date/1000-978307200;d.rest.end=d.rest.end/1000-978307200;const result=parseBackup(JSON.stringify(d));assert.ok(Math.abs(result.active.started-original)<1);assert.equal(result.active.movements[0].sets[0].reps,9);});
test('reject invalid backup without replacing existing record',()=>{const s=new Storage(),r=new Repository(s);r.change(()=>{});const before=s.getItem(KEY),bad=initial();bad.plans[0].exercises[0].reps=[8,8,10];assert.throws(()=>r.restore(bad));assert.equal(s.getItem(KEY),before);});
test('restore saves previous state and replaces atomically',()=>{const s=new Storage(),r=new Repository(s);r.change(()=>{});const before=s.getItem(KEY),next=initial();next.plans[0].name='Restored';r.restore(next);assert.equal(s.getItem(KEY+'.before-restore'),before);assert.equal(r.db.plans[0].name,'Restored');});
test('invalid set cannot corrupt current training',()=>{const st=new Storage(),r=new Repository(st);r.change(d=>start(d,d.plans[0].id));assert.throws(()=>r.change(d=>record(d,d.active.movements[0].id,0,40)));assert.equal(r.db.active.movements[0].sets.length,0);});
test('absolute deadline works after suspension',()=>{assert.equal(remaining({end:95000},65000),30);assert.equal(remaining({end:95000},100000),0);});

function completeFirst(d,plan,weight,reps){start(d,plan.id);record(d,d.active.movements[0].id,reps,weight);finish(d);}
test('editing an existing exercise is a rename and legacy same-ID history remains linked',()=>{
 const storage=new Storage(),d=initial(),p=d.plans[0],e=p.exercises[0];
 e.name='龙下胸';completeFirst(d,p,32.5,10);e.name='龙下胸新名称';start(d,p.id);
 const raw=JSON.stringify(d);storage.setItem(KEY,raw);const r=new Repository(storage);
 assert.equal(identityConflict(r.db,e.id),false);
 assert.equal(previous(r.db,e.id).sets[0].weight,32.5);
 assert.equal(suggested(r.db,r.db.active.movements[0]),32.5);
 assert.equal(storage.getItem(KEY),raw);
 assert.equal(r.db.history[0].movements[0].exercise.name,'龙下胸');
 assert.deepEqual(r.db,d);assert.deepEqual(parseBackup(raw),d);
 const before=structuredClone(r.db.history),renamed=reviseExercise(r.db,r.db.plans[0].exercises[0],{name:'龙下胸再次改名'});
 assert.equal(renamed.id,e.id);assert.equal(previous(r.db,renamed.id).sets[0].weight,32.5);
 assert.deepEqual(r.db.history,before);assert.equal(storage.getItem(KEY),raw);
});
test('similar and identical names with independent IDs never share history',()=>{
 const d=initial();d.plans[0].exercises=[exercise('龙弯举',10)];d.plans[1].exercises=[exercise('龙侧平举',5)];
 const curl=d.plans[0].exercises[0],raise=d.plans[1].exercises[0];
 completeFirst(d,d.plans[0],22,9);completeFirst(d,d.plans[1],7,15);
 assert.equal(previous(d,curl.id).sets[0].weight,22);assert.equal(previous(d,raise.id).sets[0].reps,15);
 start(d,d.plans[0].id);assert.equal(suggested(d,d.active.movements[0]),22);finish(d);
 start(d,d.plans[1].id);assert.equal(suggested(d,d.active.movements[0]),7);finish(d);
 const sameName=exercise('龙弯举',3);d.plans[0].exercises.push(sameName);
 assert.equal(previous(d,sameName.id),undefined);assert.equal(suggested(d,{exercise:sameName,sets:[]}),3);
});
test('replacing a named exercise creates a fresh identity and retains old history',()=>{
 const d=initial(),p=d.plans[0],old=p.exercises[0];completeFirst(d,p,50,9);
 p.exercises[0]=reviseExercise(d,old,{name:'龙弯举',weight:10},'new');
 assert.notEqual(p.exercises[0].id,old.id);assert.equal(previous(d,p.exercises[0].id),undefined);
 assert.equal(previous(d,old.id).sets[0].weight,50);start(d,p.id);assert.equal(suggested(d,d.active.movements[0]),10);
});
test('explicit rename, reorder and moving between plans keep history through reload and backup',()=>{
 const storage=new Storage(),r=new Repository(storage);let id;
 r.change(d=>{const p=d.plans[0];id=p.exercises[0].id;completeFirst(d,p,42.5,8);p.exercises[0]=reviseExercise(d,p.exercises[0],{name:'龙弯举'},'rename');const e=p.exercises.shift();d.plans[1].exercises.push(e);d.plans[1].exercises.reverse();});
 const d=parseBackup(JSON.stringify(new Repository(storage).db));assert.equal(identityConflict(d,id),false);assert.equal(previous(d,id).sets[0].weight,42.5);
 assert.notEqual(d.history[0].movements[0].exercise.name,'龙弯举');
});
test('one exercise intentionally referenced in multiple plans shares history',()=>{
 const d=initial(),e=d.plans[0].exercises[0];d.plans[1].exercises=[structuredClone(e)];completeFirst(d,d.plans[0],55,8);
 start(d,d.plans[1].id);assert.equal(suggested(d,d.active.movements[0]),55);
});
test('legacy renamed ID recovers recommendations without rewriting or losing records',()=>{
 const storage=new Storage(),d=initial(),p=d.plans[0],e=p.exercises[0];e.name='龙侧平举';completeFirst(d,p,7,15);
 d.history[0].started=1000;d.history[0].ended=2000;
 e.name='龙侧平举改名';e.weight=20;completeFirst(d,p,8,12);d.history[0].started=3000;d.history[0].ended=4000;start(d,p.id);
 const raw=JSON.stringify(d);storage.setItem(KEY,raw);const r=new Repository(storage);
 assert.equal(identityConflict(r.db,e.id),false);assert.equal(previous(r.db,e.id).sets[0].weight,8);assert.equal(suggested(r.db,r.db.active.movements[0]),8);
 assert.equal(storage.getItem(KEY),raw);assert.deepEqual(r.db,d);assert.deepEqual(parseBackup(raw),d);
 const renamed=reviseExercise(r.db,e,{name:'另一个名称'});assert.equal(renamed.id,e.id);
 assert.deepEqual(new Set(renamed.knownNames),new Set(['龙侧平举','龙侧平举改名','另一个名称']));
 const independent=reviseExercise(r.db,e,{name:'龙弯举'},'new');assert.notEqual(independent.id,e.id);assert.equal(previous(r.db,independent.id),undefined);
 const snapshots=structuredClone(r.db.history);r.change(next=>{next.plans[0].exercises[0]=reviseExercise(next,next.plans[0].exercises[0],{name:'保存后的名称'});});
 const loaded=new Repository(storage);assert.deepEqual(loaded.db.history,snapshots);assert.equal(previous(loaded.db,e.id).sets[0].weight,8);
});
test('same exercise ID in multiple plans can retain a stale name after a rename',()=>{
 const d=initial(),e=d.plans[0].exercises[0];d.plans[1].exercises=[{...e,name:'另一个名称',knownNames:[e.name,'另一个名称']}];assert.equal(identityConflict(d,e.id),false);
 completeFirst(d,d.plans[0],40,8);start(d,d.plans[1].id);assert.equal(suggested(d,d.active.movements[0]),40);
 const updated=reviseExercise(d,d.plans[1].exercises[0],{name:'统一新名称'});
 assert.equal(updated.id,e.id);assert.deepEqual(new Set(updated.knownNames),new Set([e.name,'另一个名称','统一新名称']));
});
test('legacy rename history remains available after plan deletion',()=>{
 const d=initial(),p=d.plans[0],e=p.exercises[0];completeFirst(d,p,40,8);d.history[0].started=1000;d.history[0].ended=2000;e.name='新的名称';completeFirst(d,p,5,15);d.history[0].started=3000;d.history[0].ended=4000;d.plans=[];
 assert.equal(identityConflict(d,e.id),false);assert.equal(previous(d,e.id).sets[0].weight,5);assert.equal(d.history.length,2);validate(d);
});
test('active exercise replacement has no old recommendation or transferred sets',()=>{
 const d=initial(),p=d.plans[0];completeFirst(d,p,50,10);start(d,p.id);const m=d.active.movements[0],mid=m.id;
 m.exercise=reviseExercise(d,m.exercise,{name:'龙弯举',weight:12},'new');assert.equal(m.id,mid);assert.equal(m.sets.length,0);assert.equal(suggested(d,m),12);
 record(d,mid,9,12);finish(d);assert.equal(previous(d,m.exercise.id).sets[0].weight,12);
});
test('independent same-name replacements do not inherit aliases',()=>{
 const d=initial(),e=d.plans[0].exercises[0],renamed=reviseExercise(d,e,{name:'简写'},'rename'),replacement=reviseExercise(d,renamed,{},'new');
 assert.notEqual(replacement.id,e.id);assert.deepEqual(replacement.knownNames,['简写']);
});
