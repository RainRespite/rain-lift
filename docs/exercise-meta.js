import {identityConflict} from './data.js?v=1.8.6';

// Separate local metadata: never changes training snapshots or health storage.
export const EXERCISE_META_KEY='rainlift.exercise-meta.v2';
export const LEGACY_EXERCISE_META_KEY='rainlift.exercise-meta.v1';
export const EXERCISE_META_MAX_BYTES=512*1024;
export const LOAD_TYPES=Object.freeze({external:'器械 / 外部负重',bodyweight:'自重 + 额外负重',assisted:'辅助负重',unknown:'尚未确认'});
const FORMAT='rainlift-exercise-meta',MAX_ENTRIES=10000;
const confirmedNames=new Set(['引体向上','龙悬']);
const fail=message=>{throw Error(message);};
const text=(value,max=200)=>typeof value==='string'&&value.trim().length>0&&value.length<=max;
const validUnit=value=>typeof value==='string'&&value.length<=30;
const validBodyWeight=value=>typeof value==='number'&&Number.isFinite(value)&&value>0&&value<=10000;
const bytes=raw=>new TextEncoder().encode(raw).length;
const empty=()=>({format:FORMAT,version:1,entries:[]});
export const exerciseMetaKey=exercise=>JSON.stringify([exercise.exerciseID??exercise.id,exercise.unit]);
function references(training){return [...(training?.plans??[]).flatMap(plan=>plan.exercises??[]),...(training?.active?.movements??[]).map(movement=>movement.exercise),...(training?.history??[]).flatMap(session=>(session.movements??[]).map(movement=>movement.exercise))];}
const sessionKey=row=>JSON.stringify([row.sessionID,row.unit]);
const findSession=(training,id)=>training?.active?.id===id?training.active:(training?.history??[]).find(session=>session.id===id);
const sessionHasUnit=(session,unit)=>!!session?.movements?.some(movement=>movement.exercise?.unit===unit);
function validate(input){
 if(!input||input.format!==FORMAT||input.version!==1||!Array.isArray(input.entries)||input.entries.length>MAX_ENTRIES)fail('动作类型文件格式或版本不正确（最多 10,000 条）。');
 const seen=new Set(),entries=input.entries.map(entry=>{
  if(!entry||!text(entry.exerciseID)||!validUnit(entry.unit)||!Object.hasOwn(LOAD_TYPES,entry.loadType))fail('动作类型编号、单位或类型不正确。');
  const key=exerciseMetaKey(entry);if(seen.has(key))fail('动作类型文件含重复的动作编号与单位。');seen.add(key);
  return {exerciseID:entry.exerciseID,unit:entry.unit,loadType:entry.loadType};
 });
 const result={format:FORMAT,version:1,entries};
 if(input.defaultLoadType!==undefined){
  if(!['external','unknown'].includes(input.defaultLoadType))fail('默认负重类型必须为外部负重或尚未确认。');
  result.defaultLoadType=input.defaultLoadType;
 }
 if(input.bodyweightSessions!==undefined){
  if(!Array.isArray(input.bodyweightSessions)||input.bodyweightSessions.length>MAX_ENTRIES)fail('本次体重设置格式不正确（最多 10,000 条）。');
  const seenSessions=new Set();
  result.bodyweightSessions=input.bodyweightSessions.map(row=>{
   if(!row||!text(row.sessionID)||!validUnit(row.unit)||!row.unit.trim()||!validBodyWeight(row.bodyWeight))fail('本次体重的训练编号、单位或数值不正确。');
   const key=sessionKey(row);if(seenSessions.has(key))fail('本次体重文件含重复的训练编号与单位。');seenSessions.add(key);
   return {sessionID:row.sessionID,unit:row.unit,bodyWeight:row.bodyWeight};
  });
 }
 if(input.legacyLoadTypes!==undefined){
  if(!Array.isArray(input.legacyLoadTypes)||input.legacyLoadTypes.length>MAX_ENTRIES)fail('旧组类型快照格式不正确。');
  const seen=new Set();result.legacyLoadTypes=input.legacyLoadTypes.map(r=>{if(!r||!text(r.sessionID)||!text(r.movementID)||!text(r.exerciseID)||!validUnit(r.unit)||!Object.hasOwn(LOAD_TYPES,r.loadType))fail('旧组类型快照无效。');const key=JSON.stringify([r.sessionID,r.movementID]);if(seen.has(key))fail('旧组类型快照重复。');seen.add(key);return {sessionID:r.sessionID,movementID:r.movementID,exerciseID:r.exerciseID,unit:r.unit,loadType:r.loadType};});
 }
 return result;
}
function parse(raw){
 if(typeof raw!=='string'||bytes(raw)>EXERCISE_META_MAX_BYTES)fail('动作类型文件必须是 512 KiB 以内的 JSON。');
 let input;try{input=JSON.parse(raw);}catch{fail('动作类型文件不是有效 JSON。');}
 return {input,db:validate(input)};
}
export function parseExerciseMetaImport(raw){
 const {input,db}=parse(raw);
 if(typeof input.exportedAt!=='string'||!Number.isFinite(Date.parse(input.exportedAt)))fail('动作类型备份缺少有效导出日期。');
 return {...db,exportedAt:input.exportedAt};
}
export function getExerciseLoadType(training,exercise,metadata=null){
 if(!exercise||!text(exercise.id)||!validUnit(exercise.unit)||identityConflict(training,exercise.id))return 'unknown';
 const refs=references(training).filter(reference=>reference.id===exercise.id&&reference.unit===exercise.unit);
 if(!refs.length)return 'unknown';
 const entry=metadata?.entries?.find(entry=>entry.exerciseID===exercise.id&&entry.unit===exercise.unit);
 if(entry&&Object.hasOwn(LOAD_TYPES,entry.loadType))return entry.loadType;
 // Exact confirmed names and explicit alias lineage only; IDs never merge.
 if(refs.some(reference=>[reference.name,...(reference.knownNames??[])].some(name=>confirmedNames.has(name))))return 'bodyweight';
 return metadata?.defaultLoadType==='external'?'external':'unknown';
}
export function listExerciseLoadSettings(training,metadata=null){
 const byKey=new Map();
 for(const exercise of references(training)){
  const key=exerciseMetaKey(exercise);if(byKey.has(key))continue;
  byKey.set(key,{exerciseID:exercise.id,id:exercise.id,name:exercise.name,unit:exercise.unit,loadType:getExerciseLoadType(training,exercise,metadata),identityUncertain:identityConflict(training,exercise.id)});
 }
 const entries=[...byKey.values()],counts=new Map(),seen=new Map();
 for(const entry of entries)counts.set(entry.name,(counts.get(entry.name)??0)+1);
 return entries.map(entry=>{const index=(seen.get(entry.name)??0)+1;seen.set(entry.name,index);return {...entry,label:entry.name+(counts.get(entry.name)>1?`（同名动作 ${index}）`:'')+(entry.unit?` · ${entry.unit}`:'')};});
}
export function getBulkExternalPreview(training,metadata=null){
 const items=listExerciseLoadSettings(training,metadata),explicit=new Set((metadata?.entries??[]).map(exerciseMetaKey));
 const candidates=items.filter(item=>!item.identityUncertain&&!explicit.has(exerciseMetaKey(item))&&item.loadType==='unknown');
 const conflictCount=items.filter(item=>item.identityUncertain).length;
 return {candidates,preservedCount:items.length-candidates.length-conflictCount,conflictCount};
}
export function getSessionBodyWeight(training,sessionID,unit,metadata=null){
 if(!text(sessionID)||!validUnit(unit)||!sessionHasUnit(findSession(training,sessionID),unit))return null;
 const row=metadata?.bodyweightSessions?.find(row=>row.sessionID===sessionID&&row.unit===unit);
 return row&&validBodyWeight(row.bodyWeight)?row.bodyWeight:null;
}
export function getLegacyLoadType(training,movement,sessionID,metadata=null){const row=metadata?.legacyLoadTypes?.find(r=>r.sessionID===sessionID&&r.movementID===movement.id&&r.exerciseID===movement.exercise.id&&r.unit===movement.exercise.unit);return row?.loadType??getExerciseLoadType(training,movement.exercise,metadata);}
function freezeLegacyTypes(training,metadata){
 const rows=[...(metadata.legacyLoadTypes??[])],seen=new Set(rows.map(r=>JSON.stringify([r.sessionID,r.movementID])));
 for(const s of [...(training.history??[]),...(training.deletedHistory??[]).map(e=>e.session),...(training.active?[training.active]:[])])for(const m of s.movements){const key=JSON.stringify([s.id,m.id]);if(m.sets.some(set=>!set.load)&&!seen.has(key)){seen.add(key);rows.push({sessionID:s.id,movementID:m.id,exerciseID:m.exercise.id,unit:m.exercise.unit,loadType:getExerciseLoadType(training,m.exercise,metadata)});}}
 return rows;
}
export function getBodyweightSetBreakdown(training,exercise,sessionID,weight,metadata=null){
 const result={bodyWeight:null,extraWeight:null,recordedWeight:weight,status:'unconfirmed'};
 const session=findSession(training,sessionID);
 const movement=session?.movements?.find(m=>m.exercise?.id===exercise.id&&m.exercise?.unit===exercise.unit);
 if(!movement||getLegacyLoadType(training,movement,sessionID,metadata)!=='bodyweight'||typeof weight!=='number'||!Number.isFinite(weight)||weight<0||weight>10000)return result;
 const bodyWeight=getSessionBodyWeight(training,sessionID,exercise.unit,metadata);if(bodyWeight===null)return result;
 if(weight<bodyWeight)return {...result,bodyWeight,status:'below_bodyweight'};
 return {...result,bodyWeight,extraWeight:Math.round((weight-bodyWeight)*1000000)/1000000,status:'confirmed'};
}
export class ExerciseMetaRepository{
 constructor(storage){
  this.storage=storage;this.db=empty();this.writable=true;this.raw=null;this.loadError=null;this.key=EXERCISE_META_KEY;
  try{this.key=storage.getItem(EXERCISE_META_KEY)!==null?EXERCISE_META_KEY:LEGACY_EXERCISE_META_KEY;this.raw=storage.getItem(this.key);if(this.raw!==null)this.db=parse(this.raw).db;}
  catch{this.writable=false;this.loadError='无法读取动作类型存储，已停止动作类型写入。请先导出原始文件；训练与健康记录独立保留。';}
 }
 assertWritable(){if(!this.writable)fail(this.loadError);}
 assertCurrent(){if((this.key===LEGACY_EXERCISE_META_KEY&&this.storage.getItem(EXERCISE_META_KEY)!==null)||this.storage.getItem(this.key)!==this.raw)fail('动作类型已被其他页面更改，请刷新后重新操作，避免覆盖。');}
 save(next){
  this.assertWritable();const validated=validate(next),raw=JSON.stringify(validated);
  if(bytes(raw)>EXERCISE_META_MAX_BYTES)fail('动作类型存储超过 512 KiB。');this.assertCurrent();
  this.storage.setItem(EXERCISE_META_KEY,raw);this.key=EXERCISE_META_KEY;this.raw=raw;this.db=validated;
 }
 set(training,exercise,loadType){
  this.assertWritable();if(!Object.hasOwn(LOAD_TYPES,loadType))fail('请选择有效的负重类型。');
  if(!exercise||!references(training).some(reference=>reference.id===exercise.id&&reference.unit===exercise.unit))fail('找不到这个动作，请刷新后重试。');
  if(identityConflict(training,exercise.id))fail('动作身份尚未确认，请先整理历史归属，再设置负重类型。');
  const key=exerciseMetaKey(exercise),entry={exerciseID:exercise.id,unit:exercise.unit,loadType};
  this.save({...this.db,legacyLoadTypes:freezeLegacyTypes(training,this.db),entries:[...this.db.entries.filter(saved=>exerciseMetaKey(saved)!==key),entry]});
  return loadType;
 }
 setUnconfirmedExternal(training,{defaultForNew=false}={}){
  this.assertWritable();if(typeof defaultForNew!=='boolean')fail('请确认是否对后续动作使用外部负重默认值。');
  const preview=getBulkExternalPreview(training,this.db),entries=preview.candidates.map(item=>({exerciseID:item.exerciseID,unit:item.unit,loadType:'external'}));
  this.save({...this.db,legacyLoadTypes:freezeLegacyTypes(training,this.db),entries:[...this.db.entries,...entries],defaultLoadType:defaultForNew?'external':'unknown'});
  return {updated:entries.length,preservedCount:preview.preservedCount,conflictCount:preview.conflictCount,defaultForNew};
 }
 setDefaultLoadType(loadType,training=null){
  this.assertWritable();if(!['external','unknown'].includes(loadType))fail('默认负重类型必须为外部负重或尚未确认。');
  this.save({...this.db,...(training?{legacyLoadTypes:freezeLegacyTypes(training,this.db)}:{}),defaultLoadType:loadType});return loadType;
 }
 setSessionBodyWeight(training,sessionID,unit,bodyWeight){
  this.assertWritable();
  if(!text(sessionID)||!validUnit(unit)||!unit.trim()||!sessionHasUnit(findSession(training,sessionID),unit))fail('找不到对应训练或单位，请重新打开后设置本次体重。');
  if(bodyWeight!==null&&!validBodyWeight(bodyWeight))fail('请填写大于 0 且不超过 10000 的本次体重，或清除该设置。');
  const rows=(this.db.bodyweightSessions??[]).filter(row=>row.sessionID!==sessionID||row.unit!==unit);
  if(bodyWeight!==null)rows.push({sessionID,unit,bodyWeight});
  const legacyLoadTypes=freezeLegacyTypes(training,this.db).map(row=>row.sessionID===sessionID&&row.unit===unit&&getExerciseLoadType(training,{id:row.exerciseID,unit:row.unit},this.db)==='bodyweight'?{...row,loadType:'bodyweight'}:row);
  this.save({...this.db,bodyweightSessions:rows,legacyLoadTypes});return bodyWeight;
 }
 export(now=Date.now()){
  this.assertWritable();if(!Number.isFinite(now)||now<0||now>253402300799999)fail('动作类型导出时间不正确。');
  return {...structuredClone(this.db),exportedAt:new Date(now).toISOString()};
 }
 restore(parsed){
  const valid=parseExerciseMetaImport(JSON.stringify(parsed)),{exportedAt,...next}=valid,raw=JSON.stringify(next);
  this.assertCurrent();if(this.raw!==null)this.storage.setItem(EXERCISE_META_KEY+'.before-restore',this.raw);
  this.storage.setItem(EXERCISE_META_KEY,raw);this.db=next;this.raw=raw;this.key=EXERCISE_META_KEY;this.writable=true;this.loadError=null;
  return next.entries.length;
 }
}
