export const KEY='rainlift.web.v1';
export const uid=()=>crypto.randomUUID();
export const exercise=(name='新动作',weight=20,reps=[8,9,10],rest=90)=>({id:uid(),name,weight,unit:'kg',step:2.5,reps,rest,target:3});
export function initial(){return {format:'rainlift-web',version:1,plans:[{id:uid(),name:'拉 · 背部与二头',exercises:[exercise('宽距高位下拉',40),exercise('坐姿划船',35),exercise('哑铃弯举',10,[10,12,15],60)]},{id:uid(),name:'推 · 胸肩与三头',exercises:[exercise('卧推',40,[8,9,10],120),exercise('哑铃肩推',12.5),exercise('侧平举',5,[12,15,20],60)]}],history:[],active:null,rest:null};}
const finite=(x,min,max)=>typeof x==='number'&&Number.isFinite(x)&&x>=min&&x<=max;
const integer=(x,min,max)=>Number.isInteger(x)&&finite(x,min,max);
const text=x=>typeof x==='string'&&x.trim().length>0&&x.length<=200;
const ids=xs=>Array.isArray(xs)&&xs.every(x=>text(x.id))&&new Set(xs.map(x=>x.id)).size===xs.length;
export function validate(d){
 const ex=e=>e&&text(e.id)&&text(e.name)&&typeof e.unit==='string'&&e.unit.length<=30&&finite(e.weight,0,10000)&&finite(e.step,.01,1000)&&integer(e.target,1,99)&&integer(e.rest,15,3600)&&Array.isArray(e.reps)&&e.reps.length===3&&new Set(e.reps).size===3&&e.reps.every(r=>integer(r,1,999));
 const set=s=>s&&text(s.id)&&finite(s.weight,0,10000)&&integer(s.reps,1,999)&&finite(s.date,0,1e15);
 const movement=m=>m&&ex(m.exercise)&&ids(m.sets)&&m.sets.every(set)&&(m.overrideWeight==null||finite(m.overrideWeight,0,10000))&&typeof m.skipped==='boolean';
 const session=s=>s&&text(s.id)&&text(s.planID)&&text(s.name)&&finite(s.started,0,1e15)&&(s.ended==null||finite(s.ended,s.started,1e15))&&typeof s.note==='string'&&s.note.length<=10000&&ids(s.movements)&&s.movements.every(movement);
 if(!d||d.format!=='rainlift-web'||d.version!==1||!ids(d.plans)||!d.plans.every(p=>text(p.name)&&ids(p.exercises)&&p.exercises.every(ex))||!ids(d.history)||!d.history.every(s=>session(s)&&s.ended!=null)||(d.active!=null&&(!session(d.active)||d.active.ended!=null||d.history.some(s=>s.id===d.active.id))))throw Error('备份格式或训练数据不正确，原记录未改变。');
 if(d.rest!=null&&(!text(d.rest.setID)||!text(d.rest.name)||!finite(d.rest.end,0,1e15)||!d.active?.movements.some(m=>m.sets.some(s=>s.id===d.rest.setID))))throw Error('备份中的休息计时无效。');
 return d;
}
export function parseBackup(raw){
 let d=JSON.parse(raw);
 if(!d.format&&d.version===1){
  const swiftDate=x=>(x+978307200)*1000;
  d.format='rainlift-web';d.active??=null;d.rest??=null;
  for(const session of [...d.history,...(d.active?[d.active]:[])]){
   session.started=swiftDate(session.started);session.ended=session.ended==null?null:swiftDate(session.ended);session.note??='';
   for(const m of session.movements){m.skipped??=false;for(const s of m.sets)s.date=swiftDate(s.date);}
  }
  if(d.rest)d.rest.end=swiftDate(d.rest.end);
 }
 validate(d);return d;
}
export function previous(d,id){return [...d.history].sort((a,b)=>b.started-a.started).flatMap(s=>s.movements).find(m=>m.exercise.id===id&&m.sets.length);}
export function suggested(d,m){return m.overrideWeight??previous(d,m.exercise.id)?.sets[m.sets.length]?.weight??m.sets.at(-1)?.weight??m.exercise.weight;}
export function start(d,planID){if(d.active)throw Error('请先结束当前训练。');const p=d.plans.find(p=>p.id===planID);if(!p?.exercises.length)throw Error('请先添加动作。');d.active={id:uid(),planID:p.id,name:p.name,started:Date.now(),ended:null,note:'',movements:p.exercises.map(e=>({id:uid(),exercise:structuredClone(e),sets:[],skipped:false}))};}
export function record(d,id,reps,weight,timed=true,now=Date.now()){
 const m=d.active?.movements.find(m=>m.id===id);if(!m)throw Error('请先选择动作。');if(!integer(reps,1,999)||!finite(weight,0,10000))throw Error('请填写有效重量和次数。');
 const s={id:uid(),weight,reps,date:now};m.sets.push(s);m.skipped=false;if(timed)d.rest={setID:s.id,name:m.exercise.name,end:now+m.exercise.rest*1000};return s;
}
export function removeSet(d,mid,sid,sessionID=null){const session=sessionID?d.history.find(s=>s.id===sessionID):d.active;const m=session?.movements.find(m=>m.id===mid);if(!m)throw Error('找不到该动作。');m.sets=m.sets.filter(s=>s.id!==sid);if(d.rest?.setID===sid)d.rest=null;}
export function finish(d){if(!d.active)throw Error('没有进行中的训练。');d.active.ended=Date.now();d.history.unshift(d.active);d.active=null;d.rest=null;}
export const remaining=(rest,now=Date.now())=>rest?Math.max(0,Math.ceil((rest.end-now)/1000)):0;
export class Repository{
 constructor(storage){this.storage=storage;this.writable=true;try{const raw=storage.getItem(KEY);this.db=raw?validate(JSON.parse(raw)):initial();}catch(e){this.db={format:'rainlift-web',version:1,plans:[],history:[],active:null,rest:null};this.writable=false;this.loadError='无法读取本地记录。为避免覆盖原数据，已停止写入。请先导出原始文件，或从备份恢复。';}}
 change(fn){if(!this.writable)throw Error(this.loadError);const next=structuredClone(this.db);const result=fn(next);validate(next);this.storage.setItem(KEY,JSON.stringify(next));this.db=next;return result;}
 restore(d){validate(d);const old=this.storage.getItem(KEY);if(old)this.storage.setItem(KEY+'.before-restore',old);this.storage.setItem(KEY,JSON.stringify(d));this.db=d;this.writable=true;this.loadError=null;}
}
