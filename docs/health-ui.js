import {HEALTH_KEY,HEALTH_MAX_BYTES,HealthRepository,parseHealthImport,healthSummary,healthRecordKey} from './health.js?v=1.7';
import {generateAIReport,reportToText} from './ai-report.js?v=1.7';

const labels={steps:'步数',sleep:'有效睡眠',resting_heart_rate:'静息心率',hrv:'HRV（SDNN）',workout:'运动时长'};
const units={count:'步',min:'分钟',bpm:'次/分',ms:'毫秒'};
const stages={asleep:'睡着（阶段未知）',core:'核心睡眠',deep:'深度睡眠',rem:'REM',awake:'清醒',in_bed:'在床',unspecified:'未知状态'};

// Local-only UI: no network capability or AI credentials are used here.
export function createHealthUI({storage,training,trainingError,esc,fmt,showDialog,confirmAction,toast,render,download,go,query,navigator}){
 let health=new HealthRepository(storage),report=null,recordPage=0;
 const timestamp=value=>new Date(value).toLocaleString('zh-CN',{timeZone:health.db.timeZone,hour12:false});
 const fail=error=>toast('健康数据操作失败，训练记录未改变：'+error.message);
 const refresh=()=>{health=new HealthRepository(storage);};
 const metricText=m=>`${labels[m.type]??m.type}：${m.value==null?'暂无可靠汇总':fmt(m.value)+' '+(units[m.unit]??m.unit)} · ${m.source}${m.stages&&Object.keys(m.stages).length?' · 分期 '+Object.entries(m.stages).map(([stage,value])=>(stages[stage]??stage)+' '+fmt(value)+' 分钟').join(' / '):''}${m.notes.length?'（'+m.notes.join('；')+'）':''}`;
 function page(){
  const summary=healthSummary(health.db),records=[...health.db.records].sort((a,b)=>Date.parse(b.end)-Date.parse(a.end));
  const pages=Math.max(1,Math.ceil(records.length/20));recordPage=Math.min(recordPage,pages-1);
  const recent=records.slice(recordPage*20,(recordPage+1)*20);
  return `<button class="text-button" data-action="health-back">‹ 设置</button><p class="eyebrow">本机健康数据 · 手动分析</p><h1>健康与 AI</h1>${health.loadError?`<aside class="warning">${esc(health.loadError)}</aside>`:''}<section class="settings-card"><h2>Apple Health JSON</h2><p>通过 iPhone 快捷指令导出规范 JSON，再选择文件。先预览，确认后保存到本机。</p><div class="status-row"><b>上次导入</b><span>${health.db.lastImportAt?esc(timestamp(health.db.lastImportAt)):'尚未导入'}</span></div><p class="footnote">${records.length} 条记录 · 时区 ${esc(health.db.timeZone)}<br>2 MiB 以内，最多 10,000 条。健康备份与训练备份分别导出。</p><button class="primary wide" data-action="health-import" ${health.writable?'':'disabled'}>导入 Apple Health JSON</button><input id="health-import-file" type="file" accept="application/json,.json" hidden><button class="outline wide" data-action="health-export" ${health.writable?'':'disabled'}>导出健康数据</button>${health.loadError?'<button class="outline wide" data-action="health-export-raw">导出健康原始文件</button>':''}<p class="footnote">本功能不会连接 Apple Health、Apple Watch 或 GPT。数据不会自动上传。不同网址的本机数据独立。</p></section><section class="settings-card"><h2>最近 7 天趋势</h2><p class="footnote">含今天的自然日；来源分别展示，不跨来源相加。今天可能未完整。睡眠按同源连通片段的结束日归属，缺口两侧不推测为同一夜；滚动 24 小时数据仅列在原始记录中。</p>${summary.days.slice().reverse().map(day=>`<div class="health-day"><h3>${esc(day.date)}</h3>${Object.keys(labels).map(type=>{const metrics=day.metrics.filter(m=>m.type===type);return metrics.length?metrics.map(m=>`<p>${esc(metricText(m))}</p>`).join(''):`<p>${labels[type]}：暂无数据</p>`;}).join('')}</div>`).join('')}${summary.warnings.length?`<aside class="warning">${summary.warnings.map(esc).join('<br>')}</aside>`:''}</section><section class="settings-card"><h2>生成 AI 分析报告</h2><p>整理最近 7 天的实际训练和健康记录。先查看内容，再自行复制到 ChatGPT。报告不会发送给任何服务。</p><button class="primary wide" data-action="health-report">生成 AI 分析报告</button><p class="footnote">已记组数不等于有效刺激组数；组间记录间隔不等于实际休息。疲劳、酸痛与恢复量表尚未采集。</p></section><section class="settings-card"><h2>健康记录与来源</h2><p class="footnote">逐条查看导入原值。删除前请先导出健康备份；删除后可从备份重新导入。</p>${recent.length?recent.map(r=>`<article class="health-record"><b>${esc(labels[r.type]??r.type)} · ${fmt(r.value)} ${esc(units[r.unit]??r.unit)}</b><p>${esc(r.source.name)}${r.source.bundleId?' · '+esc(r.source.bundleId):''}<br>${esc(r.start)} → ${esc(r.end)}<br>${esc(r.timeZone??health.db.timeZone)} · ${esc(r.aggregation)}${r.stage?' · '+esc(stages[r.stage]):''}${r.workoutType?' · '+esc(r.workoutType):''}${r.heartRate?'<br>运动心率 '+esc(JSON.stringify(r.heartRate)):''}</p><button class="danger" data-action="health-delete" data-id="${esc(healthRecordKey(r))}">删除这条数据</button></article>`).join(''):'<p>暂无数据</p>'}${pages>1?`<div class="row"><button class="outline" data-action="health-prev" ${recordPage?'':'disabled'}>上一页</button><span>${recordPage+1} / ${pages}</span><button class="outline" data-action="health-next" ${recordPage<pages-1?'':'disabled'}>下一页</button></div>`:''}</section>`;
 }
 async function importFile(file){
  if(!file)return;
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
   refresh();if(health.loadError||trainingError())throw Error(health.loadError||trainingError());
   report=generateAIReport(training(),health.db);
   const text=reportToText(report);
   showDialog('AI 分析报告 · 本地预览',`<p class="footnote">确认报告内容后，自行粘贴到 ChatGPT。没有自动发送。导出的 JSON 也是分析材料，不是训练或健康恢复备份。</p><textarea id="health-report-text" aria-label="AI 分析报告" readonly rows="14">${esc(text)}</textarea><button type="button" class="primary wide" data-modal="copy">一键复制</button><button type="button" class="outline wide" data-modal="json">导出报告 JSON</button><button type="button" class="outline wide" data-modal="text">导出纯文本</button>`,null,{
    copy:async()=>{try{if(!navigator.clipboard?.writeText)throw Error('请长按报告文本，全选后复制');await navigator.clipboard.writeText(text);toast('报告已复制，请自行粘贴到 ChatGPT');}catch{toast('无法自动复制，请长按报告文本，全选后复制');}},
    json:()=>download(JSON.stringify(report,null,2),'RainLift-AI-'+new Date().toISOString().slice(0,10)+'.json'),
    text:()=>download(text,'RainLift-AI-'+new Date().toISOString().slice(0,10)+'.txt','text/plain;charset=utf-8')
   });
  }catch(error){fail(error);}
 }
 function action(name,button){
  if(!name.startsWith('health-'))return false;
  if(name==='health-open'){refresh();go('health');}
  else if(name==='health-back')go('settings');
  else if(name==='health-import')query('#health-import-file')?.click();
  else if(name==='health-report')reportDialog();
  else if(name==='health-next'||name==='health-prev'){recordPage+=name==='health-next'?1:-1;recordPage=Math.max(0,recordPage);render();}
  else if(name==='health-delete')confirmAction('删除这条健康数据？','仅删除选中的本机健康记录。请先导出健康备份；可从备份重新导入。','删除这条',()=>{try{refresh();health.remove([button.dataset.id]);report=null;render();toast('健康数据已删除');}catch(error){fail(error);return false;}});
  else if(name==='health-export'||name==='health-export-raw'){
   try{refresh();const raw=name==='health-export-raw'?storage.getItem(HEALTH_KEY):JSON.stringify(health.export(),null,2);if(raw==null)throw Error('没有可导出的健康原始文件');download(raw,'RainLift-health'+(name.endsWith('-raw')?'-raw':'')+'.json');}catch(error){fail(error);}
  }
  return true;
 }
 return {page,action,importFile,refresh};
}
