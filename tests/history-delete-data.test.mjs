import test from 'node:test';
import assert from 'node:assert/strict';
import {KEY,initial,validate,parseBackup,identityConflict,splitExerciseIdentity,previous,suggested,start,record,finish,deleteHistory,restoreHistory,Repository} from '../dist/data.js';

class Storage{
 values=new Map();
 getItem(key){return this.values.get(key)??null;}
 setItem(key,value){if(this.fail)throw Error('quota');this.values.set(key,value);}
}
function completed(d,weight,started){
 start(d,d.plans[0].id);d.active.started=started;
 record(d,d.active.movements[0].id,8,weight,false,started+1000);
 finish(d);d.history[0].ended=started+2000;return d.history[0];
}
function fixture(){const d=initial();completed(d,20,10000);completed(d,30,20000);completed(d,40,30000);return d;}
function stored(d){const storage=new Storage();storage.setItem(KEY,JSON.stringify(d));return {storage,repo:new Repository(storage)};}

test('deleting one finished session preserves its exact snapshot and restores normal chronological order',()=>{
 const d=fixture(),before=structuredClone(d),session=d.history[1];
 assert.equal(deleteHistory(d,session.id,50000),session);
 assert.equal(d.history.length,2);assert.deepEqual(d.deletedHistory,[{session,deletedAt:50000}]);
 assert.deepEqual(d.history,[before.history[0],before.history[2]]);validate(d);
 assert.equal(restoreHistory(d,session.id),session);assert.deepEqual(d,before);assert.equal('deletedHistory' in d,false);
});

test('deleted history persists through reload and backup import while old backups stay unchanged on load',()=>{
 const old=fixture(),raw=JSON.stringify(old),{storage,repo}=stored(old);
 assert.equal(storage.getItem(KEY),raw);assert.equal('deletedHistory' in repo.db,false);assert.deepEqual(parseBackup(raw),old);
 const id=repo.db.history[0].id;repo.change(d=>deleteHistory(d,id,50000));
 const reloaded=new Repository(storage),backup=JSON.stringify(reloaded.db),parsed=parseBackup(backup);
 assert.deepEqual(parsed,reloaded.db);assert.equal(parsed.deletedHistory[0].session.id,id);
 const destination=stored(initial());destination.repo.restore(parsed);assert.deepEqual(destination.repo.db,parsed);
 destination.repo.change(d=>restoreHistory(d,id));assert.deepEqual(destination.repo.db,old);
});

test('deleting and restoring history leaves an ongoing workout, rest timer, and plans unchanged',()=>{
 const d=fixture();start(d,d.plans[1].id);record(d,d.active.movements[0].id,9,12,true,50000);
 const active=structuredClone(d.active),rest=structuredClone(d.rest),plans=structuredClone(d.plans),id=d.history[0].id;
 deleteHistory(d,id,60000);assert.deepEqual(d.active,active);assert.deepEqual(d.rest,rest);assert.deepEqual(d.plans,plans);
 restoreHistory(d,id);assert.deepEqual(d.active,active);assert.deepEqual(d.rest,rest);assert.deepEqual(d.plans,plans);validate(d);
 assert.throws(()=>deleteHistory(d,d.active.id),/找不到/);
});

test('recommendations ignore deleted sessions and return after restoring them',()=>{
 const d=fixture(),id=d.plans[0].exercises[0].id,latest=d.history[0],second=d.history[1],oldest=d.history[2];
 assert.equal(previous(d,id).sets[0].weight,40);deleteHistory(d,latest.id);
 assert.equal(previous(d,id).sets[0].weight,30);assert.equal(suggested(d,{exercise:d.plans[0].exercises[0],sets:[]}),30);
 deleteHistory(d,second.id);deleteHistory(d,oldest.id);assert.equal(previous(d,id),undefined);
 assert.equal(suggested(d,{exercise:d.plans[0].exercises[0],sets:[]}),d.plans[0].exercises[0].weight);
 restoreHistory(d,latest.id);assert.equal(previous(d,id).sets[0].weight,40);
});

test('failed persistence leaves both live and deleted records unchanged for delete and restore',()=>{
 const {storage,repo}=stored(fixture()),id=repo.db.history[0].id,before=structuredClone(repo.db),raw=storage.getItem(KEY);
 storage.fail=true;assert.throws(()=>repo.change(d=>deleteHistory(d,id)),/quota/);assert.deepEqual(repo.db,before);assert.equal(storage.getItem(KEY),raw);
 storage.fail=false;repo.change(d=>deleteHistory(d,id));const deleted=structuredClone(repo.db),deletedRaw=storage.getItem(KEY);
 storage.fail=true;assert.throws(()=>repo.change(d=>restoreHistory(d,id)),/quota/);assert.deepEqual(repo.db,deleted);assert.equal(storage.getItem(KEY),deletedRaw);
});

test('stale delete and restore requests fail without modifying records or acknowledging a duplicate operation',()=>{
 const {storage,repo}=stored(fixture()),id=repo.db.history[0].id;
 repo.change(d=>deleteHistory(d,id));let before=structuredClone(repo.db),raw=storage.getItem(KEY);
 assert.throws(()=>repo.change(d=>deleteHistory(d,id)),/找不到/);assert.deepEqual(repo.db,before);assert.equal(storage.getItem(KEY),raw);
 repo.change(d=>restoreHistory(d,id));before=structuredClone(repo.db);raw=storage.getItem(KEY);
 assert.throws(()=>repo.change(d=>restoreHistory(d,id)),/找不到/);assert.deepEqual(repo.db,before);assert.equal(storage.getItem(KEY),raw);
 assert.throws(()=>repo.change(d=>deleteHistory(d,'missing')),/找不到/);
 assert.throws(()=>repo.change(d=>deleteHistory(d,id,NaN)),/删除时间/);assert.deepEqual(repo.db,before);
});

test('malformed trash metadata and duplicate session identities are rejected before replacing local data',()=>{
 const baseline=fixture(),id=baseline.history[0].id,finished=structuredClone(baseline.history[0]);
 const badValues=[null,{},[null],[{}],[{session:finished}],[{session:finished,deletedAt:-1}],[{session:finished,deletedAt:Infinity}],[{session:{...finished,ended:null},deletedAt:50000}],[{session:{...finished,note:123},deletedAt:50000}]];
 const {storage,repo}=stored(baseline),raw=storage.getItem(KEY);
 for(const value of badValues){const bad=structuredClone(baseline);bad.deletedHistory=value;assert.throws(()=>repo.restore(bad));assert.deepEqual(repo.db,baseline);assert.equal(storage.getItem(KEY),raw);}
 const duplicate=structuredClone(baseline);duplicate.deletedHistory=[{session:finished,deletedAt:50000}];assert.throws(()=>validate(duplicate));
 const duplicateTrash=structuredClone(baseline);deleteHistory(duplicateTrash,id);duplicateTrash.deletedHistory.push(structuredClone(duplicateTrash.deletedHistory[0]));assert.throws(()=>validate(duplicateTrash));
 const activeConflict=structuredClone(baseline);deleteHistory(activeConflict,id);start(activeConflict,activeConflict.plans[0].id);activeConflict.active.id=id;assert.throws(()=>validate(activeConflict));
 const liveActive=structuredClone(baseline);start(liveActive,liveActive.plans[0].id);liveActive.active.id=id;assert.throws(()=>validate(liveActive));
});

test('restore refuses a duplicate live or active session ID without consuming the deleted entry',()=>{
 const d=fixture(),session=structuredClone(d.history[0]);deleteHistory(d,session.id);
 d.history.push(structuredClone(session));const duplicate=structuredClone(d);assert.throws(()=>restoreHistory(d,session.id),/相同编号/);assert.deepEqual(d,duplicate);
 d.history.pop();start(d,d.plans[0].id);d.active.id=session.id;const active=structuredClone(d);assert.throws(()=>restoreHistory(d,session.id),/相同编号/);assert.deepEqual(d,active);
});

function collisionFixture(){
 const d=initial(),chest=d.plans[0].exercises[0];chest.name='龙下胸';d.plans[0].exercises=[chest];
 completed(d,45,10000);const raise={...chest,name:'龙侧平举',weight:10};d.plans[1].exercises=[raise];
 start(d,d.plans[1].id);d.active.started=20000;record(d,d.active.movements[0].id,15,10,false,21000);finish(d);d.history[0].ended=22000;
 return d;
}
test('explicit identity splitting also updates deleted snapshots so restored sibling history stays separate',()=>{
 const {repo}=stored(collisionFixture()),oldID=repo.db.plans[0].exercises[0].id,sessionID=repo.db.history[0].id;
 repo.change(d=>deleteHistory(d,sessionID,50000));assert.equal(identityConflict(repo.db,oldID),true);
 const deletedBefore=structuredClone(repo.db.deletedHistory[0]);repo.repairIdentity(d=>splitExerciseIdentity(d,oldID));
 const chest=repo.db.plans[0].exercises[0],raise=repo.db.plans[1].exercises[0];assert.notEqual(chest.id,raise.id);
 const deleted=repo.db.deletedHistory[0];assert.equal(deleted.session.movements[0].exercise.id,raise.id);
 const expected=structuredClone(deletedBefore);expected.session.movements[0].exercise.id=raise.id;assert.deepEqual(deleted,expected);
 repo.change(d=>restoreHistory(d,sessionID));assert.equal(previous(repo.db,chest.id).sets[0].weight,45);assert.equal(previous(repo.db,raise.id).sets[0].weight,10);validate(repo.db);
});

test('deleted alias evidence never silently resolves a live conflict, and the repository guards restoration',()=>{
 const d=collisionFixture(),oldID=d.plans[0].exercises[0].id;
 const proof=structuredClone(d.history[0]);proof.id='alias-proof';proof.movements[0].exercise.knownNames=['龙下胸','龙侧平举'];
 d.deletedHistory=[{session:proof,deletedAt:50000}];assert.equal(identityConflict(d,oldID),true);
 const {repo,storage}=stored(d),raw=storage.getItem(KEY);assert.throws(()=>repo.change(next=>restoreHistory(next,proof.id)),/请先整理/);assert.deepEqual(repo.db,d);assert.equal(storage.getItem(KEY),raw);
});

test('native backup conversion includes deleted sessions, sets, and deletion timestamps',()=>{
 const d=fixture();deleteHistory(d,d.history[0].id,50000);const expected=structuredClone(d),swift=x=>x/1000-978307200;delete d.format;
 for(const s of [...d.history,...d.deletedHistory.map(entry=>entry.session)]){s.started=swift(s.started);s.ended=swift(s.ended);for(const m of s.movements){delete m.skipped;for(const set of m.sets)set.date=swift(set.date);}}
 for(const entry of d.deletedHistory)entry.deletedAt=swift(entry.deletedAt);
 assert.deepEqual(parseBackup(JSON.stringify(d)),expected);
});
