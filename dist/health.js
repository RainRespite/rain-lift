// Independent, local-only health protocol. Never reads or writes training storage.
export const HEALTH_KEY='rainlift.health.v1';
export const HEALTH_MAX_BYTES=2*1024*1024;
export const HEALTH_MAX_RECORDS=10000;
const TYPES={steps:'count',sleep:'min',resting_heart_rate:'bpm',hrv:'ms',workout:'min'};
const STAGES=['asleep','core','deep','rem','awake','in_bed','unspecified'];
const ASLEEP=new Set(['asleep','core','deep','rem']);
const fail=message=>{throw Error(message);};
const text=(x,max=200)=>typeof x==='string'&&x.trim().length>0&&x.length<=max;
const finite=(x,min,max)=>typeof x==='number'&&Number.isFinite(x)&&x>=min&&x<=max;
const bytes=raw=>new TextEncoder().encode(raw).length;
export function healthTimeZone(zone){
 if(!text(zone,100))fail('健康数据需要有效的 IANA 时区。');
 try{new Intl.DateTimeFormat('en-US',{timeZone:zone}).format(0);}catch{fail('健康数据时区不正确。');}
 return zone;
}
export function healthDateKey(instant,timeZone){
 const parts=new Intl.DateTimeFormat('en-US',{timeZone,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(instant));
 const p=Object.fromEntries(parts.map(x=>[x.type,x.value]));return `${p.year}-${p.month}-${p.day}`;
}
function clock(instant,timeZone){
 return new Intl.DateTimeFormat('en-GB',{timeZone,hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).format(new Date(instant));
}
function nextDate(date,delta=1){const d=new Date(date+'T12:00:00Z');d.setUTCDate(d.getUTCDate()+delta);return d.toISOString().slice(0,10);}
function instant(value){
 const m=typeof value==='string'&&value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?(Z|[+-]\d{2}:\d{2})$/);
 if(!m)fail('时间必须是含 Z 或 ±HH:mm 时区偏移的 ISO 8601 字符串。');
 const [y,mo,d,h,mi,s]=m.slice(1,7).map(Number),offset=m[8],check=new Date(0);check.setUTCFullYear(y,mo-1,d);check.setUTCHours(h,mi,s,0);
 if(y<1970||check.getUTCFullYear()!==y||check.getUTCMonth()!==mo-1||check.getUTCDate()!==d||h>23||mi>59||s>59||offset!=='Z'&&(+offset.slice(1,3)>14||+offset.slice(4,6)>59||+offset.slice(1,3)===14&&+offset.slice(4,6)!==0))fail('时间日期或时区偏移不合法。');
 const n=Date.parse(value);if(!Number.isFinite(n)||n<0||n>253402300799999)fail('时间日期不合法。');return n;
}
const sourceID=r=>JSON.stringify([r.source.name,r.source.bundleId??null]);
export const healthRecordKey=r=>JSON.stringify([sourceID(r),r.id]);
const sourceLabel=r=>r.source.name+(r.source.bundleId?` (${r.source.bundleId})`:'');
function semantic(r){const {id,timeZone,...rest}=r;return JSON.stringify({...rest,source:sourceID(r),start:Date.parse(r.start),end:Date.parse(r.end)});}
function record(input,zone){
 if(!input||typeof input!=='object'||Array.isArray(input)||!text(input.id)||!Object.hasOwn(TYPES,input.type))fail('健康记录编号或类型不正确。');
 if(!input.source||!text(input.source.name)||input.source.bundleId!==undefined&&!text(input.source.bundleId))fail('每条健康记录需要有效的数据来源。');
 const start=instant(input.start),end=instant(input.end),timeZone=healthTimeZone(input.timeZone??zone),duration=(end-start)/60000;
 if(end<start||duration>10080||duration===0&&!['resting_heart_rate','hrv'].includes(input.type))fail('健康记录的起止时间范围不正确（最长 7 天）。');
 if(input.unit!==TYPES[input.type])fail('健康记录单位不正确：'+input.type+' 需要 '+TYPES[input.type]+'。');
 if(!['sample','daily_total','rolling_24h'].includes(input.aggregation)||input.type!=='steps'&&input.aggregation!=='sample')fail('健康记录汇总方式不正确。');
 const limits={steps:[0,1000000],sleep:[0,10080],resting_heart_rate:[1,300],hrv:[0,10000],workout:[0,10080]}[input.type];
 if(!finite(input.value,...limits)||input.type==='steps'&&!Number.isInteger(input.value))fail('健康记录数值非法或超出导入范围。');
 const r={id:input.id,type:input.type,source:{name:input.source.name,...(input.source.bundleId?{bundleId:input.source.bundleId}:{})},start:input.start,end:input.end,timeZone,unit:input.unit,value:input.value,aggregation:input.aggregation};
 if(input.type==='steps'&&input.aggregation==='daily_total'){
  if(clock(start,timeZone)!=='00:00:00'||clock(end,timeZone)!=='00:00:00'||start%1000!==0||end%1000!==0||healthDateKey(end,timeZone)!==nextDate(healthDateKey(start,timeZone)))fail('每日步数必须覆盖指定时区的完整自然日（午夜至次日午夜）。');
 }
 if(input.type==='steps'&&input.aggregation==='rolling_24h'&&end-start!==86400000)fail('过去 24 小时步数必须恰好覆盖连续 24 小时。');
 if(input.type==='sleep'){
  if(!STAGES.includes(input.stage)||Math.abs(input.value-duration)>.02)fail('睡眠需要有效阶段，分钟数必须匹配起止时间。');r.stage=input.stage;
 }
 if(input.type==='workout'){
  if(!text(input.workoutType)||input.value>duration+.02)fail('运动需要类型，持续分钟数不得超过起止时间区间。');r.workoutType=input.workoutType;
  if(input.heartRate!==undefined){
   const hr=input.heartRate;if(!hr||hr.unit!=='bpm'||!['average','min','max'].some(k=>hr[k]!==undefined))fail('运动心率摘要单位或字段不正确。');
   r.heartRate={unit:'bpm'};for(const k of ['average','min','max'])if(hr[k]!==undefined){if(!finite(hr[k],1,300))fail('运动心率摘要数值不正确。');r.heartRate[k]=hr[k];}
   if(hr.min!==undefined&&hr.max!==undefined&&hr.min>hr.max||hr.average!==undefined&&(hr.min!==undefined&&hr.average<hr.min||hr.max!==undefined&&hr.average>hr.max))fail('运动心率摘要的最小值、平均值和最大值顺序不正确。');
  }
 }
 return r;
}
export function parseHealthImport(raw){
 if(typeof raw!=='string'||bytes(raw)>HEALTH_MAX_BYTES)fail('健康文件必须为 2 MiB 以内的 JSON。');
 let input;try{input=JSON.parse(raw);}catch{fail('健康文件不是有效 JSON。');}
 if(!input||input.format!=='rainlift-health'||input.version!==1||!Array.isArray(input.records)||input.records.length>HEALTH_MAX_RECORDS)fail('健康文件格式或版本不正确（最多 10000 条）。');
 const timeZone=healthTimeZone(input.timeZone);instant(input.exportedAt);
 return {format:'rainlift-health',version:1,timeZone,exportedAt:input.exportedAt,records:input.records.map(r=>record(r,timeZone))};
}
function overlapStats(records){
 const groups=new Map();for(const r of records){const key=JSON.stringify([sourceID(r),r.type]);if(!groups.has(key))groups.set(key,[]);groups.get(key).push(r);}
 let overlaps=0;for(const list of groups.values()){list.sort((a,b)=>Date.parse(a.start)-Date.parse(b.start));let end=-Infinity;for(const r of list){const start=Date.parse(r.start),stop=Date.parse(r.end);if(stop>start&&start<end)overlaps++;end=Math.max(end,stop);}}
 return overlaps;
}
function merge(existing,incoming){
 const byID=new Map(),seen=new Set(),records=[];let duplicates=0;
 for(const r of [...existing,...incoming]){const key=healthRecordKey(r),sig=semantic(r);if(byID.has(key)&&byID.get(key)!==sig)fail('同一来源的记录编号对应不同内容；请先删除旧记录或修正导出文件。');byID.set(key,sig);if(seen.has(sig)){duplicates++;continue;}seen.add(sig);records.push(r);}
 if(records.length>HEALTH_MAX_RECORDS)fail('健康记录总数超过 10000 条，请先导出并删除不需要的记录。');
 const added=records.length-existing.length,overlaps=overlapStats(records),sources=new Set(records.map(sourceID));
 return {records,added,duplicates,total:records.length,overlaps,warnings:[...(overlaps?['存在重叠区间；睡眠按有效区间去重，冲突步数/运动不直接相加。']:[]),...(sources.size>1?['多来源数据分别展示，不合并为一个总量。']:[])]};
}
function empty(){return {format:'rainlift-health',version:1,timeZone:Intl.DateTimeFormat().resolvedOptions().timeZone||'UTC',records:[],lastImportAt:null};}
export class HealthRepository{
 constructor(storage){
  this.storage=storage;this.db=empty();this.writable=true;this.raw=null;
  try{const raw=storage.getItem(HEALTH_KEY);this.raw=raw;if(raw){if(bytes(raw)>HEALTH_MAX_BYTES)fail('健康存储过大');const saved=JSON.parse(raw),parsed=parseHealthImport(JSON.stringify({...saved,exportedAt:saved.lastImportAt??'1970-01-01T00:00:00Z'}));if(saved.lastImportAt!==null)instant(saved.lastImportAt);const merged=merge([],parsed.records);this.db={format:parsed.format,version:1,timeZone:parsed.timeZone,records:merged.records,lastImportAt:saved.lastImportAt};}}
  catch{this.writable=false;this.loadError='无法读取健康存储，已停止健康数据写入。请先导出原始健康文件；训练记录独立保留。';}
 }
 assertWritable(){if(!this.writable)fail(this.loadError);}
 preview(parsed){this.assertWritable();const valid=parseHealthImport(JSON.stringify(parsed)),result=merge(this.db.records,valid.records);const {records,...stats}=result;return stats;}
 import(parsed,now=Date.now()){
  this.assertWritable();if(!finite(now,0,253402300799999))fail('导入时间不正确。');
  const valid=parseHealthImport(JSON.stringify(parsed)),result=merge(this.db.records,valid.records),next={format:'rainlift-health',version:1,timeZone:valid.timeZone,records:result.records,lastImportAt:new Date(now).toISOString()};
  this.save(next);const {records,...stats}=result;return stats;
 }
 save(next){const raw=JSON.stringify(next);if(bytes(raw)>HEALTH_MAX_BYTES)fail('健康存储超过 2 MiB，请先导出并删除不需要的记录。');if(this.storage.getItem(HEALTH_KEY)!==this.raw)fail('健康数据已被其他页面更改，请刷新后重新导入，避免覆盖。');this.storage.setItem(HEALTH_KEY,raw);this.raw=raw;this.db=next;}
 remove(keys){
  this.assertWritable();if(!Array.isArray(keys)||!keys.length||!keys.every(k=>typeof k==='string'))fail('请选择要删除的健康记录。');
  const actual=new Set();for(const key of keys){let matches=this.db.records.filter(r=>healthRecordKey(r)===key);if(!matches.length)matches=this.db.records.filter(r=>r.id===key);if(matches.length!==1)fail('找不到唯一健康记录，请按来源和编号选择。');actual.add(healthRecordKey(matches[0]));}
  this.save({...this.db,records:this.db.records.filter(r=>!actual.has(healthRecordKey(r)))});return actual.size;
 }
 export(now=Date.now()){this.assertWritable();return {format:'rainlift-health',version:1,timeZone:this.db.timeZone,exportedAt:new Date(now).toISOString(),records:structuredClone(this.db.records)};}
}
function union(intervals){let minutes=0,end=-Infinity;for(const [a,b] of intervals.sort((x,y)=>x[0]-y[0])){if(b>end){minutes+=(b-Math.max(a,end))/60000;end=b;}}return minutes;}
function overlapping(list){const sorted=[...list].sort((a,b)=>Date.parse(a.start)-Date.parse(b.start));let end=-Infinity;for(const r of sorted){const a=Date.parse(r.start),b=Date.parse(r.end);if(a<end&&b>a)return true;end=Math.max(end,b);}return false;}
export function healthSummary(db,{now=Date.now(),days=7,timeZone=db.timeZone}={}){
 healthTimeZone(timeZone);if(!Number.isInteger(days)||days<1||days>366||!finite(now,0,253402300799999))fail('健康趋势时间范围不正确。');
 const today=healthDateKey(now,timeZone),rows=Array.from({length:days},(_,i)=>({date:nextDate(today,i-days+1),metrics:[]})),byDay=new Map(rows.map(d=>[d.date,d])),warnings=new Set(),groups=new Map();
 const add=(day,metric)=>{if(byDay.has(day))byDay.get(day).metrics.push(metric);};
 for(const r of db.records){if(Date.parse(r.end)>now){warnings.add('尚未结束或未来的健康区间未计入趋势。');continue;}const key=JSON.stringify([sourceID(r),r.type]);if(!groups.has(key))groups.set(key,[]);groups.get(key).push(r);}
 if(new Set(db.records.map(sourceID)).size>1)warnings.add('多来源指标分别展示，不相加或据此判断恢复能力。');
 for(const list of groups.values()){
  const first=list[0],source=sourceLabel(first),type=first.type,unit=first.unit;
  if(type==='sleep'){
   // Connected sample intervals form an episode, attributed to its final wake date.
   const sorted=[...list].sort((a,b)=>Date.parse(a.start)-Date.parse(b.start)),episodes=[];let current;
   for(const r of sorted){const a=Date.parse(r.start),b=Date.parse(r.end);if(!current||a>current.end){current={end:b,records:[]};episodes.push(current);}current.end=Math.max(current.end,b);current.records.push(r);}
   const daily=new Map();for(const ep of episodes){const valid=ep.records.filter(r=>ASLEEP.has(r.stage));if(!valid.length)continue;const day=healthDateKey(ep.end,timeZone);if(!daily.has(day))daily.set(day,[]);daily.get(day).push(...valid);}
   for(const [day,rs] of daily){
    const intervals=rs.map(r=>[Date.parse(r.start),Date.parse(r.end)]),named=rs.filter(r=>['core','deep','rem'].includes(r.stage));
    // Different named stages cannot both describe the same instant. Generic
    // asleep intervals may legitimately overlap detailed stage samples.
    const stageGroups=['core','deep','rem'].map(stage=>named.filter(r=>r.stage===stage));
    const stageSum=stageGroups.reduce((n,xs)=>n+union(xs.map(r=>[Date.parse(r.start),Date.parse(r.end)])),0),stageUnion=union(named.map(r=>[Date.parse(r.start),Date.parse(r.end)]));
    const stageConflict=stageSum-stageUnion>1e-8,stages={};
    if(!stageConflict)for(let i=0;i<stageGroups.length;i++)if(stageGroups[i].length)stages[['core','deep','rem'][i]]=union(stageGroups[i].map(r=>[Date.parse(r.start),Date.parse(r.end)]));
    const asleepMinutes=union(intervals),awake=list.filter(r=>r.stage==='awake').map(r=>[Date.parse(r.start),Date.parse(r.end)]),awakeConflict=asleepMinutes+union(awake)-union([...intervals,...awake])>1e-8;
    add(day,{type,source,value:awakeConflict?null:asleepMinutes,unit,samples:rs.length,stages,notes:['有效睡眠区间取并集，按同源连通记录的结束日归属；无连接记录的片段不会推断为同一睡眠。在床/清醒/未知分类不计入。',...(overlapping(rs)?['总睡眠与阶段或来源内记录存在重叠，未重复累计。']:[]),...(stageConflict?['不同睡眠阶段区间冲突，已省略阶段时长；总有效睡眠仍按并集。']:[]),...(awakeConflict?['同源清醒与已睡区间冲突，无法给出可靠有效睡眠总时长。']:[])]});
   }
   continue;
  }
  const daily=new Map();for(const r of list){if(r.aggregation==='rolling_24h'){warnings.add('过去 24 小时步数仅保留原始记录，不混入自然日趋势。');continue;}const day=healthDateKey(Date.parse(r.start),timeZone);if(!daily.has(day))daily.set(day,[]);daily.get(day).push(r);}
  for(const [day,rs] of daily){
   let value,notes=[];
   if(type==='steps'){
    const totals=rs.filter(r=>r.aggregation==='daily_total'),sample=rs.filter(r=>r.aggregation==='sample'),endDate=r=>healthDateKey(Date.parse(r.end)-1,timeZone),validTotals=totals.filter(r=>clock(Date.parse(r.start),timeZone)==='00:00:00'&&clock(Date.parse(r.end),timeZone)==='00:00:00'&&healthDateKey(Date.parse(r.end),timeZone)===nextDate(day));
    if(totals.length){if(validTotals.length===totals.length&&new Set(totals.map(r=>r.value)).size===1){value=totals[0].value;notes.push('采用该来源完整自然日总数；同日样本不再相加。');}else{value=null;notes.push('日总量冲突或当前展示时区与日总量边界不一致，无法可靠汇总。');}}
    else if(sample.some(r=>endDate(r)!==day)||overlapping(sample)){value=null;notes.push('样本跨自然日或部分重叠，无法无损分摊，未直接相加。');}
    else{value=sample.reduce((n,r)=>n+r.value,0);notes.push('该来源已导入样本合计，可能不是完整一天。');}
   }else if(type==='workout'){
    value=overlapping(rs)?null:rs.reduce((n,r)=>n+r.value,0);notes.push(value===null?'运动区间重叠，未直接相加。':'已导入运动持续时间合计，按开始日归属；可包含暂停。');
   }else{value=rs.reduce((n,r)=>n+r.value,0)/rs.length;notes.push('该来源已导入样本的算术平均；不是健康应用官方每日统计或恢复评分。');}
   add(day,{type,source,value,unit,samples:rs.length,notes});
  }
 }
 return {timeZone,days:rows,warnings:[...warnings]};
}
