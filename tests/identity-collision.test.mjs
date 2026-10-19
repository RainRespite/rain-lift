import test from 'node:test';
import assert from 'node:assert/strict';
import * as data from '../dist/data.js';

const OLD_ID='fixture-colliding-exercise';
class Storage{
 m=new Map();
 getItem(key){return this.m.get(key)??null;}
 setItem(key,value){if(this.fail||this.failKey===key)throw Error('quota');this.m.set(key,value);}
}
function fixture(){
 const base=data.exercise('龙下胸',45),chest={...base,id:OLD_ID},raise={...base,id:OLD_ID,name:'龙侧平举',weight:10};
 const session=(id,name,exercise,weight,started)=>({id,planID:id+'-plan',name,started,ended:started+100,note:'保留备注',movements:[{id:id+'-movement',exercise:structuredClone(exercise),sets:[{id:id+'-set',weight,reps:20,date:started+50}],skipped:false}]});
 return {format:'rainlift-web',version:1,plans:[{id:'chest-plan',name:'胸',exercises:[chest]},{id:'raise-plan',name:'肩',exercises:[raise]}],history:[session('raise-session','肩',raise,10,3000),session('chest-session','胸',chest,45,1000),session('unknown-session','旧计划',{...chest,name:'旧名待核对'},99,500)],active:null,rest:null};
}
const references=d=>[...d.plans.flatMap(p=>p.exercises),...d.history.flatMap(s=>s.movements.map(m=>m.exercise)),...(d.active?.movements.map(m=>m.exercise)??[])];

test('current same-ID different-name plans stop mixed recommendations without mutating data',()=>{
 const d=fixture(),before=structuredClone(d),m={exercise:d.plans[0].exercises[0],sets:[],skipped:false};
 assert.equal(data.identityConflict(d,OLD_ID),true);
 assert.deepEqual(data.identityNames(d,OLD_ID),['龙下胸','龙侧平举']);
 assert.equal(data.previous(d,OLD_ID),undefined);
 assert.equal(data.suggested(d,m),45);
 m.overrideWeight=47.5;assert.equal(data.suggested(d,m),47.5);delete m.overrideWeight;
 m.sets.push({weight:42.5});assert.equal(data.suggested(d,m),42.5);
 assert.deepEqual(d,before);
});

test('explicit split changes only exact-name exercise IDs and leaves unknown history unassigned',()=>{
 const d=fixture();data.start(d,'raise-plan');data.record(d,d.active.movements[0].id,25,10,true,10000);
 const before=structuredClone(d),mapping=data.splitExerciseIdentity(d,OLD_ID),byName=new Map(mapping.map(x=>[x.name,x.id]));
 assert.deepEqual([...byName.keys()],['龙下胸','龙侧平举']);
 assert.equal(new Set(mapping.map(x=>x.id)).size,2);assert.ok(mapping.every(x=>x.id!==OLD_ID));
 for(const e of references(d))assert.equal(e.id,byName.get(e.name)??OLD_ID);
 assert.equal(data.previous(d,byName.get('龙下胸')).sets[0].weight,45);
 assert.equal(data.previous(d,byName.get('龙侧平举')).sets[0].weight,10);
 assert.equal(data.suggested(d,{exercise:d.plans[0].exercises[0],sets:[]}),45);
 assert.equal(data.suggested(d,{exercise:d.plans[1].exercises[0],sets:[]}),10);
 const normalized=structuredClone(d);for(const e of references(normalized))if(mapping.some(x=>x.id===e.id))e.id=OLD_ID;
 assert.deepEqual(normalized,before);data.validate(d);
 const once=structuredClone(d);assert.deepEqual(data.splitExerciseIdentity(d,OLD_ID),[]);assert.deepEqual(data.splitExerciseIdentity(d,mapping[0].id),[]);assert.deepEqual(d,once);
});

test('unresolved collisions reject renames and settings before aliases can absorb another action',()=>{
 const d=fixture(),e=d.plans[0].exercises[0],before=structuredClone(d);
 assert.throws(()=>data.reviseExercise(d,e,{name:'下胸新名称'}),/归属|冲突/);
 assert.throws(()=>data.reviseExercise(d,e,{weight:50}),/归属|冲突/);
 assert.throws(()=>data.reviseExercise(d,e,{name:'另一个动作'},'new'),/归属|冲突/);
 assert.deepEqual(d,before);
});

test('resolved branches rename independently and preserve their own alias lineage',()=>{
 const d=fixture(),mapping=data.splitExerciseIdentity(d,OLD_ID),raise=d.plans[1].exercises[0],before=structuredClone(d.history);
 const renamed=data.reviseExercise(d,raise,{name:'绳索侧平举'});
 assert.equal(renamed.id,mapping.find(x=>x.name==='龙侧平举').id);
 assert.deepEqual(new Set(renamed.knownNames),new Set(['龙侧平举','绳索侧平举']));
 assert.equal(data.previous(d,renamed.id).sets[0].weight,10);
 assert.deepEqual(d.history,before);assert.equal(d.plans[0].exercises[0].name,'龙下胸');
});

test('explicit alias lineage allows shared references across plans',()=>{
 const d=fixture();d.plans[0].exercises[0].knownNames=['龙下胸','龙侧平举'];
 assert.equal(data.identityConflict(d,OLD_ID),false);
 assert.deepEqual(data.splitExerciseIdentity(d,OLD_ID),[]);
 assert.equal(data.previous(d,OLD_ID).sets[0].weight,10);
});

test('one stale active snapshot and historical renamed snapshots do not create a collision',()=>{
 const d=fixture();d.plans.splice(1);data.start(d,'chest-plan');d.active.movements[0].exercise.name='旧的下胸名称';
 assert.equal(data.identityConflict(d,OLD_ID),false);assert.equal(data.previous(d,OLD_ID).sets[0].weight,10);
 const second=structuredClone(d.active.movements[0]);second.id='second-active-movement';second.exercise.name='不同动作';d.active.movements.push(second);
 assert.equal(data.identityConflict(d,OLD_ID),true);
 const same=structuredClone(d);same.active.movements[1].exercise.name=same.active.movements[0].exercise.name;assert.equal(data.identityConflict(same,OLD_ID),false);
});

test('explicit confirmation keeps one identity, records aliases, and preserves historical snapshots',()=>{
 const d=fixture();data.start(d,'chest-plan');data.record(d,d.active.movements[0].id,20,45,true,10000);
 const history=structuredClone(d.history),sets=structuredClone(d.active.movements[0].sets),timer=structuredClone(d.rest);
 data.confirmExerciseIdentity(d,OLD_ID,'统一的动作名称');
 assert.equal(data.identityConflict(d,OLD_ID),false);
 for(const e of [...d.plans.flatMap(p=>p.exercises),...d.active.movements.map(m=>m.exercise)]){
  assert.equal(e.id,OLD_ID);assert.equal(e.name,'统一的动作名称');
  assert.deepEqual(new Set(e.knownNames),new Set(['龙下胸','龙侧平举','旧名待核对','统一的动作名称']));
 }
 assert.deepEqual(d.history,history);assert.deepEqual(d.active.movements[0].sets,sets);
 assert.deepEqual(d.rest,{...timer,name:'统一的动作名称'});data.validate(d);
 const before=structuredClone(d);assert.throws(()=>data.confirmExerciseIdentity(d,OLD_ID,''));assert.deepEqual(d,before);
});

test('Repository loads and imports collision data unchanged; failed explicit repair never writes state',()=>{
 const d=fixture(),raw=JSON.stringify(d),storage=new Storage();storage.setItem(data.KEY,raw);
 const repo=new data.Repository(storage);assert.deepEqual(repo.db,d);assert.equal(storage.getItem(data.KEY),raw);assert.deepEqual(data.parseBackup(raw),d);
 storage.fail=true;assert.throws(()=>repo.repairIdentity(next=>data.splitExerciseIdentity(next,OLD_ID)),/quota/);
 assert.deepEqual(repo.db,d);assert.equal(storage.getItem(data.KEY),raw);
 storage.fail=false;const mapping=repo.repairIdentity(next=>data.splitExerciseIdentity(next,OLD_ID));assert.equal(mapping.length,2);
 const loaded=new data.Repository(storage);assert.deepEqual(loaded.db,repo.db);assert.equal(data.identityConflict(loaded.db,OLD_ID),false);
});

test('identity repair preserves the original raw backup once and fails safely at either storage write',()=>{
 const d=fixture(),raw=JSON.stringify(d,null,2),storage=new Storage(),backupKey=data.KEY+'.before-identity-repair';storage.setItem(data.KEY,raw);
 const repo=new data.Repository(storage);storage.failKey=backupKey;
 assert.throws(()=>repo.repairIdentity(next=>data.splitExerciseIdentity(next,OLD_ID)),/quota/);
 assert.deepEqual(repo.db,d);assert.equal(storage.getItem(data.KEY),raw);assert.equal(storage.getItem(backupKey),null);
 storage.failKey=data.KEY;
 assert.throws(()=>repo.repairIdentity(next=>data.splitExerciseIdentity(next,OLD_ID)),/quota/);
 assert.deepEqual(repo.db,d);assert.equal(storage.getItem(data.KEY),raw);assert.equal(storage.getItem(backupKey),raw);
 storage.failKey=null;const mapping=repo.repairIdentity(next=>data.splitExerciseIdentity(next,OLD_ID));assert.equal(mapping.length,2);
 assert.equal(storage.getItem(backupKey),raw);assert.notEqual(storage.getItem(data.KEY),raw);
 repo.change(next=>{next.plans[0].exercises[0].weight=50;});repo.repairIdentity(()=>[]);
 assert.equal(storage.getItem(backupKey),raw);assert.equal(repo.db.plans[0].exercises[0].weight,50);
});

test('identity repair validates all changes before writing its backup',()=>{
 const storage=new Storage(),repo=new data.Repository(storage);
 assert.throws(()=>repo.repairIdentity(next=>{next.plans[0].exercises[0].weight=-5;}));
 assert.equal(storage.getItem(data.KEY),null);assert.equal(storage.getItem(data.KEY+'.before-identity-repair'),null);
});

test('removing a conflicting definition or its entire plan cannot erase the evidence and resume mixed history',()=>{
 for(const edit of [next=>{next.plans[1].exercises=[];},next=>{next.plans.splice(1,1);}]){
  const d=fixture(),raw=JSON.stringify(d),storage=new Storage();storage.setItem(data.KEY,raw);const repo=new data.Repository(storage);
  assert.throws(()=>repo.change(edit),/归属/);
  assert.deepEqual(repo.db,d);assert.equal(storage.getItem(data.KEY),raw);assert.equal(data.previous(repo.db,OLD_ID),undefined);
 }
});

test('ending, removing or replacing an active-only collision cannot silently restore a mixed identity',()=>{
 const d=fixture();d.plans.splice(1);data.start(d,'chest-plan');
 const other=structuredClone(d.active.movements[0]);other.id='second-active-movement';other.exercise.name='龙侧平举';other.exercise.weight=10;d.active.movements.push(other);
 assert.equal(data.identityConflict(d,OLD_ID),true);
 for(const edit of [data.finish,next=>{next.active.movements.splice(1,1);},next=>{next.active.movements[1].exercise=data.exercise('新动作',5);},next=>{next.plans[0].exercises=[];data.finish(next);}]){
  const raw=JSON.stringify(d),storage=new Storage();storage.setItem(data.KEY,raw);const repo=new data.Repository(storage);
  assert.throws(()=>repo.change(edit),/归属/);assert.deepEqual(repo.db,d);assert.equal(storage.getItem(data.KEY),raw);
 }
 const storage=new Storage();storage.setItem(data.KEY,JSON.stringify(d));const repo=new data.Repository(storage);
 repo.repairIdentity(next=>data.splitExerciseIdentity(next,OLD_ID));repo.change(data.finish);
 assert.equal(repo.db.active,null);assert.equal(repo.db.history.length,d.history.length+1);
});

test('ordinary edits that retain collision evidence still work and proven aliases can be removed normally',()=>{
 const d=fixture(),storage=new Storage();storage.setItem(data.KEY,JSON.stringify(d));const repo=new data.Repository(storage);
 repo.change(next=>{next.plans[0].name='胸部计划';});assert.equal(repo.db.plans[0].name,'胸部计划');
 assert.equal(data.identityConflict(repo.db,OLD_ID),true);
 repo.repairIdentity(next=>data.confirmExerciseIdentity(next,OLD_ID,'同一个动作'));
 repo.change(next=>{next.plans.splice(1,1);});assert.equal(repo.db.plans.length,1);assert.equal(data.previous(repo.db,OLD_ID).sets[0].weight,10);
});
