import test from 'node:test';
import assert from 'node:assert/strict';
import {KEY,initial,exercise,validate,parseBackup,start,dayKey,planFixedExercises,planOptionalExercises,dailyExercises,todayExercises,pickDailyExercises,putLibraryExercise,Repository} from '../dist/data.js';
import {exportFull,restoreFull} from '../dist/backup.js';
import {createAppHarness,Storage} from './helpers/app-harness.mjs';

const DAY = 864e5;
const pickAction = (html, name) => {
 const row = [...html.matchAll(/data-modal="pick-(\d+)"[^>]*>([^<]+)<span>/g)].find(match => match[2] === name);
 assert.ok(row, `未在列表中找到 ${name}`);
 return `pick-${row[1]}`;
};
// The shipped sample plans carry no slot flags, which is how every plan on an
// upgraded phone looks the first time this version opens.
function sample() {
 const d = initial();
 d.plans[0].exercises = [exercise('宽距高位下拉', 40), exercise('坐姿划船', 35), {...exercise('哑铃弯举', 10), group: '手臂'}];
 return d;
}

test('a plan without slot flags still trains every movement like before', () => {
 const d = sample();
 assert.deepEqual(planFixedExercises(d.plans[0]).map(e => e.name), ['宽距高位下拉', '坐姿划船', '哑铃弯举']);
 assert.deepEqual(planOptionalExercises(d.plans[0]), []);
 assert.deepEqual(dailyExercises(d, d.plans[0]), [], '没有人勾选就没有当日动作');
 assert.deepEqual(todayExercises(d, d.plans[0]).map(e => e.name), ['宽距高位下拉', '坐姿划船', '哑铃弯举']);
 start(d, d.plans[0].id);
 assert.deepEqual(d.active.movements.map(m => m.exercise.name), ['宽距高位下拉', '坐姿划船', '哑铃弯举']);
});

test('optional movements only train on the days they are picked', () => {
 const d = sample();
 d.plans[0].exercises[2].optional = true;
 assert.deepEqual(todayExercises(d, d.plans[0]).map(e => e.name), ['宽距高位下拉', '坐姿划船']);
 assert.deepEqual(pickDailyExercises(d, d.plans[0], [d.plans[0].exercises[2].id]), [d.plans[0].exercises[2].id]);
 assert.deepEqual(d.plans[0].daily, {date: dayKey(), ids: [d.plans[0].exercises[2].id]});
 assert.deepEqual(todayExercises(d, d.plans[0]).map(e => e.name), ['宽距高位下拉', '坐姿划船', '哑铃弯举']);
 start(d, d.plans[0].id);
 assert.deepEqual(d.active.movements.map(m => m.exercise.name), ['宽距高位下拉', '坐姿划船', '哑铃弯举']);
 assert.equal(d.plans[0].exercises[2].optional, true, '开始训练不会把当日选变成固定');
 validate(d);
});

test('picks are stamped with the local date and expire when the day rolls over', () => {
 const d = sample(), plan = d.plans[0], optional = plan.exercises[2];
 optional.optional = true;
 const late = new Date(2026, 10, 26, 23, 30).getTime();
 pickDailyExercises(d, plan, [optional.id], late);
 assert.deepEqual(todayExercises(d, plan, late).map(e => e.name), ['宽距高位下拉', '坐姿划船', '哑铃弯举']);
 assert.deepEqual(dailyExercises(d, plan, late + DAY / 2), [], '午夜之后只剩固定动作');
 assert.deepEqual(todayExercises(d, plan, late + DAY / 2).map(e => e.name), ['宽距高位下拉', '坐姿划船']);
 assert.equal(dayKey(new Date(2026, 10, 30, 23, 59, 59).getTime()), '2026-11-30');
 assert.equal(dayKey(new Date(2026, 11, 1, 0, 0, 1).getTime()), '2026-12-01');
 assert.equal(dayKey(new Date(2027, 0, 5, 12).getTime()), '2027-01-05');
});

test('picks resolve by identity, prefer the plan copy and drop movements that are gone', () => {
 const d = sample(), plan = d.plans[0], curl = plan.exercises[2];
 curl.optional = true;
 const libraryOnly = {...exercise('面拉', 15), group: '肩'};
 d.library = [libraryOnly];
 pickDailyExercises(d, plan, [curl.id, libraryOnly.id, '已删除的动作']);
 const chosen = dailyExercises(d, plan);
 assert.deepEqual(chosen.map(e => e.name), ['哑铃弯举', '面拉'], '库内动作也能选进今天，找不到的编号自动忽略');
 curl.weight = 12.5;
 assert.equal(todayExercises(d, plan).at(-2).weight, 12.5, '计划自己的设置优先');
 assert.deepEqual(pickDailyExercises(d, plan, [plan.exercises[0].id]), [], '固定动作不需要勾选');
 assert.equal(plan.daily, undefined, '空选择不占存储');
 assert.deepEqual(todayExercises(d, plan).map(e => e.name), ['宽距高位下拉', '坐姿划船']);
 validate(d);
});

test('validate accepts the new fields and refuses malformed daily picks', () => {
 const good = sample();
 good.plans[0].exercises[2].optional = true;
 pickDailyExercises(good, good.plans[0], [good.plans[0].exercises[2].id]);
 assert.equal(validate(good).plans[0].daily.ids.length, 1);
 for (const bad of [{date: '2026-1-26', ids: []}, {date: dayKey(), ids: 'x'}, {date: dayKey(), ids: ['a', 'a']}, {date: dayKey(), ids: ['']}, {date: dayKey()}, null, 5]) {
  const d = structuredClone(good);
  d.plans[0].daily = bad;
  assert.throws(() => validate(d), /训练数据不正确/, JSON.stringify(bad));
 }
 for (const bad of ['yes', 1, null]) {
  const d = structuredClone(good);
  d.plans[0].exercises[0].optional = bad;
  assert.throws(() => validate(d), /训练数据不正确/, JSON.stringify(bad));
 }
 const legacy = initial();
 assert.equal(Object.hasOwn(legacy.plans[0].exercises[0], 'optional'), false, '旧数据不带新字段');
 validate(legacy);
});

test('a daily pick is a snapshot copy so the session stays independent', () => {
 const d = sample(), plan = d.plans[0];
 plan.exercises[2].optional = true;
 putLibraryExercise(d, plan.exercises[2]);
 pickDailyExercises(d, plan, [plan.exercises[2].id]);
 start(d, plan.id);
 const live = d.active.movements.at(-1);
 live.exercise.name = '改过的弯举';
 live.exercise.weight = 99;
 assert.equal(plan.exercises[2].name, '哑铃弯举');
 assert.equal(plan.exercises[2].optional, true);
 assert.equal(d.library[0].optional, undefined, '库条目不会继承计划的当日选标记');
 validate(d);
});

test('training and full backups carry slots and daily picks unchanged', () => {
 const d = sample(), plan = d.plans[0];
 plan.exercises[2].optional = true;
 putLibraryExercise(d, plan.exercises[2]);
 pickDailyExercises(d, plan, [plan.exercises[2].id]);
 const round = parseBackup(JSON.stringify(d));
 assert.equal(round.plans[0].exercises[2].optional, true);
 assert.deepEqual(round.plans[0].daily, {date: dayKey(), ids: [plan.exercises[2].id]});
 const storage = new Storage();
 storage.setItem(KEY, JSON.stringify(d));
 const backup = exportFull(storage, d);
 assert.match(backup.parts[KEY], /"optional":true/);
 assert.match(backup.parts[KEY], /"daily":\{"date"/);
 const phone = new Storage();
 restoreFull(phone, backup);
 const restored = new Repository(phone);
 assert.equal(restored.db.plans[0].exercises[2].optional, true);
 assert.deepEqual(restored.db.plans[0].daily.ids, [plan.exercises[2].id]);
 assert.deepEqual(todayExercises(restored.db, restored.db.plans[0]).map(e => e.name), ['宽距高位下拉', '坐姿划船', '哑铃弯举']);
 assert.equal(Object.hasOwn(parseBackup(JSON.stringify(initial())).plans[0], 'daily'), false, '旧备份没有这两个字段也照样有效');
});

test('the repository keeps today picks across a reload', () => {
 const d = sample(), id = d.plans[0].exercises[2].id;
 d.plans[0].exercises[2].optional = true;
 const storage = new Storage();
 storage.setItem(KEY, JSON.stringify(d));
 const repo = new Repository(storage);
 repo.change(x => pickDailyExercises(x, x.plans[0], [id]));
 assert.deepEqual(JSON.parse(storage.getItem(KEY)).plans[0].daily.ids, [id]);
 assert.deepEqual(new Repository(storage).db.plans[0].daily.ids, [id]);
 repo.change(x => pickDailyExercises(x, x.plans[0], [id], Date.now() + DAY));
 assert.deepEqual(dailyExercises(repo.db, repo.db.plans[0]), [], '换到新一天需要重新勾选');
 assert.deepEqual(todayExercises(repo.db, repo.db.plans[0]).map(e => e.name), ['宽距高位下拉', '坐姿划船']);
});

test('the home card splits fixed movements from what today already picked', () => {
 const d = sample();
 d.plans[0].exercises[2].optional = true;
 const h = createAppHarness(d);
 assert.match(h.html, /class="slot-label">固定<\/b><div class="plan-exercises"><span>宽距高位下拉<\/span><span>坐姿划船<\/span>/);
 assert.match(h.html, /固定 2 · 今日已选 0 <span class="sep">\/<\/span> 6 组 <span class="sep">\/<\/span> 1 个当日选未勾/);
 assert.doesNotMatch(h.html, /class="slot-label daily">今日/, '没勾选时不显示今日段');
 assert.match(h.html, /data-action="day-open" data-id="[^"]*">今日训练/);
 assert.equal(h.html.includes(`data-action="start" data-id="${d.plans[0].id}"`), false, '首页不再一键开始');
 h.action('day-open', {id: d.plans[0].id});
 h.action('day-pick', {id: d.plans[0].exercises[2].id});
 assert.equal(h.toast, '已加入今天');
 h.action('day-back');
 assert.match(h.html, /class="slot-label daily">今日<\/b><div class="plan-exercises"><span>哑铃弯举<\/span>/);
 assert.match(h.html, /固定 3 · 今日已选 0 <span class="sep">\/<\/span> 9 组/);
 assert.doesNotMatch(h.html, /个当日选未勾/);
});

test('the day page lists fixed, chosen and remaining candidates with their actions', () => {
 const d = sample();
 d.plans[0].exercises[2].optional = true;
 const h = createAppHarness(d);
 h.action('day-open', {id: d.plans[0].id});
 assert.match(h.html, /<h1>拉 · 背部与二头<\/h1>/);
 assert.match(h.html, /固定动作<span class="count">2<\/span>/);
 assert.match(h.html, /data-action="day-slot" data-id="[^"]*">改为当日选/);
 assert.match(h.html, /计划里的当日选<span class="count">1<\/span>/);
 assert.match(h.html, /data-action="day-pick" data-id="[^"]*">选入今天/);
 assert.doesNotMatch(h.html, /今日已选<span/, '还没勾选时不出现今日已选段');
 assert.match(h.html, /data-action="day-add">＋ 从动作库添加当日动作/);
 assert.match(h.html, /data-action="plan-edit" data-id="[^"]*">编辑固定计划/);
 assert.match(h.html, /data-action="start" data-id="[^"]*"\s*>开始训练/);
 h.action('day-pick', {id: d.plans[0].exercises[2].id});
 assert.match(h.html, /今日已选<span class="count">1<\/span>/);
 assert.match(h.html, /data-action="day-pin" data-id="[^"]*">设为固定/);
 assert.doesNotMatch(h.html, /计划里的当日选<span/, '选入今天之后不再重复列在候选段');
 h.action('day-pick', {id: d.plans[0].exercises[2].id});
 assert.equal(h.toast, '已从今天取消');
 assert.equal(h.state.plans[0].daily, undefined);
 h.action('day-back');
 assert.match(h.html, /今天练什么？/);
});

test('an empty plan opens the day page and keeps training disabled', () => {
 const d = initial();
 d.plans[0].exercises = [];
 const h = createAppHarness(d);
 assert.match(h.html, /还没有动作，先去编辑计划添加。/);
 h.action('day-open', {id: d.plans[0].id});
 assert.match(h.html, /data-action="start" data-id="[^"]*" disabled>开始训练/);
 assert.doesNotMatch(h.html, /固定动作<span/, '空计划不分段');
 assert.match(h.html, /从动作库添加当日动作/);
});

test('the day picker adds library movements to today and can create one on the spot', () => {
 const d = sample();
 const facePull = {...exercise('面拉', 15), group: '肩'};
 d.library = [facePull];
 const bench = d.plans[1].exercises[0];
 const h = createAppHarness(d);
 h.action('day-open', {id: d.plans[0].id});
 h.action('day-add');
 assert.match(h.modalHtml, /添加当日动作/);
 assert.match(h.modalHtml, /可勾选多个动作/);
 assert.match(h.modalHtml, /class="grp-tab on" data-modal="tab-0">肩/, '当日弹窗沿用主类页签');
 assert.doesNotMatch(h.modalHtml, />宽距高位下拉<span>/, '固定动作不在候选里');
 assert.match(h.modalHtml, />面拉<span>/);
 h.modalAction(pickAction(h.modalHtml, '面拉'));
 h.modalAction('tab-1');
 assert.match(h.modalHtml, /添加动作（已选 1）/, '切换主类保留已选');
 h.modalAction(pickAction(h.modalHtml, '卧推'));
 assert.match(h.modalHtml, /添加动作（已选 2）/);
 h.modalAction('confirm');
 assert.equal(h.modalOpen, false);
 assert.deepEqual(h.state.plans[0].daily, {date: dayKey(), ids: [facePull.id, bench.id]});
 h.action('day-add');
 assert.match(h.modalHtml, /aria-pressed="true">面拉<span>✓/, '已选动作在弹窗里保持勾选');
 h.modalAction(pickAction(h.modalHtml, '面拉'));
 assert.match(h.modalHtml, /添加动作（已选 1）/, '再点一次可以取消');
 h.modalAction(pickAction(h.modalHtml, '面拉'));
 h.modalAction('new');
 h.submit({name: '绳索侧平举', unit: 'kg', weight: '5', step: '1', target: '4', rest: '45', r0: '12', r1: '15', r2: '20'});
 assert.equal(h.modalOpen, false, '新建之后直接回到当日页');
 assert.equal(h.state.library.some(e => e.name === '绳索侧平举'), true, '当日新建的动作进入动作库');
 assert.deepEqual(dailyExercises(h.state, h.state.plans[0]).map(e => e.name), ['卧推', '面拉', '绳索侧平举'], '取消再勾选的动作排到最后');
 h.action('start', {id: d.plans[0].id});
 assert.deepEqual(h.state.active.movements.map(m => m.exercise.name), ['宽距高位下拉', '坐姿划船', '哑铃弯举', '卧推', '面拉', '绳索侧平举']);
 assert.match(h.html, /data-action="manage">调整动作/, '开始之后回到训练页');
});

test('a picked movement can be promoted to fixed or demoted to daily choice', () => {
 const d = sample();
 const facePull = {...exercise('面拉', 15), group: '肩'};
 d.library = [facePull];
 d.plans[0].exercises[2].optional = true;
 const curl = d.plans[0].exercises[2].id;
 const h = createAppHarness(d);
 h.action('day-open', {id: d.plans[0].id});
 h.action('day-add');
 h.modalAction(pickAction(h.modalHtml, '面拉'));
 h.modalAction('confirm');
 h.action('day-pick', {id: curl});
 assert.deepEqual(h.state.plans[0].daily.ids, [facePull.id, curl]);
 h.action('day-pin', {id: curl});
 assert.equal(h.toast, '已设为固定动作');
 assert.equal(h.state.plans[0].exercises[2].optional, undefined);
 assert.deepEqual(h.state.plans[0].daily.ids, [facePull.id], '固定之后不再占用今天的勾选');
 h.action('day-pin', {id: facePull.id});
 const plan = h.state.plans[0];
 assert.deepEqual(plan.exercises.map(e => e.name), ['宽距高位下拉', '坐姿划船', '哑铃弯举', '面拉']);
 assert.equal(Object.hasOwn(plan.exercises[3], 'optional'), false, '库内动作固化后成为固定动作');
 assert.equal(plan.daily, undefined);
 assert.deepEqual(todayExercises(h.state, plan).map(e => e.name), ['宽距高位下拉', '坐姿划船', '哑铃弯举', '面拉']);
 h.action('day-slot', {id: curl});
 const after = h.state.plans[0];
 assert.equal(after.exercises[2].optional, true);
 assert.deepEqual(after.daily, {date: dayKey(), ids: [curl]}, '改为当日选之后今天照旧');
 assert.deepEqual(todayExercises(h.state, after).map(e => e.name), ['宽距高位下拉', '坐姿划船', '面拉', '哑铃弯举'], '固定动作先练，当日选排最后');
 assert.match(h.html, /今日已选<span class="count">1<\/span>/);
 assert.equal(new Repository(h.storage).db.plans[0].daily.ids[0], curl, '刷新后还是今天');
});

test('the plan editor toggles slots and keeps the day selection consistent', () => {
 const d = sample(), h = createAppHarness(d);
 h.action('plan-edit', {id: d.plans[0].id});
 assert.match(h.modalHtml, /固定 3 · 当日选 0/);
 assert.match(h.modalHtml, /<b>1\. 宽距高位下拉<\/b><i class="slot-tag">固定<\/i>/);
 h.modalAction('slot-0');
 assert.match(h.modalHtml, /<b>1\. 宽距高位下拉<\/b><i class="slot-tag daily">当日选<\/i>/);
 assert.match(h.modalHtml, /固定 2 · 当日选 1/);
 assert.match(h.modalHtml, /data-modal="slot-0">设为固定/);
 h.submit({planName: '拉 · 背部与二头'});
 assert.equal(h.state.plans[0].exercises[0].optional, true);
 assert.equal(h.state.plans[0].daily, undefined);
 assert.deepEqual(todayExercises(h.state, h.state.plans[0]).map(e => e.name), ['坐姿划船', '哑铃弯举']);
 h.action('plan-edit', {id: d.plans[0].id});
 h.modalAction('slot-0');
 h.submit({planName: '拉 · 背部与二头'});
 assert.equal(Object.hasOwn(h.state.plans[0].exercises[0], 'optional'), false, '再点一次回到固定');
});

test('a saved plan drops picks that stopped being selectable and new actions stay fixed', () => {
 const d = sample();
 d.plans[0].exercises[2].optional = true;
 const h = createAppHarness(d);
 h.action('day-open', {id: d.plans[0].id});
 h.action('day-pick', {id: d.plans[0].exercises[2].id});
 assert.deepEqual(h.state.plans[0].daily.ids, [d.plans[0].exercises[2].id]);
 h.action('plan-edit', {id: d.plans[0].id});
 h.modalAction('slot-2');
 h.submit({planName: '拉 · 背部与二头'});
 assert.equal(Object.hasOwn(h.state.plans[0].exercises[2], 'optional'), false);
 assert.equal(h.state.plans[0].daily, undefined, '变成固定后清掉今天的重复勾选');
 h.action('plan-edit', {id: d.plans[0].id});
 h.modalAction('add');
 h.modalAction(pickAction(h.modalHtml, '卧推'));
 h.modalAction('confirm');
 h.submit({planName: '拉 · 背部与二头'});
 const added = h.state.plans[0].exercises.at(-1);
 assert.equal(added.name, '卧推');
 assert.equal(Object.hasOwn(added, 'optional'), false, '新加的动作默认固定');
});

test('a new plan saves without any slot or daily fields', () => {
 const h = createAppHarness(initial());
 h.action('plan-new');
 h.submit({planName: '腿日'});
 const plan = h.state.plans.find(p => p.name === '腿日');
 assert.deepEqual(plan.exercises, []);
 assert.equal(Object.hasOwn(plan, 'daily'), false);
 h.action('day-open', {id: plan.id});
 assert.match(h.html, /data-action="start"[^>]*disabled/);
 assert.match(h.html, /从动作库添加当日动作/);
});

test('updating the fixed plan keeps optional slots and today picks', () => {
 const d = sample();
 const facePull = {...exercise('面拉', 15), group: '肩'};
 d.library = [facePull];
 d.plans[0].exercises[2].optional = true;
 pickDailyExercises(d, d.plans[0], [d.plans[0].exercises[2].id]);
 start(d, d.plans[0].id);
 const h = createAppHarness(d);
 h.action('manage');
 h.modalAction('add');
 h.modalAction(pickAction(h.modalHtml, '面拉'));
 h.modalAction('confirm');
 h.modalAction('template');
 assert.match(h.modalHtml, /标记为「当日选」的动作仍是当日选/, '确认弹窗说明保留槽位与今天的勾选');
 h.modalAction('confirm');
 assert.equal(h.toast, '计划已更新');
 const plan = h.state.plans[0];
 assert.deepEqual(plan.exercises.map(e => [e.name, e.optional === true]), [['宽距高位下拉', false], ['坐姿划船', false], ['哑铃弯举', true], ['面拉', false]]);
 assert.deepEqual(plan.daily, {date: dayKey(), ids: [d.plans[0].exercises[2].id]}, '今天的勾选还在');
 assert.deepEqual(todayExercises(h.state, plan).map(e => e.name), ['宽距高位下拉', '坐姿划船', '面拉', '哑铃弯举'], '固定动作先练，当日选排在后面');
});

test('an in-progress session blocks the day page instead of starting a second workout', () => {
 const d = sample(), h = createAppHarness(d);
 h.action('day-open', {id: d.plans[0].id});
 h.action('start', {id: d.plans[0].id});
 assert.equal(h.state.active.movements.length, 3);
 h.run('dayPlan=db().plans[0].id;view="day";render();');
 assert.match(h.html, /训练进行中/);
 assert.match(h.html, /data-action="nav" data-view="today">回到本次训练/);
 assert.doesNotMatch(h.html, /data-action="day-pick"/);
 h.action('day-back');
 assert.match(h.html, /data-action="manage">调整动作/);
});

test('the day page survives a deleted plan and reloads with today picks', () => {
 const d = sample();
 d.plans[0].exercises[2].optional = true;
 const id = d.plans[0].exercises[2].id;
 const h = createAppHarness(d);
 h.action('day-open', {id: d.plans[0].id});
 h.action('day-pick', {id});
 const reload = new Repository(h.storage);
 assert.deepEqual(reload.db.plans[0].daily.ids, [id]);
 assert.equal(reload.db.plans[0].exercises[2].optional, true);
 h.run('db().plans=[];render();');
 assert.match(h.html, /找不到这个计划/);
 assert.match(h.html, /data-action="day-back">返回训练首页/);
 h.action('day-pick', {id});
 assert.equal(h.toast, '找不到这个计划，请返回训练首页。');
 h.action('day-back');
 assert.match(h.html, /今天练什么？/);
});
