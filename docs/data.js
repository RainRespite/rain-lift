export const KEY='rainlift.web.v1';
export const uid=()=>crypto.randomUUID();
export const exercise=(name='新动作',weight=20,reps=[8,9,10],rest=90)=>({id:uid(),name,weight,unit:'kg',step:2.5,reps,rest,target:3});
export function initial(){return {format:'rainlift-web',version:1,plans:[{id:uid(),name:'拉 · 背部与二头',exercises:[exercise('宽距高位下拉',40),exercise('坐姿划船',35),exercise('哑铃弯举',10,[10,12,15],60)]},{id:uid(),name:'推 · 胸肩与三头',exercises:[exercise('卧推',40,[8,9,10],120),exercise('哑铃肩推',12.5),exercise('侧平举',5,[12,15,20],60)]}],history:[],active:null,rest:null};}
const finite=(x,min,max)=>typeof x==='number'&&Number.isFinite(x)&&x>=min&&x<=max;
const integer=(x,min,max)=>Number.isInteger(x)&&finite(x,min,max);
const text=x=>typeof x==='string'&&x.trim().length>0&&x.length<=200;
const ids=xs=>Array.isArray(xs)&&xs.every(x=>text(x.id))&&new Set(xs.map(x=>x.id)).size===xs.length;
export function validate(d){
 const ex=e=>e&&text(e.id)&&text(e.name)&&(e.knownNames==null||(Array.isArray(e.knownNames)&&e.knownNames.every(text)&&e.knownNames.includes(e.name)))&&typeof e.unit==='string'&&e.unit.length<=30&&finite(e.weight,0,10000)&&finite(e.step,.01,1000)&&integer(e.target,1,99)&&integer(e.rest,15,3600)&&Array.isArray(e.reps)&&e.reps.length===3&&new Set(e.reps).size===3&&e.reps.every(r=>integer(r,1,999));
 const set=s=>s&&text(s.id)&&finite(s.weight,0,10000)&&integer(s.reps,1,999)&&finite(s.date,0,1e15);
 const movement=m=>m&&ex(m.exercise)&&ids(m.sets)&&m.sets.every(set)&&(m.overrideWeight==null||finite(m.overrideWeight,0,10000))&&typeof m.skipped==='boolean';
 const session=s=>s&&text(s.id)&&text(s.planID)&&text(s.name)&&finite(s.started,0,1e15)&&(s.ended==null||finite(s.ended,s.started,1e15))&&typeof s.note==='string'&&s.note.length<=10000&&ids(s.movements)&&s.movements.every(movement);
 if(!d||d.format!=='rainlift-web'||d.version!==1||!ids(d.plans)||!d.plans.every(p=>text(p.name)&&ids(p.exercises)&&p.exercises.every(ex))||!ids(d.history)||!d.history.every(s=>session(s)&&s.ended!=null)||(d.deletedHistory!==undefined&&(!Array.isArray(d.deletedHistory)||!d.deletedHistory.every(entry=>entry&&session(entry.session)&&entry.session.ended!=null&&finite(entry.deletedAt,0,1e15))))||(d.active!=null&&(!session(d.active)||d.active.ended!=null))||!ids([...d.history,...(d.deletedHistory??[]).map(entry=>entry.session),...(d.active?[d.active]:[])]))throw Error('备份格式或训练数据不正确，原记录未改变。');
 if(d.rest!=null&&(!text(d.rest.setID)||!text(d.rest.name)||!finite(d.rest.end,0,1e15)||!d.active?.movements.some(m=>m.sets.some(s=>s.id===d.rest.setID))))throw Error('备份中的休息计时无效。');
 return d;
}
export function parseBackup(raw){
 let d=JSON.parse(raw);
 if(!d.format&&d.version===1){
  const swiftDate=x=>(x+978307200)*1000;
  d.format='rainlift-web';d.active??=null;d.rest??=null;
  if(d.deletedHistory!==undefined){if(!Array.isArray(d.deletedHistory))throw Error('备份格式或训练数据不正确，原记录未改变。');for(const entry of d.deletedHistory){if(!entry?.session)throw Error('备份格式或训练数据不正确，原记录未改变。');entry.deletedAt=swiftDate(entry.deletedAt);}}
  for(const session of [...d.history,...(d.deletedHistory??[]).map(entry=>entry.session),...(d.active?[d.active]:[])]){
   session.started=swiftDate(session.started);session.ended=session.ended==null?null:swiftDate(session.ended);session.note??='';
   for(const m of session.movements){m.skipped??=false;for(const s of m.sets)s.date=swiftDate(s.date);}
  }
  if(d.rest)d.rest.end=swiftDate(d.rest.end);
 }
 validate(d);return d;
}
const currentReferences=(d,id)=>[...d.plans.flatMap(p=>p.exercises),...(d.active?.movements.map(m=>m.exercise)??[])].filter(e=>e.id===id);
const allReferences=(d,id)=>[...currentReferences(d,id),...d.history.flatMap(s=>s.movements.map(m=>m.exercise)).filter(e=>e.id===id)];
// Deleted snapshots are retained for recovery, but do not prove live aliases or
// contribute recommendations. Explicit identity splits still update their IDs.
const allStoredReferences=(d,id)=>[...allReferences(d,id),...(d.deletedHistory??[]).flatMap(entry=>entry.session.movements.map(m=>m.exercise)).filter(e=>e.id===id)];
export function identityNames(d,id){return [...new Set(currentReferences(d,id).map(e=>e.name))];}
// Different historical names can be rename snapshots. Concurrent definitions
// need an explicit alias lineage before they can safely share recommendations.
export function identityConflict(d,id){
 const references=allReferences(d,id),linked=names=>{
  if(names.length<2)return true;
  const reached=new Set([names[0]]);let changed=true;
  while(changed){changed=false;for(const e of references){const aliases=[e.name,...(e.knownNames??[])];if(aliases.some(name=>reached.has(name)))for(const name of aliases)if(!reached.has(name)){reached.add(name);changed=true;}}}
  return names.every(name=>reached.has(name));
 };
 const planNames=[...new Set(d.plans.flatMap(p=>p.exercises).filter(e=>e.id===id).map(e=>e.name))];
 const activeNames=[...new Set((d.active?.movements??[]).filter(m=>m.exercise.id===id).map(m=>m.exercise.name))];
 return !linked(planNames)||!linked(activeNames);
}
// Resolution is explicit: only exact current names get new identities. A legacy
// snapshot with an unrecognized name retains its original, unresolved identity.
export function splitExerciseIdentity(d,id){
 if(!identityConflict(d,id))return [];
 const mappings=identityNames(d,id).map(name=>({name,id:uid()})),byName=new Map(mappings.map(e=>[e.name,e.id]));
 for(const e of allStoredReferences(d,id))if(byName.has(e.name))e.id=byName.get(e.name);
 return mappings;
}
export function confirmExerciseIdentity(d,id,canonicalName){
 if(!text(canonicalName))throw Error('请填写有效的动作名称。');
 const current=currentReferences(d,id);if(!current.length)throw Error('找不到该动作。');
 const name=canonicalName.trim(),names=[...new Set([...allReferences(d,id).flatMap(e=>[e.name,...(e.knownNames??[])]),name])];
 for(const e of current){e.name=name;e.knownNames=[...names];}
 if(d.rest&&d.active?.movements.some(m=>m.exercise.id===id&&m.sets.some(s=>s.id===d.rest.setID)))d.rest.name=name;
 return {id,name};
}
export function reviseExercise(d,original,changes,mode='rename'){
 if(!['rename','new'].includes(mode))throw Error('动作编辑类型不正确。');
 if(identityConflict(d,original.id))throw Error('这个编号关联了多个动作，请先确认历史归属，再修改动作。');
 const updated={...original,...changes,id:original.id};
 if(mode==='new')return {...updated,id:uid(),knownNames:[updated.name]};
 if(updated.name!==original.name){
  const references=[...d.plans.flatMap(p=>p.exercises),...d.history.flatMap(s=>s.movements.map(m=>m.exercise)),...(d.active?.movements.map(m=>m.exercise)??[])].filter(e=>e.id===original.id);
  updated.knownNames=[...new Set([...references.flatMap(e=>[...(e.knownNames??[]),e.name]),...(original.knownNames??[]),original.name,updated.name])];
 }
 return updated;
}
export function previous(d,id){if(identityConflict(d,id))return;return [...d.history].sort((a,b)=>b.started-a.started).flatMap(s=>s.movements).find(m=>m.exercise.id===id&&m.sets.length);}
export function suggested(d,m){return m.overrideWeight??previous(d,m.exercise.id)?.sets[m.sets.length]?.weight??m.sets.at(-1)?.weight??m.exercise.weight;}
export function start(d,planID){if(d.active)throw Error('请先结束当前训练。');const p=d.plans.find(p=>p.id===planID);if(!p?.exercises.length)throw Error('请先添加动作。');d.active={id:uid(),planID:p.id,name:p.name,started:Date.now(),ended:null,note:'',movements:p.exercises.map(e=>({id:uid(),exercise:structuredClone(e),sets:[],skipped:false}))};}
export function record(d,id,reps,weight,timed=true,now=Date.now()){
 const m=d.active?.movements.find(m=>m.id===id);if(!m)throw Error('请先选择动作。');if(!integer(reps,1,999)||!finite(weight,0,10000))throw Error('请填写有效重量和次数。');
 const s={id:uid(),weight,reps,date:now};m.sets.push(s);m.skipped=false;if(timed)d.rest={setID:s.id,name:m.exercise.name,end:now+m.exercise.rest*1000};return s;
}
export function removeSet(d,mid,sid,sessionID=null){const session=sessionID?d.history.find(s=>s.id===sessionID):d.active;const m=session?.movements.find(m=>m.id===mid);if(!m)throw Error('找不到该动作。');m.sets=m.sets.filter(s=>s.id!==sid);if(d.rest?.setID===sid)d.rest=null;}
export function deleteHistory(d,sessionID,now=Date.now()){
 const index=d.history.findIndex(s=>s.id===sessionID);if(index<0)throw Error('找不到这次历史训练，可能已删除。');
 if(!finite(now,0,1e15))throw Error('删除时间无效，原记录未改变。');
 const session=d.history[index];if(session.ended==null||(d.deletedHistory??[]).some(entry=>entry.session.id===sessionID))throw Error('这次训练的记录冲突，原记录未改变。');
 d.history.splice(index,1);(d.deletedHistory??=[]).unshift({session,deletedAt:now});return session;
}
export function restoreHistory(d,sessionID){
 const index=(d.deletedHistory??[]).findIndex(entry=>entry.session.id===sessionID);if(index<0)throw Error('找不到这次已删除训练，可能已恢复。');
 const {session}=d.deletedHistory[index];if(d.history.some(s=>s.id===sessionID)||d.active?.id===sessionID)throw Error('已存在相同编号的训练，无法恢复，原记录未改变。');
 const before=d.history.findIndex(s=>s.started<session.started);d.history.splice(before<0?d.history.length:before,0,session);
 d.deletedHistory.splice(index,1);if(!d.deletedHistory.length)delete d.deletedHistory;return session;
}
export function finish(d){if(!d.active)throw Error('没有进行中的训练。');d.active.ended=Date.now();d.history.unshift(structuredClone(d.active));d.active=null;d.rest=null;}
export const remaining=(rest,now=Date.now())=>rest?Math.max(0,Math.ceil((rest.end-now)/1000)):0;
export class Repository{
 constructor(storage){this.storage=storage;this.writable=true;try{const raw=storage.getItem(KEY);this.db=raw?validate(JSON.parse(raw)):initial();}catch(e){this.db={format:'rainlift-web',version:1,plans:[],history:[],active:null,rest:null};this.writable=false;this.loadError='无法读取本地记录。为避免覆盖原数据，已停止写入。请先导出原始文件，或从备份恢复。';}}
 change(fn){
  if(!this.writable)throw Error(this.loadError);
  const next=structuredClone(this.db),result=fn(next);validate(next);
  // Removing a plan or ending a workout must not silently make an unresolved
  // shared ID look valid again. Only the explicit repair path can resolve it.
  const ids=new Set([...this.db.plans.flatMap(p=>p.exercises.map(e=>e.id)),...(this.db.active?.movements.map(m=>m.exercise.id)??[])]);
  for(const id of ids)if(identityConflict(this.db,id)&&!identityConflict(next,id))throw Error('请先整理旧动作的历史归属，再移除动作、删除计划或结束训练。');
  this.storage.setItem(KEY,JSON.stringify(next));this.db=next;return result;
 }
 repairIdentity(fn){
  if(!this.writable)throw Error(this.loadError);
  const next=structuredClone(this.db),result=fn(next);validate(next);const serialized=JSON.stringify(next);
  if(this.storage.getItem(KEY+'.before-identity-repair')==null)this.storage.setItem(KEY+'.before-identity-repair',this.storage.getItem(KEY)??JSON.stringify(this.db));
  this.storage.setItem(KEY,serialized);this.db=next;return result;
 }
 restore(d){validate(d);const old=this.storage.getItem(KEY);if(old)this.storage.setItem(KEY+'.before-restore',old);this.storage.setItem(KEY,JSON.stringify(d));this.db=d;this.writable=true;this.loadError=null;}
}
