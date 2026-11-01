import {identityConflict} from './data.js?v=1.8';

// Separate local metadata: never changes training snapshots or health storage.
export const EXERCISE_META_KEY='rainlift.exercise-meta.v1';
export const EXERCISE_META_MAX_BYTES=512*1024;
export const LOAD_TYPES=Object.freeze({external:'器械 / 外部负重',bodyweight:'自身体重',assisted:'辅助负重',unknown:'尚未确认'});
const FORMAT='rainlift-exercise-meta',MAX_ENTRIES=10000;
const confirmedNames=new Set(['引体向上','龙悬']);
const fail=message=>{throw Error(message);};
const text=(value,max=200)=>typeof value==='string'&&value.trim().length>0&&value.length<=max;
const validUnit=value=>typeof value==='string'&&value.length<=30;
const bytes=raw=>new TextEncoder().encode(raw).length;
const empty=()=>({format:FORMAT,version:1,entries:[]});
export const exerciseMetaKey=exercise=>JSON.stringify([exercise.exerciseID??exercise.id,exercise.unit]);
function references(training){return [...(training?.plans??[]).flatMap(plan=>plan.exercises??[]),...(training?.active?.movements??[]).map(movement=>movement.exercise),...(training?.history??[]).flatMap(session=>(session.movements??[]).map(movement=>movement.exercise))];}
function validate(input){
 if(!input||input.format!==FORMAT||input.version!==1||!Array.isArray(input.entries)||input.entries.length>MAX_ENTRIES)fail('动作类型文件格式或版本不正确（最多 10,000 条）。');
 const seen=new Set(),entries=input.entries.map(entry=>{
  if(!entry||!text(entry.exerciseID)||!validUnit(entry.unit)||!Object.hasOwn(LOAD_TYPES,entry.loadType))fail('动作类型编号、单位或类型不正确。');
  const key=exerciseMetaKey(entry);if(seen.has(key))fail('动作类型文件含重复的动作编号与单位。');seen.add(key);
  return {exerciseID:entry.exerciseID,unit:entry.unit,loadType:entry.loadType};
 });
 return {format:FORMAT,version:1,entries};
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
 return refs.some(reference=>[reference.name,...(reference.knownNames??[])].some(name=>confirmedNames.has(name)))?'bodyweight':'unknown';
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
export class ExerciseMetaRepository{
 constructor(storage){
  this.storage=storage;this.db=empty();this.writable=true;this.raw=null;this.loadError=null;
  try{this.raw=storage.getItem(EXERCISE_META_KEY);if(this.raw!==null)this.db=parse(this.raw).db;}
  catch{this.writable=false;this.loadError='无法读取动作类型存储，已停止动作类型写入。请先导出原始文件；训练与健康记录独立保留。';}
 }
 assertWritable(){if(!this.writable)fail(this.loadError);}
 assertCurrent(){if(this.storage.getItem(EXERCISE_META_KEY)!==this.raw)fail('动作类型已被其他页面更改，请刷新后重新操作，避免覆盖。');}
 save(next){
  this.assertWritable();const validated=validate(next),raw=JSON.stringify(validated);
  if(bytes(raw)>EXERCISE_META_MAX_BYTES)fail('动作类型存储超过 512 KiB。');this.assertCurrent();
  this.storage.setItem(EXERCISE_META_KEY,raw);this.raw=raw;this.db=validated;
 }
 set(training,exercise,loadType){
  this.assertWritable();if(!Object.hasOwn(LOAD_TYPES,loadType))fail('请选择有效的负重类型。');
  if(!exercise||!references(training).some(reference=>reference.id===exercise.id&&reference.unit===exercise.unit))fail('找不到这个动作，请刷新后重试。');
  if(identityConflict(training,exercise.id))fail('动作身份尚未确认，请先整理历史归属，再设置负重类型。');
  const key=exerciseMetaKey(exercise),entry={exerciseID:exercise.id,unit:exercise.unit,loadType};
  this.save({...this.db,entries:[...this.db.entries.filter(saved=>exerciseMetaKey(saved)!==key),entry]});
  return loadType;
 }
 export(now=Date.now()){
  this.assertWritable();if(!Number.isFinite(now)||now<0||now>253402300799999)fail('动作类型导出时间不正确。');
  return {...structuredClone(this.db),exportedAt:new Date(now).toISOString()};
 }
 restore(parsed){
  const valid=parseExerciseMetaImport(JSON.stringify(parsed)),next={format:FORMAT,version:1,entries:valid.entries},raw=JSON.stringify(next);
  this.assertCurrent();if(this.raw!==null)this.storage.setItem(EXERCISE_META_KEY+'.before-restore',this.raw);
  this.storage.setItem(EXERCISE_META_KEY,raw);this.db=next;this.raw=raw;this.writable=true;this.loadError=null;
  return next.entries.length;
 }
}
