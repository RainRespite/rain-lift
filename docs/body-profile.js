export const PROFILE_KEY='rainlift.body-profile.v1';
const finite=(v,min,max)=>typeof v==='number'&&Number.isFinite(v)&&v>=min&&v<=max;
export const validBodyWeight=v=>finite(v,.01,1000)&&Math.abs(v*100-Math.round(v*100))<1e-6;
export const validTimestamp=v=>finite(v,0,253402300799999);
const id=v=>typeof v==='string'&&v.length>0&&v.length<=200;
export const emptyProfile=()=>({format:'rainlift-body-profile',version:1,heightCm:null,sex:'unspecified',includeInReport:false,current:null,history:[]});
export function validateProfile(p){
 const revision=r=>r&&id(r.id)&&validBodyWeight(r.weightKg)&&validTimestamp(r.updatedAt);
 if(!p||p.format!=='rainlift-body-profile'||p.version!==1||!(p.heightCm===null||finite(p.heightCm,1,300)&&Math.abs(p.heightCm*100-Math.round(p.heightCm*100))<1e-6)||!['male','female','unspecified'].includes(p.sex)||typeof p.includeInReport!=='boolean'||!(p.current===null||revision(p.current))||!Array.isArray(p.history)||p.history.length>10000||!p.history.every(revision)||new Set(p.history.map(r=>r.id)).size!==p.history.length)throw Error('身体档案格式或数值不正确。身高 1–300 cm，体重 0.01–1000 kg，最多两位小数。');
 const current=p.current&&p.history.find(r=>r.id===p.current.id);
 if(current&&(current.weightKg!==p.current.weightKg||current.updatedAt!==p.current.updatedAt))throw Error('当前体重与变更记录冲突。');
 return p;
}
export function profileSnapshot(p){return {bodyWeightKg:p.current?.weightKg??null,bodyWeightSource:p.current?'profile':null,bodyWeightRevisionID:p.current?.id??null,bodyWeightUpdatedAt:p.current?.updatedAt??null};}
export class ProfileRepository{
 constructor(storage){this.storage=storage;this.raw=null;this.db=emptyProfile();this.writable=true;this.loadError=null;try{this.raw=storage.getItem(PROFILE_KEY);if(this.raw!==null){if(this.raw.length>1024*1024)throw Error();this.db=validateProfile(JSON.parse(this.raw));}}catch{this.writable=false;this.loadError='无法读取身体档案，已停止档案写入。请先导出原始档案。';}}
 save(next){if(!this.writable)throw Error(this.loadError);validateProfile(next);if(this.storage.getItem(PROFILE_KEY)!==this.raw)throw Error('身体档案已被其他页面修改，请重新打开后再保存。');const raw=JSON.stringify(next);if(raw.length>1024*1024)throw Error('身体档案过大，请先完整备份。');this.storage.setItem(PROFILE_KEY,raw);this.raw=raw;this.db=next;}
 update({heightCm=this.db.heightCm,sex=this.db.sex,includeInReport=this.db.includeInReport,weightKg=this.db.current?.weightKg??null},now=Date.now()){
  if(!validTimestamp(now)||!(weightKg===null||validBodyWeight(weightKg)))throw Error('请填写有效体重（0.01–1000 kg，最多两位小数），或明确留空。');
  const next=structuredClone(this.db);Object.assign(next,{heightCm,sex,includeInReport});
  if(weightKg!==(next.current?.weightKg??null)){next.current=weightKg===null?null:{id:crypto.randomUUID(),weightKg,updatedAt:now};if(next.current)next.history.push({...next.current});}
  this.save(next);return next;
 }
 removeRevision(revisionID,{clearCurrent=false}={}){const next=structuredClone(this.db);if(!next.history.some(r=>r.id===revisionID))throw Error('这条体重记录已不存在。');next.history=next.history.filter(r=>r.id!==revisionID);if(clearCurrent&&next.current?.id===revisionID)next.current=null;this.save(next);}
}
