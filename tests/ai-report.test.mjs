import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {initial} from '../dist/data.js';
import {generateAIReport, reportToText} from '../dist/ai-report.js';

const NOW = Date.parse('2026-10-31T12:00:00+08:00');
const healthy = () => ({format: 'rainlift-health', version: 1, timeZone: 'Asia/Shanghai', records: [], lastImportAt: null});
function session(exercise, at, {weight = 20, reps = 8, unit = exercise.unit, count = 1, ended = Date.parse(at) + 3600000, name = exercise.name, id = at} = {}) {
 const started = Date.parse(at);
 return {id, planID: 'plan', name: '私人训练名称', started, ended, note: '不要导出这段私人备注', movements: [{id: `movement-${id}`, exercise: {...structuredClone(exercise), name, unit}, skipped: false, sets: Array.from({length: count}, (_, index) => ({id: `set-${id}-${index}`, date: started + index * 90000, weight, reps}))}]};
}

test('AI report uses all valid history with separate seven-day overview and excludes deleted, active, future and empty sessions', () => {
 const data = initial(), exercise = data.plans[0].exercises[0];
 data.history = [session(exercise, '2026-10-24T23:59:59+08:00'), session(exercise, '2026-10-25T00:00:00+08:00'), session(exercise, '2026-10-31T09:00:00+08:00', {count: 2}), session(exercise, '2026-10-31T13:00:00+08:00'), session(exercise, '2026-10-29T09:00:00+08:00', {count: 0})];
 data.deletedHistory = [{session: session(exercise, '2026-10-30T09:00:00+08:00'), deletedAt: NOW}];
 data.active = {...session(exercise, '2026-10-31T10:30:00+08:00'), ended: null};
 const report = generateAIReport(data, healthy(), {now: NOW});
 assert.deepEqual(report.period, {timeZone: 'Asia/Shanghai', firstDate: '2026-10-25', lastDate: '2026-10-31', calendarDays: 7, includesPartialToday: true, recent30FirstDate: '2026-10-02'});
 assert.equal(report.training.completedSessionCount, 3);
 assert.equal(report.training.recent7.completedSessionCount, 2);
 assert.equal(report.training.recordedSetCount, 4);
 assert.equal(report.training.recent7.recordedSetCount, 3);
 assert.equal(report.training.activeWorkoutExcluded, true);
 assert.equal(report.training.emptySessionsExcluded, 1);
 assert.equal(report.training.futureSessionsExcluded, 1);
 assert.equal(report.training.elapsedMinutes, undefined);
 assert.equal(report.training.sessions[1].interSetGapsSeconds, undefined);
});

test('report boundaries respect selected timezone including dates across DST', () => {
 const data = initial(), exercise = data.plans[0].exercises[0];
 data.history = [session(exercise, '2026-10-25T00:30:00Z')];
 const now = Date.parse('2026-10-31T02:00:00Z');
 const report = generateAIReport(data, healthy(), {now, timeZone: 'America/New_York'});
 assert.equal(report.period.lastDate, '2026-10-30');
 assert.equal(report.period.firstDate, '2026-10-24');
 assert.equal(report.training.sessions[0].date, '2026-10-24');
 const dst = generateAIReport(initial(), healthy(), {now: Date.parse('2026-11-03T17:00:00Z'), timeZone: 'America/New_York'});
 assert.equal(dst.period.firstDate, '2026-10-28');
 assert.equal(dst.period.lastDate, '2026-11-03');
});

test('exercise identity and units stay separate while renamed snapshots remain visible', () => {
 const data = initial(), exercise = data.plans[0].exercises[0], independent = {...exercise, id: 'independent'};
 data.history = [
  session(exercise, '2026-10-25T09:00:00+08:00', {name: '旧名称', weight: 30, reps: 8}),
  session(exercise, '2026-10-30T09:00:00+08:00', {name: '新名称', weight: 32.5, reps: 10}),
  session(exercise, '2026-10-31T08:00:00+08:00', {unit: 'lb', weight: 60}),
  session(independent, '2026-10-31T09:00:00+08:00', {name: '新名称'})
 ];
 const report = generateAIReport(data, healthy(), {now: NOW});
 assert.equal(report.training.exercises.length, 3);
 const kilograms = report.training.exercises.find(group => group.exerciseID === exercise.id && group.unit === 'kg');
 assert.deepEqual(kilograms.names, ['旧名称', '新名称']);
 assert.equal(kilograms.comparison.maxRecordedWeightDelta, 2.5);
 assert.equal(kilograms.comparison.totalRecordedRepsDelta, 2);
 assert.equal(report.training.exercises.find(group => group.unit === 'lb').comparison, null);
 assert.match(kilograms.comparison.interpretation, /不能单独判定进步/);
});

test('unresolved identity conflict disables performance comparison', () => {
 const data = initial(), exercise = data.plans[0].exercises[0];
 data.plans[1].exercises.push({...structuredClone(exercise), name: '另一种动作'});
 data.history = [session(exercise, '2026-10-25T09:00:00+08:00'), session(exercise, '2026-10-30T09:00:00+08:00')];
 const report = generateAIReport(data, healthy(), {now: NOW});
 assert.equal(report.training.exercises[0].identityUncertain, true);
 assert.equal(report.training.exercises[0].comparison, null);
 assert.ok(report.limitations.some(value => value.includes('动作编号冲突')));
});

test('missing recovery data stays null and text never calls recorded sets effective sets', () => {
 const report = generateAIReport(initial(), healthy(), {now: NOW});
 assert.equal(report.training.effectiveHardSetCount, null);
 assert.deepEqual(report.subjectiveRecovery, {fatigue: null, soreness: null, perceivedRecovery: null, note: '暂无结构化记录；未从自由备注推断。'});
 assert.equal(report.health.hasUsableData, false);
 assert.deepEqual(report.health.days, []);
 const text = reportToText(report);
 assert.match(text, /记录组数不等于有效增肌组数/);
 assert.match(text, /尚未导入可用健康数据，本次仅分析训练记录。/);
 assert.match(text, /不要擅自修改我的训练计划/);
 assert.match(text, /下一次训练的具体建议/);
 assert.match(text, /不要编造缺失数据/);
 assert.doesNotMatch(text, /以下为 JSON|暂无两次可比较/);
 assert.equal(report.training.completedSessionCount, 0);
 assert.ok(report.health.days.every(day => day.metrics.length === 0));
});

test('report includes real health records and has no fabricated missing HRV', () => {
 const health = healthy();
 health.records = [{id: 'rhr-one', type: 'resting_heart_rate', source: {name: '示例设备'}, start: '2026-10-30T07:00:00+08:00', end: '2026-10-30T07:00:00+08:00', unit: 'bpm', value: 62, aggregation: 'sample'}];
 const report = generateAIReport(initial(), health, {now: NOW});
 assert.equal(report.health.days.find(day => day.date === '2026-10-30').metrics.find(metric => metric.type === 'resting_heart_rate').value, 62);
 assert.equal(report.health.trends.find(metric => metric.type === 'resting_heart_rate').values[0].value, 62);
 assert.equal(report.health.period.actualFirstDate, '2026-10-30');
 assert.equal(report.health.period.actualLastDate, '2026-10-30');
 assert.match(reportToText(report), /可用记录日期：2026-10-30 至 2026-10-30/);
 assert.equal(report.health.trends.some(metric => metric.type === 'hrv'), false);
});

test('generating and rendering report leave both source stores unchanged and omit private notes', () => {
 const data = initial(), exercise = data.plans[0].exercises[0], health = healthy();
 data.history = [session(exercise, '2026-10-30T09:00:00+08:00', {weight: 0})];
 const beforeTraining = JSON.stringify(data), beforeHealth = JSON.stringify(health);
 const report = generateAIReport(data, health, {now: NOW});
 const text = reportToText(report);
 assert.equal(JSON.stringify(data), beforeTraining);
 assert.equal(JSON.stringify(health), beforeHealth);
 assert.equal(report.training.recordedSetCount, 1);
 assert.equal(report.training.exercises[0].performances[0].sets[0].weight, 0);
 assert.equal(text.includes('不要导出这段私人备注'), false);
 assert.equal(text.includes('私人训练名称'), false);
 assert.equal(report.privacy.automaticUpload, false);
});

test('report pure module has no network, storage or automatic clipboard operation', () => {
 const source = fs.readFileSync(new URL('../dist/ai-report.js', import.meta.url), 'utf8');
 assert.doesNotMatch(source, /\bfetch\s*\(|XMLHttpRequest|sendBeacon\s*\(|WebSocket\s*\(|localStorage\.|navigator\.clipboard/);
});

test('future set timestamps are omitted instead of shown as existing observations', () => {
 const data = initial(), exercise = data.plans[0].exercises[0];
 data.history = [session(exercise, '2026-10-30T09:00:00+08:00', {count: 2})];
 data.history[0].movements[0].sets[1].date = NOW + 1000;
 const report = generateAIReport(data, healthy(), {now: NOW});
 assert.equal(report.training.recordedSetCount, 1);
 assert.equal(report.training.futureSetsExcluded, 1);
 assert.ok(report.limitations.some(value => value.includes('设备时钟')));
});

function setRecords(row, records) {
 row.movements[0].sets = records.map(([weight, reps], index) => ({id: `synthetic-set-${row.id}-${index}`, weight, reps, date: row.started + index * 90000}));
 return row;
}
const meta = (exercise, loadType) => ({format: 'rainlift-exercise-meta', version: 1, entries: [{exerciseID: exercise.id, unit: exercise.unit, loadType}]});

test('all history contributes baseline, latest two, coverage, extrema and thirty-day frequency', () => {
 const data = initial(), exercise = data.plans[0].exercises[0];
 data.history = [session(exercise, '2025-01-01T09:00:00+08:00', {weight: 10}), session(exercise, '2025-06-01T09:00:00+08:00', {weight: 99}), session(exercise, '2026-09-30T09:00:00+08:00', {weight: 20}), session(exercise, '2026-10-29T09:00:00+08:00', {weight: 22})];
 const report = generateAIReport(data, healthy(), {now: NOW, metadata: meta(exercise, 'external')}), group = report.training.exercises[0];
 assert.equal(group.historySummary.performanceCount, 4);
 assert.equal(group.historySummary.maxRecordedWeight, 99);
 assert.equal(group.baseline.maxRecordedWeight, 10);
 assert.equal(group.comparison.previous.maxRecordedWeight, 20);
 assert.equal(group.comparison.latest.maxRecordedWeight, 22);
 assert.equal(group.historySummary.recent30Count, 1);
 assert.deepEqual(report.training.historyRange, {firstDate: '2025-01-01', lastDate: '2026-10-29'});
 assert.match(reportToText(report), /2025-01-01/);
 assert.match(reportToText(report), /最高记录2025-06-01 99kg×8次/);
 assert.match(reportToText(report), /近30天记录重量范围22–22kg/);
});

test('same-weight repetitions compare corresponding recorded sets without confusing extra sets with progress', () => {
 const data = initial(), exercise = data.plans[0].exercises[0];
 data.history = [setRecords(session(exercise, '2026-10-01T09:00:00+08:00'), [[40, 10], [40, 8]]), setRecords(session(exercise, '2026-10-30T09:00:00+08:00'), [[40, 9], [40, 8], [40, 10]])];
 const report = generateAIReport(data, healthy(), {now: NOW, metadata: meta(exercise, 'external')}), comparison = report.training.exercises[0].comparison;
 assert.equal(comparison.totalRecordedRepsDelta, 9);
 assert.deepEqual(comparison.sameWeight[0].pairedRepChanges, [-1, 0]);
 assert.equal(comparison.sameWeight[0].sameRecordedSetCount, false);
 assert.match(reportToText(report), /组数不同，不直接比较总次数/);
 assert.doesNotMatch(reportToText(report), /力量进步了|增加9次.*进步/);
});

test('bodyweight-class records retain 68/73 without assuming either is only body mass', () => {
 const data = initial(), pull = data.plans[0].exercises[0], dragon = data.plans[0].exercises[1];
 pull.name = '引体向上'; dragon.name = '龙悬';
 data.history = [session(pull, '2026-10-01T09:00:00+08:00', {weight: 68, reps: 8}), session(pull, '2026-10-30T09:00:00+08:00', {weight: 73, reps: 8}), setRecords(session(dragon, '2026-10-29T09:00:00+08:00'), [[68, 8], [73, 7]])];
 const before = JSON.stringify(data), report = generateAIReport(data, healthy(), {now: NOW}), text = reportToText(report);
 assert.ok(report.training.exercises.every(exercise => exercise.loadType === 'bodyweight'));
 assert.deepEqual(report.training.exercises.find(exercise => exercise.exerciseID === dragon.id).bodyweightDifferences[0].weights, [68, 73]);
 assert.match(text, /自重动作可以额外加重/);
 assert.match(text, /体重增加不直接表示力量进步/);
 assert.match(text, /68\/73kg.*体重与附加未拆分/);
 assert.doesNotMatch(text, /不同体重记录|重量表示自身体重，不是额外负重|体重记录 73/);
 assert.doesNotMatch(text, /负重引体|杠杆|器械龙悬|额外负重68/);
 assert.equal(JSON.stringify(data), before);
});

test('assisted loads have distinct interpretation and unknown loads do not assume external weights', () => {
 const data = initial(), exercise = data.plans[0].exercises[0];
 data.history = [session(exercise, '2026-10-01T09:00:00+08:00', {weight: 40}), session(exercise, '2026-10-30T09:00:00+08:00', {weight: 30})];
 const assisted = generateAIReport(data, healthy(), {now: NOW, metadata: meta(exercise, 'assisted')});
 assert.match(assisted.training.exercises[0].comparison.interpretation, /辅助减少/);
 assert.match(reportToText(assisted), /辅助重量/);
 assert.match(reportToText(assisted), /减少辅助与增加器械负重含义不同/);
 assert.equal(generateAIReport(data, healthy(), {now: NOW}).training.exercises[0].loadType, 'unknown');
});

test('same-name independent IDs display distinct labels and never reveal internal UUIDs', () => {
 const data = initial(), exercise = data.plans[0].exercises[0], independent = {...exercise, id: '7d89a772-6acc-4d1a-8c43-060773894fa5'};
 data.history = [session(exercise, '2026-10-29T09:00:00+08:00'), session(independent, '2026-10-30T09:00:00+08:00')];
 const report = generateAIReport(data, healthy(), {now: NOW}), text = reportToText(report);
 assert.equal(report.training.exercises.length, 2);
 assert.notEqual(report.training.exercises[0].displayName, report.training.exercises[1].displayName);
 assert.ok(report.training.exercises.every(exercise => exercise.comparison === null));
 assert.match(text, /独立动作 1/); assert.match(text, /独立动作 2/);
 assert.doesNotMatch(text, /[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}/i);
 assert.ok(!text.includes(exercise.id));
 assert.doesNotMatch(text, /暂无两次可比较/);
});

test('unresolved shared-ID names are isolated, not silently presented as one movement', () => {
 const data = initial(), exercise = data.plans[0].exercises[0], conflicting = {...exercise, name: '不相关动作'};
 data.plans[1].exercises.push(conflicting);
 data.history = [session(exercise, '2026-10-29T09:00:00+08:00'), session(conflicting, '2026-10-30T09:00:00+08:00')];
 const report = generateAIReport(data, healthy(), {now: NOW});
 assert.equal(report.training.exercises.length, 2);
 assert.deepEqual(report.training.exercises.map(group => group.names.length), [1, 1]);
 assert.ok(report.training.exercises.every(group => group.identityUncertain && group.loadType === 'unknown' && !group.comparison));
 assert.match(reportToText(report), /归属待核对/);
});

test('renamed identity follows exact ID and lineage across older historical snapshots', () => {
 const data = initial(), exercise = data.plans[0].exercises[0];
 exercise.knownNames = ['旧动作名', exercise.name];
 data.history = [session(exercise, '2025-06-01T09:00:00+08:00', {name: '旧动作名', weight: 20}), session(exercise, '2026-10-30T09:00:00+08:00', {weight: 25})];
 const report = generateAIReport(data, healthy(), {now: NOW});
 assert.equal(report.training.exercises.length, 1);
 assert.equal(report.training.exercises[0].comparison.previous.maxRecordedWeight, 20);
 assert.equal(report.training.exercises[0].displayName, exercise.name);
 assert.match(reportToText(report, {detailed: true}), /旧动作名/);
});

test('abnormal session elapsed time is warned once without fabricated training duration or interval rest', () => {
 const data = initial(), exercise = data.plans[0].exercises[0];
 data.history = [session(exercise, '2026-10-25T09:00:00+08:00', {ended: Date.parse('2026-10-28T09:00:00+08:00')}), session(exercise, '2026-10-28T10:00:00+08:00', {ended: Date.parse('2026-10-30T12:00:00+08:00')})];
 const before = JSON.stringify(data), report = generateAIReport(data, healthy(), {now: NOW}), text = reportToText(report);
 assert.equal(report.training.abnormalTimeCount, 2);
 assert.equal((text.match(/存在异常会话时间记录/g) ?? []).length, 1);
 assert.doesNotMatch(text, /训练经过时长合计|实际训练时长[：:]|4320|72小时|组间记录间隔[：:]/);
 assert.equal(JSON.stringify(data), before);
});

test('three comparable records describe sustained recorded-repetition patterns without diagnosing recovery', () => {
 const data = initial(), exercise = data.plans[0].exercises[0];
 data.history = [session(exercise, '2026-10-01T09:00:00+08:00', {weight: 40, reps: 10, count: 2}), session(exercise, '2026-10-15T09:00:00+08:00', {weight: 40, reps: 9, count: 2}), session(exercise, '2026-10-30T09:00:00+08:00', {weight: 40, reps: 8, count: 2})];
 let report = generateAIReport(data, healthy(), {now: NOW});
 assert.equal(report.training.exercises[0].recentPattern.observation, 'declining_recorded_reps');
 assert.match(reportToText(report), /对应次数连续下降/);
 data.history[2].movements[0].sets.pop();
 report = generateAIReport(data, healthy(), {now: NOW});
 assert.equal(report.training.exercises[0].recentPattern, null);
});

test('invalid and unfinished sessions and malformed sets do not become observations', () => {
 const data = initial(), exercise = data.plans[0].exercises[0];
 const invalid = session(exercise, '2026-10-29T09:00:00+08:00'); invalid.ended = invalid.started - 1;
 const unfinished = session(exercise, '2026-10-28T09:00:00+08:00'); unfinished.ended = null;
 const mixed = session(exercise, '2026-10-30T09:00:00+08:00', {count: 3}); mixed.movements[0].sets[1].reps = 0; mixed.movements[0].sets[2].date = NaN;
 data.history = [invalid, unfinished, mixed];
 const report = generateAIReport(data, healthy(), {now: NOW});
 assert.equal(report.training.completedSessionCount, 1);
 assert.equal(report.training.recordedSetCount, 1);
 assert.equal(report.training.invalidSessionsExcluded, 1);
 assert.equal(report.training.unfinishedSessionsExcluded, 1);
 assert.equal(report.training.invalidSetsExcluded, 2);
});

test('health trends keep real source-separated values, dates and imported workout heart rate', () => {
 const health = healthy();
 const record = (id, type, day, value, source = '合成 Apple Watch') => ({id, type, source: {name: source}, start: `2026-10-${day}T07:00:00+08:00`, end: `2026-10-${day}T07:00:00+08:00`, unit: type === 'hrv' ? 'ms' : 'bpm', value, aggregation: 'sample'});
 health.records = [record('r1', 'resting_heart_rate', '28', 60), record('r2', 'resting_heart_rate', '30', 62), record('h1', 'hrv', '28', 45), record('h2', 'hrv', '30', 42), record('other', 'hrv', '30', 99, '另一来源'), {id: 'workout', type: 'workout', source: {name: '合成 Apple Watch'}, start: '2026-10-30T17:00:00+08:00', end: '2026-10-30T18:00:00+08:00', unit: 'min', value: 45, aggregation: 'sample', workoutType: '力量训练', heartRate: {unit: 'bpm', average: 120, min: 80, max: 150}}];
 const before = JSON.stringify(health), report = generateAIReport(initial(), health, {now: NOW}), text = reportToText(report);
 assert.equal(report.health.trends.filter(group => group.type === 'hrv').length, 2);
 assert.match(text, /10-28 45 → 10-30 42/);
 assert.match(text, /另一来源.*99/);
 assert.match(text, /导入心率均值 120 最小 80 最大 150/);
 assert.doesNotMatch(text, /2026-10-27：暂无数据|恢复评分[：:]\s*\d/);
 assert.equal(JSON.stringify(health), before);
});

test('older imported health is dated as historical and cannot masquerade as current recovery', () => {
 const health = healthy();
 health.records = [{id: 'old-hrv', type: 'hrv', source: {name: '旧数据来源'}, start: '2025-01-01T07:00:00+08:00', end: '2025-01-01T07:00:00+08:00', unit: 'ms', value: 42, aggregation: 'sample'}];
 const report = generateAIReport(initial(), health, {now: NOW});
 assert.equal(report.health.hasUsableData, true);
 assert.match(reportToText(report), /较早记录，不能代表当前恢复/);
 assert.match(reportToText(report), /2025-01-01/);
});

test('compact activity values preserve sample coverage and elapsed workout caveats', () => {
 const health=healthy();
 health.records=[
  {id:'partial-steps',type:'steps',source:{name:'合成手机'},start:'2026-10-30T08:00:00+08:00',end:'2026-10-30T08:10:00+08:00',unit:'count',value:123,aggregation:'sample'},
  {id:'elapsed-workout',type:'workout',source:{name:'合成手表'},start:'2026-10-30T10:00:00+08:00',end:'2026-10-30T11:00:00+08:00',unit:'min',value:60,aggregation:'sample',workoutType:'力量训练'}
 ];
 const text=reportToText(generateAIReport(initial(),health,{now:NOW}));
 assert.match(text,/可能不是完整一天/);assert.match(text,/可包含暂停/);
 assert.match(text,/10-30 123/);assert.match(text,/10-30 60/);
});

test('recent workout heart-rate examples sort timestamps before selecting the latest three', () => {
 const health=healthy();
 health.records=['31','30','29','28'].map((day,index)=>({id:'reverse-'+day,type:'workout',source:{name:'合成手表'},start:`2026-10-${day}T08:00:00+08:00`,end:`2026-10-${day}T09:00:00+08:00`,unit:'min',value:60,aggregation:'sample',workoutType:'力量训练',heartRate:{unit:'bpm',average:120+index}}));
 const text=reportToText(generateAIReport(initial(),health,{now:NOW}));
 assert.match(text,/2026-10-31.*导入心率均值 120/);assert.match(text,/2026-10-29.*导入心率/);
 assert.doesNotMatch(text,/2026-10-28.*导入心率/);
 assert.ok(text.indexOf('2026-10-29 力量训练')<text.indexOf('2026-10-31 力量训练'));
});

test('default is five concise sections without repeated raw JSON while detailed text and JSON remain separate', () => {
 const data = initial(), exercise = data.plans[0].exercises[0];
 data.history = ['01', '15', '30'].map(day => session(exercise, `2026-10-${day}T09:00:00+08:00`));
 const report = generateAIReport(data, healthy(), {now: NOW}), compact = reportToText(report), detailed = reportToText(report, {detailed: true});
 for (const section of ['第一部分：训练概况', '第二部分：关键动作表现', '第三部分：训练进步与问题', '第四部分：健康与恢复', '第五部分：GPT 分析任务']) assert.match(compact, new RegExp(section));
 assert.doesNotMatch(compact, /"sessionID"|"recordedAt"|"format"|以下为 JSON|历次：/);
 assert.match(detailed, /历次：/);
 assert.ok(detailed.length > compact.length);
 assert.equal(JSON.parse(JSON.stringify(report)).training.exercises[0].performances.length, 3);
});
