import {KEY,TRAINING_V2_KEY,uid,exercise,initial,validate,parseBackup,identityConflict,identityNames,splitExerciseIdentity,confirmExerciseIdentity,reviseExercise,previous,suggested,start,record,removeSet,finish,deleteHistory,restoreHistory,remaining,findSet,Repository} from './data.js?v=1.9.1';
import {createHealthUI} from './health-ui.js?v=1.9.1';
import {createBodyUI,prepareStorage} from './body-ui.js?v=1.9.1';
import {SET_TYPES,effortLabel,performanceCountText,performanceDetails,setPerformance,setTypeOf,trainingSetCounts} from './performance.js?v=1.9.1';
import {recordsPanel} from './records-ui.js?v=1.9.1';
import {DEFAULT_REP_RANGE,LOOKBACK_DAYS,recommendProgression,validateProgression} from './progression.js?v=1.9.1';

const APP_VERSION='1.9.1';
const store=prepareStorage(localStorage);
const isIPhone=/\biPhone\b/.test(navigator.userAgent??'');
const clockShortcutName='Rain Lift 组间休息';
const $=s=>document.querySelector(s),esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmt=n=>Number(n).toLocaleString('zh-CN',{maximumFractionDigits:2}),date=n=>new Date(n).toLocaleDateString('zh-CN',{month:'long',day:'numeric'});
let repo;try{repo=new Repository(store);}catch{repo={db:initial(),writable:false,loadError:'浏览器存储不可用，请退出无痕浏览或检查浏览器设置。',change(){throw Error(this.loadError);}};}
let view='today',selected=null,historyID=null,tab='exercise',lastTap=0,audio,awake=null,offlineReady=false;
let nextSet=null;
const initialRecordsFilter={range:'30',group:null,metric:'load',weight:null};
const recordFields={'record-range':'range','record-group':'group','record-metric':'metric','record-weight':'weight'};
let recordsFilter={...initialRecordsFilter};
let serviceRegistration=null,offlineSetup=null,updateAvailable=false,reloading=false,lastUpdateCheck=0,updateChecking=false,updateState='联网后可检查更新';
const healthUI=createHealthUI({storage:store,profile:()=>bodyUI.profile(),openModernSession:id=>bodyUI.sessionDialog(id),training:()=>repo.db,trainingError:()=>repo.loadError,esc,fmt,showDialog,confirmAction,toast,render,download,go:next=>{view=next;render();scrollTo(0,0);},query:$,navigator});
const db=()=>repo.db,movement=()=>db().active?.movements.find(m=>m.id===selected)??db().active?.movements[0];
const bodyUI=createBodyUI({storage:store,rawStorage:localStorage,training:db,metadata:()=>healthUI.getMetadata(),change:mutate,preserve:preserveTrainingInputs,showDialog,confirmAction,toast,render,download,go:next=>{view=next;render();scrollTo(0,0);},query:$,onRestored:()=>{repo=new Repository(store);healthUI.refresh();selected=null;nextSet=null;historyID=null;announced=null;render();},esc,fmt});
// Names follow one identity across current references; completed sessions remain snapshots.
function syncExerciseName(d,e){
 if(identityConflict(d,e.id))throw Error('请先整理这个动作的旧历史关联。');
 const refs=[...d.plans.flatMap(p=>p.exercises),...(d.active?.movements.map(m=>m.exercise)??[])].filter(x=>x.id===e.id),names=[...new Set([e.name,...(e.knownNames??[]),...refs.flatMap(x=>[x.name,...(x.knownNames??[])])])];
 for(const x of refs){x.name=e.name;x.knownNames=[...names];}
 if(d.rest&&d.active?.movements.some(m=>m.exercise.id===e.id&&m.sets.some(s=>s.id===d.rest.setID)))d.rest.name=e.name;
}
function exerciseName(id,fallback='动作历史'){return db().active?.movements.find(m=>m.exercise.id===id)?.exercise.name??db().plans.flatMap(p=>p.exercises).find(e=>e.id===id)?.name??[...db().history].sort((a,b)=>b.started-a.started).flatMap(s=>s.movements).find(m=>m.exercise.id===id)?.exercise.name??fallback;}
const icons={today:'<path d="M4 8v8m4-11v14m8-14v14m4-11v8M8 12h8"/>',history:'<path d="M4 20V4m0 16h17M8 15l4-5 4 3 5-8"/>',settings:'<path d="M4 7h16M4 17h16"/><circle cx="9" cy="7" r="3"/><circle cx="15" cy="17" r="3"/>'};
const icon=n=>`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[n]||''}</svg>`;
function toast(s){$('#toast').textContent=s;$('#toast').classList.add('visible');clearTimeout(toast.timer);toast.timer=setTimeout(()=>$('#toast').classList.remove('visible'),3000);}
function mutate(fn,message,identityRepair=false){try{if(identityRepair&&!repo.writable)throw Error(repo.loadError);const result=identityRepair?repo.repairIdentity(fn):repo.change(fn);render();if(message)toast(message);return result??true;}catch(e){toast(e.name==='QuotaExceededError'?'空间不足，未保存。请先导出备份并释放空间。':e.message);return false;}}
function unlockAudio(){try{audio??=new (window.AudioContext||window.webkitAudioContext)();if(audio.state==='suspended')audio.resume().catch(()=>{});}catch{}}
function beep(){try{if(audio?.state==='running'){const o=audio.createOscillator(),g=audio.createGain();o.connect(g);g.connect(audio.destination);o.frequency.value=740;g.gain.setValueAtTime(.15,audio.currentTime);g.gain.exponentialRampToValueAtTime(.001,audio.currentTime+.5);o.start();o.stop(audio.currentTime+.5);}}catch{}}
function render(){
 const active=db().active;
 if(nextSet&&(nextSet.sessionID!==active?.id||nextSet.movementID!==movement()?.id))nextSet=null;
 $('#app').innerHTML=`<header class="top"><a href="#" data-action="nav" data-view="today" aria-label="返回训练首页">RAIN<span>/</span>LIFT</a><span id="connection-state" class="local-status">${navigator.onLine?'本机保存':'离线模式'}</span></header><main>${repo.loadError?`<aside class="warning">${esc(repo.loadError)}</aside>`:''}${view==='today'?(active?training():today()):view==='history'?history():view==='health'?healthUI.page():view==='body'?bodyUI.page():settings()}</main>${active&&db().rest?restPanel():''}<nav class="bottom" aria-label="主导航">${[['today','训练'],['history','历史'],['settings','设置']].map(([id,label])=>`<button data-action="nav" data-view="${id}" class="${view===id?'active':''}" ${view===id?'aria-current="page"':''}>${icon(id)}<span>${label}</span></button>`).join('')}</nav>`;
 document.body.classList.toggle('has-timer',!!(active&&db().rest));updateClock();reloadWhenIdle();
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
function today(){return `<div class="page-heading"><div><p class="eyebrow">${date(Date.now())} · 今天</p><h1>今天练什么？</h1></div><button class="icon-button" data-action="plan-new" aria-label="创建计划">＋</button></div>${identityWarnings()}<button class="outline wide" data-action="profile-open">身体档案 / 修改体重</button><div class="plans">${db().plans.map((p,i)=>`<article class="plan-card"><div class="plan-index">PLAN / ${String(i+1).padStart(2,'0')}</div><div class="row"><h2>${esc(p.name)}</h2><button class="icon-button" data-action="plan-edit" data-id="${p.id}" aria-label="编辑${esc(p.name)}">···</button></div><p class="muted">${p.exercises.length} 个动作 <span class="sep">/</span> ${p.exercises.reduce((a,e)=>a+e.target,0)} 组</p><div class="plan-exercises">${p.exercises.map(e=>`<span>${esc(e.name)}</span>`).join('')}</div><button class="primary wide" data-action="start" data-id="${p.id}" ${p.exercises.length?'':'disabled'}>开始训练 <span>↗</span></button></article>`).join('')}</div><button class="outline wide" data-action="plan-new">＋ 创建训练计划</button><p class="footnote">示例计划可修改。完成一组，点一下次数就记好了。</p>${!matchMedia('(display-mode: standalone)').matches?'<aside class="install-note"><b>像 App 一样打开</b><p>在 iPhone Safari 中点“分享” → “添加到主屏幕”。首次联网打开后，等待设置页显示“离线已就绪”。</p></aside>':''}`;}
const effortDisplay=()=>db().effortDisplay??'rpe';
const nextPerformance=()=>({setType:nextSet?.setType??'normal',toFailure:nextSet?.toFailure??false,effort:null});
const suggestedWeight=(d,m)=>bodyUI.suggested(d,m,nextPerformance().setType);
const groupLabel=set=>SET_TYPES[setTypeOf(set)]??'未分类';
const weightHint=source=>source==='default'?'暂无同类型重量，请确认本组重量。':'';

function nextSetControls(){
 const {setType,toFailure}=nextPerformance();
 const typeButtons=Object.entries(SET_TYPES).map(([type,label])=>
  `<button data-action="next-set-type" data-type="${type}" aria-pressed="${type===setType}">${label}</button>`).join('');
 return `<div class="next-set-controls" role="group" aria-label="下一组标记">${typeButtons}<button data-action="next-set-failure" aria-pressed="${toFailure}">力竭</button></div>`;
}

function setDetails(set){
 const details=performanceDetails(set);
 if(!details)return '';
 const labels=[];
 if(details.setType)labels.push(SET_TYPES[details.setType]);
 if(details.toFailure)labels.push('力竭');
 const mode=effortDisplay();
 if(mode!=='off'){
  if(details.effort)labels.push(effortLabel(details.effort,mode));
  if(details.effortNeedsConfirmation)labels.push('评分待确认');
 }
 return labels.length?`<small class="set-performance">${labels.join(' · ')}</small>`:'';
}

function setCounts(sets){
 if(!sets.length)return '';
 const counts=trainingSetCounts(sets);
 return `<p class="footnote set-counts">总记录 ${counts.totalRecordedSets} 组 · ${performanceCountText(counts,effortDisplay()!=='off')}</p>`;
}

function saveTrainingSet(m,reps,weight,timed,performance){
 const draft=nextSet;
 nextSet=null;
 const saved=mutate(d=>{
  const set=bodyUI.record(d,m.id,reps,weight,timed,performance);
  const current=d.active.movements.find(item=>item.id===m.id);
  // The manual draft has been recorded. Subsequent defaults come from the
  // new set of the same type, without carrying its weight into other types.
  delete current.overrideMode;
  delete current.overrideWeight;
  return set;
 });
 if(!saved)nextSet=draft;
 return saved;
}

const progressionReasons={
 identity:'动作归属还需核对。',unsupported_mode:'目前只对明确的外部负重动作给出建议。',skipped:'本次已跳过这个动作。',
 duplicate_action:'同次训练有多个同动作条目，先保留当前设置。',different_next_set:'普通工作组才使用这项建议。',
 invalid_weight:'请先输入有效重量。',latest_not_working:'最近一组需要是明确的普通工作组。',
 invalid_set:'最近记录的时间、重量或次数无效。',different_load:'记录的单位或负重模式与当前不同。',
 different_weight:'记录重量与当前输入不同。',failure:'证据中有力竭标记。',stale_effort:'记录条件变了，评分需要重新确认。',
 no_effort:'缺少强度评分。',bounded_effort:'RIR 5+ 是范围评分，当前规则需要精确评分。',
 high_effort:'已记录的强度超过建议增加训练量的条件。',different_target:'记录使用了不同的目标组数或次数范围。',
 below_range:'上一组次数还没到目标下限。',at_rep_limit:'上一组已到次数上限，本次先保持重量。',
 no_current_working_set:'当前组记录还不足以确认加重适用。',few_sessions:'需要至少两次已完成的同动作训练。',
 old_history:`最近两次训练需在过去 ${LOOKBACK_DAYS} 天内。`,too_few_sets:'最近一次或两次训练的普通组数还没到目标。',
 no_target_snapshot:'最近两次训练需有记组时保存的目标。',below_session_limit:'最近两次的普通组还没全部达到次数上限。',
 weight_limit:'再增加一个步长会超出可用重量范围。'
};

function progressionFor(d,m,weight){
 if(!m?.exercise.progression?.enabled)return null;
 const next=nextPerformance();
 return recommendProgression(d,m,{mode:bodyUI.mode(m,d.active),weight,now:Date.now(),
  identityUncertain:identityConflict(d,m.exercise.id),nextSetType:next.setType,nextToFailure:next.toFailure});
}

function progressionToken(d,m,proposal){
 return proposal?.kind==='increase'?JSON.stringify([d.active.id,m.id,m.exercise.id,m.exercise.unit,
  proposal.fromWeight,proposal.weight,proposal.sessionIDs]):'';
}

function progressionContent(m,weight){
 const proposal=progressionFor(db(),m,weight);
 if(!proposal)return '';
 const unit=esc(m.exercise.unit),{minReps,maxReps}=m.exercise.progression;
 let content;
 if(proposal.kind==='reps'){
  const mode=effortDisplay(),effort=mode==='off'?'强度符合建议条件':effortLabel({kind:'exact',rpe:proposal.rpe},mode);
  content=`<strong>保持 ${fmt(proposal.weight)} ${unit}，尝试 ${proposal.reps} 次</strong><p>上一普通组 ${proposal.previousReps} 次，${effort}。</p>`;
 }else if(proposal.kind==='increase'){
  const token=progressionToken(db(),m,proposal);
  content=`<strong>本次可试 ${fmt(proposal.weight)} ${unit}</strong><p>最近两次训练都在 ${fmt(proposal.fromWeight)} ${unit} 达到组数和次数目标，评分符合条件。</p>
   <button class="outline progression-apply" data-action="progression-apply" data-suggestion="${esc(token)}">采用建议重量</button>`;
 }else{
  content=`<p>${progressionReasons[proposal.reason]}</p>`;
 }
 return `<small>渐进建议 · 目标 ${minReps}–${maxReps} 次</small>${content}`;
}

function setWeightOverride(d,movementID,mode,weight){
 const current=d.active?.movements.find(item=>item.id===movementID);
 if(!current)throw Error('找不到这个动作，请重新打开训练。');
 current.overrideMode=mode;
 current.overrideWeight=weight;
}

function adoptProgression(m,token){
 const input=$('#weight');
 if(!input||!m||!token||!preserveTrainingInputs())return;
 const weight=input.value.trim()===''?NaN:Number(input.value);
 mutate(d=>{
  const current=d.active?.movements.find(item=>item.id===m.id);
  const proposal=progressionFor(d,current,weight);
  if(!current||proposal?.kind!=='increase'||progressionToken(d,current,proposal)!==token){
   throw Error('建议条件已变化，已保留当前输入。');
  }
  setWeightOverride(d,current.id,bodyUI.mode(current,d.active),proposal.weight);
 },'建议重量已填入');
}

function previousWeights(m){
 if(identityConflict(db(),m.exercise.id))return identityWarning(m.exercise.id);
 const prior=previous(db(),m.exercise.id,m.exercise.unit);
 if(!prior)return '<p class="muted">第一次记录，从今天开始。</p>';
 const session=db().history.find(item=>item.movements.includes(prior));
 return `<div class="last-sets">${prior.sets.map((set,index)=>{
  const label=groupLabel(set);
  const use=session&&bodyUI.canReuseWeight(m,prior,set)
   ?`<button class="text-button" data-action="use-history-weight" data-session="${esc(session.id)}" data-movement="${esc(prior.id)}" data-id="${esc(set.id)}" aria-label="填入上次第 ${index+1} 组${label}重量">填入重量</button>`:'';
  return `<div><small>第 ${index+1} 组 · ${label}</small><b>${esc(bodyUI.setText(set,m.exercise.unit))} <span>× ${set.reps}</span></b>${use}</div>`;
 }).join('')}</div>`;
}

function useHistoryWeight(m,{session,movement,id}){
 if(!m||!preserveTrainingInputs())return;
 const ref={sessionID:session,movementID:movement,setID:id};
 let label,weight;
 const saved=mutate(d=>{
  const current=d.active?.movements.find(item=>item.id===m.id);
  if(!current||!d.history.some(item=>item.id===session))throw Error('找不到这组历史记录。');
  const {movement:prior,set}=findSet(d,ref);
  if(!bodyUI.canReuseWeight(current,prior,set))throw Error('历史组的动作、单位或负重模式与当前不同。');
  label=groupLabel(set);weight=set.weight;
  setWeightOverride(d,current.id,bodyUI.mode(current,d.active),weight);
 });
 if(saved)toast(`已填入上次${label}组的重量 · ${fmt(weight)} ${m.exercise.unit}`);
}

function training(){
 const s=db().active,m=movement(),setType=nextPerformance().setType;
 const counts=m?trainingSetCounts(m.sets):null;
 const suggestion=m?bodyUI.recommendation(db(),m,setType):null;
 return `<div class="row"><p class="eyebrow">${esc(s.name)}</p><button class="text-button" data-action="manage">调整动作</button></div><div class="exercise-tabs" aria-label="本次动作">${s.movements.map(x=>`<button data-action="select" data-id="${x.id}" class="${x.id===m?.id?'selected':''}">${x.skipped?'跳过 · ':''}${esc(x.exercise.name)}${x.sets.length?` <small>${x.sets.length}</small>`:''}</button>`).join('')}</div>${m?`<div class="training-heading"><h1>${esc(m.exercise.name)}</h1><div class="row"><span class="muted">已完成 <b class="accent">${counts.normal}</b> / ${m.exercise.target} 个普通工作组</span><span class="badge">下一组 · ${SET_TYPES[setType]} ${String(counts[setType]+1).padStart(2,'0')}</span></div></div>${bodyUI.panel(m)}<section class="record-card"><label for="weight" class="weight-label">${bodyUI.mode(m)==='bodyweight_plus_extra'?'额外负重':'本组重量'} <span>${esc(m.exercise.unit)}</span></label><div class="weight-control"><button data-action="weight-minus" aria-label="减少重量">−</button><input id="weight" data-load-mode="${bodyUI.mode(m)}" inputmode="decimal" type="number" min="0" max="10000" step="any" value="${suggestion.weight}" aria-label="${bodyUI.mode(m)==='bodyweight_plus_extra'?'额外负重':'本组重量'}"><button data-action="weight-plus" aria-label="增加重量">＋</button></div>${bodyUI.reference(m,suggestion.weight)}${weightHint(suggestion.source)?`<p class="footnote weight-hint">${weightHint(suggestion.source)}</p>`:''}${m.exercise.progression?.enabled?`<aside id="progression-panel" class="progression-panel" aria-label="渐进建议">${progressionContent(m,suggestion.weight)}</aside>`:''}${nextSetControls()}<div class="reps-buttons">${m.exercise.reps.map(r=>`<button data-action="record" data-reps="${r}" aria-label="完成${r}次"><strong>${r}</strong><span>次 · 完成</span></button>`).join('')}</div><button class="other-button" data-action="set-new">其他次数 / 补录</button></section><section class="previous"><div class="row"><h2>上次表现</h2><button class="text-button" data-action="history-open" data-id="${m.exercise.id}">查看历史</button></div>${previousWeights(m)}</section><section><div class="row section-heading"><h2>本次记录 <span class="count">${m.sets.length}</span></h2>${m.sets.length?'<button class="text-button" data-action="undo">撤销上一组</button>':''}</div>${setCounts(m.sets)}${m.sets.length?`<div class="set-list">${m.sets.map((x,i)=>`<button class="set-row" data-action="set-edit" data-id="${x.id}"><span class="set-number">${String(i+1).padStart(2,'0')}</span><b>${x.load?esc(bodyUI.setText(x,m.exercise.unit)):fmt(x.weight)+' <small>'+esc(m.exercise.unit)+'</small>'}${setDetails(x)}</b><span>× ${x.reps} 次</span><span class="edit-label">修改</span></button>`).join('')}</div>`:'<div class="empty-small">完成一组后，点上方次数按钮。</div>'}</section>`:'<div class="empty"><h1>添加今天的动作</h1><button class="primary" data-action="manage">选择动作</button></div>'}<button class="outline wide" data-action="session-bodyweight">${s.loadSchemaVersion===1?'本次参考体重':'本次体重 / 自重加重'}</button><label class="note-label" for="note">训练备注 <span>选填</span></label><textarea id="note" rows="2" maxlength="10000" placeholder="今天的状态、器械差异…">${esc(s.note)}</textarea><div class="row end-row"><span class="muted">共 ${s.movements.reduce((a,m)=>a+m.sets.length,0)} 组</span><button class="outline" data-action="finish">结束训练</button></div>`;}
function restPanel(){
 const {active,rest}=db();
 const matches=active.movements.filter(m=>m.sets.some(set=>set.id===rest.setID));
 const m=matches.length===1?matches[0]:null;
 const action=m?`<button class="rest-performance" data-action="rest-performance" data-session="${esc(active.id)}" data-movement="${esc(m.id)}" data-id="${esc(rest.setID)}">${effortDisplay()==='off'?'标记本组':`补记 ${effortDisplay().toUpperCase()}`}</button>`:'';
 return `<aside class="rest-panel" aria-label="组间休息"><div class="row"><div><b id="rest-title">组间休息</b><small>${esc(db().rest.name)}</small></div><strong id="clock" aria-live="off">00:00</strong></div><div class="rest-actions"><button data-action="rest-minus">−15 秒</button><button data-action="rest-plus">＋15 秒</button><button data-action="rest-end">结束休息</button></div>${isIPhone?'<button id="island-start" class="island-start" data-action="island-start" disabled>灵动岛提醒 ↗</button>':''}${action}</aside>`;
}
function startClockTimer(seconds){
 window.location.href=`shortcuts://run-shortcut?name=${encodeURIComponent(clockShortcutName)}&input=text&text=${seconds}`;
}
function clockTimerSetup(){
 showDialog('灵动岛提醒设置',`<ol><li>在 iPhone 的「快捷指令」中，新建并命名为「${clockShortcutName}」。</li><li>添加「从输入中获取数字」，把输入设为「快捷指令输入」。</li><li>添加「开始计时」（Start Timer），单位选「秒」，长按时长数值并选上一步输出的数字。</li></ol><p>设置好后，训练中记完一组，点「灵动岛提醒」即可把当时的剩余秒数交给系统时钟。</p><p class="muted">系统时钟会独立计时。若在 Rain Lift 调整或提前结束休息，请到「时钟 → 计时器」处理已启动的提醒。</p><button type="button" class="outline wide" data-modal="test">试跑 10 秒</button>`,null,{
  test:()=>{$('#modal').close();startClockTimer(10);}
 });
}
let announced=null;
function updateClock(){
 const rest=db().rest;
 if(!rest)return;
 const seconds=remaining(rest),clock=$('#clock'),title=$('#rest-title'),islandButton=$('#island-start');
 if(clock)clock.textContent=`${String(Math.floor(seconds/60)).padStart(2,'0')}:${String(seconds%60).padStart(2,'0')}`;
 if(title)title.textContent=seconds?'组间休息':'休息结束';
 if(islandButton)islandButton.disabled=seconds===0;
 if(seconds===0&&announced!==rest.setID){
  announced=rest.setID;
  if(document.visibilityState==='visible'){beep();toast('休息结束，准备下一组');}
 }
}


function showDialog(title,content,submit,handlers={}){const d=$('#modal');if(d.open)d.close();d.innerHTML=`<form><header><h2>${esc(title)}</h2><button type="button" data-modal="close" class="icon-button" aria-label="关闭">×</button></header><div class="dialog-body">${content}</div>${submit?'<footer><button type="submit" class="primary wide">保存</button></footer>':''}</form>`;d.querySelector('form').addEventListener('submit',e=>{e.preventDefault();submit?.(new FormData(e.target));});d.querySelector('[data-modal="close"]').onclick=()=>d.close();for(const b of d.querySelectorAll('[data-modal]'))if(handlers[b.dataset.modal])b.onclick=()=>handlers[b.dataset.modal](b);d.showModal();}
function confirmAction(title,body,yes,action){showDialog(title,`<p>${esc(body)}</p><button type="button" class="primary wide" data-modal="confirm">${esc(yes)}</button><button type="button" class="outline wide" data-modal="cancel">取消</button>`,null,{confirm:()=>{if(action()!==false)$('#modal').close();},cancel:()=>$('#modal').close()});}
// Reorder identities, never rebuild movements or their recorded sets.
function moveToPosition(items,id,position){
 const from=items.findIndex(x=>x.id===id),to=Number(position)-1;
 if(from<0)throw Error('找不到这个动作，请重新打开调整顺序。');
 if(!Number.isInteger(to)||to<0||to>=items.length)throw Error('请选择有效的目标位置。');
 if(from!==to)items.splice(to,0,items.splice(from,1)[0]);
}
function orderEditor(items,id,name,save,back){
 const current=items.findIndex(x=>x.id===id);
 showDialog('调整顺序',`<p><b>${esc(name)}</b> · 当前第 ${current+1} 位</p><label>移动到<select name="position">${items.map((_,i)=>`<option value="${i+1}" ${i===current?'selected':''}>移动到第 ${i+1} 位${i===items.length-1?'（最后一位）':''}</option>`).join('')}</select></label><p class="footnote">其他动作保持原来的相对顺序。</p><button type="button" class="outline wide" data-modal="back">取消 / 返回</button>`,fd=>{
  try{if(save(Number(fd.get('position')))!==false)back();}catch(err){toast(err.message);}
 },{back});
}
// Opening the manager can precede change/blur on iPhone. Save legal pending
// input first, and pin the fallback selection before any array order changes.
function preserveTrainingInputs(){
 const m=movement(),weight=$('#weight'),note=$('#note');
 if(!db().active)return false;
 try{
  let value;if(weight){if(weight.dataset.loadMode&&weight.dataset.loadMode!==bodyUI.mode(m)){render();throw Error('动作负重类型已变化，请确认新模式的重量。');}const raw=weight.value;value=Number(raw);if(raw.trim()===''||!Number.isFinite(value)||value<0||value>10000)throw Error('请先填写 0–10000 之间的有效重量，再调整动作。');}
  if(note&&note.value.length>10000)throw Error('训练备注不能超过 10000 字。');
  if((weight&&m&&value!==suggestedWeight(db(),m))||(note&&note.value!==db().active.note))repo.change(d=>{
   if(weight&&m)setWeightOverride(d,m.id,bodyUI.mode(m),value);
   if(note)d.active.note=note.value;
  });
  if(m)selected=m.id;
  return true;
 }catch(err){toast(err.message);return false;}
}
function planEditor(plan){
 const saveName=()=>{plan.name=$('#modal [name="planName"]').value.trim()||'新计划';};
 showDialog('编辑计划',`<label>计划名称<input name="planName" value="${esc(plan.name)}" required maxlength="100"></label><p class="muted">动作与顺序 · 调整后点保存，已有训练记录保留。</p><div class="editor-list">${plan.exercises.map((e,i)=>`<div class="editor-item"><div><b>${i+1}. ${esc(e.name)}</b><small>${e.target} 组 · 休息 ${e.rest} 秒</small></div><div class="mini-actions"><button type="button" data-modal="edit-${i}">设置</button><button type="button" data-modal="order-${i}" aria-label="调整${esc(e.name)}的顺序">调整顺序</button><button type="button" data-modal="up-${i}" aria-label="上移动作" ${i===0?'disabled':''}>↑</button><button type="button" data-modal="down-${i}" aria-label="下移动作" ${i===plan.exercises.length-1?'disabled':''}>↓</button><button type="button" data-modal="remove-${i}" aria-label="从计划移除${esc(e.name)}">移除</button></div></div>`).join('')}</div><button class="outline wide" type="button" data-modal="add">＋ 添加动作</button>${db().plans.some(p=>p.id===plan.id)?'<button class="danger wide" type="button" data-modal="delete">删除计划</button>':''}`,fd=>{
 plan.name=String(fd.get('planName')).trim();if(mutate(d=>{const i=d.plans.findIndex(p=>p.id===plan.id),renamed=plan.exercises.filter(e=>d.plans[i]?.exercises.some(old=>old.id===e.id&&old.name!==e.name));if(i<0)d.plans.push(plan);else d.plans[i]=plan;for(const e of renamed)syncExerciseName(d,e);},'计划已保存'))$('#modal').close();
 },{
 add:()=>{saveName();exerciseEditor(exercise(),e=>{plan.exercises.push(e);planEditor(plan);},()=>planEditor(plan));},
 delete:()=>confirmAction('删除这个计划？','已有训练记录会保留。','删除计划',()=>mutate(d=>{d.plans=d.plans.filter(p=>p.id!==plan.id);},'计划已删除')),
 ...Object.fromEntries(plan.exercises.flatMap((e,i)=>[
 [`edit-${i}`,()=>{saveName();exerciseEditor(structuredClone(e),v=>{plan.exercises[i]=v;planEditor(plan);},()=>planEditor(plan));}],
 [`order-${i}`,()=>{saveName();orderEditor(plan.exercises,e.id,e.name,position=>moveToPosition(plan.exercises,e.id,position),()=>planEditor(plan));}],
 [`remove-${i}`,()=>{saveName();plan.exercises.splice(i,1);planEditor(plan);}],
 [`up-${i}`,()=>{saveName();[plan.exercises[i-1],plan.exercises[i]]=[plan.exercises[i],plan.exercises[i-1]];planEditor(plan);}],
 [`down-${i}`,()=>{saveName();[plan.exercises[i+1],plan.exercises[i]]=[plan.exercises[i],plan.exercises[i+1]];planEditor(plan);}]
 ]))
 });
}
function progressionSettings(e){
 const {enabled,minReps,maxReps}=e.progression??DEFAULT_REP_RANGE;
 return `<details class="progression-settings" ${enabled?'open':''}><summary>渐进建议（选填）</summary>
  <label class="check-label"><input type="checkbox" name="progressionEnabled" ${enabled?'checked':''}>启用这个动作的渐进建议</label>
  <div class="form-grid"><label>目标次数下限<input name="progressionMin" type="number" inputmode="numeric" min="1" max="999" value="${minReps}"></label>
  <label>目标次数上限<input name="progressionMax" type="number" inputmode="numeric" min="1" max="999" value="${maxReps}"></label></div>
  <p class="footnote">次数范围用于建议。目标组数和三个次数快捷键在上方分别设置。</p></details>`;
}

function exerciseEditor(e,save,back){if(identityConflict(db(),e.id)){identityResolver(e.id);return;}showDialog('动作设置',`<label>动作名称<input name="name" value="${esc(e.name)}" required maxlength="100"></label><p class="footnote">修改名称会延续这个动作的全部历史。不同动作请返回后选择“创建新动作”。</p><div class="form-grid"><label>初始重量<input name="weight" type="number" inputmode="decimal" min="0" max="10000" step="any" value="${e.weight}" required></label><label>单位<input name="unit" maxlength="20" value="${esc(e.unit)}"></label><label>加减步长<input name="step" type="number" inputmode="decimal" min=".01" max="1000" step="any" value="${e.step}" required></label><label>目标普通工作组数<input name="target" type="number" inputmode="numeric" min="1" max="99" value="${e.target}" required></label></div><label>每组休息（秒）<input name="rest" type="number" inputmode="numeric" min="15" max="3600" value="${e.rest}" required></label><p class="muted">三个次数快捷键 · 请填写不同次数</p><div class="form-grid three">${e.reps.map((n,i)=>`<label>按钮 ${i+1}<input name="r${i}" type="number" inputmode="numeric" min="1" max="999" value="${n}" required></label>`).join('')}</div>${progressionSettings(e)}<p class="footnote">哑铃记单只还是总重量，由你自己约定；自重可填 0。</p><button type="button" class="outline wide" data-modal="back">返回</button>`,fd=>{
 const updated={...e,name:String(fd.get('name')).trim(),unit:String(fd.get('unit')),weight:+fd.get('weight'),step:+fd.get('step'),target:+fd.get('target'),rest:+fd.get('rest'),reps:[0,1,2].map(i=>+fd.get('r'+i))};
 if(new Set(updated.reps).size!==3){toast('三个快捷次数不能相同');return;}
 try{
  if(fd.has('progressionEnabled')){
   updated.progression={enabled:true,minReps:Number(fd.get('progressionMin')),maxReps:Number(fd.get('progressionMax'))};
   validateProgression(updated.progression);
  }else if(e.progression)updated.progression={...e.progression,enabled:false};
  save(reviseExercise(db(),e,updated));
 }catch(err){toast(err.message);}
 },{back});}
function performanceFields(values){
 const {setType,toFailure,effort}=values,mode=effortDisplay();
 const typeOptions=[['','未分类'],...Object.entries(SET_TYPES)].map(([value,label])=>
  `<option value="${value}" ${(setType??'')===value?'selected':''}>${label}</option>`).join('');
 const fields=`<label>组类型<select name="setType">${typeOptions}</select></label>
  <label class="check-label"><input type="checkbox" name="toFailure" ${toFailure?'checked':''}>标记力竭</label>`;
 if(mode==='off')return fields;
 const scores=Array.from({length:11},(_,i)=>({kind:'exact',rpe:mode==='rir'?10-i/2:5+i/2}));
 scores.push({kind:'at_most',rpe:5});
 const options=scores.map(score=>{
  const value=score.kind==='at_most'?'bound':score.rpe;
  const selected=effort?.kind===score.kind&&effort.rpe===score.rpe;
  return `<option value="${value}" ${selected?'selected':''}>${effortLabel(score,mode)}</option>`;
 }).join('');
 return fields+`<label>${mode.toUpperCase()}（选填）<select name="effort"><option value="">未评分</option>${options}</select></label>${effort?'<label class="check-label"><input type="checkbox" name="confirmEffort">确认这个评分适用于保存后的重量、次数及参考体重</label>':''}`;
}

function performanceInput(fd,prior){
 if(!fd.has('setType'))return prior;
 const raw=fd.get('effort');
 const effort=raw===null?prior.effort:raw===''?null:raw==='bound'?{kind:'at_most',rpe:5}:{kind:'exact',rpe:Number(raw)};
 return {setType:fd.get('setType')||null,toFailure:fd.has('toFailure'),effort};
}

function unchangedSet(d,ref,expected,unit){
 const found=findSet(d,ref);
 if(found.movement.exercise.unit!==unit||JSON.stringify(found.set)!==JSON.stringify(expected)){
  throw Error('这组记录已修改，请重新打开后操作。');
 }
 return found;
}

function annotateSet(ref){
 const {movement:m,set}=findSet(db(),ref);
 const prior=set.performance??{setType:null,toFailure:false,effort:null};
 const stale=effortDisplay()!=='off'&&performanceDetails(set)?.effortNeedsConfirmation;
 showDialog('补记这组',`<p class="muted">${esc(m.exercise.name)} · ${esc(bodyUI.setText(set,m.exercise.unit))} × ${set.reps} 次</p>${stale?'<p class="footnote">记录条件已变化，原评分待确认。</p>':''}${performanceFields(prior)}`,fd=>{
  if(mutate(d=>setPerformance(unchangedSet(d,ref,set,m.exercise.unit).set,performanceInput(fd,prior),fd.has('confirmEffort')),'组标记已保存'))$('#modal').close();
 });
}

function setEditor(m,entry,sessionID=null){
 const ref=entry?{sessionID:sessionID??db().active.id,movementID:m.id,setID:entry.id}:null;
 const prior=entry?(entry.performance??{setType:null,toFailure:false,effort:null}):nextPerformance();
 const prefill=entry?null:bodyUI.recommendation(db(),m,prior.setType);
 const extra=(entry?(entry.load?.mode??'legacy'):bodyUI.mode(m))==='bodyweight_plus_extra';
 const stale=entry&&effortDisplay()!=='off'&&performanceDetails(entry)?.effortNeedsConfirmation;
 const bodyWeight=entry?.load?.mode==='bodyweight_plus_extra'
  ?`<label>本组参考体重 · kg（留空为未知）<input name="bodyWeight" type="number" inputmode="decimal" min="0.01" max="1000" step="0.01" value="${entry.load.bodyWeightKg??''}"></label>`:'';
 const timing=entry?'<p class="footnote">修改记录不会启动新的休息计时。</p><button type="button" class="danger wide" data-modal="delete">删除这一组</button>'
  :'<label class="check-label"><input type="checkbox" name="timed" checked>完成后开始休息</label><p class="footnote">补录之前的组时，关闭此开关。</p>';
 showDialog(entry?'修改这一组':'记录一组',`<p class="muted">${esc(m.exercise.name)}</p>
  <div class="form-grid"><label>${extra?'额外负重':entry&&!entry.load?'原记录重量':'重量'} · ${esc(m.exercise.unit)}<input name="weight" type="number" inputmode="decimal" min="0" max="10000" step="any" value="${entry?.weight??prefill.weight}" required></label>
  <label>实际次数<input name="reps" type="number" inputmode="numeric" min="1" max="999" value="${entry?.reps??m.exercise.reps[1]}" required></label></div>${bodyWeight}
  ${stale?'<p class="footnote">记录条件已变化，原评分待确认。</p>':''}${performanceFields(prior)}${entry?'':`<p class="footnote weight-hint" data-weight-hint>${weightHint(prefill.source)}</p>`}${timing}`,fd=>{
  if(String(fd.get('weight')??'').trim()===''||String(fd.get('reps')??'').trim()===''){toast('重量和次数不能为空');return;}
  const weight=Number(fd.get('weight')),reps=Number(fd.get('reps')),performance=performanceInput(fd,prior);
  if(!entry){
   unlockAudio();
   if(saveTrainingSet(m,reps,weight,fd.has('timed'),performance)){$('#modal').close();toast('记录已保存');}
   return;
  }
  if(mutate(d=>{
   const {set,movement}=unchangedSet(d,ref,entry,m.exercise.unit);
   const raw=String(fd.get('bodyWeight')??'').trim(),bw=raw===''?null:Number(raw);
   if(weight!==set.weight||reps!==set.reps||(extra&&bw!==set.load.bodyWeightKg)){
    bodyUI.editSet(set,weight,reps,movement.exercise.unit,raw);
   }
   setPerformance(set,performance,fd.has('confirmEffort'));
  },'记录已保存'))$('#modal').close();
 },{delete:()=>{
  if(mutate(d=>{unchangedSet(d,ref,entry,m.exercise.unit);removeSet(d,m.id,entry.id,sessionID);},'已删除这一组'))$('#modal').close();
 }});
 if(!entry){
  const weight=$('#modal [name="weight"]'),type=$('#modal [name="setType"]');
  const hint=$('#modal [data-weight-hint]');
  let manual=prefill.source==='manual';
  weight?.addEventListener('input',()=>{manual=true;if(hint)hint.textContent='';});
  type?.addEventListener('change',()=>{
   if(manual)return;
   const suggested=bodyUI.recommendation(db(),m,type.value||null);
   weight.value=suggested.weight;
   if(hint)hint.textContent=weightHint(suggested.source);
  });
 }
}
function manage(){if(!preserveTrainingInputs())return;const movements=db().active.movements,sessionID=db().active.id;const move=(id,position)=>mutate(d=>{if(d.active?.id!==sessionID)throw Error('当前训练已改变，请重新打开调整动作。');moveToPosition(d.active.movements,id,position);});showDialog('调整本次训练',`<p class="muted">改名会同步到计划，其他调整只影响今天。未记录的动作可移除；已记录的动作可跳过，保留已完成的组。</p><div class="editor-list">${movements.map((m,i)=>`<div class="editor-item"><div><b>${i+1}. ${esc(m.exercise.name)}</b><small>${m.skipped?'已跳过':m.sets.length+' 组已完成'}</small></div><div class="mini-actions"><button type="button" data-modal="edit-${i}">设置</button><button type="button" data-modal="order-${i}" aria-label="调整${esc(m.exercise.name)}的顺序">调整顺序</button><button type="button" data-modal="skip-${i}">${m.skipped?'恢复':'跳过'}</button>${!m.sets.length?`<button type="button" data-modal="replace-${i}">更换</button><button type="button" data-modal="remove-${i}" aria-label="从本次训练移除${esc(m.exercise.name)}">移除</button>`:''}<button type="button" data-modal="up-${i}" ${i===0?'disabled':''} aria-label="上移动作">↑</button><button type="button" data-modal="down-${i}" ${i===movements.length-1?'disabled':''} aria-label="下移动作">↓</button></div></div>`).join('')}</div><button type="button" class="outline wide" data-modal="add">＋ 添加动作</button><button type="button" class="outline wide" data-modal="template">更新固定计划</button>`,()=>$('#modal').close(),{
 add:()=>pickExercise(),template:()=>confirmAction('更新固定计划？','把本次未跳过的动作和顺序保存到原计划，已有历史不变。','更新计划',()=>mutate(d=>{const s=d.active,seen=new Set(),p={id:s.planID,name:s.name,exercises:s.movements.filter(m=>!m.skipped).map(m=>structuredClone(m.exercise)).filter(e=>!seen.has(e.id)&&seen.add(e.id))};const i=d.plans.findIndex(p=>p.id===s.planID);if(i<0)d.plans.push(p);else d.plans[i]=p;},'计划已更新')),
 ...Object.fromEntries(movements.flatMap((m,i)=>[
 [`edit-${i}`,()=>exerciseEditor(structuredClone(m.exercise),e=>{if(mutate(d=>{const x=d.active.movements.find(x=>x.id===m.id);const renamed=x.exercise.name!==e.name;if(x.exercise.id!==e.id)delete x.overrideWeight;x.exercise=e;if(renamed)syncExerciseName(d,e);}))manage();},manage)],
 [`order-${i}`,()=>orderEditor(db().active.movements,m.id,m.exercise.name,position=>move(m.id,position),manage)],
 [`skip-${i}`,()=>{mutate(d=>{d.active.movements[i].skipped=!m.skipped;});manage();}],
 [`replace-${i}`,()=>pickExercise(m.id)],
 [`remove-${i}`,()=>{if(mutate(d=>{const x=d.active.movements.find(x=>x.id===m.id);if(x?.sets.length)throw Error('这个动作已有记录，请使用跳过，保留训练记录。');d.active.movements=d.active.movements.filter(x=>x.id!==m.id);},'已从本次训练移除')){if(selected===m.id)selected=null;manage();}}],
 [`up-${i}`,()=>{const index=db().active.movements.findIndex(x=>x.id===m.id);if(move(m.id,index))manage();}],
 [`down-${i}`,()=>{const index=db().active.movements.findIndex(x=>x.id===m.id);if(move(m.id,index+2))manage();}]
 ]))
 });}
function pickExercise(replaceID=null){const seen=new Set(),library=db().plans.flatMap(p=>p.exercises).filter(e=>{const key=identityConflict(db(),e.id)?JSON.stringify([e.id,e.name]):e.id;return !seen.has(key)&&seen.add(key);});const add=e=>{const conflictID=[e.id,db().active.movements.find(m=>m.id===replaceID)?.exercise.id].find(id=>id&&identityConflict(db(),id));if(conflictID){identityResolver(conflictID);return;}if(mutate(d=>{if(replaceID){const m=d.active.movements.find(m=>m.id===replaceID);m.exercise=structuredClone(e);delete m.overrideWeight;m.skipped=false;}else d.active.movements.push({id:uid(),exercise:structuredClone(e),sets:[],skipped:false});},'动作已更新'))manage();};showDialog(replaceID?'更换动作':'添加动作',`<div class="editor-list">${library.map((e,i)=>`<button class="library-item" type="button" data-modal="choose-${i}">${esc(e.name)}<span>${identityConflict(db(),e.id)?'整理':'＋'}</span></button>`).join('')}</div><button type="button" class="outline wide" data-modal="new">创建新动作</button><button type="button" class="outline wide" data-modal="back">返回</button>`,null,{new:()=>exerciseEditor(exercise(),add,()=>pickExercise(replaceID)),back:manage,...Object.fromEntries(library.map((e,i)=>['choose-'+i,()=>add(e)]))});}

$('#app').addEventListener('click',e=>{const b=e.target.closest('[data-action]');if(!b)return;e.preventDefault();const m=movement(),a=b.dataset.action;
 if(a==='nav'){if(db().active&&!preserveTrainingInputs())return;view=b.dataset.view;historyID=null;render();scrollTo(0,0);}
 else if(a==='start'){if(mutate(d=>bodyUI.start(d,b.dataset.id))){unlockAudio();selected=null;scrollTo(0,0);}}
 else if(a==='select'){if(!preserveTrainingInputs())return;selected=b.dataset.id;render();}
 else if(a==='next-set-type'||a==='next-set-failure'){
  if(!m||!preserveTrainingInputs())return;
  const {setType,toFailure}=nextPerformance();
  nextSet={sessionID:db().active.id,movementID:m.id,setType:a==='next-set-type'?b.dataset.type:setType,toFailure:a==='next-set-failure'?!toFailure:toFailure};
  render();
 }
 else if(a==='record'){
  if(!m||!preserveTrainingInputs()||Date.now()-lastTap<650)return;
  lastTap=Date.now();unlockAudio();
  const saved=saveTrainingSet(m,+b.dataset.reps,suggestedWeight(db(),m),true,nextPerformance());
  if(saved)toast(`第 ${movement().sets.length} 组已保存 · ${fmt(saved.weight)} × ${saved.reps}`);
 }
 else if(a==='rest-performance'){
  if(!preserveTrainingInputs())return;
  const {session:sessionID,movement:movementID,id:setID}=b.dataset;
  if(db().active?.id!==sessionID||db().rest?.setID!==setID){toast('休息对应的组已变化，请重新打开。');return;}
  try{annotateSet({sessionID,movementID,setID});}catch(err){toast(err.message);}
 }
 else if(a==='progression-apply'){adoptProgression(m,b.dataset.suggestion);}
 else if(a==='use-history-weight'){useHistoryWeight(m,b.dataset);}
 else if(a==='weight-minus'||a==='weight-plus'){
  if(!m||!preserveTrainingInputs())return;
  mutate(d=>{
   const change=(a==='weight-plus'?1:-1)*m.exercise.step;
   const weight=Math.max(0,Math.min(10000,Math.round((suggestedWeight(d,m)+change)*100)/100));
   setWeightOverride(d,m.id,bodyUI.mode(m),weight);
  });
 }
 else if(a==='undo'){mutate(d=>removeSet(d,m.id,m.sets.at(-1).id),'已撤销，相关计时已取消');}
 else if(a==='island-start'){
  if(!isIPhone||!remaining(db().rest)||!preserveTrainingInputs())return;
  const seconds=remaining(db().rest);
  if(seconds)startClockTimer(seconds);
  else updateClock();
 }
 else if(a==='island-setup'&&isIPhone)clockTimerSetup();
 else if(a.startsWith('rest-')){unlockAudio();mutate(d=>{if(a==='rest-end'){d.rest=null;return;}if(!d.rest)return;d.rest.end=Math.max(Date.now(),d.rest.end)+(a==='rest-plus'?15000:-15000);if(d.rest.end<=Date.now())d.rest=null;else announced=null;});}
 else if(a==='finish'){
  const count=db().active.movements.reduce((n,m)=>n+m.sets.length,0);
  confirmAction('结束本次训练？',count?`已完成 ${count} 组。历史只保留实际记录过组数的动作。`:'本次还没有记录任何组数，结束后不会生成训练历史。',count?'保存并结束':'结束训练',()=>mutate(finish,count?'训练已保存':'本次训练已结束，未生成历史'));
 }
 else if(a==='plan-new')planEditor({id:uid(),name:'新计划',exercises:[]});
 else if(a==='plan-edit')planEditor(structuredClone(db().plans.find(p=>p.id===b.dataset.id)));
 else if(a==='manage')manage();
 else if(a==='session-bodyweight'){if(preserveTrainingInputs()){if(db().active.loadSchemaVersion===1)bodyUI.sessionDialog(db().active.id);else healthUI.openSessionBodyWeight(db().active.id);}}
 else if(a==='set-new'){if(m&&preserveTrainingInputs())setEditor(m,null);}
 else if(a==='set-edit'){const entry=m?.sets.find(s=>s.id===b.dataset.id);if(entry&&preserveTrainingInputs())setEditor(m,entry);}
 else if(a==='history-open'){
  if(db().active&&!preserveTrainingInputs())return;
  if(historyID!==b.dataset.id)recordsFilter={...initialRecordsFilter};
  historyID=b.dataset.id;view='history';render();scrollTo(0,0);
 }
 else extraAction(a,b);
});

$('#app').addEventListener('input',e=>{
 if(e.target.id!=='weight')return;
 const m=movement(),raw=e.target.value;
 const reference=$('#reference-load');
 if(reference)reference.textContent=bodyUI.referenceText(m,raw);
 const panel=$('#progression-panel');
 if(panel)panel.innerHTML=progressionContent(m,raw.trim()===''?NaN:Number(raw));
});
$('#app').addEventListener('change',e=>{if(e.target.id==='weight'){const raw=e.target.value,v=Number(raw),m=movement();if(raw.trim()===''||!Number.isFinite(v)||v<0||v>10000){toast('请输入 0–10000 之间的重量');render();return;}try{repo.change(d=>setWeightOverride(d,m.id,bodyUI.mode(m),v));}catch(err){toast(err.message);render();}}if(e.target.id==='note')try{repo.change(d=>{d.active.note=e.target.value;});}catch(err){toast(err.message);}});
function connectionStatus(){const status=$('#connection-state');if(status)status.textContent=navigator.onLine?'本机保存':'离线模式';}
setInterval(updateClock,500);window.addEventListener('online',connectionStatus);window.addEventListener('offline',connectionStatus);document.addEventListener('visibilitychange',()=>{
 if(document.visibilityState==='hidden'&&view==='today'&&db().active)preserveTrainingInputs();
 updateClock();
});
window.addEventListener('storage',e=>{if(e.key===KEY||e.key===TRAINING_V2_KEY){try{repo=new Repository(store);render();toast('记录已从另一窗口更新');}catch{toast('另一窗口的数据发生变化，请重新打开页面。');}}});
render();

$('#app').addEventListener('change',event=>{
 const {id,value}=event.target;
 if(view!=='history'||!historyID||!Object.hasOwn(recordFields,id))return;
 const field=recordFields[id];
 recordsFilter[field]=field==='weight'?Number(value):value;
 if(field==='group')recordsFilter.weight=null;
 render();
 $('#'+id)?.focus?.();
});

function history(){
 const sessions=db().history.filter(s=>s.movements.some(m=>m.sets.length)).sort((a,b)=>b.started-a.started);
 if(historyID&&identityConflict(db(),historyID))return `<button class="text-button" data-action="history-back">‹ 全部历史</button><h1>先整理动作关联</h1>${identityWarning(historyID)}<button class="outline wide" data-action="history-unconfirmed">按训练查看原始记录</button>`;
 if(historyID){
  const matched=sessions.filter(s=>s.movements.some(m=>m.exercise.id===historyID&&m.sets.length)),name=exerciseName(historyID);
  const timeZone=Intl.DateTimeFormat().resolvedOptions().timeZone||'UTC';
  const records=recordsPanel(db(),historyID,recordsFilter,{now:Date.now(),timeZone,esc,fmt});
  const entries=matched.length?matched.map(s=>historySession(s,historyID)).join(''):'<div class="empty"><p>还没有已完成的训练记录。</p></div>';
  return `<button class="text-button" data-action="history-back">‹ 全部历史</button><h1>${esc(name)}</h1>${records}${entries}`;
 }
 const seen=new Set(),exercises=sessions.flatMap(s=>s.movements).filter(m=>m.sets.length&&!identityConflict(db(),m.exercise.id)&&!seen.has(m.exercise.id)&&seen.add(m.exercise.id));
 const deleted=[...(db().deletedHistory??[])].sort((a,b)=>b.deletedAt-a.deletedAt);
 return `<p class="eyebrow">每一次训练，都有迹可循</p><h1>训练历史</h1>${identityWarnings()}<div class="segmented"><button data-action="history-tab" data-tab="exercise" class="${tab==='exercise'?'selected':''}">按动作</button><button data-action="history-tab" data-tab="session" class="${tab==='session'?'selected':''}">按训练</button><button data-action="history-tab" data-tab="deleted" class="${tab==='deleted'?'selected':''}">最近删除${deleted.length?` (${deleted.length})`:''}</button></div>${tab==='deleted'?`<p class="footnote">已删除的训练不计入历史和上次表现，可随时恢复。备份也会保留这些记录，不会自动清空。</p>${deleted.length?deleted.map(entry=>historySession(entry.session,null,true)).join(''):'<div class="empty"><p>没有已删除的训练。</p></div>'}`:!sessions.length?'<div class="empty"><h2>还没有完成的训练</h2><p>训练结束后，重量和次数会出现在这里。</p></div>':tab==='session'?sessions.map(s=>historySession(s)).join(''):`<div class="history-list">${exercises.map(m=>`<button data-action="history-open" data-id="${m.exercise.id}" class="history-item"><div><b>${esc(exerciseName(m.exercise.id))}</b><small>${m.sets.map(s=>bodyUI.setText(s,m.exercise.unit)+' × '+s.reps).join(' / ')}</small></div><span>›</span></button>`).join('')}</div>`}`;
}
function historySession(s,exerciseID=null,deleted=false){return `<article class="history-session" id="history-${esc(s.id)}"><div class="row"><h2>${esc(s.name)}</h2><span class="muted">${date(s.started)}</span></div><p class="footnote">${new Date(s.started).toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit'})} · 共 ${s.movements.reduce((n,m)=>n+m.sets.length,0)} 组</p>${s.movements.filter(m=>m.sets.length&&(!exerciseID||m.exercise.id===exerciseID)).map(m=>`<div class="history-movement"><h3>${esc(identityConflict(db(),m.exercise.id)?m.exercise.name:exerciseName(m.exercise.id,m.exercise.name))}${m.skipped?' · 跳过':''}</h3>${setCounts(m.sets)}${m.sets.length?m.sets.map((x,i)=>`<${deleted?'div':'button'} class="set-row" ${deleted?'':`data-action="history-edit" data-session="${esc(s.id)}" data-movement="${esc(m.id)}" data-id="${esc(x.id)}"`}><span class="set-number">${String(i+1).padStart(2,'0')}</span><b>${x.load?esc(bodyUI.setText(x,m.exercise.unit)):fmt(x.weight)+' <small>'+esc(m.exercise.unit)+'</small>'}${setDetails(x)}</b><span>× ${x.reps} 次</span>${deleted?'':'<span class="edit-label">修改</span>'}</${deleted?'div':'button'}>`).join(''):'<p class="muted">未记录组数</p>'}</div>`).join('')}${s.note?`<p class="history-note">${esc(s.note)}</p>`:''}<div class="history-actions">${deleted?`<button class="outline wide" data-action="history-restore" data-session="${esc(s.id)}">恢复这次训练</button>`:exerciseID?`<button class="text-button" data-action="history-session-open" data-session="${esc(s.id)}">查看整次训练 / 删除记录</button>`:`<button class="danger" data-action="history-delete" data-session="${esc(s.id)}">删除这次训练</button>`}</div></article>`;}
function deleteHistoryDialog(id){
 const session=db().history.find(s=>s.id===id);if(!session){toast('找不到这次训练，可能已删除');return;}
 const count=session.movements.reduce((n,m)=>n+m.sets.length,0);
 confirmAction('删除这次训练？',`${date(session.started)} ${new Date(session.started).toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit'})} · ${session.name}，共 ${count} 组。会移除这整次训练的所有动作记录；计划与正在进行的训练保留。误删可到“最近删除”恢复。`,'移入最近删除',()=>mutate(d=>deleteHistory(d,id),'已移入最近删除，可随时恢复'));
}
function settings(){return `<h1>设置</h1>${identityWarnings()}<section class="settings-card"><h2>个人身体档案</h2><p>体重设置后持续使用，想改时再改；身高和性别选填。</p><button class="primary wide" data-action="profile-open">身体档案 / 修改体重</button></section><section class="settings-card"><h2>健康与 AI</h2><p>导入 Apple Health JSON、查看本机趋势，并生成可手动复制到 GPT 的分析报告。</p><button class="primary wide" data-action="health-open">打开健康与 AI</button></section><section class="settings-card"><h2>训练强度</h2><label class="effort-display">评分显示<select id="effort-display">${[['rpe','RPE'],['rir','RIR'],['off','关闭']].map(([value,label])=>`<option value="${value}" ${effortDisplay()===value?'selected':''}>${label}</option>`).join('')}</select></label><p class="footnote">关闭后保留已保存的评分、组类型和力竭标记。</p></section><section class="settings-card"><h2>添加到主屏幕</h2><ol><li>用 iPhone 的 Safari 打开这个链接。</li><li>点“分享”，选择“添加到主屏幕”。</li><li>从主屏幕打开一次，确认下方离线状态。</li></ol><div class="status-row"><b>离线使用</b><span id="offline-state">${offlineReady?'已就绪':'准备中，请保持联网'}</span></div><p class="footnote">添加后先检查记录是否齐全。若 Safari 与主屏幕版本的数据未共享，用导出 / 导入迁移。</p></section><section class="settings-card"><h2>版本与更新</h2><p>当前版本：${APP_VERSION}</p><p class="footnote">当前网址：${esc(window.location?.href??'')}</p><p id="update-state" class="footnote">${esc(updateState)}</p><button class="outline wide" data-action="app-update">检查更新</button><button class="outline wide" data-action="app-reload">刷新页面 / 载入新版</button><p class="footnote">新版下载完成后，回到空闲的训练首页会自动载入。训练或编辑时可继续操作，手动刷新前会保存训练重量和备注。</p></section><section class="settings-card"><h2>休息计时</h2><p>页面打开时倒计时，到点尝试播放提示音。返回页面时会恢复正确剩余时间。</p><aside class="warning"><b>锁屏后不保证提醒</b><p>网页无法在离线锁屏或后台可靠地准时发声。${isIPhone?'可先设置灵动岛提醒，再从组间休息面板启动系统计时。':'如需锁屏提醒，请同时使用手机系统计时器。'}</p></aside>${isIPhone?'<button class="outline wide" data-action="island-setup">灵动岛提醒设置</button>':''}<button class="outline wide" data-action="wake">${awake?'关闭保持屏幕常亮':'训练时保持屏幕常亮'}</button><p class="footnote">需要浏览器支持，可能增加耗电；切到后台后会暂停。</p></section><section class="settings-card"><h2>记录与备份</h2><button class="primary wide" data-action="full-export">导出完整备份（推荐）</button><button class="outline wide" data-action="full-import">恢复完整备份 / 换机</button><button class="text-button" data-action="full-before">导出完整恢复前副本</button><input id="full-import-file" type="file" accept="application/json,.json" hidden><p class="footnote">完整备份含训练、健康、动作类型、身体档案、体重历史及训练快照；组标记与评分可在 1.8.5 或更新版本查看。下面的训练单独备份不包含其他分区。</p><button class="outline wide" data-action="history-deleted">查看最近删除的训练 (${db().deletedHistory?.length??0})</button><p>记录只存在当前设备，不上传训练数据。清除网站数据、移除网页应用或更换手机可能导致丢失，请定期导出。</p><button class="primary wide" data-action="export">导出训练备份</button><button class="outline wide" data-action="import">导入备份 / 迁移原生版记录</button><button class="text-button" data-action="export-previous">导出上次恢复前的副本</button><button class="text-button" data-action="export-identity-original">导出动作关联修复前的副本</button>${repo.loadError?'<button class="outline wide" data-action="export-raw">导出当前原始文件</button>':''}<input id="import-file" type="file" accept="application/json,.json" hidden><p class="footnote">支持 Rain Lift 网页版及原生版 JSON 备份。导入会先保留一份本机副本，再替换当前数据。</p></section><p class="footnote">Rain Lift · 网页版 ${APP_VERSION}<br>无需开发者签名。建议从主屏幕使用，并保留相同网址。</p>`;}
function download(raw,name,type='application/json'){const blob=new Blob([raw],{type}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);}
function extraAction(a,b){
 if(bodyUI.action(a,b))return;
 if(a==='health-open'&&db().active&&!preserveTrainingInputs())return;
 if(healthUI.action(a,b))return;
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
 else if(a==='export-previous'||a==='export-raw'||a==='export-identity-original'){try{const raw=localStorage.getItem(a==='export-raw'?(repo.key??KEY):a==='export-identity-original'?KEY+'.before-identity-repair':KEY+'.before-restore');if(raw)download(raw,'RainLift-'+(a==='export-raw'?'original':a==='export-identity-original'?'before-identity-repair':'before-restore')+'.json');else toast('还没有恢复前的副本');}catch{toast('无法读取本地文件');}}
 else if(a==='import')$('#import-file').click();
 else if(a==='wake')toggleWake();
}
let wakeDesired=false;
async function toggleWake(){if(awake){wakeDesired=false;await awake.release();awake=null;render();return;}if(!navigator.wakeLock){toast('当前浏览器不支持保持屏幕常亮');return;}try{awake=await navigator.wakeLock.request('screen');wakeDesired=true;awake.addEventListener('release',()=>{awake=null;if(view==='settings')render();});render();toast('已保持屏幕常亮');}catch{toast('无法保持常亮，请检查低电量模式和浏览器设置');}}
$('#app').addEventListener('change',async e=>{if(e.target.id==='effort-display'){if(!mutate(d=>{d.effortDisplay=e.target.value;},'强度显示已保存'))e.target.value=effortDisplay();return;}if(e.target.id==='full-import-file'){await bodyUI.importFile(e.target.files?.[0]);e.target.value='';return;}if(e.target.id==='health-import-file'){await healthUI.importFile(e.target.files?.[0]);e.target.value='';return;}if(e.target.id!=='import-file')return;const file=e.target.files[0];if(!file)return;try{if(file.size>10*1024*1024)throw Error('文件过大，请选择 10 MB 以内的训练备份。');const data=parseBackup(await file.text()),expected=bodyUI.fingerprint();confirmAction('用备份恢复记录？',`备份含 ${data.plans.length} 个计划、${data.history.length} 次历史训练。将替换当前全部记录；原数据会先保留一份本机副本。会话内容不匹配的旧负重与体重确认将移到类型恢复前副本；需要保留所有分区时请使用完整备份。`,'恢复备份',()=>{try{bodyUI.restoreTraining(data,expected);toast('备份已恢复');return true;}catch(err){toast('恢复失败，原数据未改变：'+err.message);return false;}});}catch(err){toast(err.message);}finally{e.target.value='';}});
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
  updateState=updateAvailable?'新版已就绪，空闲时回到训练首页自动载入':registration.installing?'正在下载新版，完成后会提示刷新':'已完成检查；有新版时会提示刷新';
 }catch{updateState='检查失败，请联网后重试';if(manual)toast(updateState);}
 finally{updateChecking=false;updateStatus();}
}
function reloadWhenIdle(){
 if(updateAvailable&&view==='today'&&!db().active&&repo.writable&&document.visibilityState==='visible'&&!$('#modal').open){
  reloadApp();
 }
}
function reloadApp(){
 if(reloading)return;
 if($('#modal').open){toast('请先保存或关闭正在编辑的内容，再刷新');return;}
 try{
  if(db().active&&!preserveTrainingInputs())throw Error('请确认重量、负重类型与备注后再刷新。');
  reloading=true;
  window.location.reload();
 }catch(err){reloading=false;toast('未刷新：'+err.message);}
}
$('#update-notice')?.addEventListener('click',e=>{if(e.target.closest('[data-action]')?.dataset.action==='app-reload')reloadApp();});
$('#modal').addEventListener('close',reloadWhenIdle);
if('serviceWorker' in navigator){
 let controlled=!!navigator.serviceWorker.controller;
 navigator.serviceWorker.addEventListener('controllerchange',()=>{
  if(!navigator.serviceWorker.controller)return;
  if(controlled){updateAvailable=true;updateState='新版已就绪，空闲时回到训练首页自动载入';}
  controlled=true;offlineReady=true;updateStatus();reloadWhenIdle();
 });
 window.addEventListener('load',async()=>{try{await prepareOffline();await checkAppUpdate();}catch{updateState='离线准备失败，请联网后重试';updateStatus();}});
 window.addEventListener('online',()=>checkAppUpdate());
 document.addEventListener('visibilitychange',()=>{
  if(document.visibilityState==='visible'){
   reloadWhenIdle();
   if(!reloading)checkAppUpdate();
  }
 });
}
if(document.modelContext?.registerTool){const lifecycle=new AbortController();const tools=[{name:'read_training_state',description:'查看当前训练、动作及已记录的组；不修改数据。',inputSchema:{type:'object',properties:{},additionalProperties:false},annotations:{readOnlyHint:true},execute:async()=>structuredClone({active:db().active,rest:db().rest})},{name:'record_training_set',description:'完成并保存当前选中动作的一组，自动开始休息计时。',inputSchema:{type:'object',properties:{reps:{type:'integer',minimum:1,maximum:999},weight:{type:'number',minimum:0,maximum:10000},extraWeightKg:{type:'number',minimum:0,maximum:10000},mode:{type:'string',enum:['bodyweight_plus_extra','external','assisted','unknown','legacy']}},required:['reps'],additionalProperties:false},annotations:{readOnlyHint:false},execute:async input=>{if(!movement()||!Number.isInteger(input?.reps)||input.reps<1||input.reps>999||!(typeof input.weight==='number'&&Number.isFinite(input.weight)&&input.weight>=0&&input.weight<=10000||typeof input.extraWeightKg==='number'&&Number.isFinite(input.extraWeightKg)&&input.extraWeightKg>=0&&input.extraWeightKg<=10000))throw Error('需要当前训练动作和有效的重量、次数。');const kind=bodyUI.mode(movement());if(kind==='bodyweight_plus_extra'&&(input.mode!==kind||typeof input.extraWeightKg!=='number'))throw Error('自重新模式必须明确 mode 和 extraWeightKg，不能只传 weight。');if(input.mode!==undefined&&input.mode!==kind)throw Error('请求模式与当前动作模式不一致，请确认后重试。');const w=kind==='bodyweight_plus_extra'?input.extraWeightKg:input.weight;const result=repo.change(d=>bodyUI.record(d,movement().id,input.reps,w));render();return {id:result.id,weight:result.weight,reps:result.reps,load:result.load??null};}}];for(const t of tools)try{Promise.resolve(document.modelContext.registerTool(t,{signal:lifecycle.signal})).catch(()=>{});}catch{}window.addEventListener('pagehide',()=>lifecycle.abort(),{once:true});}
