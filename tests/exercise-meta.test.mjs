import test from 'node:test';
import assert from 'node:assert/strict';
import {KEY,initial,exercise,reviseExercise,start,record,finish,identityConflict,splitExerciseIdentity,parseBackup,Repository} from '../dist/data.js';
import {HEALTH_KEY} from '../dist/health.js';
import {EXERCISE_META_KEY,EXERCISE_META_MAX_BYTES,ExerciseMetaRepository,getExerciseLoadType,listExerciseLoadSettings,parseExerciseMetaImport,getBulkExternalPreview,getSessionBodyWeight,getBodyweightSetBreakdown} from '../dist/exercise-meta.js';
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

test('bulk external preview preserves explicit settings, trusted bodyweight defaults and conflicts without changing names',()=>{
 const training=fixture(),storage=new Storage(),repo=new ExerciseMetaRepository(storage);
 training.plans[1].exercises=[];
 const explicitUnknown=exercise('我自己更新的名称',20),assisted=exercise('辅助类型动作',20),external=exercise('已有外部动作',40),conflicted=exercise('冲突名称甲',20);
 training.plans[0].exercises.push(explicitUnknown,assisted,external,conflicted);training.plans[1].exercises.push({...conflicted,name:'冲突名称乙'});
 repo.set(training,explicitUnknown,'unknown');repo.set(training,assisted,'assisted');repo.set(training,external,'external');
 const before=JSON.stringify(training),raw=storage.getItem(EXERCISE_META_KEY),preview=getBulkExternalPreview(training,repo.db);
 assert.deepEqual(preview.candidates.map(item=>item.name),['普通器械']);assert.equal(preview.preservedCount,5);assert.equal(preview.conflictCount,1);
 assert.equal(storage.getItem(EXERCISE_META_KEY),raw);assert.equal(JSON.stringify(training),before);
 const result=repo.setUnconfirmedExternal(training,{defaultForNew:true});assert.equal(result.updated,1);assert.equal(result.defaultForNew,true);
 assert.equal(getExerciseLoadType(training,explicitUnknown,repo.db),'unknown');assert.equal(getExerciseLoadType(training,assisted,repo.db),'assisted');assert.equal(getExerciseLoadType(training,conflicted,repo.db),'unknown');assert.equal(getExerciseLoadType(training,training.plans[0].exercises[0],repo.db),'bodyweight');
 assert.equal(JSON.stringify(training),before);
});

test('bulk save is one metadata write and cannot change either original store on quota or stale failure',()=>{
 const training=fixture(),storage=new Storage(),repo=new ExerciseMetaRepository(storage);const before=JSON.stringify(training);storage.setItem(KEY,before);storage.setItem(HEALTH_KEY,'original-health');
 let writes=0;const save=storage.setItem.bind(storage);storage.setItem=(key,value)=>{if(key===EXERCISE_META_KEY)writes++;save(key,value);};
 storage.fail=true;assert.throws(()=>repo.setUnconfirmedExternal(training,{defaultForNew:true}),/quota/);assert.equal(repo.db.defaultLoadType,undefined);assert.equal(repo.db.entries.length,0);assert.equal(storage.getItem(EXERCISE_META_KEY),null);
 storage.fail=false;repo.setUnconfirmedExternal(training,{defaultForNew:true});assert.equal(writes,2);assert.equal(storage.getItem(KEY),before);assert.equal(storage.getItem(HEALTH_KEY),'original-health');
 const stale=new ExerciseMetaRepository(storage),other=new ExerciseMetaRepository(storage);other.setDefaultLoadType('unknown');const saved=storage.getItem(EXERCISE_META_KEY);assert.throws(()=>stale.setUnconfirmedExternal(training),/其他页面/);assert.equal(storage.getItem(EXERCISE_META_KEY),saved);
});

test('default external is opt-in, applies to new identities and remains lower priority than overrides and bodyweight defaults',()=>{
 const training=fixture(),repo=new ExerciseMetaRepository(new Storage()),custom=exercise('实际新动作名称',30);training.plans[0].exercises.push(custom);
 assert.equal(getExerciseLoadType(training,custom,repo.db),'unknown');repo.setDefaultLoadType('external');assert.equal(getExerciseLoadType(training,custom,repo.db),'external');
 assert.equal(getExerciseLoadType(training,training.plans[0].exercises[0],repo.db),'bodyweight');repo.set(training,custom,'unknown');assert.equal(getExerciseLoadType(training,custom,repo.db),'unknown');
 const sameName=exercise(custom.name,30);training.plans[1].exercises.push(sameName);assert.equal(getExerciseLoadType(training,sameName,repo.db),'external');assert.equal(getExerciseLoadType(training,custom,repo.db),'unknown');
 repo.setDefaultLoadType('unknown');assert.equal(getExerciseLoadType(training,sameName,repo.db),'unknown');assert.throws(()=>repo.setDefaultLoadType('bodyweight'),/默认/);
});

test('bulk without future defaults leaves later new exercises unconfirmed and repeated batch is stable',()=>{
 const training=fixture(),repo=new ExerciseMetaRepository(new Storage());training.plans[1].exercises=[];assert.equal(repo.setUnconfirmedExternal(training).updated,1);assert.equal(repo.db.defaultLoadType,'unknown');assert.equal(repo.setUnconfirmedExternal(training).updated,0);
 const added=exercise('后续新增',20);training.plans[0].exercises.push(added);assert.equal(getExerciseLoadType(training,added,repo.db),'unknown');assert.throws(()=>repo.setUnconfirmedExternal(training,{defaultForNew:'yes'}),/确认/);
});

function bodyweightFixture(){
 const training=initial();training.plans[0].exercises=[exercise('用户当前实际名称',68)];start(training,training.plans[0].id);const movement=training.active.movements[0];record(training,movement.id,8,68);record(training,movement.id,6,73);
 const storage=new Storage(),repo=new ExerciseMetaRepository(storage);repo.set(training,movement.exercise,'bodyweight');return {training,storage,repo,movement};
}

test('confirmed per-session bodyweight splits 68 and 73 into zero and five extra without changing original records',()=>{
 const {training,storage,repo,movement}=bodyweightFixture(),id=training.active.id,before=JSON.stringify(training);storage.setItem(KEY,before);storage.setItem(HEALTH_KEY,'original-health');
 assert.deepEqual(getBodyweightSetBreakdown(training,movement.exercise,id,73,repo.db),{bodyWeight:null,extraWeight:null,recordedWeight:73,status:'unconfirmed'});
 repo.setSessionBodyWeight(training,id,'kg',68);
 assert.deepEqual(getBodyweightSetBreakdown(training,movement.exercise,id,68,repo.db),{bodyWeight:68,extraWeight:0,recordedWeight:68,status:'confirmed'});
 assert.deepEqual(getBodyweightSetBreakdown(training,movement.exercise,id,73,repo.db),{bodyWeight:68,extraWeight:5,recordedWeight:73,status:'confirmed'});
 assert.equal(JSON.stringify(training),before);assert.equal(storage.getItem(KEY),before);assert.equal(storage.getItem(HEALTH_KEY),'original-health');
});

test('bodyweight is isolated by exact session and unit and is never inferred backwards from another training',()=>{
 const {training,repo,movement}=bodyweightFixture(),oldID=training.active.id;repo.setSessionBodyWeight(training,oldID,'kg',68);finish(training);start(training,training.plans[0].id);const newID=training.active.id;
 assert.equal(getSessionBodyWeight(training,newID,'kg',repo.db),null);repo.setSessionBodyWeight(training,newID,'kg',70);assert.equal(getSessionBodyWeight(training,oldID,'kg',repo.db),68);assert.equal(getSessionBodyWeight(training,newID,'kg',repo.db),70);
 assert.equal(getSessionBodyWeight(training,oldID,'lb',repo.db),null);assert.throws(()=>repo.setSessionBodyWeight(training,newID,'lb',150),/单位/);
 const independent=exercise(movement.exercise.name,68);training.plans[1].exercises.push(independent);assert.equal(getBodyweightSetBreakdown(training,independent,newID,73,repo.db).status,'unconfirmed');
 training.deletedHistory=[{session:training.history.shift(),deletedAt:Date.now()}];assert.equal(getSessionBodyWeight(training,oldID,'kg',repo.db),null);
});

test('a lower recorded weight or a non-bodyweight type is never silently converted into assistance or extra weight',()=>{
 const {training,repo,movement}=bodyweightFixture(),id=training.active.id;repo.setSessionBodyWeight(training,id,'kg',68);
 assert.deepEqual(getBodyweightSetBreakdown(training,movement.exercise,id,60,repo.db),{bodyWeight:68,extraWeight:null,recordedWeight:60,status:'below_bodyweight'});
 for(const type of ['external','assisted','unknown']){repo.set(training,movement.exercise,type);assert.equal(getBodyweightSetBreakdown(training,movement.exercise,id,73,repo.db).status,'unconfirmed');}
 repo.set(training,movement.exercise,'bodyweight');assert.equal(getBodyweightSetBreakdown(training,movement.exercise,id,NaN,repo.db).status,'unconfirmed');
 repo.setSessionBodyWeight(training,id,'kg',68.1);assert.equal(getBodyweightSetBreakdown(training,movement.exercise,id,73.1,repo.db).extraWeight,5);
});

test('new defaults and bodyweight sessions round-trip in version-one backups and old version-one files remain valid',()=>{
 const {training,storage,repo}=bodyweightFixture(),id=training.active.id;repo.setSessionBodyWeight(training,id,'kg',68);repo.setDefaultLoadType('external');const backup=repo.export(now),reopened=new ExerciseMetaRepository(storage);
 assert.equal(reopened.db.version,1);assert.equal(reopened.db.defaultLoadType,'external');assert.equal(getSessionBodyWeight(training,id,'kg',reopened.db),68);
 const restored=new ExerciseMetaRepository(new Storage());restored.restore(parseExerciseMetaImport(JSON.stringify(backup)));assert.equal(restored.db.defaultLoadType,'external');assert.equal(getSessionBodyWeight(training,id,'kg',restored.db),68);
 const old={format:'rainlift-exercise-meta',version:1,entries:[],exportedAt:new Date(now).toISOString()};restored.restore(parseExerciseMetaImport(JSON.stringify(old)));assert.deepEqual(restored.db,{format:'rainlift-exercise-meta',version:1,entries:[]});assert.equal(getSessionBodyWeight(training,id,'kg',restored.db),null);
});

test('bodyweight clearing is local to one session/unit and rejects invalid or duplicate persisted values',()=>{
 const {training,repo}=bodyweightFixture(),id=training.active.id;repo.setSessionBodyWeight(training,id,'kg',68);const valid=repo.export(now);repo.setSessionBodyWeight(training,id,'kg',null);assert.equal(getSessionBodyWeight(training,id,'kg',repo.db),null);
 for(const weight of [0,-1,Infinity,NaN,'68',10001])assert.throws(()=>repo.setSessionBodyWeight(training,id,'kg',weight),/体重/);assert.throws(()=>repo.setSessionBodyWeight(training,'missing','kg',68),/找不到/);
 for(const change of [{defaultLoadType:'bodyweight'},{bodyweightSessions:[valid.bodyweightSessions[0],valid.bodyweightSessions[0]]},{bodyweightSessions:[{sessionID:id,unit:'kg',bodyWeight:0}]},{bodyweightSessions:{}},{bodyweightSessions:[{sessionID:id,unit:'',bodyWeight:68}]}])assert.throws(()=>parseExerciseMetaImport(JSON.stringify({...valid,...change})));
});

test('session baseline writes retain memory and old backups on quota or stale failure',()=>{
 const {training,storage,repo}=bodyweightFixture(),id=training.active.id;repo.setSessionBodyWeight(training,id,'kg',68);const before=structuredClone(repo.db),raw=storage.getItem(EXERCISE_META_KEY);storage.fail=true;assert.throws(()=>repo.setSessionBodyWeight(training,id,'kg',70),/quota/);assert.deepEqual(repo.db,before);assert.equal(storage.getItem(EXERCISE_META_KEY),raw);
 storage.fail=false;const stale=new ExerciseMetaRepository(storage);repo.setSessionBodyWeight(training,id,'kg',69);const saved=storage.getItem(EXERCISE_META_KEY);assert.throws(()=>stale.setSessionBodyWeight(training,id,'kg',71),/其他页面/);assert.equal(storage.getItem(EXERCISE_META_KEY),saved);
});
