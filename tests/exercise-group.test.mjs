import test from 'node:test';
import assert from 'node:assert/strict';
import {KEY,initial,exercise,parseBackup,validate,identityConflict,start,libraryExercises,putLibraryExercise,usedExerciseGroups,exerciseGroupLabel,normalizeGroupName,syncExerciseGroup,syncExerciseName,uid,Repository} from '../dist/data.js';
import {exportFull,restoreFull} from '../dist/backup.js';
import {createAppHarness,Storage} from './helpers/app-harness.mjs';

const withGroup=(d,name,group)=>{d.plans[0].exercises=[{...exercise(name),group}];return d;};
const pickAction=(html,name)=>{
 const row=[...html.matchAll(/data-modal="pick-(\d+)"[^>]*>([^<]+)<span>/g)].find(match=>match[2]===name);
 assert.ok(row,`未在列表中找到 ${name}`);
 return `pick-${row[1]}`;
};

test('exercises and library entries stay valid with optional categories',()=>{
 const plain=initial();validate(plain);
 assert.equal(plain.library,undefined,'旧数据不会凭空多出动作库');
 assert.equal(plain.plans[0].exercises.every(e=>exerciseGroupLabel(e)===null),true);
 const d=initial();d.library=[exercise('库内动作'),{...exercise('深蹲'),group:'腿'}];validate(d);
 for(const bad of ['','   ','一'.repeat(25),5,{}]){const x=initial();x.plans[0].exercises[0].group=bad;assert.throws(()=>validate(x),/训练数据不正确/,JSON.stringify(bad));}
 const same=exercise('同编号');
 for(const bad of [null,{},[same,structuredClone(same)],[{...exercise('坏分类'),group:''}],['x']]){const x=initial();x.library=bad;assert.throws(()=>validate(x),/训练数据不正确/,JSON.stringify(bad));}
});

test('the library lists plan, session and library-only actions once per identity',()=>{
 const d=initial();d.plans[0].exercises[0].group='背';
 start(d,d.plans[0].id);
 const extra={...exercise('绳索下压',15),group:'有氧'};
 d.library=[extra,structuredClone(d.plans[1].exercises[0]),structuredClone(d.active.movements[0].exercise)];
 const all=libraryExercises(d);
 assert.equal(new Set(all.map(e=>e.id)).size,all.length,'同一动作只列一次');
 assert.equal(all.find(e=>e.id===extra.id).name,'绳索下压','库内新建的动作会列出');
 assert.equal(all.filter(e=>e.id===d.plans[0].exercises[0].id).length,1,'计划和本次训练共用编号只留一条');
 assert.deepEqual(usedExerciseGroups(d).slice(6),['有氧'],'库内分类也进入候选');
});

test('the six defaults always lead the list and custom labels only appear while in use',()=>{
 const d=initial();
 assert.deepEqual(usedExerciseGroups(d),['背','肩','胸','腿','核心','手臂']);
 const extra={...exercise('椭圆机'),group:'有氧'};
 d.library=[extra];
 assert.deepEqual(usedExerciseGroups(d).slice(6),['有氧']);
 syncExerciseGroup(d,extra.id,null);
 assert.deepEqual(usedExerciseGroups(d).slice(6),[],'没人用了就自动消失');
 validate(d);
 d.plans[1].exercises.push({...exercise('登山跑'),group:'有氧'});
 d.plans[1].exercises.push({...exercise('快走'),group:'有氧'});
 assert.deepEqual(usedExerciseGroups(d).slice(6),['有氧']);
 syncExerciseGroup(d,d.plans[1].exercises.at(-2).id,null);
 assert.deepEqual(usedExerciseGroups(d).slice(6),['有氧'],'另一个动作还在用就保留');
});

test('normalizeGroupName collapses spacing and caps length',()=>{
 assert.equal(normalizeGroupName('   '),null);assert.equal(normalizeGroupName(''),null);
 assert.equal(normalizeGroupName(' 上肢   推拉 '),'上肢 推拉');
 assert.equal(normalizeGroupName(null),null);
 assert.equal(normalizeGroupName('一'.repeat(24)).length,24);
 assert.throws(()=>normalizeGroupName('一'.repeat(25)),/24 字/);
});

test('a category follows the exercise identity across library, plans and the active session',()=>{
 const d=initial();const shared=exercise('硬拉');
 d.plans[0].exercises.push(shared);d.plans[1].exercises.push(structuredClone(shared));d.library=[structuredClone(shared)];
 start(d,d.plans[0].id);const live=d.active.movements.find(m=>m.exercise.id===shared.id);
 d.history=[{id:uid(),planID:d.plans[0].id,name:'上周',started:Date.now()-864e5,ended:Date.now()-860e5,note:'',movements:[{id:uid(),exercise:{...structuredClone(shared),group:'腿'},sets:[{id:uid(),weight:100,reps:5,date:Date.now()-863e5}],skipped:false}]}];
 assert.equal(syncExerciseGroup(d,shared.id,'背'),4,'库、两个计划、本次训练一起更新');
 validate(d);
 assert.equal(d.library[0].group,'背');
 assert.equal(d.plans[0].exercises.find(e=>e.id===shared.id).group,'背');
 assert.equal(d.plans[1].exercises.find(e=>e.id===shared.id).group,'背');
 assert.equal(live.exercise.group,'背');
 assert.equal(d.history[0].movements[0].exercise.group,'腿','历史快照保留当时的分类');
 assert.equal(syncExerciseGroup(d,shared.id,null),4);
 assert.equal(Object.hasOwn(d.library[0],'group'),false);
 assert.equal(Object.hasOwn(d.plans[1].exercises.find(e=>e.id===shared.id),'group'),false);
});

test('renames follow the library too while history stays a snapshot',()=>{
 const d=initial();const shared=exercise('硬拉');
 d.plans[0].exercises.push(shared);d.library=[structuredClone(shared)];
 d.history=[{id:uid(),planID:d.plans[0].id,name:'上周',started:Date.now()-864e5,ended:Date.now()-860e5,note:'',movements:[{id:uid(),exercise:structuredClone(shared),sets:[{id:uid(),weight:100,reps:5,date:Date.now()-863e5}],skipped:false}]}];
 syncExerciseName(d,{...shared,name:'传统硬拉',knownNames:['硬拉']});
 assert.equal(d.library[0].name,'传统硬拉');
 assert.equal(d.plans[0].exercises.at(-1).name,'传统硬拉');
 assert.equal(d.history[0].movements[0].exercise.name,'硬拉');
 validate(d);
});

test('an unresolved identity still blocks category edits like renames do',()=>{
 const d=initial();const shared=exercise('卧推');
 d.plans[0].exercises.push(shared);d.plans[1].exercises.push({...structuredClone(shared),name:'杠铃卧推'});
 assert.equal(identityConflict(d,shared.id),true);
 assert.throws(()=>syncExerciseGroup(d,shared.id,'胸'),/旧历史关联/);
 assert.throws(()=>syncExerciseName(d,{...shared,name:'平板卧推'}),/旧历史关联/);
});

test('the repository stores library entries so training backups keep them',()=>{
 const storage=new Storage();const d=withGroup(initial(),'坐姿划船','背');putLibraryExercise(d,d.plans[0].exercises[0]);storage.setItem(KEY,JSON.stringify(d));
 const repo=new Repository(storage);
 repo.change(x=>{x.library[0].group='上背';});
 assert.equal(JSON.parse(storage.getItem(KEY)).library[0].group,'上背');
 const reloaded=new Repository(storage);
 assert.equal(reloaded.db.library[0].group,'上背');
 repo.change(x=>{syncExerciseGroup(x,x.library[0].id,null);});
 assert.equal(Object.hasOwn(JSON.parse(storage.getItem(KEY)).library[0],'group'),false);
});

test('the library starts with main categories and plan editing only shows the tag',()=>{
 const d=initial(),h=createAppHarness(d);
 assert.match(h.html,/data-view="library"[^>]*>[\s\S]*动作库/,'底栏有动作库标签');
 h.action('nav',{view:'library'});
 assert.match(h.html,/class="active"[^>]*data-view="library"|data-view="library"[^>]*class="active"/,'动作库页面已选中');
 assert.match(h.html,/data-action="library-group" data-group="背"/);
 assert.match(h.html,/data-action="library-group" data-group="手臂"/);
 assert.doesNotMatch(h.html,/宽距高位下拉/,'动作库首页只列主类，不直接铺开动作');
 assert.match(h.html,/还有 6 个未分类动作/);
 h.action('nav',{view:'today'});
 h.action('plan-edit',{id:d.plans[0].id});
 h.modalAction('edit-0');
 assert.doesNotMatch(h.modalHtml,/name="group"/,'计划编辑不再改分类');
 assert.match(h.modalHtml,/主类在底栏「动作库」里设置/);
 h.modalAction('close');
 h.action('nav',{view:'library'});
 h.action('library-group',{group:'背'});
 assert.match(h.html,/data-action="library-add" data-group="背"/);
 assert.match(h.html,/这个主类还没有动作/);
 h.action('library-add',{group:'背'});
 assert.match(h.modalHtml,/添加动作到「背」/);
 assert.match(h.modalHtml,/只显示未分类动作/);
 assert.match(h.modalHtml,/宽距高位下拉/);
 assert.match(h.modalHtml,/加入「背」（已选 0）/);
 h.modalAction(pickAction(h.modalHtml,'宽距高位下拉'));
 assert.match(h.modalHtml,/加入「背」（已选 1）/);
 h.modalAction('confirm');
 assert.equal(h.modalOpen,false);
 assert.equal(h.state.plans[0].exercises[0].group,'背');
 assert.equal(h.state.library[0].name,'宽距高位下拉','设置分类时动作进入动作库');
 assert.match(h.html,/宽距高位下拉/);
 assert.match(h.html,/1 个动作/);
 h.action('nav',{view:'today'});
 h.action('plan-edit',{id:d.plans[0].id});
 assert.match(h.modalHtml,/class="editor-item"><div><b>1\. 宽距高位下拉<\/b><i class="grp-tag">背<\/i>/);
 h.modalAction('edit-0');
 assert.doesNotMatch(h.modalHtml,/name="group"/);
});

test('a custom category created in the library becomes selectable and clearing removes it',()=>{
 const d=initial(),h=createAppHarness(d);
 h.action('nav',{view:'library'});
 h.action('library-group',{group:'背'});
 h.action('library-add',{group:'背'});
 h.modalAction(pickAction(h.modalHtml,'宽距高位下拉'));
 h.modalAction('confirm');
 const first=d.plans[0].exercises[0];
 h.action('library-edit',{id:first.id,name:first.name});
 h.submit({groupNew:' 有氧 '});
 assert.equal(new Repository(h.storage).db.plans[0].exercises[0].group,'有氧');
 h.action('library-home');
 assert.match(h.html,/data-action="library-group" data-group="有氧"/,'新类作为主类卡片出现');
 h.action('library-group',{group:'有氧'});
 h.action('library-add',{group:'有氧'});
 h.modalAction(pickAction(h.modalHtml,'坐姿划船'));
 h.modalAction('confirm');
 const second=d.plans[0].exercises[1];
 assert.equal(new Repository(h.storage).db.plans[0].exercises[1].group,'有氧');
 h.action('library-edit',{id:first.id,name:first.name});
 assert.match(h.modalHtml,/name="group" value="有氧"/,'新类成为其他动作的候选');
 assert.match(h.modalHtml,/value="有氧" checked/);assert.match(h.modalHtml,/value=""><span>清除/);
 h.submit({group:''});
 const saved=new Repository(h.storage).db;
 assert.equal(Object.hasOwn(saved.plans[0].exercises[0],'group'),false);
 assert.equal(Object.hasOwn(saved.library[0],'group'),false);
 assert.equal(saved.plans[0].exercises[1].group,'有氧','另一个动作仍在使用时候选保留');
 h.action('library-home');
 assert.match(h.html,/data-action="library-group" data-group="有氧"/);
 h.action('library-group',{group:'有氧'});
 h.action('library-edit',{id:second.id,name:second.name});
 assert.match(h.modalHtml,/value="有氧" checked/,'还在用的分类仍可选');
 h.submit({group:''});
 h.action('library-home');
 assert.doesNotMatch(h.html,/data-action="library-group" data-group="有氧"/,'不再被使用就退出候选');
 assert.match(h.html,/还有 6 个未分类动作/);
});

test('an ambiguous category entry keeps the typed name over the radio and survives a reload',()=>{
 const d=initial(),h=createAppHarness(d);
 h.action('nav',{view:'library'});
 h.action('library-group',{group:'腿'});
 h.action('library-add',{group:'腿'});
 h.modalAction(pickAction(h.modalHtml,'坐姿划船'));
 h.modalAction('confirm');
 const second=d.plans[0].exercises[1];
 h.action('library-edit',{id:second.id,name:second.name});
 h.submit({group:'腿',groupNew:'小腿'});
 assert.equal(new Repository(h.storage).db.library[0].group,'小腿');
 h.action('library-home');
 assert.match(h.html,/data-action="library-group" data-group="小腿"/);
});

test('a library action can be added to a plan through the category picker',()=>{
 const d=initial(),h=createAppHarness(d);
 h.action('nav',{view:'library'});
 h.action('library-group',{group:'手臂'});
 h.action('library-add',{group:'手臂'});
 h.modalAction('new');
 assert.doesNotMatch(h.modalHtml,/name="group"/,'从大类新建时直接归入当前主类');
 assert.match(h.modalHtml,/保存后会加入「手臂」主类/);
 h.submit({name:'绳索下压',unit:'kg',weight:'15',step:'1',target:'3',rest:'60',r0:'10',r1:'12',r2:'15'});
 assert.equal(h.modalOpen,false);
 assert.equal(h.state.library.length,1);
 assert.equal(h.state.library[0].group,'手臂');
 assert.match(h.html,/绳索下压/);
 assert.match(h.html,/<h1>手臂<\/h1>/);
 h.action('nav',{view:'today'});
 h.action('plan-edit',{id:d.plans[1].id});
 h.modalAction('add');
 assert.match(h.modalHtml,/class="grp-tab on" data-modal="tab-0">手臂/);
 assert.match(h.modalHtml,/class="library-item"[^>]*>绳索下压<span>/);
 h.modalAction('pick-0');
 assert.match(h.modalHtml,/添加动作（已选 1）/);
 h.modalAction('confirm');
 h.submit();
 assert.equal(h.state.plans[1].exercises.some(e=>e.name==='绳索下压'),true);
 assert.equal(h.state.library.length,1,'引用库内动作不会复制出第二条');
});

test('a category page multi-selects uncategorized actions into that category',()=>{
 const d=initial();d.plans[1].exercises[0].group='腿';
 const h=createAppHarness(d);
 h.action('nav',{view:'library'});
 h.action('library-group',{group:'背'});
 h.action('library-add',{group:'背'});
 assert.match(h.modalHtml,/只显示未分类动作/);
 assert.match(h.modalHtml,/宽距高位下拉/);
 assert.doesNotMatch(h.modalHtml,/>卧推<span>/,'已有主类的动作不进入未分类列表');
 h.modalAction(pickAction(h.modalHtml,'宽距高位下拉'));
 h.modalAction(pickAction(h.modalHtml,'坐姿划船'));
 assert.match(h.modalHtml,/加入「背」（已选 2）/);
 h.modalAction(pickAction(h.modalHtml,'宽距高位下拉'));
 assert.match(h.modalHtml,/加入「背」（已选 1）/,'再点一次可取消选择');
 h.modalAction(pickAction(h.modalHtml,'宽距高位下拉'));
 h.modalAction('confirm');
 assert.equal(h.modalOpen,false);
 assert.equal(h.state.plans[0].exercises[0].group,'背');
 assert.equal(h.state.plans[0].exercises[1].group,'背');
 assert.equal(h.state.plans[0].exercises[2].group,undefined,'未选中的动作保持未分类');
 assert.equal(h.state.plans[1].exercises[0].group,'腿','其他主类不受影响');
 assert.deepEqual(h.state.library.map(e=>[e.name,e.group]),[['坐姿划船','背'],['宽距高位下拉','背']],'按最后选择顺序写入');
 assert.match(h.html,/2 个动作/);
 h.action('library-home');
 assert.match(h.html,/data-group="背"[\s\S]*2 个动作/);
});

test('a plan can add several actions across categories in one selection',()=>{
 const d=initial();
 d.plans[1].exercises[0].group='胸';d.plans[1].exercises[1].group='肩';d.plans[1].exercises[2].group='肩';
 const h=createAppHarness(d);
 h.action('plan-edit',{id:d.plans[0].id});
 h.modalAction('add');
 assert.match(h.modalHtml,/可勾选多个动作/);
 assert.match(h.modalHtml,/添加动作（已选 0）/);
 assert.match(h.modalHtml,/aria-pressed="false">哑铃肩推<span>＋/);
 h.modalAction('pick-0');h.modalAction('pick-1');
 assert.match(h.modalHtml,/class="library-item picked"[^>]*aria-pressed="true">哑铃肩推<span>✓/);
 assert.match(h.modalHtml,/添加动作（已选 2）/);
 h.modalAction('tab-1');
 assert.match(h.modalHtml,/添加动作（已选 2）/,'切换大类保留已选');
 assert.match(h.modalHtml,/aria-pressed="false">卧推<span>＋/);
 h.modalAction('pick-0');
 assert.match(h.modalHtml,/添加动作（已选 3）/);
 h.modalAction('confirm');
 assert.match(h.modalHtml,/编辑计划/);
 assert.equal(h.state.plans[0].exercises.length,3,'确认前不写入计划');
 h.submit();
 assert.deepEqual(h.state.plans[0].exercises.map(e=>e.name),['宽距高位下拉','坐姿划船','哑铃弯举','哑铃肩推','侧平举','卧推']);
 assert.equal(h.state.plans[1].exercises.length,3,'源计划不受影响');
});

test('a training session can add several actions across categories at once',()=>{
 const d=initial();d.plans[0].exercises[0].group='背';
 d.plans[1].exercises[0].group='胸';d.plans[1].exercises[1].group='肩';d.plans[1].exercises[2].group='肩';
 start(d,d.plans[0].id);
 const h=createAppHarness(d);
 h.action('manage');h.modalAction('add');
 assert.match(h.modalHtml,/class="grp-tab on" data-modal="tab-0">背/);
 h.modalAction('tab-1');
 assert.match(h.modalHtml,/class="grp-tab on" data-modal="tab-1">肩/);
 h.modalAction('pick-0');h.modalAction('pick-1');
 assert.match(h.modalHtml,/添加动作（已选 2）/);
 h.modalAction('tab-2');
 assert.match(h.modalHtml,/添加动作（已选 2）/);
 h.modalAction('pick-0');
 assert.match(h.modalHtml,/添加动作（已选 3）/);
 h.modalAction('confirm');
 const state=h.state;
 assert.equal(state.active.movements.length,6);
 assert.deepEqual(state.active.movements.slice(3).map(m=>m.exercise.name),['哑铃肩推','侧平举','卧推'],'按点选顺序加入');
 assert.equal(state.library,undefined,'引用已有动作不会新建库条目');
 assert.match(h.modalHtml,/调整本次训练/);
});

test('training rows show the category and the in-session editor no longer changes it',()=>{
 const d=initial();d.plans[0].exercises[0].group='背';start(d,d.plans[0].id);
 const h=createAppHarness(d);
 h.action('manage');
 assert.match(h.modalHtml,/宽距高位下拉<\/b><i class="grp-tag">背<\/i>/);
 h.modalAction('edit-0');
 assert.doesNotMatch(h.modalHtml,/name="group"/);
 h.submit({name:'高位下拉'});
 const state=h.state;
 assert.equal(state.active.movements[0].exercise.name,'高位下拉');
 assert.equal(state.plans[0].exercises[0].name,'高位下拉','训练里改名仍同步计划');
});

test('the in-session picker lists library actions and new session actions join the library',()=>{
 const d=initial();d.plans[0].exercises[0].group='背';d.library=[{...exercise('面拉',15),group:'背'}];start(d,d.plans[0].id);
 const h=createAppHarness(d);
 h.action('manage');h.modalAction('add');
 assert.match(h.modalHtml,/class="grp-tab on" data-modal="tab-0">背/);
 assert.match(h.modalHtml,/>面拉<span>/,'库内动作可直接加入本次训练');
 h.modalAction('back');
 h.modalAction('add');h.modalAction('new');
 assert.doesNotMatch(h.modalHtml,/name="group"/,'训练里新建动作不改分类');
 assert.match(h.modalHtml,/主类在底栏「动作库」里设置/);
 h.submit({name:'保加利亚分腿蹲'});
 assert.equal(h.state.active.movements.at(-1).exercise.name,'保加利亚分腿蹲');
 assert.equal(h.state.library.some(e=>e.name==='保加利亚分腿蹲'),true,'训练中新建的动作进入动作库');
 assert.match(h.modalHtml,/保加利亚分腿蹲/);
 h.modalAction('close');
 h.action('nav',{view:'library'});
 assert.match(h.html,/还有 6 个未分类动作/);
 h.action('library-group',{group:'背'});
 assert.match(h.html,/面拉/);
 h.action('library-add',{group:'背'});
 assert.match(h.modalHtml,/保加利亚分腿蹲/);
});

test('replacing a movement opens the picker on its own category',()=>{
 const d=initial();d.plans[0].exercises[0].group='背';d.plans[0].exercises[1].group='肩';start(d,d.plans[0].id);
 const h=createAppHarness(d);
 h.action('manage');h.modalAction('replace-1');
 assert.match(h.modalHtml,/更换动作/);
 assert.match(h.modalHtml,/class="grp-tab on" data-modal="tab-1">肩<\/button>/);
 assert.match(h.modalHtml,/>坐姿划船<span>/);
 assert.doesNotMatch(h.modalHtml,/>宽距高位下拉<span>/,'别的类不混进当前列表');
 assert.doesNotMatch(h.modalHtml,/添加动作（已选/,'更换动作仍为单选');
});

test('training and full backups carry the library and category across devices',()=>{
 const d=withGroup(initial(),'杠铃划船','背');
 putLibraryExercise(d,exercise('库内动作'));
 assert.equal(parseBackup(JSON.stringify(d)).library[0].name,'库内动作');
 assert.equal(parseBackup(JSON.stringify(d)).plans[0].exercises[0].group,'背');
 const storage=new Storage();storage.setItem(KEY,JSON.stringify(d));
 const backup=exportFull(storage,d);
 assert.match(backup.parts[KEY],/"library"/);
 assert.match(backup.parts[KEY],/"group":"背"/);
 const phone=new Storage();restoreFull(phone,backup);
 assert.equal(JSON.parse(phone.getItem(KEY)).library[0].name,'库内动作');
 assert.equal(JSON.parse(phone.getItem(KEY)).plans[0].exercises[0].group,'背');
 const legacy=new Storage();legacy.setItem(KEY,JSON.stringify(initial()));
 assert.equal(new Repository(legacy).db.library,undefined,'旧备份没有动作库也能打开');
});