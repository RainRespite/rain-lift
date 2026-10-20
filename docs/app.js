import {KEY,uid,exercise,initial,validate,parseBackup,identityConflict,identityNames,splitExerciseIdentity,confirmExerciseIdentity,reviseExercise,previous,suggested,start,record,removeSet,finish,deleteHistory,restoreHistory,remaining,Repository} from './data.js?v=1.5';
const $=s=>document.querySelector(s),esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmt=n=>Number(n).toLocaleString('zh-CN',{maximumFractionDigits:2}),date=n=>new Date(n).toLocaleDateString('zh-CN',{month:'long',day:'numeric'});
let repo;try{repo=new Repository(localStorage);}catch{repo={db:initial(),writable:false,loadError:'浏览器存储不可用，请退出无痕浏览或检查浏览器设置。',change(){throw Error(this.loadError);}};}
let view='today',selected=null,historyID=null,tab='exercise',lastTap=0,audio,awake=null,offlineReady=false;
let serviceRegistration=null,offlineSetup=null,updateAvailable=false,lastUpdateCheck=0,updateChecking=false,updateState='联网后可检查更新';
const db=()=>repo.db,movement=()=>db().active?.movements.find(m=>m.id===selected)??db().active?.movements[0];
// Names follow one identity across current references; completed sessions remain snapshots.
function syncExerciseName(d,e){
 if(identityConflict(d,e.id))throw Error('请先整理这个动作的旧历史关联。');
 const refs=[...d.plans.flatMap(p=>p.exercises),...(d.active?.movements.map(m=>m.exercise)??[])].filter(x=>x.id===e.id),names=[...new Set([e.name,...(e.knownNames??[]),...refs.flatMap(x=>[x.name,...(x.knownNames??[])])])];
 for(const x of refs){x.name=e.name;x.knownNames=[...names];}
 if(d.rest&&d.active?.movements.some(m=>m.exercise.id===e.id&&m.sets.some(s=>s.id===d.rest.setID)))d.rest.name=e.name;
}
function exerciseName(id){return db().active?.movements.find(m=>m.exercise.id===id)?.exercise.name??db().plans.flatMap(p=>p.exercises).find(e=>e.id===id)?.name??[...db().history].sort((a,b)=>b.started-a.started).flatMap(s=>s.movements).find(m=>m.exercise.id===id)?.exercise.name??'动作历史';}
const icons={today:'<path d="M4 8v8m4-11v14m8-14v14m4-11v8M8 12h8"/>',history:'<path d="M4 20V4m0 16h17M8 15l4-5 4 3 5-8"/>',settings:'<path d="M4 7h16M4 17h16"/><circle cx="9" cy="7" r="3"/><circle cx="15" cy="17" r="3"/>'};
const icon=n=>`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[n]||''}</svg>`;
function toast(s){$('#toast').textContent=s;$('#toast').classList.add('visible');clearTimeout(toast.timer);toast.timer=setTimeout(()=>$('#toast').classList.remove('visible'),3000);}
function mutate(fn,message,identityRepair=false){try{if(identityRepair&&!repo.writable)throw Error(repo.loadError);const result=identityRepair?repo.repairIdentity(fn):repo.change(fn);render();if(message)toast(message);return result??true;}catch(e){toast(e.name==='QuotaExceededError'?'空间不足，未保存。请先导出备份并释放空间。':e.message);return false;}}
function unlockAudio(){try{audio??=new (window.AudioContext||window.webkitAudioContext)();if(audio.state==='suspended')audio.resume().catch(()=>{});}catch{}}
function beep(){try{if(audio?.state==='running'){const o=audio.createOscillator(),g=audio.createGain();o.connect(g);g.connect(audio.destination);o.frequency.value=740;g.gain.setValueAtTime(.15,audio.currentTime);g.gain.exponentialRampToValueAtTime(.001,audio.currentTime+.5);o.start();o.stop(audio.currentTime+.5);}}catch{}}
function render(){
 const active=db().active;
 $('#app').innerHTML=`<header class="top"><a href="#" data-action="nav" data-view="today" aria-label="返回训练首页">RAIN<span>/</span>LIFT</a><span id="connection-state" class="local-status">${navigator.onLine?'本机保存':'离线模式'}</span></header><main>${repo.loadError?`<aside class="warning">${esc(repo.loadError)}</aside>`:''}${view==='today'?(active?training():today()):view==='history'?history():settings()}</main>${active&&db().rest?restPanel():''}<nav class="bottom" aria-label="主导航">${[['today','训练'],['history','历史'],['settings','设置']].map(([id,label])=>`<button data-action="nav" data-view="${id}" class="${view===id?'active':''}" ${view===id?'aria-current="page"':''}>${icon(id)}<span>${label}</span></button>`).join('')}</nav>`;
 document.body.classList.toggle('has-timer',!!(active&&db().rest));updateClock();
}
function conflictIDs(){return [...new Set([...db().plans.flatMap(p=>p.exercises.map(e=>e.id)),...(db().active?.movements.map(m=>m.exercise.id)??[])])].filter(id=>identityConflict(db(),id));}
function identityWarning(id){return `<aside class="warning"><b>旧动作关联需要整理</b><p>${identityNames(db(),id).map(esc).join(' / ')} 共用了一个旧编号，已暂停合并历史和推荐重量。</p><button class="text-button" data-action="history-resolve" data-id="${esc(id)}">整理这几个动作的历史</button></aside>`;}
function identityWarnings(){return conflictIDs().map(identityWarning).join('');}
function identityResolver(id){
 const names=identityNames(db(),id);
 const done=(fn,message)=>{if(mutate(fn,message,true)){historyID=null;$('#modal').close();render();}};
 showDialog('整理旧动作历史',`<p>这些动作共用了同一旧编号。若它们是不同动作，可按历史记录中的原名称分开。</p><div class="editor-list">${names.map(name=>`<div class="editor-item"><b>${esc(name)}</b><small>${db().history.flatMap(s=>s.movements).filter(m=>m.exercise.id===id&&m.exercise.name===name).reduce((n,m)=>n+m.sets.length,0)} 组历史记录</small></div>`).join('')}</div><p class="footnote">修复前会先保存原始副本。无法匹配这些名称的记录会继续保留；最近删除中的相关记录也会一起整理。</p><button type="button" class="primary wide" data-modal="split">按这些名称分开记录</button><button type="button" class="outline wide" data-modal="same">这些只是同一动作的旧名称</button>`,null,{
 split:()=>done(d=>splitExerciseIdentity(d,id),'已分开动作历史'),
 same:()=>showDialog('确认是同一个动作',`<p>仅在这些名称确实代表同一个动作时确认。确认后会共享历史，训练当时的名称仍保留。</p><label>当前动作名称<select name="canonical">${names.map(name=>`<option value="${esc(name)}">${esc(name)}</option>`).join('')}</select></label><button type="button" class="outline wide" data-modal="back">返回</button>`,fd=>done(d=>confirmExerciseIdentity(d,id,String(fd.get('canonical'))),'已确认改名关联'),{back:()=>identityResolver(id)})
 });
}
function today(){return `<div class="page-heading"><div><p class="eyebrow">${date(Date.now())} · 今天</p><h1>今天练什么？</h1></div><button class="icon-button" data-action="plan-new" aria-label="创建计划">＋</button></div>${identityWarnings()}<div class="plans">${db().plans.map((p,i)=>`<article class="plan-card"><div class="plan-index">PLAN / ${String(i+1).padStart(2,'0')}</div><div class="row"><h2>${esc(p.name)}</h2><button class="icon-button" data-action="plan-edit" data-id="${p.id}" aria-label="编辑${esc(p.name)}">···</button></div><p class="muted">${p.exercises.length} 个动作 <span class="sep">/</span> ${p.exercises.reduce((a,e)=>a+e.target,0)} 组</p><div class="plan-exercises">${p.exercises.map(e=>`<span>${esc(e.name)}</span>`).join('')}</div><button class="primary wide" data-action="start" data-id="${p.id}" ${p.exercises.length?'':'disabled'}>开始训练 <span>↗</span></button></article>`).join('')}</div><button class="outline wide" data-action="plan-new">＋ 创建训练计划</button><p class="footnote">示例计划可修改。完成一组，点一下次数就记好了。</p>${!matchMedia('(display-mode: standalone)').matches?'<aside class="install-note"><b>像 App 一样打开</b><p>在 iPhone Safari 中点“分享” → “添加到主屏幕”。首次联网打开后，等待设置页显示“离线已就绪”。</p></aside>':''}`;}
function training(){const s=db().active,m=movement();return `<div class="row"><p class="eyebrow">${esc(s.name)}</p><button class="text-button" data-action="manage">调整动作</button></div><div class="exercise-tabs" aria-label="本次动作">${s.movements.map(x=>`<button data-action="select" data-id="${x.id}" class="${x.id===m?.id?'selected':''}">${x.skipped?'跳过 · ':''}${esc(x.exercise.name)}${x.sets.length?` <small>${x.sets.length}</small>`:''}</button>`).join('')}</div>${m?`<div class="training-heading"><h1>${esc(m.exercise.name)}</h1><div class="row"><span class="muted">已完成 <b class="accent">${m.sets.length}</b> / ${m.exercise.target} 组</span><span class="badge">下一组 · ${String(m.sets.length+1).padStart(2,'0')}</span></div></div><section class="record-card"><label for="weight" class="weight-label">本组重量 <span>${esc(m.exercise.unit)}</span></label><div class="weight-control"><button data-action="weight-minus" aria-label="减少重量">−</button><input id="weight" inputmode="decimal" type="number" min="0" max="10000" step="any" value="${suggested(db(),m)}" aria-label="本组重量"><button data-action="weight-plus" aria-label="增加重量">＋</button></div><div class="reps-buttons">${m.exercise.reps.map(r=>`<button data-action="record" data-reps="${r}" aria-label="完成${r}次"><strong>${r}</strong><span>次 · 完成</span></button>`).join('')}</div><button class="other-button" data-action="set-new">其他次数 / 补录</button></section><section class="previous"><div class="row"><h2>上次表现</h2><button class="text-button" data-action="history-open" data-id="${m.exercise.id}">查看历史</button></div>${identityConflict(db(),m.exercise.id)?identityWarning(m.exercise.id):previous(db(),m.exercise.id)?`<div class="last-sets">${previous(db(),m.exercise.id).sets.map((x,i)=>`<div><small>第 ${i+1} 组</small><b>${fmt(x.weight)} <span>× ${x.reps}</span></b></div>`).join('')}</div>`:'<p class="muted">第一次记录，从今天开始。</p>'}</section><section><div class="row section-heading"><h2>本次记录 <span class="count">${m.sets.length}</span></h2>${m.sets.length?'<button class="text-button" data-action="undo">撤销上一组</button>':''}</div>${m.sets.length?`<div class="set-list">${m.sets.map((x,i)=>`<button class="set-row" data-action="set-edit" data-id="${x.id}"><span class="set-number">${String(i+1).padStart(2,'0')}</span><b>${fmt(x.weight)} <small>${esc(m.exercise.unit)}</small></b><span>× ${x.reps} 次</span><span class="edit-label">修改</span></button>`).join('')}</div>`:'<div class="empty-small">完成一组后，点上方次数按钮。</div>'}</section>`:'<div class="empty"><h1>添加今天的动作</h1><button class="primary" data-action="manage">选择动作</button></div>'}<label class="note-label" for="note">训练备注 <span>选填</span></label><textarea id="note" rows="2" maxlength="10000" placeholder="今天的状态、器械差异…">${esc(s.note)}</textarea><div class="row end-row"><span class="muted">共 ${s.movements.reduce((a,m)=>a+m.sets.length,0)} 组</span><button class="outline" data-action="finish">结束训练</button></div>`;}
function restPanel(){return `<aside class="rest-panel" aria-label="组间休息"><div class="row"><div><b id="rest-title">组间休息</b><small>${esc(db().rest.name)}</small></div><strong id="clock" aria-live="off">00:00</strong></div><div class="rest-actions"><button data-action="rest-minus">−15 秒</button><button data-action="rest-plus">＋15 秒</button><button data-action="rest-end">结束休息</button></div></aside>`;}
let announced=null;
function updateClock(){if(!db().rest)return;const n=remaining(db().rest);if($('#clock'))$('#clock').textContent=`${String(Math.floor(n/60)).padStart(2,'0')}:${String(n%60).padStart(2,'0')}`;if($('#rest-title'))$('#rest-title').textContent=n?'组间休息':'休息结束';if(n===0&&announced!==db().rest.setID){announced=db().rest.setID;if(document.visibilityState==='visible'){beep();toast('休息结束，准备下一组');}}}


function showDialog(title,content,submit,handlers={}){const d=$('#modal');if(d.open)d.close();d.innerHTML=`<form><header><h2>${esc(title)}</h2><button type="button" data-modal="close" class="icon-button" aria-label="关闭">×</button></header><div class="dialog-body">${content}</div>${submit?'<footer><button type="submit" class="primary wide">保存</button></footer>':''}</form>`;d.querySelector('form').addEventListener('submit',e=>{e.preventDefault();submit?.(new FormData(e.target));});d.querySelector('[data-modal="close"]').onclick=()=>d.close();for(const b of d.querySelectorAll('[data-modal]'))if(handlers[b.dataset.modal])b.onclick=()=>handlers[b.dataset.modal](b);d.showModal();}
function confirmAction(title,body,yes,action){showDialog(title,`<p>${esc(body)}</p><button type="button" class="primary wide" data-modal="confirm">${esc(yes)}</button><button type="button" class="outline wide" data-modal="cancel">取消</button>`,null,{confirm:()=>{if(action()!==false)$('#modal').close();},cancel:()=>$('#modal').close()});}
function planEditor(plan){
 const saveName=()=>{plan.name=$('#modal [name="planName"]').value.trim()||'新计划';};
 showDialog('编辑计划',`<label>计划名称<input name="planName" value="${esc(plan.name)}" required maxlength="100"></label><p class="muted">动作与顺序 · 调整后点保存，已有训练记录保留。</p><div class="editor-list">${plan.exercises.map((e,i)=>`<div class="editor-item"><div><b>${esc(e.name)}</b><small>${e.target} 组 · 休息 ${e.rest} 秒</small></div><div class="mini-actions"><button type="button" data-modal="edit-${i}">设置</button><button type="button" data-modal="up-${i}" aria-label="上移动作" ${i===0?'disabled':''}>↑</button><button type="button" data-modal="down-${i}" aria-label="下移动作" ${i===plan.exercises.length-1?'disabled':''}>↓</button><button type="button" data-modal="remove-${i}" aria-label="从计划移除${esc(e.name)}">移除</button></div></div>`).join('')}</div><button class="outline wide" type="button" data-modal="add">＋ 添加动作</button>${db().plans.some(p=>p.id===plan.id)?'<button class="danger wide" type="button" data-modal="delete">删除计划</button>':''}`,fd=>{
 plan.name=String(fd.get('planName')).trim();if(mutate(d=>{const i=d.plans.findIndex(p=>p.id===plan.id),renamed=plan.exercises.filter(e=>d.plans[i]?.exercises.some(old=>old.id===e.id&&old.name!==e.name));if(i<0)d.plans.push(plan);else d.plans[i]=plan;for(const e of renamed)syncExerciseName(d,e);},'计划已保存'))$('#modal').close();
 },{
 add:()=>{saveName();exerciseEditor(exercise(),e=>{plan.exercises.push(e);planEditor(plan);},()=>planEditor(plan));},
 delete:()=>confirmAction('删除这个计划？','已有训练记录会保留。','删除计划',()=>mutate(d=>{d.plans=d.plans.filter(p=>p.id!==plan.id);},'计划已删除')),
 ...Object.fromEntries(plan.exercises.flatMap((e,i)=>[
 [`edit-${i}`,()=>{saveName();exerciseEditor(structuredClone(e),v=>{plan.exercises[i]=v;planEditor(plan);},()=>planEditor(plan));}],
 [`remove-${i}`,()=>{saveName();plan.exercises.splice(i,1);planEditor(plan);}],
 [`up-${i}`,()=>{saveName();[plan.exercises[i-1],plan.exercises[i]]=[plan.exercises[i],plan.exercises[i-1]];planEditor(plan);}],
 [`down-${i}`,()=>{saveName();[plan.exercises[i+1],plan.exercises[i]]=[plan.exercises[i],plan.exercises[i+1]];planEditor(plan);}]
 ]))
 });
}
function exerciseEditor(e,save,back){if(identityConflict(db(),e.id)){identityResolver(e.id);return;}showDialog('动作设置',`<label>动作名称<input name="name" value="${esc(e.name)}" required maxlength="100"></label><p class="footnote">修改名称会延续这个动作的全部历史。不同动作请返回后选择“创建新动作”。</p><div class="form-grid"><label>初始重量<input name="weight" type="number" inputmode="decimal" min="0" max="10000" step="any" value="${e.weight}" required></label><label>单位<input name="unit" maxlength="20" value="${esc(e.unit)}"></label><label>加减步长<input name="step" type="number" inputmode="decimal" min=".01" max="1000" step="any" value="${e.step}" required></label><label>目标组数<input name="target" type="number" inputmode="numeric" min="1" max="99" value="${e.target}" required></label></div><label>每组休息（秒）<input name="rest" type="number" inputmode="numeric" min="15" max="3600" value="${e.rest}" required></label><p class="muted">三个次数快捷键 · 请填写不同次数</p><div class="form-grid three">${e.reps.map((n,i)=>`<label>按钮 ${i+1}<input name="r${i}" type="number" inputmode="numeric" min="1" max="999" value="${n}" required></label>`).join('')}</div><p class="footnote">哑铃记单只还是总重量，由你自己约定；自重可填 0。</p><button type="button" class="outline wide" data-modal="back">返回</button>`,fd=>{
 const updated={...e,name:String(fd.get('name')).trim(),unit:String(fd.get('unit')),weight:+fd.get('weight'),step:+fd.get('step'),target:+fd.get('target'),rest:+fd.get('rest'),reps:[0,1,2].map(i=>+fd.get('r'+i))};
 if(new Set(updated.reps).size!==3){toast('三个快捷次数不能相同');return;}
 try{save(reviseExercise(db(),e,updated));}catch(err){toast(err.message);}
 },{back});}
function setEditor(m,entry,sessionID=null){showDialog(entry?'修改这一组':'记录一组',`<p class="muted">${esc(m.exercise.name)}</p><div class="form-grid"><label>重量 · ${esc(m.exercise.unit)}<input name="weight" type="number" inputmode="decimal" min="0" max="10000" step="any" value="${entry?.weight??suggested(db(),m)}" required></label><label>实际次数<input name="reps" type="number" inputmode="numeric" min="1" max="999" value="${entry?.reps??m.exercise.reps[1]}" required></label></div>${!entry?'<label class="check-label"><input type="checkbox" name="timed" checked>完成后开始休息</label><p class="footnote">补录之前的组时，关闭此开关。</p>':'<p class="footnote">修改记录不会启动新的休息计时。</p><button type="button" class="danger wide" data-modal="delete">删除这一组</button>'}`,fd=>{
 unlockAudio();const weight=+fd.get('weight'),reps=+fd.get('reps');
 if(mutate(d=>{if(entry){const s=sessionID?d.history.find(s=>s.id===sessionID):d.active;const x=s.movements.find(x=>x.id===m.id).sets.find(x=>x.id===entry.id);x.weight=weight;x.reps=reps;}else record(d,m.id,reps,weight,fd.has('timed'));},'记录已保存'))$('#modal').close();
 },{delete:()=>{if(mutate(d=>removeSet(d,m.id,entry.id,sessionID),'已删除这一组'))$('#modal').close();}});}
function manage(){const movements=db().active.movements;showDialog('调整本次训练',`<p class="muted">改名会同步到计划，其他调整只影响今天。未记录的动作可移除；已记录的动作可跳过，保留已完成的组。</p><div class="editor-list">${movements.map((m,i)=>`<div class="editor-item"><div><b>${esc(m.exercise.name)}</b><small>${m.skipped?'已跳过':m.sets.length+' 组已完成'}</small></div><div class="mini-actions"><button type="button" data-modal="edit-${i}">设置</button><button type="button" data-modal="skip-${i}">${m.skipped?'恢复':'跳过'}</button>${!m.sets.length?`<button type="button" data-modal="replace-${i}">更换</button><button type="button" data-modal="remove-${i}" aria-label="从本次训练移除${esc(m.exercise.name)}">移除</button>`:''}<button type="button" data-modal="up-${i}" ${i===0?'disabled':''} aria-label="上移动作">↑</button><button type="button" data-modal="down-${i}" ${i===movements.length-1?'disabled':''} aria-label="下移动作">↓</button></div></div>`).join('')}</div><button type="button" class="outline wide" data-modal="add">＋ 添加动作</button><button type="button" class="outline wide" data-modal="template">保存本次安排到计划</button>`,()=>$('#modal').close(),{
 add:()=>pickExercise(),template:()=>confirmAction('更新固定计划？','把本次未跳过的动作和顺序保存到原计划，已有历史不变。','更新计划',()=>mutate(d=>{const s=d.active,seen=new Set(),p={id:s.planID,name:s.name,exercises:s.movements.filter(m=>!m.skipped).map(m=>structuredClone(m.exercise)).filter(e=>!seen.has(e.id)&&seen.add(e.id))};const i=d.plans.findIndex(p=>p.id===s.planID);if(i<0)d.plans.push(p);else d.plans[i]=p;},'计划已更新')),
 ...Object.fromEntries(movements.flatMap((m,i)=>[
 [`edit-${i}`,()=>exerciseEditor(structuredClone(m.exercise),e=>{if(mutate(d=>{const x=d.active.movements.find(x=>x.id===m.id);const renamed=x.exercise.name!==e.name;if(x.exercise.id!==e.id)delete x.overrideWeight;x.exercise=e;if(renamed)syncExerciseName(d,e);}))manage();},manage)],
 [`skip-${i}`,()=>{mutate(d=>{d.active.movements[i].skipped=!m.skipped;});manage();}],
 [`replace-${i}`,()=>pickExercise(m.id)],
 [`remove-${i}`,()=>{if(mutate(d=>{const x=d.active.movements.find(x=>x.id===m.id);if(x?.sets.length)throw Error('这个动作已有记录，请使用跳过，保留训练记录。');d.active.movements=d.active.movements.filter(x=>x.id!==m.id);},'已从本次训练移除')){if(selected===m.id)selected=null;manage();}}],
 [`up-${i}`,()=>{mutate(d=>{const a=d.active.movements;[a[i-1],a[i]]=[a[i],a[i-1]];});manage();}],
 [`down-${i}`,()=>{mutate(d=>{const a=d.active.movements;[a[i+1],a[i]]=[a[i],a[i+1]];});manage();}]
 ]))
 });}
function pickExercise(replaceID=null){const seen=new Set(),library=db().plans.flatMap(p=>p.exercises).filter(e=>{const key=identityConflict(db(),e.id)?JSON.stringify([e.id,e.name]):e.id;return !seen.has(key)&&seen.add(key);});const add=e=>{const conflictID=[e.id,db().active.movements.find(m=>m.id===replaceID)?.exercise.id].find(id=>id&&identityConflict(db(),id));if(conflictID){identityResolver(conflictID);return;}if(mutate(d=>{if(replaceID){const m=d.active.movements.find(m=>m.id===replaceID);m.exercise=structuredClone(e);delete m.overrideWeight;m.skipped=false;}else d.active.movements.push({id:uid(),exercise:structuredClone(e),sets:[],skipped:false});},'动作已更新'))manage();};showDialog(replaceID?'更换动作':'添加动作',`<div class="editor-list">${library.map((e,i)=>`<button class="library-item" type="button" data-modal="choose-${i}">${esc(e.name)}<span>${identityConflict(db(),e.id)?'整理':'＋'}</span></button>`).join('')}</div><button type="button" class="outline wide" data-modal="new">创建新动作</button><button type="button" class="outline wide" data-modal="back">返回</button>`,null,{new:()=>exerciseEditor(exercise(),add,()=>pickExercise(replaceID)),back:manage,...Object.fromEntries(library.map((e,i)=>['choose-'+i,()=>add(e)]))});}

$('#app').addEventListener('click',e=>{const b=e.target.closest('[data-action]');if(!b)return;e.preventDefault();const m=movement(),a=b.dataset.action;
 if(a==='nav'){view=b.dataset.view;historyID=null;render();scrollTo(0,0);}
 else if(a==='start'){if(mutate(d=>start(d,b.dataset.id))){unlockAudio();selected=null;scrollTo(0,0);}}
 else if(a==='select'){selected=b.dataset.id;render();}
 else if(a==='record'){if(Date.now()-lastTap<650)return;lastTap=Date.now();unlockAudio();const s=mutate(d=>record(d,m.id,+b.dataset.reps,suggested(d,m)));if(s)toast(`第 ${movement().sets.length} 组已保存 · ${fmt(s.weight)} × ${s.reps}`);}
 else if(a==='weight-minus'||a==='weight-plus'){mutate(d=>{const x=d.active.movements.find(x=>x.id===m.id);x.overrideWeight=Math.max(0,Math.min(10000,Math.round((suggested(d,x)+(a==='weight-plus'?1:-1)*x.exercise.step)*100)/100));});}
 else if(a==='undo'){mutate(d=>removeSet(d,m.id,m.sets.at(-1).id),'已撤销，相关计时已取消');}
 else if(a.startsWith('rest-')){unlockAudio();mutate(d=>{if(a==='rest-end'){d.rest=null;return;}if(!d.rest)return;d.rest.end=Math.max(Date.now(),d.rest.end)+(a==='rest-plus'?15000:-15000);if(d.rest.end<=Date.now())d.rest=null;else announced=null;});}
 else if(a==='finish')confirmAction('结束本次训练？',`已完成 ${db().active.movements.reduce((n,m)=>n+m.sets.length,0)} 组。即使未达到目标组数，也可以保存结束。`,'保存并结束',()=>mutate(finish,'训练已保存'));
 else if(a==='plan-new')planEditor({id:uid(),name:'新计划',exercises:[]});
 else if(a==='plan-edit')planEditor(structuredClone(db().plans.find(p=>p.id===b.dataset.id)));
 else if(a==='manage')manage();
 else if(a==='set-new')setEditor(m,null);
 else if(a==='set-edit')setEditor(m,m.sets.find(s=>s.id===b.dataset.id));
 else if(a==='history-open'){historyID=b.dataset.id;view='history';render();scrollTo(0,0);}
 else extraAction(a,b);
});

$('#app').addEventListener('change',e=>{if(e.target.id==='weight'){const raw=e.target.value,v=Number(raw),m=movement();if(raw.trim()===''||!Number.isFinite(v)||v<0||v>10000){toast('请输入 0–10000 之间的重量');render();return;}try{repo.change(d=>{d.active.movements.find(x=>x.id===m.id).overrideWeight=v;});}catch(err){toast(err.message);render();}}if(e.target.id==='note')try{repo.change(d=>{d.active.note=e.target.value;});}catch(err){toast(err.message);}});
function connectionStatus(){const status=$('#connection-state');if(status)status.textContent=navigator.onLine?'本机保存':'离线模式';}
setInterval(updateClock,500);window.addEventListener('online',connectionStatus);window.addEventListener('offline',connectionStatus);document.addEventListener('visibilitychange',updateClock);
window.addEventListener('storage',e=>{if(e.key===KEY){try{repo.db=validate(JSON.parse(e.newValue));render();toast('记录已从另一窗口更新');}catch{toast('另一窗口的数据发生变化，请重新打开页面。');}}});
render();

function history(){
 const sessions=[...db().history].sort((a,b)=>b.started-a.started);
 if(historyID&&identityConflict(db(),historyID))return `<button class="text-button" data-action="history-back">‹ 全部历史</button><h1>先整理动作关联</h1>${identityWarning(historyID)}<button class="outline wide" data-action="history-unconfirmed">按训练查看原始记录</button>`;
 if(historyID){const matched=sessions.filter(s=>s.movements.some(m=>m.exercise.id===historyID&&m.sets.length)),name=exerciseName(historyID);return `<button class="text-button" data-action="history-back">‹ 全部历史</button><h1>${esc(name)}</h1>${matched.length?matched.map(s=>historySession(s,historyID)).join(''):'<div class="empty"><p>还没有已完成的训练记录。</p></div>'}`;}
 const seen=new Set(),exercises=sessions.flatMap(s=>s.movements).filter(m=>m.sets.length&&!identityConflict(db(),m.exercise.id)&&!seen.has(m.exercise.id)&&seen.add(m.exercise.id));
 const deleted=[...(db().deletedHistory??[])].sort((a,b)=>b.deletedAt-a.deletedAt);
 return `<p class="eyebrow">每一次训练，都有迹可循</p><h1>训练历史</h1>${identityWarnings()}<div class="segmented"><button data-action="history-tab" data-tab="exercise" class="${tab==='exercise'?'selected':''}">按动作</button><button data-action="history-tab" data-tab="session" class="${tab==='session'?'selected':''}">按训练</button><button data-action="history-tab" data-tab="deleted" class="${tab==='deleted'?'selected':''}">最近删除${deleted.length?` (${deleted.length})`:''}</button></div>${tab==='deleted'?`<p class="footnote">已删除的训练不计入历史和上次表现，可随时恢复。备份也会保留这些记录，不会自动清空。</p>${deleted.length?deleted.map(entry=>historySession(entry.session,null,true)).join(''):'<div class="empty"><p>没有已删除的训练。</p></div>'}`:!sessions.length?'<div class="empty"><h2>还没有完成的训练</h2><p>训练结束后，重量和次数会出现在这里。</p></div>':tab==='session'?sessions.map(s=>historySession(s)).join(''):`<div class="history-list">${exercises.map(m=>`<button data-action="history-open" data-id="${m.exercise.id}" class="history-item"><div><b>${esc(exerciseName(m.exercise.id))}</b><small>${m.sets.map(s=>fmt(s.weight)+' × '+s.reps).join(' / ')}</small></div><span>›</span></button>`).join('')}</div>`}`;
}
function historySession(s,exerciseID=null,deleted=false){return `<article class="history-session" id="history-${esc(s.id)}"><div class="row"><h2>${esc(s.name)}</h2><span class="muted">${date(s.started)}</span></div><p class="footnote">${new Date(s.started).toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit'})} · 共 ${s.movements.reduce((n,m)=>n+m.sets.length,0)} 组</p>${s.movements.filter(m=>!exerciseID||m.exercise.id===exerciseID).map(m=>`<div class="history-movement"><h3>${esc(m.exercise.name)}${m.skipped?' · 跳过':''}</h3>${m.sets.length?m.sets.map((x,i)=>`<${deleted?'div':'button'} class="set-row" ${deleted?'':`data-action="history-edit" data-session="${esc(s.id)}" data-movement="${esc(m.id)}" data-id="${esc(x.id)}"`}><span class="set-number">${String(i+1).padStart(2,'0')}</span><b>${fmt(x.weight)} <small>${esc(m.exercise.unit)}</small></b><span>× ${x.reps} 次</span>${deleted?'':'<span class="edit-label">修改</span>'}</${deleted?'div':'button'}>`).join(''):'<p class="muted">未记录组数</p>'}</div>`).join('')}${s.note?`<p class="history-note">${esc(s.note)}</p>`:''}<div class="history-actions">${deleted?`<button class="outline wide" data-action="history-restore" data-session="${esc(s.id)}">恢复这次训练</button>`:exerciseID?`<button class="text-button" data-action="history-session-open" data-session="${esc(s.id)}">查看整次训练 / 删除记录</button>`:`<button class="danger" data-action="history-delete" data-session="${esc(s.id)}">删除这次训练</button>`}</div></article>`;}
function deleteHistoryDialog(id){
 const session=db().history.find(s=>s.id===id);if(!session){toast('找不到这次训练，可能已删除');return;}
 const count=session.movements.reduce((n,m)=>n+m.sets.length,0);
 confirmAction('删除这次训练？',`${date(session.started)} ${new Date(session.started).toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit'})} · ${session.name}，共 ${count} 组。会移除这整次训练的所有动作记录；计划与正在进行的训练保留。误删可到“最近删除”恢复。`,'移入最近删除',()=>mutate(d=>deleteHistory(d,id),'已移入最近删除，可随时恢复'));
}
function settings(){return `<h1>设置</h1>${identityWarnings()}<section class="settings-card"><h2>添加到主屏幕</h2><ol><li>用 iPhone 的 Safari 打开这个链接。</li><li>点“分享”，选择“添加到主屏幕”。</li><li>从主屏幕打开一次，确认下方离线状态。</li></ol><div class="status-row"><b>离线使用</b><span id="offline-state">${offlineReady?'已就绪':'准备中，请保持联网'}</span></div><p class="footnote">添加后先检查记录是否齐全。若 Safari 与主屏幕版本的数据未共享，用导出 / 导入迁移。</p></section><section class="settings-card"><h2>版本与更新</h2><p>当前版本：1.5</p><p class="footnote">当前网址：${esc(window.location?.href??'')}</p><p id="update-state" class="footnote">${esc(updateState)}</p><button class="outline wide" data-action="app-update">检查更新</button><button class="outline wide" data-action="app-reload">刷新页面 / 载入新版</button><p class="footnote">更新保留本机记录。正在编辑时请先保存或关闭；训练中的重量和备注会在刷新前保存。</p></section><section class="settings-card"><h2>休息计时</h2><p>页面打开时倒计时，到点尝试播放提示音。返回页面时会恢复正确剩余时间。</p><aside class="warning"><b>锁屏后不保证提醒</b><p>网页无法在离线锁屏或后台可靠地准时发声。如需锁屏提醒，请同时使用手机系统计时器。</p></aside><button class="outline wide" data-action="wake">${awake?'关闭保持屏幕常亮':'训练时保持屏幕常亮'}</button><p class="footnote">需要浏览器支持，可能增加耗电；切到后台后会暂停。</p></section><section class="settings-card"><h2>记录与备份</h2><button class="outline wide" data-action="history-deleted">查看最近删除的训练 (${db().deletedHistory?.length??0})</button><p>记录只存在当前设备，不上传训练数据。清除网站数据、移除网页应用或更换手机可能导致丢失，请定期导出。</p><button class="primary wide" data-action="export">导出训练备份</button><button class="outline wide" data-action="import">导入备份 / 迁移原生版记录</button><button class="text-button" data-action="export-previous">导出上次恢复前的副本</button><button class="text-button" data-action="export-identity-original">导出动作关联修复前的副本</button>${repo.loadError?'<button class="outline wide" data-action="export-raw">导出当前原始文件</button>':''}<input id="import-file" type="file" accept="application/json,.json" hidden><p class="footnote">支持 Rain Lift 网页版及原生版 JSON 备份。导入会先保留一份本机副本，再替换当前数据。</p></section><p class="footnote">Rain Lift · 网页版 1.5<br>无需开发者签名。建议从主屏幕使用，并保留相同网址。</p>`;}
function download(raw,name){const blob=new Blob([raw],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);}
function extraAction(a,b){
 if(a==='app-update'){checkAppUpdate(true);}
 else if(a==='app-reload'){reloadApp();}
 else if(a==='history-resolve'){identityResolver(b.dataset.id);}
 else if(a==='history-unconfirmed'){historyID=null;view='history';tab='session';render();}
 else if(a==='history-tab'){tab=b.dataset.tab;render();}
 else if(a==='history-session-open'){historyID=null;tab='session';render();document.getElementById?.('history-'+b.dataset.session)?.scrollIntoView?.({block:'start'});}
 else if(a==='history-deleted'){historyID=null;tab='deleted';view='history';render();scrollTo(0,0);}
 else if(a==='history-delete'){deleteHistoryDialog(b.dataset.session);}
 else if(a==='history-restore'){mutate(d=>restoreHistory(d,b.dataset.session),'训练记录已恢复');}
 else if(a==='history-back'){historyID=null;render();}
 else if(a==='history-edit'){const s=db().history.find(s=>s.id===b.dataset.session),m=s.movements.find(m=>m.id===b.dataset.movement);setEditor(m,m.sets.find(x=>x.id===b.dataset.id),s.id);}
 else if(a==='export'){download(JSON.stringify(db(),null,2),'RainLift-'+new Date().toISOString().slice(0,10)+'.json');}
 else if(a==='export-previous'||a==='export-raw'||a==='export-identity-original'){try{const raw=localStorage.getItem(a==='export-raw'?KEY:a==='export-identity-original'?KEY+'.before-identity-repair':KEY+'.before-restore');if(raw)download(raw,'RainLift-'+(a==='export-raw'?'original':a==='export-identity-original'?'before-identity-repair':'before-restore')+'.json');else toast('还没有恢复前的副本');}catch{toast('无法读取本地文件');}}
 else if(a==='import')$('#import-file').click();
 else if(a==='wake')toggleWake();
}
let wakeDesired=false;
async function toggleWake(){if(awake){wakeDesired=false;await awake.release();awake=null;render();return;}if(!navigator.wakeLock){toast('当前浏览器不支持保持屏幕常亮');return;}try{awake=await navigator.wakeLock.request('screen');wakeDesired=true;awake.addEventListener('release',()=>{awake=null;if(view==='settings')render();});render();toast('已保持屏幕常亮');}catch{toast('无法保持常亮，请检查低电量模式和浏览器设置');}}
$('#app').addEventListener('change',async e=>{if(e.target.id!=='import-file')return;const file=e.target.files[0];if(!file)return;try{if(file.size>10*1024*1024)throw Error('文件过大，请选择 10 MB 以内的训练备份。');const data=parseBackup(await file.text());confirmAction('用备份恢复记录？',`备份含 ${data.plans.length} 个计划、${data.history.length} 次历史训练。将替换当前全部记录；原数据会先保留一份本机副本。`,'恢复备份',()=>{try{repo.restore(data);selected=null;historyID=null;announced=null;render();toast('备份已恢复');return true;}catch(err){toast('恢复失败，原数据未改变：'+err.message);return false;}});}catch(err){toast(err.message);}finally{e.target.value='';}});
document.addEventListener('visibilitychange',async()=>{if(document.visibilityState==='visible'&&wakeDesired&&!awake)try{awake=await navigator.wakeLock.request('screen');awake.addEventListener('release',()=>{awake=null;});}catch{}});
function updateStatus(){
 const status=$('#update-state');if(status)status.textContent=updateState;
 const offline=$('#offline-state');if(offline)offline.textContent=offlineReady?'已就绪':'准备中，请保持联网';
 const notice=$('#update-notice');if(notice)notice.innerHTML=updateAvailable?'<aside class="update-notice"><span>新版已就绪</span><button class="primary" data-action="app-reload">刷新到新版</button></aside>':'';
}
function prepareOffline(){
 if(!offlineSetup)offlineSetup=(async()=>{
  serviceRegistration=await navigator.serviceWorker.register('./sw.js',{updateViaCache:'none'});
  await navigator.serviceWorker.ready;offlineReady=true;updateStatus();
  navigator.storage?.persist?.().catch(()=>{});
  return serviceRegistration;
 })().catch(err=>{offlineSetup=null;throw err;});
 return offlineSetup;
}
async function checkAppUpdate(manual=false){
 if(!('serviceWorker' in navigator)){if(manual)toast('当前浏览器不支持离线更新');return;}
 if(!navigator.onLine){if(manual)toast('请联网后检查更新');return;}
 if(updateChecking||(!manual&&Date.now()-lastUpdateCheck<60000))return;
 updateChecking=true;lastUpdateCheck=Date.now();updateState='正在检查更新…';updateStatus();
 try{
  const registration=await prepareOffline();await registration.update();
  updateState=updateAvailable?'新版已就绪，请点“刷新到新版”':registration.installing?'正在下载新版，完成后会提示刷新':'已完成检查；有新版时会提示刷新';
 }catch{updateState='检查失败，请联网后重试';if(manual)toast(updateState);}
 finally{updateChecking=false;updateStatus();}
}
function reloadApp(){
 if($('#modal').open){toast('请先保存或关闭正在编辑的内容，再刷新');return;}
 try{
  const weight=$('#weight'),note=$('#note');
  if(db().active&&(weight||note))repo.change(d=>{
   if(weight){const raw=weight.value,v=Number(raw);if(raw.trim()===''||!Number.isFinite(v)||v<0||v>10000)throw Error('请先填写有效重量，再刷新');d.active.movements.find(x=>x.id===movement().id).overrideWeight=v;}
   if(note)d.active.note=note.value;
  });
  window.location.reload();
 }catch(err){toast('未刷新：'+err.message);}
}
$('#update-notice')?.addEventListener('click',e=>{if(e.target.closest('[data-action]')?.dataset.action==='app-reload')reloadApp();});
if('serviceWorker' in navigator){
 let controlled=!!navigator.serviceWorker.controller;
 navigator.serviceWorker.addEventListener('controllerchange',()=>{
  if(controlled){updateAvailable=true;updateState='新版已就绪，请点“刷新到新版”';}
  controlled=true;offlineReady=true;updateStatus();
 });
 window.addEventListener('load',async()=>{try{await prepareOffline();await checkAppUpdate();}catch{updateState='离线准备失败，请联网后重试';updateStatus();}});
 window.addEventListener('online',()=>checkAppUpdate());
 document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')checkAppUpdate();});
}
if(document.modelContext?.registerTool){const lifecycle=new AbortController();const tools=[{name:'read_training_state',description:'查看当前训练、动作及已记录的组；不修改数据。',inputSchema:{type:'object',properties:{},additionalProperties:false},annotations:{readOnlyHint:true},execute:async()=>structuredClone({active:db().active,rest:db().rest})},{name:'record_training_set',description:'完成并保存当前选中动作的一组，自动开始休息计时。',inputSchema:{type:'object',properties:{reps:{type:'integer',minimum:1,maximum:999},weight:{type:'number',minimum:0,maximum:10000}},required:['reps','weight'],additionalProperties:false},annotations:{readOnlyHint:false},execute:async input=>{if(!movement()||!Number.isInteger(input?.reps)||input.reps<1||input.reps>999||typeof input.weight!=='number'||!Number.isFinite(input.weight)||input.weight<0||input.weight>10000)throw Error('需要当前训练动作和有效的重量、次数。');const result=repo.change(d=>record(d,movement().id,input.reps,input.weight));render();return {id:result.id,weight:result.weight,reps:result.reps};}}];for(const t of tools)try{Promise.resolve(document.modelContext.registerTool(t,{signal:lifecycle.signal})).catch(()=>{});}catch{}window.addEventListener('pagehide',()=>lifecycle.abort(),{once:true});}
