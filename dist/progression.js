import {isWorkingSet,performanceDetails} from './performance.js?v=1.9.1';

export const LOOKBACK_DAYS = 30;
export const MAX_PROGRESS_RPE = 8;
export const DEFAULT_REP_RANGE = {minReps:8,maxReps:12};
const DAY = 86400000;
const integer = (value,min,max) => Number.isInteger(value)&&value>=min&&value<=max;
const weightValue = value => Number.isFinite(value)&&value>=0&&value<=10000;
const validTime = value => Number.isFinite(value)&&value>=0&&value<=253402300799999;
const hasKeys = (value,keys) => value!==null&&typeof value==='object'&&!Array.isArray(value)
  && Object.keys(value).length===keys.length&&keys.every(key=>Object.hasOwn(value,key));
const validRange = ({minReps,maxReps}) => integer(minReps,1,999)&&integer(maxReps,minReps,999);

export function validateProgression(value){
  if(!hasKeys(value,['enabled','minReps','maxReps'])||typeof value.enabled!=='boolean'||!validRange(value)){
    throw Error('目标次数需为 1–999 的整数，下限不能大于上限。');
  }
  return true;
}

export function validateProgressionTarget(value){
  if(!hasKeys(value,['schemaVersion','target','minReps','maxReps'])||value.schemaVersion!==1
      ||!integer(value.target,1,99)||!validRange(value)){
    throw Error('训练组的渐进目标快照无效或版本不受支持。');
  }
  return true;
}

export function progressionTarget(exercise){
  if(!exercise.progression?.enabled)return;
  const {target}=exercise,{minReps,maxReps}=exercise.progression;
  return {schemaVersion:1,target,minReps,maxReps};
}

const sameTarget = (saved,target) => saved?.schemaVersion===1&&saved.target===target.target
  &&saved.minReps===target.minReps&&saved.maxReps===target.maxReps;
const hold = reason => ({kind:'hold',reason});

function loadProblem(set,unit,weight,now){
  if(!validTime(set.date)||set.date>now||!weightValue(set.weight)||!integer(set.reps,1,999))return 'invalid_set';
  if(set.load?.schemaVersion!==1||set.load.mode!=='external'||set.load.unit!==unit)return 'different_load';
  if(set.weight!==weight)return 'different_weight';
}

function effortProblem(set){
  const mark=performanceDetails(set);
  if(mark?.toFailure)return 'failure';
  if(mark?.effortNeedsConfirmation)return 'stale_effort';
  if(!mark?.effort)return 'no_effort';
  if(mark.effort.kind!=='exact')return 'bounded_effort';
  if(mark.effort.rpe>MAX_PROGRESS_RPE)return 'high_effort';
}

function nextReps(m,unit,weight,target,now){
  // Compare the latest actual set, even when a later warm-up or drop set
  // makes the previous working set unsuitable as the immediate reference.
  const last=m.sets.reduce((latest,set)=>!latest||set.date>=latest.date?set:latest,null);
  if(!isWorkingSet(last))return hold('latest_not_working');
  const reason=loadProblem(last,unit,weight,now)||effortProblem(last);
  if(reason)return hold(reason);
  if(last.progressionTarget&&!sameTarget(last.progressionTarget,target))return hold('different_target');
  if(last.reps<target.minReps)return hold('below_range');
  if(last.reps>=target.maxReps)return hold('at_rep_limit');
  return {kind:'reps',weight,reps:last.reps+1,previousReps:last.reps,rpe:performanceDetails(last).effort.rpe};
}

function latestExposures(training,exerciseID,now){
  return training.history.flatMap(session=>{
    if(!validTime(session.started)||!validTime(session.ended)||session.ended<session.started||session.ended>now)return [];
    const movements=session.movements.filter(m=>m.exercise.id===exerciseID&&m.sets.length);
    return movements.length?[{session,movements}]:[];
  }).sort(({session:a},{session:b})=>b.started-a.started||b.ended-a.ended||(a.id<b.id?-1:a.id>b.id?1:0)).slice(0,2);
}

function increaseWeight(training,m,unit,weight,target,now){
  if(m.sets.some(set=>set.performance?.setType!=='warmup'||set.performance?.toFailure)){
    return hold('no_current_working_set');
  }
  const recent=latestExposures(training,m.exercise.id,now);
  if(recent.length!==2)return hold('few_sessions');
  for(const {session,movements} of recent){
    if(now-session.ended>LOOKBACK_DAYS*DAY)return hold('old_history');
    if(movements.length!==1)return hold('duplicate_action');
    const [prior]=movements;
    if(prior.exercise.unit!==unit)return hold('different_load');
    const work=prior.sets.filter(isWorkingSet);
    if(work.length<target.target)return hold('too_few_sets');
    if(work.some(set=>set.progressionTarget===undefined))return hold('no_target_snapshot');
    if(prior.sets.some(set=>set.progressionTarget&&!sameTarget(set.progressionTarget,target))){
      return hold('different_target');
    }
    for(const set of work){
      const reason=loadProblem(set,unit,weight,now)||effortProblem(set);
      if(reason)return hold(reason);
      if(set.reps<target.maxReps)return hold('below_session_limit');
    }
  }
  const step=m.exercise.step;
  const sum=weight+step,next=Math.round(sum*100)/100;
  if(!Number.isFinite(step)||step<.01||step>1000||sum>10000||!weightValue(next)||next<=weight)return hold('weight_limit');
  return {kind:'increase',fromWeight:weight,weight:next,sessionIDs:recent.map(row=>row.session.id)};
}

export function recommendProgression(training,m,{mode,weight,now=Date.now(),identityUncertain=false,nextSetType='normal',nextToFailure=false}={}){
  const target=m&&progressionTarget(m.exercise);
  if(!target)return null;
  if(identityUncertain)return hold('identity');
  if(mode!=='external'||!m.exercise.unit.trim())return hold('unsupported_mode');
  if(m.skipped)return hold('skipped');
  if(training.active?.movements.some(other=>other.id!==m.id&&other.exercise.id===m.exercise.id))return hold('duplicate_action');
  if(nextSetType!=='normal'||nextToFailure)return hold('different_next_set');
  if(!weightValue(weight)||!validTime(now))return hold('invalid_weight');
  if(m.sets.some(isWorkingSet))return nextReps(m,m.exercise.unit,weight,target,now);
  return increaseWeight(training,m,m.exercise.unit,weight,target,now);
}
