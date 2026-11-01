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

test('AI report uses seven local natural dates and excludes deleted, active, future, old and empty sessions', () => {
 const data = initial(), exercise = data.plans[0].exercises[0];
 data.history = [session(exercise, '2026-10-24T23:59:59+08:00'), session(exercise, '2026-10-25T00:00:00+08:00'), session(exercise, '2026-10-31T09:00:00+08:00', {count: 2}), session(exercise, '2026-10-31T13:00:00+08:00'), session(exercise, '2026-10-29T09:00:00+08:00', {count: 0})];
 data.deletedHistory = [{session: session(exercise, '2026-10-30T09:00:00+08:00'), deletedAt: NOW}];
 data.active = {...session(exercise, '2026-10-31T10:30:00+08:00'), ended: null};
 const report = generateAIReport(data, healthy(), {now: NOW});
 assert.deepEqual(report.period, {timeZone: 'Asia/Shanghai', firstDate: '2026-10-25', lastDate: '2026-10-31', calendarDays: 7, includesPartialToday: true});
 assert.equal(report.training.completedSessionCount, 2);
 assert.equal(report.training.recordedSetCount, 3);
 assert.equal(report.training.activeWorkoutExcluded, true);
 assert.equal(report.training.emptySessionsExcluded, 1);
 assert.equal(report.training.futureSessionsExcluded, 1);
 assert.equal(report.training.elapsedMinutes, 120);
 assert.equal(report.training.sessions[1].interSetGapsSeconds[0], 90);
 assert.match(report.training.sessions[1].restMeasurement, /不是|没有实际休息/);
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
 for (const type of ['sleep', 'hrv', 'resting_heart_rate']) assert.equal(report.health.missing.find(metric => metric.type === type).dates.length, 7);
 const text = reportToText(report);
 assert.match(text, /有效训练组数：暂无数据/);
 assert.match(text, /实际休息时长：暂无数据/);
 assert.match(text, /不要擅自修改训练计划/);
 assert.match(text, /下一次训练的具体建议/);
 assert.match(text, /信息不足/);
 assert.equal(report.training.completedSessionCount, 0);
 assert.ok(report.health.days.every(day => day.metrics.length === 0));
});

test('report includes real health records and has no fabricated missing HRV', () => {
 const health = healthy();
 health.records = [{id: 'rhr-one', type: 'resting_heart_rate', source: {name: '示例设备'}, start: '2026-10-30T07:00:00+08:00', end: '2026-10-30T07:00:00+08:00', unit: 'bpm', value: 62, aggregation: 'sample'}];
 const report = generateAIReport(initial(), health, {now: NOW});
 assert.equal(report.health.days.find(day => day.date === '2026-10-30').metrics.find(metric => metric.type === 'resting_heart_rate').value, 62);
 assert.equal(report.health.missing.find(metric => metric.type === 'resting_heart_rate').dates.length, 6);
 assert.equal(report.health.missing.find(metric => metric.type === 'hrv').dates.length, 7);
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
