import {setTypeOf} from './performance.js?v=1.9.1';

// Pure contracts shared by data, UI and report. No storage or name inference.
export const LOAD_MODES=['external','assisted','unknown','bodyweight_plus_extra'];
const finite=(v,min,max)=>typeof v==='number'&&Number.isFinite(v)&&v>=min&&v<=max;
export function validateSnapshot(s){
 if(!s||!(s.bodyWeightKg===null||finite(s.bodyWeightKg,.01,1000)&&Math.abs(s.bodyWeightKg*100-Math.round(s.bodyWeightKg*100))<1e-6)||!['profile','manual_session',null].includes(s.bodyWeightSource)||!(s.bodyWeightRevisionID===null||typeof s.bodyWeightRevisionID==='string'&&s.bodyWeightRevisionID.length>0&&s.bodyWeightRevisionID.length<=200)||!(s.bodyWeightUpdatedAt===null||finite(s.bodyWeightUpdatedAt,0,253402300799999)))throw Error('训练体重快照格式不正确。');
 if(s.bodyWeightKg===null&&(s.bodyWeightSource!==null||s.bodyWeightRevisionID!==null||s.bodyWeightUpdatedAt!==null)||s.bodyWeightKg!==null&&s.bodyWeightSource===null||s.bodyWeightSource==='profile'&&(s.bodyWeightRevisionID===null||s.bodyWeightUpdatedAt===null))throw Error('训练体重快照来源不完整。');
 return s;
}
export const unknownSnapshot=()=>({bodyWeightKg:null,bodyWeightSource:null,bodyWeightRevisionID:null,bodyWeightUpdatedAt:null});
export function validateLoad(load,weight,unit){
 if(!load||load.schemaVersion!==1||!LOAD_MODES.includes(load.mode)||load.unit!==unit)throw Error('组负重模式或单位不正确。');
 if(load.mode==='bodyweight_plus_extra'){if(unit!=='kg'||!finite(load.extraWeightKg,0,10000)||load.extraWeightKg!==weight)throw Error('额外负重字段不一致或单位不是 kg。');validateSnapshot(load);}
 return load;
}
export function makeLoad(mode,unit,weight,snapshot=unknownSnapshot()){
 if(mode==='bodyweight_plus_extra'){validateSnapshot(snapshot);const {bodyWeightKg,bodyWeightSource,bodyWeightRevisionID,bodyWeightUpdatedAt}=snapshot;const load={schemaVersion:1,mode,unit,bodyWeightKg,bodyWeightSource,bodyWeightRevisionID,bodyWeightUpdatedAt,extraWeightKg:weight};validateLoad(load,weight,unit);return load;}
 const load={schemaVersion:1,mode,unit};validateLoad(load,weight,unit);return load;
}
export function resolveLoad(set,unit){
 if(!set.load)return {mode:'legacy',recordedWeight:set.weight,unit};
 validateLoad(set.load,set.weight,unit);
 const load=set.load;
 return {...load,recordedWeight:set.weight,referenceTotalKg:load.mode==='bodyweight_plus_extra'&&load.bodyWeightKg!==null?Math.round((load.bodyWeightKg+load.extraWeightKg)*1e6)/1e6:null};
}
export function matchesLoadMode(set,unit,mode){
 if(mode==='legacy')return set.load===undefined;
 return set.load?.mode===mode&&set.load?.unit===unit;
}

export function weightSuggestion(training,m,mode,setType='normal',{allowHistory=true}={}){
 if(mode==='blocked')return {weight:0,source:'blocked'};
 if(m.overrideWeight!=null&&(m.overrideMode===mode||mode==='legacy'&&m.overrideMode==null)){
  return {weight:m.overrideWeight,source:'manual'};
 }
 if(allowHistory){
  const matches=set=>setTypeOf(set)===setType&&matchesLoadMode(set,m.exercise.unit,mode);
  const local=m.sets.filter(matches).at(-1);
  if(local)return {weight:local.weight,source:'current'};
  const history=[...training.history].sort((a,b)=>b.started-a.started);
  for(const session of history){
   for(const prior of session.movements){
    if(prior.exercise.id!==m.exercise.id||prior.exercise.unit!==m.exercise.unit)continue;
    const match=prior.sets.find(matches);
    if(match)return {weight:match.weight,source:'history'};
   }
  }
 }
 return {weight:mode==='bodyweight_plus_extra'?0:m.exercise.weight,source:'default'};
}

export function suggestedLoad(training,m,mode,setType='normal'){
 return weightSuggestion(training,m,mode,setType).weight;
}
