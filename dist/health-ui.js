import {HEALTH_KEY,HEALTH_MAX_BYTES,HealthRepository,parseHealthImport,healthSummary,healthRecordKey} from './health.js?v=1.9.1';
import {generateAIReport,reportToText} from './ai-report.js?v=1.9.1';
import {EXERCISE_META_KEY,EXERCISE_META_MAX_BYTES,LOAD_TYPES,ExerciseMetaRepository,listExerciseLoadSettings,parseExerciseMetaImport,getBulkExternalPreview,getSessionBodyWeight} from './exercise-meta.js?v=1.9.1';

const labels={steps:'步数',sleep:'有效睡眠',resting_heart_rate:'静息心率',hrv:'HRV（SDNN）',workout:'运动时长'};
const units={count:'步',min:'分钟',bpm:'次/分',ms:'毫秒'};
const stages={asleep:'睡着（阶段未知）',core:'核心睡眠',deep:'深度睡眠',rem:'REM',awake:'清醒',in_bed:'在床',unspecified:'未知状态'};

// Local-only UI: no network capability or AI credentials are used here.
export function createHealthUI({storage,profile=()=>null,openModernSession=null,training,trainingError,esc,fmt,showDialog,confirmAction,toast,render,download,go,query,navigator}){
 let health=new HealthRepository(storage),metadata=new ExerciseMetaRepository(storage),report=null,recordPage=0,importKind='health';
 const timestamp=value=>new Date(value).toLocaleString('zh-CN',{timeZone:health.db.timeZone,hour12:false});
 const fail=error=>toast('健康数据操作失败，训练记录未改变：'+error.message);
 const refresh=()=>{health=new HealthRepository(storage);metadata=new ExerciseMetaRepository(storage);};
 const metricText=m=>`${labels[m.type]??m.type}：${m.value==null?'暂无可靠汇总':fmt(m.value)+' '+(units[m.unit]??m.unit)} · ${m.source}${m.stages&&Object.keys(m.stages).length?' · 分期 '+Object.entries(m.stages).map(([stage,value])=>(stages[stage]??stage)+' '+fmt(value)+' 分钟').join(' / '):''}${m.notes.length?'（'+m.notes.join('；')+'）':''}`;
 function page(){
  const summary=healthSummary(health.db),records=[...health.db.records].sort((a,b)=>Date.parse(b.end)-Date.parse(a.end));
  const pages=Math.max(1,Math.ceil(records.length/20));recordPage=Math.min(recordPage,pages-1);
  const recent=records.slice(recordPage*20,(recordPage+1)*20);
  return `<button class="text-button" data-action="health-back">‹ 设置</button><p class="eyebrow">本机健康数据 · 手动分析</p><h1>健康与 AI</h1>${health.loadError?`<aside class="warning">${esc(health.loadError)}</aside>`:''}<section class="settings-card"><h2>Apple Health JSON</h2><p>通过 iPhone 快捷指令导出规范 JSON，再选择文件。先预览，确认后保存到本机。</p><div class="status-row"><b>上次导入</b><span>${health.db.lastImportAt?esc(timestamp(health.db.lastImportAt)):'尚未导入'}</span></div><p class="footnote">${records.length} 条记录 · 时区 ${esc(health.db.timeZone)}<br>2 MiB 以内，最多 10,000 条。健康备份与训练备份分别导出。</p><button class="primary wide" data-action="health-import" ${health.writable?'':'disabled'}>导入 Apple Health JSON</button><input id="health-import-file" type="file" accept="application/json,.json" hidden><button class="outline wide" data-action="health-export" ${health.writable?'':'disabled'}>导出健康数据</button>${health.loadError?'<button class="outline wide" data-action="health-export-raw">导出健康原始文件</button>':''}<p class="footnote">本功能不会连接 Apple Health、Apple Watch 或 GPT。数据不会自动上传。不同网址的本机数据独立。</p></section><section class="settings-card"><h2>最近 7 天趋势</h2><p class="footnote">含今天的自然日；来源分别展示，不跨来源相加。今天可能未完整。睡眠按同源连通片段的结束日归属，缺口两侧不推测为同一夜；滚动 24 小时数据仅列在原始记录中。</p>${summary.days.some(day=>day.metrics.length)?summary.days.filter(day=>day.metrics.length).slice().reverse().map(day=>`<div class="health-day"><h3>${esc(day.date)}</h3>${day.metrics.map(m=>`<p>${esc(metricText(m))}</p>`).join('')}</div>`).join(''):'<p>最近 7 天暂无可用健康数据。</p>'}${summary.warnings.length?`<aside class="warning">${summary.warnings.map(esc).join('<br>')}</aside>`:''}</section><section class="settings-card"><h2>生成 AI 分析报告</h2><p>用全部有效历史分析长期表现，突出最近 7 / 30 天；健康只使用已导入记录。默认精简，可切换详细报告。先审阅，再自行复制到 ChatGPT。</p><button class="primary wide" data-action="health-report">生成 AI 分析报告</button><p class="footnote">已记组数不等于有效刺激组数；组间记录间隔不等于实际休息。疲劳、酸痛与恢复量表尚未采集。</p></section>${metadataCard()}<section class="settings-card"><h2>健康记录与来源</h2><p class="footnote">逐条查看导入原值。删除前请先导出健康备份；删除后可从备份重新导入。</p>${recent.length?recent.map(r=>`<article class="health-record"><b>${esc(labels[r.type]??r.type)} · ${fmt(r.value)} ${esc(units[r.unit]??r.unit)}</b><p>${esc(r.source.name)}${r.source.bundleId?' · '+esc(r.source.bundleId):''}<br>${esc(r.start)} → ${esc(r.end)}<br>${esc(r.timeZone??health.db.timeZone)} · ${esc(r.aggregation)}${r.stage?' · '+esc(stages[r.stage]):''}${r.workoutType?' · '+esc(r.workoutType):''}${r.heartRate?'<br>运动心率 '+esc(JSON.stringify(r.heartRate)):''}</p><button class="danger" data-action="health-delete" data-id="${esc(healthRecordKey(r))}">删除这条数据</button></article>`).join(''):'<p>暂无数据</p>'}${pages>1?`<div class="row"><button class="outline" data-action="health-prev" ${recordPage?'':'disabled'}>上一页</button><span>${recordPage+1} / ${pages}</span><button class="outline" data-action="health-next" ${recordPage<pages-1?'':'disabled'}>下一页</button></div>`:''}</section>`;
 }
 function metadataCard(){
  const items=listExerciseLoadSettings(training(),metadata.db),preview=getBulkExternalPreview(training(),metadata.db);
  return `<section class="settings-card"><h2>动作负重类型</h2><p>大多数动作可一次设为外部负重，少数自重或辅助动作单独调整。类型设置用于后续新组；既有组保留原语义，名称与原始记录保持不变。</p>${metadata.loadError?`<aside class="warning">${esc(metadata.loadError)}</aside>`:''}<button class="primary wide" data-action="health-meta-bulk" ${metadata.writable?'':'disabled'}>一键设置未确认动作</button><p class="footnote">可设置 ${preview.candidates.length} 个；保留已有设置及自重、辅助类型，跳过身份冲突。</p><div class="status-row"><b>未单独设置的动作默认</b><span>${metadata.db.defaultLoadType==='external'?'外部负重':'尚未确认'}</span></div><button class="outline wide" data-action="health-meta-default" ${metadata.writable?'':'disabled'}>${metadata.db.defaultLoadType==='external'?'关闭默认外部负重':'启用默认外部负重'}</button><p class="footnote">默认仅用于未单独设置的动作；显式设置、自重及冲突保护优先。关闭默认不会撤销已经批量保存的类型。</p><div class="editor-list">${items.map((item,index)=>`<div class="editor-item"><div><b>${esc(item.label??item.name)}</b><small>${esc(LOAD_TYPES[item.loadType])} · ${esc(item.unit||'未设置单位')}${item.identityUncertain?' · 请先整理历史关联':''}</small></div><button class="outline" data-action="health-meta-edit" data-index="${index}" ${!metadata.writable||item.identityUncertain?'disabled':''}>设置类型</button></div>`).join('')||'<p>暂无动作</p>'}</div><p class="footnote">自重动作也可额外加重。新版使用档案参考值及组内额外负重；旧版仅按该次明确确认的体重拆分。</p><button class="outline wide" data-action="health-bodyweight-picker" ${metadata.writable?'':'disabled'}>设置某次训练的体重 / 自重加重</button><button class="outline wide" data-action="health-meta-export" ${metadata.writable?'':'disabled'}>导出动作类型备份</button><button class="outline wide" data-action="health-meta-import">导入动作类型备份</button><button class="text-button" data-action="health-meta-previous">导出类型恢复前副本</button>${metadata.loadError?'<button class="outline wide" data-action="health-meta-raw">导出类型原始文件</button>':''}<p class="footnote">动作类型备份包含默认规则和本次体重，包含新版类型快照时请用1.8.2及以上恢复。换设备时，训练、健康和动作类型三份备份分别迁移；推荐在设置中导出完整备份，包含身体档案、新版组语义及全部分区。</p></section>`;
 }
 function bulkMetadataDialog(){
  try{
   refresh();if(!metadata.writable)throw Error(metadata.loadError);
   const preview=getBulkExternalPreview(training(),metadata.db);
   showDialog('一键设置外部负重',`<p>本次将 ${preview.candidates.length} 个未确认动作设为外部负重。保留 ${preview.preservedCount??0} 个已有设置或自重、辅助类型，跳过 ${preview.conflictCount??0} 个身份冲突。</p><p>请先为少数自重或辅助动作设置正确类型，再批量处理其余动作。请核对本次列表，类型不会按名称猜测。</p>${preview.candidates.length?`<details><summary>查看本次全部 ${preview.candidates.length} 个动作</summary><ul>${preview.candidates.map(item=>`<li>${esc(item.label??item.name)}</li>`).join('')}</ul></details>`:''}<label class="check-label"><input type="checkbox" name="defaultForNew" checked>以后未单独设置的动作也默认外部负重</label><p class="footnote">保留显式的“尚未确认”。自重、辅助动作可分别修改；不会改名，不会重写任何训练组。</p><button type="button" class="outline wide" data-modal="cancel">取消</button>`,fd=>{
    try{const result=metadata.setUnconfirmedExternal(training(),{defaultForNew:fd.has('defaultForNew')});report=null;query('#modal').close();render();toast(`已设置 ${result.updated??preview.candidates.length} 个动作，原记录保留`);}catch(error){toast('批量设置未保存：'+error.message);}
   },{cancel:()=>query('#modal').close()});
  }catch(error){toast('无法批量设置：'+error.message);}
 }
 function defaultMetadataDialog(){
  try{
   refresh();if(!metadata.writable)throw Error(metadata.loadError);
   const next=metadata.db.defaultLoadType==='external'?'unknown':'external';
   showDialog(next==='external'?'启用默认外部负重':'关闭默认外部负重',`<p>${next==='external'?'未单独设置的动作默认按外部负重解释。已有自重、辅助、显式未确认和身份冲突保护继续保留。':'未单独设置的动作回到尚未确认。已经单独或批量保存的动作类型不受影响。'}</p><button type="button" class="outline wide" data-modal="cancel">取消</button>`,()=>{
    try{metadata.setDefaultLoadType(next,training());report=null;query('#modal').close();render();toast(next==='external'?'已启用默认外部负重':'已关闭默认外部负重');}catch(error){toast('默认类型未保存：'+error.message);}
   },{cancel:()=>query('#modal').close()});
  }catch(error){toast('无法设置默认类型：'+error.message);}
 }
 function eligibleSessions(){
  const db=training(),now=Date.now();
  return [...(db.active?[db.active]:[]),...(db.history??[]).filter(session=>session.ended!=null&&session.started<=now&&session.ended<=now&&session.movements.some(m=>m.sets.length)).sort((a,b)=>b.started-a.started).slice(0,20)];
 }
 function sessionBodyWeightPicker(){
  const sessions=eligibleSessions();
  showDialog('选择要设置体重的训练',`<p>可选择正在训练或最近20次有效历史。仅对选中的一次训练保存体重，不应用到其他训练或整段历史。</p><div class="editor-list">${sessions.map((session,index)=>`<button type="button" class="library-item" data-modal="session-${index}">${esc(timestamp(session.started))} · ${esc(session.name)}${session.id===training().active?.id?'（正在训练）':''}</button>`).join('')||'<p>暂无可设置的训练</p>'}</div>`,null,Object.fromEntries(sessions.map((session,index)=>['session-'+index,()=>openSessionBodyWeight(session.id)])));
 }
 function openSessionBodyWeight(sessionID){
  try{
   refresh();if(!metadata.writable)throw Error(metadata.loadError);if(trainingError())throw Error(trainingError());
   const db=training(),session=db.active?.id===sessionID?db.active:(db.history??[]).find(item=>item.id===sessionID);
   if(!session)throw Error('这次训练已不存在，请重新选择。');
   if(session.loadSchemaVersion===1&&openModernSession){openModernSession(sessionID);return;}
   const sessionUnits=[...new Set(session.movements.map(m=>m.exercise.unit).filter(unit=>typeof unit==='string'&&unit.trim()))];if(!sessionUnits.length)throw Error('这次训练的动作尚未设置单位，请先确认单位再设置体重。');
   const initialUnit=sessionUnits.includes('kg')?'kg':sessionUnits[0],saved=getSessionBodyWeight(db,sessionID,initialUnit,metadata.db);
   showDialog('本次体重 / 自重加重',`<p>${esc(timestamp(session.started))} · ${esc(session.name)}</p><label>体重单位<select name="bodyUnit">${sessionUnits.map(unit=>`<option value="${esc(unit)}" ${unit===initialUnit?'selected':''}>${esc(unit)}</option>`).join('')}</select></label><label>这次训练已确认的体重<input name="bodyWeight" type="number" inputmode="decimal" min="0.01" max="10000" step="any" value="${saved==null?'':esc(saved)}" placeholder="例如 68" required></label><p>保存即确认：这次训练的自重动作，原记录重量 = 体重 + 额外负重。例如本次体重 68、原记录 73，报告说明额外负重 5。</p><p class="footnote">仅应用这次训练、这个单位，不改原记录或动作名称，不从其他训练复制体重，不换算单位。低于体重的记录只提示核对。</p><button type="button" class="outline wide" data-modal="clear">移除本次这个单位的体重设置</button><button type="button" class="outline wide" data-modal="cancel">取消</button>`,fd=>{
    try{const raw=String(fd.get('bodyWeight')??'').trim(),weight=Number(raw);if(!raw||!Number.isFinite(weight)||weight<=0||weight>10000)throw Error('请填写 0–10000 之间的有效体重（不含 0）。');metadata.setSessionBodyWeight(training(),sessionID,String(fd.get('bodyUnit')),weight);report=null;query('#modal').close();render();toast('本次体重已保存，仅用于这次训练的解释');}catch(error){toast('体重设置未保存：'+error.message);}
   },{
    clear:()=>{try{metadata.setSessionBodyWeight(training(),sessionID,String(query('#modal [name="bodyUnit"]').value),null);report=null;query('#modal').close();render();toast('已移除本次体重设置，原记录保留');}catch(error){toast('体重设置未移除：'+error.message);}},
    cancel:()=>query('#modal').close()
   });
   query('#modal [name="bodyUnit"]')?.addEventListener('change',()=>{const unit=query('#modal [name="bodyUnit"]').value,value=getSessionBodyWeight(training(),sessionID,unit,metadata.db);query('#modal [name="bodyWeight"]').value=value==null?'':String(value);});
  }catch(error){toast('无法设置本次体重：'+error.message);}
 }
 function metadataEditor(index){
  try{
   refresh();if(!metadata.writable)throw Error(metadata.loadError);
   const item=listExerciseLoadSettings(training(),metadata.db)[Number(index)];if(!item)throw Error('找不到这个动作，请重新打开页面。');
   showDialog('设置动作负重类型',`<p>${esc(item.label??item.name)} · ${esc(item.unit||'未设置单位')}</p><label>负重类型<select name="loadType">${Object.entries(LOAD_TYPES).map(([value,label])=>`<option value="${value}" ${item.loadType===value?'selected':''}>${esc(label)}</option>`).join('')}</select></label><p class="footnote">新版自重组只输入额外负重，采用固定体重快照。旧记录只按明确确认的本次体重解释。类型更改用于后续新组；辅助负重表示外部帮助，无法确认可保留尚未确认。</p>`,fd=>{
    try{metadata.set(training(),{id:item.exerciseID??item.id,unit:item.unit,name:item.name},String(fd.get('loadType')));report=null;query('#modal').close();render();toast('动作负重类型已保存');}catch(error){toast('动作类型未保存：'+error.message);}
   });
  }catch(error){toast('无法设置动作类型：'+error.message);}
 }
 async function importMetadata(file){
  try{
   if(file.size>EXERCISE_META_MAX_BYTES)throw Error('动作类型文件超过 512 KiB。');
   const parsed=parseExerciseMetaImport(await file.text());refresh();
   showDialog('预览动作类型恢复',`<p>文件含 ${parsed.entries.length} 条动作类型设置、${parsed.bodyweightSessions?.length??0} 条训练体重设置；未单独设置的动作默认：${parsed.defaultLoadType==='external'?'外部负重':'尚未确认'}。确认后替换上述独立设置，并保存恢复前副本；不会改变训练或健康记录。仅相同身份的设置可用于分析，冲突动作继续受到保护。</p><button type="button" class="primary wide" data-modal="confirm">确认恢复动作类型</button><button type="button" class="outline wide" data-modal="cancel">取消</button>`,null,{
    confirm:()=>{try{metadata.restore(parsed,training());report=null;query('#modal').close();render();toast('动作类型备份已恢复');}catch(error){toast('动作类型恢复失败：'+error.message);}},cancel:()=>query('#modal').close()
   });
  }catch(error){toast('动作类型导入失败：'+error.message);}
 }
 async function importFile(file){
  if(!file)return;
  if(importKind==='metadata'){await importMetadata(file);return;}
  try{
   if(file.size>HEALTH_MAX_BYTES)throw Error('文件超过 2 MiB，请按较短日期范围分别导出。');
   const parsed=parseHealthImport(await file.text());refresh();
   const preview=health.preview(parsed);
   showDialog('预览健康数据导入',`<p>文件 ${esc(file.name??'JSON')}<br>时区：${esc(parsed.timeZone)}<br>新增 ${preview.added} 条 · 重复 ${preview.duplicates} 条 · 保存后 ${preview.total} 条</p><p>类型：${Object.entries(labels).map(([type,label])=>label+' '+parsed.records.filter(r=>r.type===type).length+' 条').join(' · ')}</p><p>来源：${[...new Set(parsed.records.map(r=>r.source.name))].map(esc).join('、')||'无数据'}</p><p>覆盖范围：${parsed.records.length?esc([...parsed.records].map(r=>r.start).sort((a,b)=>Date.parse(a)-Date.parse(b))[0])+' → '+esc([...parsed.records].map(r=>r.end).sort((a,b)=>Date.parse(b)-Date.parse(a))[0]):'无数据'}</p><p>重叠范围 ${preview.overlaps} 处。不同来源保留各自记录；不明确的汇总不会伪装成总量。</p>${preview.warnings.length?`<aside class="warning">${preview.warnings.map(esc).join('<br>')}</aside>`:''}<button type="button" class="primary wide" data-modal="confirm">确认保存到本机</button><button type="button" class="outline wide" data-modal="cancel">取消</button>`,null,{
    confirm:()=>{try{refresh();const result=health.import(parsed);report=null;query('#modal').close();render();toast(`已保存 ${result.added} 条，跳过 ${result.duplicates} 条重复数据`);}catch(error){fail(error);}},
    cancel:()=>query('#modal').close()
   });
  }catch(error){fail(error);}
 }
 function reportDialog(){
  try{
   refresh();if(health.loadError||metadata.loadError||trainingError())throw Error(health.loadError||metadata.loadError||trainingError());
   report=generateAIReport(training(),health.db,{metadata:metadata.db,profile:profile()});
   const compact=reportToText(report);
   const preview=(detailed=false)=>{
    const text=reportToText(report,{detailed});
    showDialog('AI 分析报告 · 本地预览',`<p class="footnote">${detailed?'详细分析报告':'精简 GPT 报告（默认）'} · 本机生成，审阅后自行发送。JSON 单独导出，仅供分析，不是恢复备份。</p><div class="row"><button type="button" class="outline" data-modal="compact">精简 GPT 报告</button><button type="button" class="outline" data-modal="detail">详细分析报告</button></div><textarea id="health-report-text" aria-label="AI 分析报告" readonly rows="14">${esc(text)}</textarea><button type="button" class="primary wide" data-modal="copy">一键复制精简报告</button><button type="button" class="outline wide" data-modal="text">导出${detailed?'详细':'精简'} TXT</button><button type="button" class="outline wide" data-modal="json">独立导出详细 JSON</button>`,null,{
     compact:()=>preview(false),detail:()=>preview(true),
     copy:async()=>{try{if(!navigator.clipboard?.writeText)throw Error('请长按报告文本，全选后复制');await navigator.clipboard.writeText(compact);toast('精简报告已复制，请自行粘贴到 ChatGPT');}catch{toast('无法自动复制，请切到精简报告后长按文本复制');}},
     json:()=>download(JSON.stringify(report,null,2),'RainLift-AI-'+new Date().toISOString().slice(0,10)+'.json'),
     text:()=>download(text,'RainLift-AI-'+(detailed?'detailed-':'compact-')+new Date().toISOString().slice(0,10)+'.txt','text/plain;charset=utf-8')
    });
   };preview();
  }catch(error){fail(error);}
 }
 function action(name,button){
  if(!name.startsWith('health-'))return false;
  if(name==='health-open'){refresh();go('health');}
  else if(name==='health-back')go('settings');
  else if(name==='health-import'){importKind='health';query('#health-import-file')?.click();}
  else if(name==='health-meta-import'){importKind='metadata';query('#health-import-file')?.click();}
  else if(name==='health-meta-edit')metadataEditor(button.dataset.index);
  else if(name==='health-meta-bulk')bulkMetadataDialog();
  else if(name==='health-meta-default')defaultMetadataDialog();
  else if(name==='health-bodyweight-picker')sessionBodyWeightPicker();
  else if(name==='health-meta-export'||name==='health-meta-raw'||name==='health-meta-previous'){
   try{refresh();const raw=name==='health-meta-export'?JSON.stringify(metadata.export(),null,2):storage.getItem(name==='health-meta-previous'?EXERCISE_META_KEY+'.before-restore':metadata.key);if(raw==null)throw Error('还没有可导出的动作类型副本');download(raw,'RainLift-exercise-types'+(name==='health-meta-previous'?'-before-restore':name==='health-meta-raw'?'-raw':'')+'.json');}catch(error){toast('动作类型导出失败：'+error.message);}
  }
  else if(name==='health-report')reportDialog();
  else if(name==='health-next'||name==='health-prev'){recordPage+=name==='health-next'?1:-1;recordPage=Math.max(0,recordPage);render();}
  else if(name==='health-delete')confirmAction('删除这条健康数据？','仅删除选中的本机健康记录。请先导出健康备份；可从备份重新导入。','删除这条',()=>{try{refresh();health.remove([button.dataset.id]);report=null;render();toast('健康数据已删除');}catch(error){fail(error);return false;}});
  else if(name==='health-export'||name==='health-export-raw'){
   try{refresh();const raw=name==='health-export-raw'?storage.getItem(HEALTH_KEY):JSON.stringify(health.export(),null,2);if(raw==null)throw Error('没有可导出的健康原始文件');download(raw,'RainLift-health'+(name.endsWith('-raw')?'-raw':'')+'.json');}catch(error){fail(error);}
  }
  return true;
 }
 return {page,action,importFile,refresh,openSessionBodyWeight,getMetadata(){refresh();if(!metadata.writable)throw Error(metadata.loadError);return metadata.db;}};
}
