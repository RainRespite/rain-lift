import {KEY,TRAINING_V2_KEY,parseBackup,initial} from './data.js?v=1.8.6';
import {HEALTH_KEY,HealthRepository} from './health.js?v=1.8.6';
import {EXERCISE_META_KEY,LEGACY_EXERCISE_META_KEY,parseExerciseMetaImport} from './exercise-meta.js?v=1.8.6';
import {PROFILE_KEY,validateProfile} from './body-profile.js?v=1.8.6';

export const FULL_BEFORE_KEY='rainlift.full.before-restore.v1',JOURNAL_KEY='rainlift.full.restore-journal.v1';
const KEYS=[KEY,TRAINING_V2_KEY,HEALTH_KEY,EXERCISE_META_KEY,LEGACY_EXERCISE_META_KEY,PROFILE_KEY];
const snapshot=storage=>Object.fromEntries(KEYS.map(key=>[key,storage.getItem(key)]));
const adapter=values=>({getItem:key=>values[key]??null,setItem(){throw Error('校验时不允许写入');}});
function validParts(parts){
 if(!parts||Object.keys(parts).length!==KEYS.length||!KEYS.every(k=>Object.hasOwn(parts,k)&&(parts[k]===null||typeof parts[k]==='string')))throw Error('完整备份缺少分区或分区类型错误。');
 if(parts[KEY]===null&&parts[TRAINING_V2_KEY]===null)throw Error('完整备份缺少训练分区。');
 parseBackup(parts[TRAINING_V2_KEY]??parts[KEY]);
 if(parts[HEALTH_KEY]!==null){const health=new HealthRepository(adapter(parts));if(!health.writable)throw Error(health.loadError);}
 const metaRaw=parts[EXERCISE_META_KEY]??parts[LEGACY_EXERCISE_META_KEY];if(metaRaw!==null)parseExerciseMetaImport(JSON.stringify({...JSON.parse(metaRaw),exportedAt:'1970-01-01T00:00:00Z'}));
 if(parts[PROFILE_KEY]!==null)validateProfile(JSON.parse(parts[PROFILE_KEY]));
 return parts;
}
export function exportFull(storage,training,now=Date.now()){
 if(storage.getItem(JOURNAL_KEY)!==null)throw Error('恢复尚未完成，请重新打开页面恢复后再导出。');
 const parts=snapshot(storage);if(parts[KEY]===null&&parts[TRAINING_V2_KEY]===null)parts[training.version===2?TRAINING_V2_KEY:KEY]=JSON.stringify(training);validParts(parts);
 return {format:'rainlift-full-backup',version:1,minimumAppVersion:'1.8.2',exportedAt:new Date(now).toISOString(),parts};
}
export function parseFull(raw){
 if(typeof raw!=='string'||new TextEncoder().encode(raw).length>16*1024*1024)throw Error('完整备份必须是 16 MiB 以内的 JSON。');
 const data=JSON.parse(raw);if(data?.format!=='rainlift-full-backup'||data.version!==1||data.minimumAppVersion!=='1.8.2'||!Number.isFinite(Date.parse(data.exportedAt)))throw Error('完整备份格式或版本不受支持。');validParts(data.parts);return data;
}
function writeParts(storage,parts){for(const key of KEYS){if(parts[key]===null)storage.removeItem(key);else storage.setItem(key,parts[key]);}}
export function recoverRestore(storage){
 const raw=storage.getItem(JOURNAL_KEY);if(raw===null)return false;
 const journal=JSON.parse(raw);if(journal?.format!=='rainlift-restore-journal'||journal.version!==1||!journal.before||!KEYS.every(k=>Object.hasOwn(journal.before,k)&&(journal.before[k]===null||typeof journal.before[k]==='string')))throw Error('恢复日志损坏，已阻止写入。请保留所有原始分区和恢复前副本。');
 writeParts(storage,journal.before);storage.removeItem(JOURNAL_KEY);return true;
}
export function restoreFull(storage,backup,{expected=null,fallbackTraining=null}={}){
 const valid=parseFull(JSON.stringify(backup));commitParts(storage,valid.parts,{expected,fallbackTraining});
}
function commitParts(storage,parts,{expected=null,fallbackTraining=null}={}){
 if(storage.getItem(JOURNAL_KEY)!==null)throw Error('有未完成的恢复，请先重新打开页面。');
 const before=snapshot(storage);if(expected!==null&&JSON.stringify(before)!==expected)throw Error('预览后本机数据发生变化，请重新导入。');
 const beforeBackup={...before};if(beforeBackup[KEY]===null&&beforeBackup[TRAINING_V2_KEY]===null)beforeBackup[KEY]=JSON.stringify(fallbackTraining??initial());
 storage.setItem(FULL_BEFORE_KEY,JSON.stringify({format:'rainlift-full-backup',version:1,minimumAppVersion:'1.8.2',exportedAt:new Date().toISOString(),parts:beforeBackup}));
 storage.setItem(JOURNAL_KEY,JSON.stringify({format:'rainlift-restore-journal',version:1,before}));
 try{writeParts(storage,parts);storage.removeItem(JOURNAL_KEY);}catch(error){try{recoverRestore(storage);}catch{throw Error('恢复中断，已锁定写入。请重新打开页面以回滚，并保留恢复前副本。');}throw error;}
}
export const restoreFingerprint=storage=>JSON.stringify(snapshot(storage));
// A legacy training-only restore must not silently rebind old session confirmations.
export function restoreTrainingOnly(storage,training,{expected=null}={}){
 training=parseBackup(JSON.stringify(training));const parts=snapshot(storage);let old=null;try{if(parts[TRAINING_V2_KEY]??parts[KEY])old=parseBackup(parts[TRAINING_V2_KEY]??parts[KEY]);}catch{/* Damaged current training remains in before-image; the supplied backup is validated independently. */}
 parts[parts[TRAINING_V2_KEY]!==null||training.version===2?TRAINING_V2_KEY:KEY]=JSON.stringify(training);
 const rawMeta=parts[EXERCISE_META_KEY]??parts[LEGACY_EXERCISE_META_KEY];let meta=null;try{if(rawMeta!==null)meta=parseExerciseMetaImport(JSON.stringify({...JSON.parse(rawMeta),exportedAt:'1970-01-01T00:00:00Z'}));}catch{/* Unreadable independent metadata stays untouched and read-only. */}
 if(meta){delete meta.exportedAt;const sessions=d=>[...(d?.history??[]),...(d?.deletedHistory??[]).map(e=>e.session),...(d?.active?[d.active]:[])];
  const identical=new Set(sessions(training).filter(s=>sessions(old).some(previous=>previous.id===s.id&&JSON.stringify(previous)===JSON.stringify(s))).map(s=>s.id));
  const orphaned=(meta.bodyweightSessions??[]).filter(r=>!identical.has(r.sessionID));
  if(orphaned.length||meta.legacyLoadTypes?.some(r=>!identical.has(r.sessionID))){storage.setItem(EXERCISE_META_KEY+'.before-training-restore',rawMeta);meta.bodyweightSessions=(meta.bodyweightSessions??[]).filter(r=>identical.has(r.sessionID));if(meta.legacyLoadTypes)meta.legacyLoadTypes=meta.legacyLoadTypes.filter(r=>identical.has(r.sessionID));parts[EXERCISE_META_KEY]=JSON.stringify(meta);}
 }
 commitParts(storage,parts,{expected});
}
