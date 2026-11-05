import {identityConflict} from './data.js?v=1.9.1';
import {healthDateKey} from './health.js?v=1.9.1';
import {validateLoad} from './load.js?v=1.9.1';
import {isWorkingSet,setTypeOf} from './performance.js?v=1.9.1';

const DAY = 86400000;
const MASS_UNITS = new Set(['kg','kgs','kilogram','kilograms','公斤','千克','lb','lbs','pound','pounds','磅']);
export const RECORD_RANGES = {30:'最近 30 天',90:'最近 90 天',all:'全部历史'};

const validTime = n => Number.isFinite(n) && n >= 0 && n <= 253402300799999;
const validSet = set => !!set && typeof set.id==='string' && validTime(set.date) && Number.isFinite(set.weight) && set.weight >= 0 && set.weight <= 10000
  && Number.isInteger(set.reps) && set.reps >= 1 && set.reps <= 999;
const dateIndex = date => {
  const [year,month,day]=date.split('-').map(Number);
  return Date.UTC(year,month-1,day)/DAY;
};
export const recordDayLabel = day => new Date(day*DAY).toISOString().split('T')[0];

function choose(best,row,metric){
  if(!best||row[metric]>best[metric])return row;
  if(row[metric]!==best[metric])return best;
  if(row.date!==best.date)return row.date<best.date?row:best;
  for(const key of ['setID','sessionID','movementID'])if(row[key]!==best[key])return row[key]<best[key]?row:best;
  return best;
}

function summarize(rows,mode){
  const sessions=new Set(),weights=new Map();
  let bestLoad=null,bestEstimate=null;
  for(const row of rows){
    sessions.add(row.sessionID);
    weights.set(row.weight,choose(weights.get(row.weight),row,'reps'));
    if(mode!=='assisted')bestLoad=choose(bestLoad,row,'weight');
    if(row.estimated1RM!==null)bestEstimate=choose(bestEstimate,row,'estimated1RM');
  }
  return {
    setCount:rows.length,sessionCount:sessions.size,bestLoad,bestEstimate,
    weights:[...weights].sort(([a],[b])=>a-b).map(([weight,record])=>({weight,record}))
  };
}

// All comparisons use saved group classifications and load modes. Current
// metadata, current body mass and active/deleted sessions are not evidence.
export function deriveExerciseRecords(training,exerciseID,{range='30',now=Date.now(),timeZone=Intl.DateTimeFormat().resolvedOptions().timeZone||'UTC'}={}){
  if(!Object.hasOwn(RECORD_RANGES,range)||!validTime(now))throw Error('动作趋势的日期范围无效。');
  const lastDay=dateIndex(healthDateKey(now,timeZone)),firstDay=range==='all'?null:lastDay-Number(range)+1;
  const excluded={unclassified:0,warmup:0,drop:0,unknownLoad:0,missingBodyWeight:0,invalid:0,future:0,outside:0,active:0,deleted:0};
  const groups=new Map(),result={range,timeZone,firstDay,lastDay,excluded,groups:[],identityConflict:identityConflict(training,exerciseID)};
  if(result.identityConflict)return result;
  const countSets=session=>(session?.movements??[]).filter(m=>m.exercise.id===exerciseID).reduce((count,m)=>count+m.sets.length,0);
  excluded.active=countSets(training.active);
  excluded.deleted=(training.deletedHistory??[]).reduce((count,entry)=>count+countSets(entry.session),0);
  for(const session of training.history){
    const movements=session.movements.filter(m=>m.exercise.id===exerciseID&&m.sets.length);
    if(!movements.length)continue;
    const count=movements.reduce((n,m)=>n+m.sets.length,0);
    if(!validTime(session.started)||!validTime(session.ended)||session.ended<session.started){excluded.invalid+=count;continue;}
    if(session.started>now||session.ended>now){excluded.future+=count;continue;}
    const day=dateIndex(healthDateKey(session.started,timeZone));
    if(firstDay!==null&&day<firstDay){excluded.outside+=count;continue;}
    for(const movement of movements){
      const {unit}=movement.exercise;
      for(const set of movement.sets){
        if(!validSet(set)||typeof unit!=='string'){excluded.invalid++;continue;}
        if(set.date>now){excluded.future++;continue;}
        if(!isWorkingSet(set)){excluded[setTypeOf(set)??'unclassified']++;continue;}
        if(set.load===undefined){excluded.unknownLoad++;continue;}
        try{validateLoad(set.load,set.weight,unit);}catch{excluded.invalid++;continue;}
        const {mode}=set.load;
        if(mode==='unknown'){excluded.unknownLoad++;continue;}
        const bodyWeight=mode==='bodyweight_plus_extra'?set.load.bodyWeightKg:null;
        if(mode==='bodyweight_plus_extra'&&bodyWeight===null){excluded.missingBodyWeight++;continue;}
        const key=JSON.stringify([mode,unit,bodyWeight]);
        if(!groups.has(key))groups.set(key,{key,mode,unit,bodyWeight,rows:[],byDay:new Map()});
        const group=groups.get(key);
        const {weight,reps,date}=set;
        const estimated1RM=mode==='external'&&weight>0&&reps>=2&&reps<=10&&MASS_UNITS.has(unit.trim().toLowerCase())
          ?weight*(1+reps/30):null;
        const row={weight,reps,date,estimated1RM,setID:set.id,movementID:movement.id,sessionID:session.id};
        group.rows.push(row);
        if(!group.byDay.has(day))group.byDay.set(day,[]);
        group.byDay.get(day).push(row);
      }
    }
  }
  result.groups=[...groups.values()].sort((a,b)=>a.key<b.key?-1:a.key>b.key?1:0).map(({key,mode,unit,bodyWeight,rows,byDay})=>({
    key,mode,unit,bodyWeight,...summarize(rows,mode),
    days:[...byDay].sort(([a],[b])=>a-b).map(([day,sets])=>({day,...summarize(sets,mode)}))
  }));
  return result;
}

export function recordSeries(group,metric,weight){
  return group.days.map(row=>{
    if(metric==='sets')return {day:row.day,points:[{value:row.setCount}]};
    if(metric==='sessions')return {day:row.day,points:[{value:row.sessionCount}]};
    if(metric==='load'&&group.mode==='assisted'){
      return {day:row.day,points:row.weights.map(({weight,record})=>({value:weight,record}))};
    }
    const record=metric==='reps'?row.weights.find(item=>item.weight===weight)?.record
      :metric==='estimate'?row.bestEstimate:row.bestLoad;
    const value=metric==='reps'?record?.reps:metric==='estimate'?record?.estimated1RM:record?.weight;
    return {day:row.day,points:record?[{value,record}]:[]};
  });
}
