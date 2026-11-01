import test from 'node:test';
import assert from 'node:assert/strict';
import {initial,exercise} from '../dist/data.js';
import {generateAIReport,reportToText} from '../dist/ai-report.js';

const now=Date.parse('2026-11-02T12:00:00+08:00');
const health=()=>({format:'rainlift-health',version:1,timeZone:'Asia/Shanghai',records:[]});
function fixture(){
 const training=initial(),e=exercise('用户实际名称保持原样',68);training.plans[0].exercises=[e];
 const make=(id,date,weights,unit='kg')=>({id,planID:training.plans[0].id,name:'合成测试',started:Date.parse(date+'T10:00:00+08:00'),ended:Date.parse(date+'T11:00:00+08:00'),note:'',movements:[{id:'movement-'+id,exercise:{...structuredClone(e),unit},skipped:false,sets:weights.map((weight,i)=>({id:'set-'+id+'-'+i,weight,reps:8-i,date:Date.parse(date+'T10:00:00+08:00')+i*90000}))}]});
 training.history=[make('prior','2026-10-20',[68,73]),make('latest','2026-11-01',[68,73])];
 const metadata={format:'rainlift-exercise-meta',version:1,entries:[{exerciseID:e.id,unit:'kg',loadType:'bodyweight'}],bodyweightSessions:[{sessionID:'latest',unit:'kg',bodyWeight:68}]};
 return {training,e,metadata,make};
}
const report=(training,metadata)=>generateAIReport(training,health(),{now,metadata});

test('explicit per-session body mass renders 68 plus zero and 68 plus five without rewriting names or source records',()=>{
 const {training,e,metadata}=fixture(),before=JSON.stringify(training),priorMeta=JSON.stringify(metadata),r=report(training,metadata),text=reportToText(r),g=r.training.exercises[0];
 assert.match(text,/体重68kg＋额外负重0kg（原记录68kg）/);assert.match(text,/体重68kg＋额外负重5kg（原记录73kg）/);
 assert.equal(g.displayName,e.name);assert.ok(text.includes(e.name));assert.equal(g.latest.byWeight[1].loadBreakdown.extraWeight,5);
 assert.equal(JSON.stringify(training),before);assert.equal(JSON.stringify(metadata),priorMeta);assert.ok(!text.includes(e.id));
 assert.doesNotMatch(text,/不同体重记录|体重记录 73|力量进步了/);
});

test('today session baseline never retroactively splits a previous training record',()=>{
 const {training,metadata}=fixture(),r=report(training,metadata),g=r.training.exercises[0];
 assert.equal(g.previous.byWeight[1].loadBreakdown.status,'unconfirmed');assert.equal(g.previous.byWeight[1].loadBreakdown.extraWeight,null);
 assert.equal(g.latest.byWeight[1].loadBreakdown.extraWeight,5);
 assert.deepEqual(g.bodyweightDifferences.map(row=>row.startedAt),[new Date(training.history[0].started).toISOString()]);
 const text=reportToText(r);assert.match(text,/体重与附加未拆分/);assert.match(text,/不用当前体重反推旧记录/);
});

test('missing baseline reports original self-weight-class values without inventing body mass or extra weight',()=>{
 const {training,metadata}=fixture();delete metadata.bodyweightSessions;const r=report(training,metadata),text=reportToText(r);
 assert.match(text,/自重类记录重量 68kg/);assert.match(text,/体重与附加未拆分/);
 assert.doesNotMatch(text,/体重68kg＋额外负重5kg|不同体重记录/);
 assert.ok(r.training.exercises[0].latest.byWeight.every(row=>row.loadBreakdown.extraWeight===null));
});

test('below-bodyweight records are preserved and flagged instead of being converted to assistance',()=>{
 const {training,metadata}=fixture();training.history[1].movements[0].sets[1].weight=63;const r=report(training,metadata),text=reportToText(r),row=r.training.exercises[0].latest.byWeight[1];
 assert.equal(row.weight,63);assert.equal(row.loadBreakdown.status,'below_bodyweight');assert.equal(row.loadBreakdown.extraWeight,null);
 assert.match(text,/原记录63kg.*低于本次体重68kg/);assert.match(text,/不自动按辅助重量解释/);assert.doesNotMatch(text,/额外负重-5|辅助重量5/);
});

test('bodyweight baseline cannot cross units or independent same-name exercise identities',()=>{
 const {training,e,metadata,make}=fixture(),independent={...structuredClone(e),id:'independent-same-name',unit:'kg'};
 training.plans[1].exercises=[independent];training.history.push(make('lb-session','2026-10-30',[73],'lb'));
 metadata.entries.push({exerciseID:e.id,unit:'lb',loadType:'bodyweight'});metadata.bodyweightSessions.push({sessionID:'lb-session',unit:'kg',bodyWeight:68});
 const other=make('other-session','2026-10-29',[73]);other.movements[0].exercise=independent;training.history.push(other);
 const r=report(training,metadata),lb=r.training.exercises.find(group=>group.unit==='lb'),otherGroup=r.training.exercises.find(group=>group.exerciseID===independent.id);
 assert.equal(lb.latest.byWeight[0].loadBreakdown.status,'unconfirmed');assert.equal(otherGroup.loadType,'unknown');assert.equal(otherGroup.latest.byWeight[0].loadBreakdown,undefined);
 assert.equal(r.training.exercises.length,3);assert.ok(r.training.exercises.every(group=>group.displayName.includes(e.name)));
});

test('same recorded total with different session body masses is not called the same added load',()=>{
 const {training,metadata}=fixture();metadata.bodyweightSessions.push({sessionID:'prior',unit:'kg',bodyWeight:63});
 const r=report(training,metadata),text=reportToText(r);assert.equal(r.training.exercises[0].comparison.sameWeight[0].sameConfirmedBodyweightAndExtra,false);
 assert.match(text,/拆分未确认或体重不同，仅对照原记录/);assert.doesNotMatch(text,/体重及额外负重均相同/);
});

test('matching confirmed body mass and added load permits factual same-load repetition comparison',()=>{
 const {training,metadata}=fixture();metadata.bodyweightSessions.push({sessionID:'prior',unit:'kg',bodyWeight:68});
 const r=report(training,metadata),text=reportToText(r);assert.ok(r.training.exercises[0].comparison.sameWeight.every(row=>row.sameConfirmedBodyweightAndExtra));
 assert.match(text,/体重及额外负重均相同/);assert.deepEqual(r.training.exercises[0].bodyweightDifferences,[]);
});

test('current exact identity name stays unchanged while historical names remain traceable in detail',()=>{
 const {training,e,metadata}=fixture();training.history[0].movements[0].exercise.name='用户以前自行设置的简称';e.knownNames=[e.name,'用户以前自行设置的简称'];const before=JSON.stringify(training),r=report(training,metadata);
 assert.equal(r.training.exercises[0].displayName,e.name);assert.equal(r.training.exercises.length,1);
 assert.match(reportToText(r,{detailed:true}),/用户以前自行设置的简称/);assert.equal(JSON.stringify(training),before);
});
