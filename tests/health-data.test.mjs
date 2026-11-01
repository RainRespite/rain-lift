import test from 'node:test';
import assert from 'node:assert/strict';
import {HEALTH_KEY,HEALTH_MAX_BYTES,HealthRepository,parseHealthImport,healthSummary,healthRecordKey} from '../dist/health.js';
import {KEY,initial,Repository,parseBackup,start,record} from '../dist/data.js';
class Storage{values=new Map();getItem(k){return this.values.get(k)??null;}setItem(k,v){if(this.fail)throw Error('quota');this.values.set(k,String(v));}}
const now=Date.parse('2026-10-31T12:00:00+08:00');
const sample=(overrides={})=>({id:'steps1',type:'steps',source:{name:'iPhone',bundleId:'com.example.health'},start:'2026-10-30T08:00:00+08:00',end:'2026-10-30T08:10:00+08:00',unit:'count',value:120,aggregation:'sample',...overrides});
const input=(records=[sample()],extra={})=>({format:'rainlift-health',version:1,timeZone:'Asia/Shanghai',exportedAt:'2026-10-31T12:00:00+08:00',records,...extra});
const parsed=(records,extra)=>parseHealthImport(JSON.stringify(input(records,extra)));
const metric=(repo,type='steps',date='2026-10-30',opts={})=>healthSummary(repo.db,{now,...opts}).days.find(d=>d.date===date)?.metrics.find(m=>m.type===type);

test('health import previews without writing, persists only after explicit import and reloads offline',()=>{
 const storage=new Storage(),repo=new HealthRepository(storage),data=parsed();
 assert.deepEqual(repo.preview(data),{added:1,duplicates:0,total:1,overlaps:0,warnings:[]});assert.equal(storage.getItem(HEALTH_KEY),null);
 repo.import(data,now);assert.equal(repo.db.records[0].source.name,'iPhone');assert.equal(repo.db.records[0].timeZone,'Asia/Shanghai');assert.equal(repo.db.lastImportAt,new Date(now).toISOString());
 const reopened=new HealthRepository(storage);assert.equal(metric(reopened).value,120);assert.equal(reopened.db.records.length,1);
});
test('duplicate import deduplicates same identity and semantic samples with new IDs or offset notation',()=>{
 const repo=new HealthRepository(new Storage());repo.import(parsed(),now);
 assert.equal(repo.import(parsed(),now).duplicates,1);
 assert.equal(repo.import(parsed([sample({id:'new-id',start:'2026-10-30T00:00:00Z',end:'2026-10-30T00:10:00Z'})]),now).added,0);
 assert.equal(repo.db.records.length,1);
});
test('same source ID with changed data rejects whole batch; IDs from distinct sources remain independent',()=>{
 const storage=new Storage(),repo=new HealthRepository(storage);repo.import(parsed(),now);const before=storage.getItem(HEALTH_KEY);
 assert.throws(()=>repo.import(parsed([sample({id:'valid-new'}),sample({value:121})]),now),/编号/);assert.equal(storage.getItem(HEALTH_KEY),before);
 repo.import(parsed([sample({source:{name:'Watch',bundleId:'com.example.watch'}})]),now);assert.equal(repo.db.records.length,2);
 const rows=healthSummary(repo.db,{now}).days.find(d=>d.date==='2026-10-30').metrics;assert.equal(rows.length,2);assert.deepEqual(rows.map(m=>m.value),[120,120]);
});
test('empty/incomplete metric sets work and absent data are never filled with zero',()=>{
 const repo=new HealthRepository(new Storage());repo.import(parsed([]),now);assert.equal(repo.db.records.length,0);assert.equal(healthSummary(repo.db,{now}).days.every(d=>d.metrics.length===0),true);
 repo.import(parsed(),now);assert.equal(metric(repo,'hrv'),undefined);assert.equal(metric(repo,'sleep'),undefined);
});
test('wrong units, non-finite numbers, bad types, impossible dates and missing offsets reject import',()=>{
 for(const change of [{unit:'steps'},{value:-1},{value:'120'},{value:1.2},{type:'unknown'},{start:'2026-02-30T08:00:00+08:00'},{start:'2026-10-30T08:00:00'},{start:'2026-10-30T08:00:00+15:00'},{end:'2026-10-29T08:00:00Z'}])assert.throws(()=>parsed([sample(change)]),JSON.stringify(change));
 assert.throws(()=>parsed([sample({value:Infinity})]));assert.throws(()=>parsed(undefined,{timeZone:'Mars/Olympus'}));assert.throws(()=>parsed(undefined,{version:1.7}));
});
test('file size is UTF8 bytes and record counts are bounded',()=>{
 assert.throws(()=>parseHealthImport(' '.repeat(HEALTH_MAX_BYTES+1)),/2 MiB/);
 assert.throws(()=>parseHealthImport(JSON.stringify(input([], {padding:'健'.repeat(HEALTH_MAX_BYTES/3)}))),/2 MiB/);
 assert.throws(()=>parsed(Array(10001).fill(null)),/10000/);
});
test('sleep crossing midnight uses elapsed minutes and wake day; overlapping total/stages counted once',()=>{
 const repo=new HealthRepository(new Storage()),base=sample({id:'sleep-total',type:'sleep',unit:'min',stage:'asleep',start:'2026-10-29T23:00:00+08:00',end:'2026-10-30T07:00:00+08:00',value:480});
 repo.import(parsed([base,{...base,id:'sleep-core',stage:'core',start:'2026-10-29T23:00:00+08:00',end:'2026-10-30T00:00:00+08:00',value:60},{...base,id:'sleep-deep',stage:'deep',start:'2026-10-30T00:00:00+08:00',end:'2026-10-30T01:00:00+08:00',value:60}]),now);
 assert.equal(metric(repo,'sleep').value,480);assert.equal(metric(repo,'sleep').stages.deep,60);assert.equal(metric(repo,'sleep','2026-10-29'),undefined);
 assert.equal(repo.db.records[0].start,base.start);assert.throws(()=>parsed([{...base,value:479}]),/睡眠/);
});
test('awake, in-bed and unknown sleep do not pretend to be valid sleep',()=>{
 const repo=new HealthRepository(new Storage());repo.import(parsed(['awake','in_bed','unspecified'].map((stage,i)=>sample({id:'sleep'+i,type:'sleep',unit:'min',stage,value:10}))),now);
 assert.equal(metric(repo,'sleep'),undefined);
});
test('natural day steps differ from rolling 24 hours; full day totals override same source samples',()=>{
 const repo=new HealthRepository(new Storage()),daily=sample({id:'daily',aggregation:'daily_total',value:5000,start:'2026-10-30T00:00:00+08:00',end:'2026-10-31T00:00:00+08:00'}),rolling=sample({id:'rolling',aggregation:'rolling_24h',value:5500,start:'2026-10-29T12:00:00+08:00',end:'2026-10-30T12:00:00+08:00'});
 repo.import(parsed([sample(),daily,rolling]),now);assert.equal(metric(repo).value,5000);assert.match(healthSummary(repo.db,{now}).warnings.join(' '),/24 小时/);
 assert.throws(()=>parsed([{...daily,start:'2026-10-30T01:00:00+08:00'}]),/自然日/);
 assert.throws(()=>parsed([{...rolling,end:'2026-10-30T13:00:00+08:00'}]),/24 小时/);
});
test('DST natural days need not be 24h and timezone changes preserve original boundaries',()=>{
 const repo=new HealthRepository(new Storage()),daily=sample({aggregation:'daily_total',start:'2026-03-08T00:00:00-05:00',end:'2026-03-09T00:00:00-04:00',value:7000});
 repo.import(parsed([daily],{timeZone:'America/New_York'}),now);
 const ny=healthSummary(repo.db,{now:Date.parse('2026-03-09T18:00:00-04:00'),days:2});assert.equal(ny.days[0].metrics[0].value,7000);
 const shifted=healthSummary(repo.db,{now:Date.parse('2026-03-09T18:00:00Z'),days:3,timeZone:'UTC'});assert.equal(shifted.days.find(d=>d.date==='2026-03-08').metrics[0].value,null);
 assert.equal(repo.db.records[0].timeZone,'America/New_York');
});
test('partial-overlap steps and cross-midnight samples are not blindly added or prorated',()=>{
 const repo=new HealthRepository(new Storage());repo.import(parsed([sample(),sample({id:'overlap',start:'2026-10-30T08:05:00+08:00',end:'2026-10-30T08:15:00+08:00'})]),now);assert.equal(metric(repo).value,null);
 const cross=new HealthRepository(new Storage());cross.import(parsed([sample({start:'2026-10-29T23:55:00+08:00',end:'2026-10-30T00:05:00+08:00'})]),now);assert.equal(metric(cross,'steps','2026-10-29').value,null);
});
test('conflicting daily totals do not invent a definitive total',()=>{
 const repo=new HealthRepository(new Storage()),daily=sample({aggregation:'daily_total',start:'2026-10-30T00:00:00+08:00',end:'2026-10-31T00:00:00+08:00'});
 repo.import(parsed([daily,{...daily,id:'changed',value:9000}]),now);assert.equal(metric(repo).value,null);
});
test('RHR and HRV preserve source, units and actual average without recovery thresholds',()=>{
 const repo=new HealthRepository(new Storage());repo.import(parsed([sample({id:'rhr',type:'resting_heart_rate',unit:'bpm',value:60,end:'2026-10-30T08:00:00+08:00'}),sample({id:'hrv',type:'hrv',unit:'ms',value:45}),sample({id:'hrv2',type:'hrv',unit:'ms',value:55,start:'2026-10-30T09:00:00+08:00',end:'2026-10-30T09:00:00+08:00'})]),now);
 assert.equal(metric(repo,'resting_heart_rate').value,60);assert.equal(metric(repo,'hrv').value,50);assert.match(metric(repo,'hrv').notes.join(),/算术平均/);
});
test('workout duration and optional heart rate validated and preserved; missing HR stays absent',()=>{
 const workout=sample({id:'workout',type:'workout',workoutType:'strength',unit:'min',value:8,heartRate:{min:80,average:110,max:150,unit:'bpm'}}),repo=new HealthRepository(new Storage());repo.import(parsed([workout]),now);
 assert.deepEqual(repo.db.records[0].heartRate,workout.heartRate);assert.equal(metric(repo,'workout').value,8);
 assert.throws(()=>parsed([{...workout,value:12}]),/运动/);assert.throws(()=>parsed([{...workout,heartRate:{min:150,average:110,max:80,unit:'bpm'}}]),/顺序/);
 const minimal=parsed([{...workout,heartRate:undefined}]);assert.equal('heartRate' in minimal.records[0],false);
});
test('future/in-progress records excluded and explicitly noted',()=>{
 const repo=new HealthRepository(new Storage());repo.import(parsed([sample({start:'2026-10-31T13:00:00+08:00',end:'2026-10-31T13:10:00+08:00'})]),now);
 const s=healthSummary(repo.db,{now});assert.equal(s.days.every(d=>d.metrics.length===0),true);assert.match(s.warnings.join(),/未来/);
});
test('failed import/delete writes preserve both in-memory and persisted health and byte-identical training records',()=>{
 const storage=new Storage(),training=new Repository(storage);training.change(d=>{start(d,d.plans[0].id);record(d,d.active.movements[0].id,9,40);});const original=storage.getItem(KEY),repo=new HealthRepository(storage);repo.import(parsed(),now);const raw=storage.getItem(HEALTH_KEY),state=JSON.stringify(repo.db);
 storage.fail=true;assert.throws(()=>repo.import(parsed([sample({id:'next',start:'2026-10-30T09:00:00+08:00',end:'2026-10-30T09:10:00+08:00'})]),now),/quota/);assert.throws(()=>repo.remove([healthRecordKey(repo.db.records[0])]),/quota/);
 assert.equal(storage.getItem(HEALTH_KEY),raw);assert.equal(JSON.stringify(repo.db),state);assert.equal(storage.getItem(KEY),original);
});
test('old training backup restore remains version 1 and never replaces independent health storage',()=>{
 const storage=new Storage(),repo=new HealthRepository(storage);repo.import(parsed(),now);const health=storage.getItem(HEALTH_KEY),training=new Repository(storage),old=initial();
 training.restore(parseBackup(JSON.stringify(old)));assert.equal(training.db.version,1);assert.equal(storage.getItem(HEALTH_KEY),health);
 repo.remove([healthRecordKey(repo.db.records[0])]);assert.equal(storage.getItem(KEY),JSON.stringify(old));
});
test('corrupt health cannot be overwritten, while independent training repository continues working',()=>{
 const storage=new Storage();storage.setItem(HEALTH_KEY,'broken');const health=new HealthRepository(storage),training=new Repository(storage);assert.equal(health.writable,false);assert.throws(()=>health.import(parsed(),now));assert.equal(storage.getItem(HEALTH_KEY),'broken');training.change(d=>start(d,d.plans[0].id));assert.ok(training.db.active);
});
test('export is reimportable; precise source keys delete only selected record and plain ambiguous ID fails',()=>{
 const repo=new HealthRepository(new Storage());repo.import(parsed([sample(),sample({source:{name:'Watch'}})]),now);assert.throws(()=>repo.remove(['steps1']),/唯一/);const exported=repo.export(now),next=new HealthRepository(new Storage());next.import(parseHealthImport(JSON.stringify(exported)),now);assert.equal(next.db.records.length,2);
 next.remove([healthRecordKey(next.db.records[0])]);assert.equal(next.db.records.length,1);assert.equal(next.db.records[0].source.name,'Watch');
});

test('conflicting named sleep stages omit contradictory breakdown while retaining union total',()=>{
 const repo=new HealthRepository(new Storage()),base=sample({type:'sleep',unit:'min',stage:'core',value:480,start:'2026-10-29T23:00:00+08:00',end:'2026-10-30T07:00:00+08:00'});
 repo.import(parsed([base,{...base,id:'deep-overlap',stage:'deep'}]),now);const sleep=metric(repo,'sleep');assert.equal(sleep.value,480);assert.deepEqual(sleep.stages,{});assert.match(sleep.notes.join(),/阶段区间冲突/);
});
test('explicit awake/asleep conflict cannot produce a definitive effective sleep total',()=>{
 const repo=new HealthRepository(new Storage()),base=sample({type:'sleep',unit:'min',stage:'asleep',value:10});repo.import(parsed([base,{...base,id:'awake-conflict',stage:'awake'}]),now);assert.equal(metric(repo,'sleep').value,null);assert.match(metric(repo,'sleep').notes.join(),/清醒与已睡区间冲突/);
});
test('disconnected sleep fragments use their own end dates and never invent an episode bridge',()=>{
 const repo=new HealthRepository(new Storage()),base=sample({id:'before-midnight',type:'sleep',unit:'min',stage:'core',value:50,start:'2026-10-29T23:00:00+08:00',end:'2026-10-29T23:50:00+08:00'});
 repo.import(parsed([base,{...base,id:'after-midnight',stage:'deep',value:410,start:'2026-10-30T00:10:00+08:00',end:'2026-10-30T07:00:00+08:00'}]),now);assert.equal(metric(repo,'sleep','2026-10-29').value,50);assert.equal(metric(repo,'sleep').value,410);assert.match(metric(repo,'sleep').notes.join(),/不会推断/);
});

test('different named device sources sharing an app bundle retain separate records and metrics',()=>{
 const repo=new HealthRepository(new Storage());repo.import(parsed([sample(),sample({source:{name:'Apple Watch',bundleId:'com.example.health'}})]),now);assert.equal(repo.db.records.length,2);assert.notEqual(healthRecordKey(repo.db.records[0]),healthRecordKey(repo.db.records[1]));const rows=healthSummary(repo.db,{now}).days.find(d=>d.date==='2026-10-30').metrics;assert.equal(rows.length,2);assert.deepEqual(rows.map(m=>m.value),[120,120]);
});

test('a stale tab cannot overwrite health records imported from another page',()=>{
 const storage=new Storage(),one=new HealthRepository(storage),two=new HealthRepository(storage);one.import(parsed(),now);const before=storage.getItem(HEALTH_KEY);assert.throws(()=>two.import(parsed([sample({id:'other'})]),now),/其他页面/);assert.equal(storage.getItem(HEALTH_KEY),before);assert.equal(two.db.records.length,0);
});
