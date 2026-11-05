import {RECORD_RANGES,deriveExerciseRecords,recordDayLabel,recordSeries} from './records.js?v=1.8.6';

const exclusionLabels={
  unclassified:'未分类',warmup:'热身',drop:'递减',unknownLoad:'负重含义未确认',missingBodyWeight:'缺少本组参考体重',
  invalid:'无效记录',future:'未来记录',outside:'范围外',active:'进行中',deleted:'最近删除'
};
const modes={external:'外部负重',assisted:'辅助负重',bodyweight_plus_extra:'自重＋额外负重'};

function lineChart(series,firstDay,lastDay,{esc,fmt,label,scatter}){
  const rows=series.filter(row=>row.points.length);
  if(!rows.length)return '<p class="muted">所选指标暂无可用数据。</p>';
  let low=Infinity,high=-Infinity;
  for(const row of rows)for(const {value} of row.points){low=Math.min(low,value);high=Math.max(high,value);}
  const x=day=>firstDay===lastDay?185:64+(day-firstDay)/(lastDay-firstDay)*264;
  const y=value=>low===high?65:106-(value-low)/(high-low)*82;
  const points=[],lines=[];
  let previous=null;
  for(const row of rows){
    for(const point of row.points)points.push(`<circle cx="${x(row.day)}" cy="${y(point.value)}" r="3.2"/>`);
    if(!scatter&&previous&&row.day===previous.day+1){
      lines.push(`<path d="M${x(previous.day)} ${y(previous.points[0].value)}L${x(row.day)} ${y(row.points[0].value)}"/>`);
    }
    previous=row;
  }
  const dateTicks=firstDay===lastDay?`<text x="185" y="139" text-anchor="middle">${recordDayLabel(firstDay)}</text>`
    :`<text x="64" y="139">${recordDayLabel(firstDay)}</text><text x="328" y="139" text-anchor="end">${recordDayLabel(lastDay)}</text>`;
  const yTicks=low===high?`<text x="58" y="68" text-anchor="end">${fmt(low)}</text>`
    :`<text x="58" y="27" text-anchor="end">${fmt(high)}</text><text x="58" y="109" text-anchor="end">${fmt(low)}</text>`;
  return `<svg class="record-chart" viewBox="0 0 340 150" role="img" aria-label="${esc(label)}趋势图，逐日数据见下方">
    <path class="record-axis" d="M64 20V113H328"/><g class="record-line">${lines.join('')}</g>
    <g class="record-points">${points.join('')}</g><g class="record-ticks">${dateTicks}${yTicks}</g>
  </svg>`;
}

export function recordsPanel(training,exerciseID,filters,{now,timeZone,esc,fmt}){
  const {range,firstDay,lastDay,groups,excluded}=deriveExerciseRecords(training,exerciseID,{range:filters.range,now,timeZone});
  const group=groups.find(item=>item.key===filters.group)??groups.find(item=>item.mode==='external')??groups[0];
  const unit=group?.unit||'无单位';
  const weightText=weight=>`${fmt(weight)} ${unit}`;
  const labels=group?{
    load:group.mode==='assisted'?'辅助重量记录':group.mode==='bodyweight_plus_extra'?'每日最高额外负重':'每日最高工作重量',
    reps:'同重量最高次数',estimate:'每日最高估算 1RM',sets:'工作组数',sessions:'有工作组的训练次数'
  }:{};
  if(group&&!group.bestEstimate)delete labels.estimate;
  const metric=Object.hasOwn(labels,filters.metric)?filters.metric:'load';
  const chosen=group?.weights.find(row=>row.weight===filters.weight)??group?.weights.at(-1);
  const option=(value,label,selected)=>`<option value="${esc(value)}"${selected?' selected':''}>${esc(label)}</option>`;
  const select=(id,title,options)=>`<label class="${id==='record-group'?'record-group-field':''}">${title}<select id="${id}">${options}</select></label>`;
  const ranges=select('record-range','日期范围',Object.entries(RECORD_RANGES).map(([value,label])=>option(value,label,value===range)).join(''));
  const omissions=Object.entries(excluded).filter(([,n])=>n>0).map(([key,n])=>`${exclusionLabels[key]} ${n} 组`).join(' · ');
  const scope=`<p class="footnote">按训练开始的自然日统计（${esc(timeZone)}），仅计有明确负重口径的普通组。${omissions?` 排除 ${omissions}。`:''}</p>`;
  const header=`<section class="records-card" aria-label="动作纪录与趋势"><h2>动作纪录与趋势</h2>`;
  if(!group)return `${header}<div class="record-filters">${ranges}</div><p class="muted">这个范围暂无可比工作组。原始记录仍可在下方查看。</p>${scope}</section>`;
  const groupsSelect=select('record-group','负重分组',groups.map(item=>option(item.key,
    `${modes[item.mode]} · ${item.unit||'无单位'}${item.bodyWeight===null?'':` · 参考体重 ${fmt(item.bodyWeight)} kg`}`,item.key===group.key)).join(''));
  const shortLabels={load:group.mode==='assisted'?'辅助重量':group.mode==='bodyweight_plus_extra'?'额外负重':'工作重量',
    reps:'同重量次数',estimate:'估算 1RM',sets:'工作组数',sessions:'训练次数'};
  const metrics=select('record-metric','趋势指标',Object.keys(labels).map(value=>option(value,shortLabels[value],value===metric)).join(''));
  const weights=select('record-weight',group.mode==='assisted'?'比较用辅助重量':group.mode==='bodyweight_plus_extra'?'比较用额外负重':'比较用工作重量',
    group.weights.map(row=>option(row.weight,weightText(row.weight),row===chosen)).join(''));
  const stamp=new Intl.DateTimeFormat('zh-CN',{timeZone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'});
  const source=record=>`<time datetime="${new Date(record.date).toISOString()}">${stamp.format(record.date)}</time>`;
  const card=(label,value,record)=>`<div><span>${label}</span><strong>${esc(value)}</strong><small>${source(record)}</small></div>`;
  const bestWeight=group.bestLoad?card(group.mode==='external'?'最高工作重量':'同参考体重最高额外负重',weightText(group.bestLoad.weight),group.bestLoad):'';
  const bestReps=card('同重量最高次数',`${weightText(chosen.weight)} × ${chosen.record.reps} 次`,chosen.record);
  const estimate=group.bestEstimate?card('估算 1RM',weightText(group.bestEstimate.estimated1RM),group.bestEstimate):'';
  const series=recordSeries(group,metric,chosen.weight);
  const from=firstDay??group.days[0].day;
  const showValue=value=>metric==='reps'?`${fmt(value)} 次`:metric==='sets'?`${fmt(value)} 组`:metric==='sessions'?`${fmt(value)} 次`:weightText(value);
  const table=series.some(row=>row.points.length)?`<details class="record-data"><summary>查看逐日数据</summary><table><thead><tr><th scope="col">训练日期</th><th scope="col">${labels[metric]}</th></tr></thead><tbody>
    ${series.map(row=>`<tr><th scope="row">${recordDayLabel(row.day)}</th><td>${row.points.map(point=>`<span class="record-day-value">${esc(showValue(point.value))}${point.record?` <small>${source(point.record)}</small>`:''}</span>`).join('')||'—'}</td></tr>`).join('')}
  </tbody></table></details>`:'';
  return `${header}<div class="record-filters">${ranges}${groupsSelect}${metrics}${weights}</div>
    <p class="footnote" data-record-sample>所选范围 · ${group.setCount} 个工作组 · ${group.sessionCount} 次训练</p>
    <div class="record-prs">${bestWeight}${bestReps}${estimate}</div>
    ${group.bestEstimate?'<p class="footnote">估算 1RM 采用 Epley 公式，样本为 2–10 次的外部负重组。</p>':group.mode==='external'?'<p class="footnote">暂无估算 1RM 样本。需明确质量单位、正重量和 2–10 次。</p>':''}
    ${group.mode==='assisted'?'<p class="footnote">辅助重量按实际记录显示，同辅助重量下比较次数。</p>':''}
    ${lineChart(series,from,lastDay,{esc,fmt,label:labels[metric],scatter:group.mode==='assisted'&&metric==='load'})}
    ${table}${scope}<p class="footnote">未记录的日期和缺测指标留空。</p></section>`;
}
