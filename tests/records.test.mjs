import test from 'node:test';
import assert from 'node:assert/strict';
import {initial,reviseExercise} from '../dist/data.js';
import {makeLoad,unknownSnapshot} from '../dist/load.js';
import {deriveExerciseRecords,recordDayLabel,recordSeries} from '../dist/records.js';
import {recordsPanel} from '../dist/records-ui.js';
import {createAppHarness} from './helpers/app-harness.mjs';

const DAY=86400000;
const now=Date.parse('2026-11-05T01:00:00Z');
const utc={now,timeZone:'UTC',range:'all'};
let id=0;
const uid=()=>String(++id).padStart(6,'0');
function group(weight,reps,{date=now-10000,mode='external',unit='kg',type='normal',bodyWeight=null,setID=uid()}={}){
 const snapshot=bodyWeight===null?unknownSnapshot():{...unknownSnapshot(),bodyWeightKg:bodyWeight,bodyWeightSource:'manual_session'};
 return {id:setID,weight,reps,date,...(mode==='legacy'?{}:{load:makeLoad(mode,unit,weight,snapshot)}),
  ...(type===null?{}:{performance:{schemaVersion:1,setType:type,toFailure:false,effort:null}})};
}
function session(db,sets,{exercise=db.plans[0].exercises[0],unit=exercise.unit,started=now-20000,ended=started+5000}={}){
 return {id:uid(),planID:db.plans[0].id,name:'合成训练',note:'',started,ended,movements:[{id:uid(),exercise:{...exercise,unit},skipped:false,sets}]};
}

test('only valid completed, classified groups with saved load are eligible and omissions are explicit',()=>{
 const db=initial(),exercise=db.plans[0].exercises[0];
 db.history=[
  session(db,[group(40,8),group(60,8,{type:'warmup'}),group(70,8,{type:'drop'}),group(80,8,{type:null}),
   group(90,8,{mode:'legacy'}),group(100,8,{mode:'unknown'}),group(110,8,{date:now+1}),
   {...group(120,8),reps:0},{...group(130,8),load:{schemaVersion:1,mode:'external',unit:'lb'}}]),
  session(db,[group(140,8)],{started:now+10}),
  session(db,[group(150,8)],{ended:null})
 ];
 db.active=session(db,[group(160,8)],{ended:null});
 db.deletedHistory=[{session:session(db,[group(170,8)]),deletedAt:now}];
 const before=JSON.stringify(db),r=deriveExerciseRecords(db,exercise.id,utc);
 assert.equal(JSON.stringify(db),before);
 assert.equal(r.groups[0].bestLoad.weight,40);
 assert.equal(r.groups[0].setCount,1);
 assert.deepEqual(r.excluded,{unclassified:1,warmup:1,drop:1,unknownLoad:2,missingBodyWeight:0,invalid:3,future:2,outside:0,active:1,deleted:1});
});

test('IDs, historical renames, original unit and stored mode are kept separate',()=>{
 const db=initial(),e=db.plans[0].exercises[0],sameName={...db.plans[0].exercises[1],name:e.name};
 db.plans[0].exercises[1]=sameName;
 db.history=[session(db,[group(40,8)]),session(db,[group(90,8,{unit:'lb'})],{unit:'lb'}),
  session(db,[group(100,8,{unit:'KG'})],{unit:'KG'}),session(db,[group(33,9,{mode:'assisted'})]),
  session(db,[group(150,8)],{exercise:sameName})];
 db.plans[0].exercises[0]=reviseExercise(db,e,{name:'新名字'});
 const result=deriveExerciseRecords(db,e.id,utc);
 assert.deepEqual(result.groups.map(row=>[row.mode,row.unit,row.setCount]),[['assisted','kg',1],['external','KG',1],['external','kg',1],['external','lb',1]]);
 assert.equal(deriveExerciseRecords(db,sameName.id,utc).groups[0].bestLoad.weight,150);
 db.plans[1].exercises.push({...e,name:'未确认不同动作'});
 assert.equal(deriveExerciseRecords(db,e.id,utc).identityConflict,true);
 assert.deepEqual(deriveExerciseRecords(db,e.id,utc).groups,[]);
});

test('tie breaking uses actual group time then set ID for load, reps and 1RM',()=>{
 const db=initial(),e=db.plans[0].exercises[0];
 const later=group(80,8,{date:now-1000,setID:'a'});
 const sameDayA=group(80,8,{date:now-2000,setID:'b'});
 const sameDayB=group(80,8,{date:now-2000,setID:'a'});
 db.history=[session(db,[later]),session(db,[sameDayA]),session(db,[sameDayB])];
 const result=deriveExerciseRecords(db,e.id,utc).groups[0];
 assert.equal(result.bestLoad.date,now-2000);
 assert.equal(result.bestLoad.sessionID,db.history[2].id);
 assert.equal(result.bestEstimate.sessionID,db.history[2].id);
 assert.equal(result.weights[0].record.sessionID,db.history[2].id);
});

test('Epley includes 2 and 10 reps, excludes 1, 11, zero, and undefined mass units',()=>{
 const db=initial(),e=db.plans[0].exercises[0];
 db.history=[session(db,[group(300,1),group(200,11),group(70,2),group(60,10),group(0,10)]),
  session(db,[group(100,8,{unit:'plate'})],{unit:'plate'}),session(db,[group(50,2,{unit:'lb'})],{unit:'lb'})];
 const result=deriveExerciseRecords(db,e.id,utc).groups;
 const kg=result.find(g=>g.unit==='kg');
 assert.equal(kg.bestLoad.weight,300);
 assert.equal(kg.bestEstimate.weight,60);
 assert.equal(kg.bestEstimate.estimated1RM,60*(1+10/30));
 assert.equal(result.find(g=>g.unit==='plate').bestEstimate,null);
 assert.equal(result.find(g=>g.unit==='lb').bestEstimate.estimated1RM,50*(1+2/30));
});

test('self-weight separates confirmed reference weights and assisted trends show observed loads',()=>{
 const db=initial(),e=db.plans[0].exercises[0],body='bodyweight_plus_extra';
 db.history=[session(db,[group(0,8,{mode:body,bodyWeight:68}),group(5,6,{mode:body,bodyWeight:68}),group(5,9,{mode:body,bodyWeight:72}),group(20,7,{mode:body})]),
  session(db,[group(30,10,{mode:'assisted'}),group(20,7,{mode:'assisted'}),group(20,8,{mode:'assisted'})])];
 const result=deriveExerciseRecords(db,e.id,utc),assisted=result.groups.find(g=>g.mode==='assisted');
 assert.equal(result.excluded.missingBodyWeight,1);
 assert.equal(assisted.bestLoad,null);
 assert.equal(assisted.bestEstimate,null);
 assert.deepEqual(recordSeries(assisted,'load')[0].points.map(point=>point.value),[20,30]);
 assert.equal(recordSeries(assisted,'reps',20)[0].points[0].value,8);
 const self=result.groups.filter(g=>g.mode===body);
 assert.deepEqual(self.map(g=>[g.bodyWeight,g.setCount,g.bestEstimate]),[[68,2,null],[72,1,null]]);
 assert.equal(recordSeries(self[0],'reps',5)[0].points[0].value,6);
 assert.equal(recordSeries(self[1],'reps',5)[0].points[0].value,9);
});

test('30-day bounds use the local start date, keep original set time and deduplicate sessions per group',()=>{
 const db=initial(),e=db.plans[0].exercises[0];
 const early=Date.parse('2026-10-06T16:10:00Z'),near=now-2*DAY;
 const timed=group(40,8,{date:early+6*3600000});
 const kept=session(db,[timed],{started:early,ended:early+7*3600000});
 kept.movements.push({id:uid(),exercise:{...e},skipped:false,sets:[group(40,10,{date:early+1000})]});
 db.history=[session(db,[group(20,8,{date:early-3600000})],{started:early-3600000}),kept,
  session(db,[group(45,11,{date:near+1000})],{started:near})];
 const sh=deriveExerciseRecords(db,e.id,{now,timeZone:'Asia/Shanghai',range:'30'});
 assert.equal(recordDayLabel(sh.firstDay),'2026-10-07');
 assert.equal(recordDayLabel(sh.groups[0].days[0].day),'2026-10-07');
 assert.equal(sh.excluded.outside,1);
 assert.equal(sh.groups[0].days[0].sessionCount,1);
 assert.equal(sh.groups[0].days[0].setCount,2);
 assert.equal(sh.groups[0].days[0].bestLoad.date,early+1000);
 assert.equal(recordSeries(sh.groups[0],'estimate')[1].points.length,0);
 const la=deriveExerciseRecords(db,e.id,{now,timeZone:'America/Los_Angeles',range:'30'});
 assert.equal(recordDayLabel(la.firstDay),'2026-10-06');
 assert.equal(la.excluded.outside,0);
 assert.equal(la.groups[0].setCount,4);
});

test('chart uses dates with real samples and does not connect over missing days',()=>{
 const db=initial(),e=db.plans[0].exercises[0];
 db.history=[now-3*DAY,now-2*DAY,now-100000].map((started,i)=>session(db,[group(30+i,8,{date:started+1000})],{started}));
 const panel=recordsPanel(db,e.id,{range:'30',metric:'load',group:null,weight:null},{...utc,esc:String,fmt:String});
 assert.match(panel,/<svg[^>]*role="img"/);
 assert.equal((panel.match(/<circle /g)??[]).length,3);
 const lines=panel.match(/class="record-line">([\s\S]*?)<\/g>/)[1];
 assert.equal((lines.match(/<path /g)??[]).length,1);
 assert.match(panel,/查看逐日数据/);
 assert.match(panel,/2026-11-02/);
});

test('action detail filters are read-only and recompute after edit, delete and restore',async()=>{
 const db=initial(),e=db.plans[0].exercises[0],today=Date.now();
 db.version=2;
 db.history=[session(db,[group(40,8,{date:today-DAY})],{started:today-DAY}),
  session(db,[group(60,5,{date:today-2*DAY})],{started:today-2*DAY}),
  session(db,[group(80,8,{date:today-40*DAY})],{started:today-40*DAY})];
 const app=createAppHarness(db);
 app.action('history-open',{id:e.id});
 assert.match(app.html,/最高工作重量<\/span><strong>60 kg/);
 const raw=JSON.stringify(app.state);
 await app.change('record-range','90');
 await app.change('record-weight','40');
 await app.change('record-metric','reps');
 assert.match(app.html,/最高工作重量<\/span><strong>80 kg/);
 assert.match(app.html,/同重量最高次数<\/span><strong>40 kg × 8 次/);
 assert.equal(JSON.stringify(app.state),raw);
 const edited=db.history[2],movement=edited.movements[0];
 app.action('history-edit',{session:edited.id,movement:movement.id,id:movement.sets[0].id});app.field('weight','50');app.submit();
 assert.match(app.html,/最高工作重量<\/span><strong>60 kg/);
 app.action('history-session-open',{session:db.history[1].id});
 app.action('history-delete',{session:db.history[1].id});app.modalAction('confirm');
 app.action('history-open',{id:e.id});assert.match(app.html,/最高工作重量<\/span><strong>40 kg/);
 app.action('history-deleted');
 app.action('history-restore',{session:db.history[1].id});
 app.action('history-open',{id:e.id});assert.match(app.html,/最高工作重量<\/span><strong>60 kg/);
});

test('empty trend keeps original history visible and conflict stops aggregate display',()=>{
 const db=initial(),e=db.plans[0].exercises[0],today=Date.now();
 db.history=[session(db,[group(44,9,{date:today-DAY,mode:'legacy',type:null})],{started:today-DAY})];
 const app=createAppHarness(db);app.action('history-open',{id:e.id});
 assert.match(app.html,/这个范围暂无可比工作组/);
 assert.match(app.html,/未分类 1 组/);
 assert.match(app.html,/44 <small>kg<\/small>/);
 assert.doesNotMatch(app.html,/class="record-chart"/);
 db.plans[1].exercises.push({...e,name:'冲突样本'});
 const conflict=createAppHarness(db);conflict.action('history-open',{id:e.id});
 assert.match(conflict.html,/按训练查看原始记录/);
 assert.doesNotMatch(conflict.html,/动作纪录与趋势/);
});
