# Apple Health → iPhone 快捷指令 → Rain-Lift v1.7

本轮链路：**手动运行快捷指令 → 导出本地 JSON → 在 Rain-Lift 预览并确认导入 → 本地查看 → 手动复制报告给 GPT**。它不需要 Apple Watch、开发者会员、第三方健康服务或付费 API。Rain-Lift 尚未实现 HealthKit 原生授权、Watch App、自动后台同步或 ChatGPT 自动连接。

用户已确认快捷指令能读取步数样本；下文先把这条已可用路径规范化。本文不是已经在用户 iPhone 安装并验收过的 `.shortcut` 文件。动作中文名称、样本详情和可读取的类别会随 iOS 版本/语言变化，按手机实际提供的字段配置；不提供的指标留空，不伪造。

## 1. 文件协议

这是 Rain-Lift 自定义交换格式，**不是 Apple 官方统一 JSON 导出格式**。不接受“健康 → 导出所有健康数据”生成的 ZIP/XML，也不接受训练备份 JSON。

文件使用 UTF-8 JSON，单文件最多 **2 MiB（2,097,152 字节）**、最多 **10,000 条记录**；累计健康存储也受相同字节与条数上限保护。数字必须是 JSON number，不能包含单位、千位逗号或写成字符串。文件中只放实际读取成功的记录；没有某类数据时省略该类记录，`records: []` 合法。不要用 0 表示无权限或无数据。

顶层字段：

| 字段 | 类型 | 要求 |
| --- | --- | --- |
| `format` | string | 固定 `rainlift-health` |
| `version` | number | 固定整数 `1`，与界面 v1.7 无关 |
| `timeZone` | string | IANA 时区，如 `Asia/Shanghai`；不是 `UTC+8` |
| `exportedAt` | string | 导出时刻，带 `Z` 或 `±HH:mm` 的 ISO 8601 |
| `records` | array | 记录列表，可为空 |

每条记录的公共字段：

| 字段 | 类型 | 要求 |
| --- | --- | --- |
| `id` | string | 稳定的来源内编号；重复导出同一样本应保持不变 |
| `type` | string | `steps`、`sleep`、`resting_heart_rate`、`hrv`、`workout` 之一 |
| `source` | object | `{ "name": "实际来源名称" }`；能取得时可增加 `bundleId`；不要把快捷指令名称冒充测量来源 |
| `start` / `end` | string | 样本实际起止时刻；带时区偏移，`end >= start`，持续时间样本应有正区间 |
| `unit` | string | 见下表，不自动猜测或换算错误单位 |
| `value` | number | 真实数值；不可为负数、NaN 或 Infinity |
| `aggregation` | string | 通常为 `sample`；步数另支持 `daily_total`、`rolling_24h` |
| `timeZone` | string，可选 | 该记录原始 IANA 时区；省略时继承顶层 `timeZone`，健康导出会保留 |

导入后每条记录保留原始时区标记与时间偏移，不改写原始时间。趋势与报告统一按界面当前显示的时区分日；当前展示时区取最近一次确认导入文件的顶层 timeZone。旅行或导入不同时区时请核对这个标记：原始样本可落入不同展示日期；不符合当前日界线的整日总数不会冒充当前自然日总量。

| type | unit / value 含义 | 额外字段 |
| --- | --- | --- |
| `steps` | `count`，整数步数 | `aggregation` 必填；原始样本用 `sample` |
| `sleep` | `min`，此睡眠分类区间的分钟数，必须等于 `(end-start)/60000`，允许 0.02 分钟舍入误差 | `stage` 必填，见睡眠映射 |
| `resting_heart_rate` | `bpm`，来源记录的静息心率 | 只能 `sample`；不能把普通心率样本改名为静息心率 |
| `hrv` | `ms`，Apple Health 的 **SDNN** | 只能 `sample`；不能把其他 HRV 算法混入 |
| `workout` | `min`，来源记录的实际运动持续时间，可短于起止区间（暂停） | `workoutType` 必填；只能 `sample`；可选 `heartRate` |

`heartRate` 示例：`{ "unit": "bpm", "average": 125, "min": 90, "max": 150 }`。有哪个可信摘要就填哪个；最小值不能高于最大值，平均值应处于提供的最小/最大范围内。没有摘要时省略整个字段。不能凭运动时长推算心率，不能把该时段不相关心率的均值标作官方运动平均心率。

导入防护范围：步数为 0–1,000,000 的整数；睡眠/运动分钟为 0–10,080；静息/运动心率为 1–300 bpm；HRV 为 0–10,000 ms。**这些是程序拒绝明显非法输入的范围，不是健康正常值或诊断标准。** 单条区间最长 7 天；只有静息心率/HRV 允许 start=end。编号、来源名、bundleId、运动类型为非空文本，最长 200 字符。ISO 日期需含秒，毫秒可选且最多 3 位，年份 1970–9999，偏移最多 ±14:00。

Apple Health 的 HRV 类型为 SDNN，不能与 RMSSD 当作同一种数值比较；[Apple 类型说明](https://developer.apple.com/documentation/healthkit/hkquantitytypeidentifier/heartratevariabilitysdnn)。运动实际持续时间可能由开始/结束或运动事件决定，与墙钟经过时间不同；[Apple duration 说明](https://developer.apple.com/documentation/healthkit/hkworkout/duration)。

## 2. 先制作“只导出步数样本”的快捷指令

先选最近一天或少量样本验证，成功后再扩展到最近 7 天。不要第一次就导出全部健康历史。

1. 打开 iPhone“快捷指令”，新建快捷指令，例如“Rain Lift 健康导出”。添加 **查找健康样本（Find Health Samples）**，类型选“步数”，设置明确的起止日期与排序。先限制少量结果，以便逐条检查；正式导出时不要让结果数量限制静默截断数据。
2. 运行一次并授权读取步数。用“快速查看”检查返回内容，确认数值、开始/结束时间和来源。Apple 官方把 Find Health Samples 列为查找动作；筛选、排序和数量限制由动作参数设置：[查找动作](https://support.apple.com/en-euro/guide/shortcuts/apd3c845e881/10.0/ios/27)、[筛选参数](https://support.apple.com/en-gb/guide/shortcuts/apdbdab3433f/ios)。
3. 添加 **重复每一项（Repeat with Each）**。在循环内，通过样本变量可选属性，或手机实际提供的“获取健康样本详细信息”动作，分别取：数值、单位、开始日期、结束日期、来源名称。某字段不可见时先停止该类别的导出；不要用当前时间代替样本时间，也不要把“添加日期”当作测量日期。
4. 数值转换成 `count` 的纯数字。用“格式化日期”将开始、结束日期变成带偏移的 ISO 字符串。可选系统提供的 ISO 8601；自定义时使用 `yyyy-MM-dd'T'HH:mm:ssXXX`，先快速查看确认末尾实际得到 `+08:00` 或 `Z`。**不要给本地时间手动拼接 `Z`**。Apple 支持自定义日期格式和 Unicode 日期模式：[自定义日期格式](https://support.apple.com/guide/shortcuts/custom-date-formats-apd8d9b19184/ios)。
5. 创建一个 `source` **字典**，键 `name` 的值绑定实际来源名称。若动作不能读取来源，先在 Health 中确认并只查询一个已知来源，人工核对后固定该真实名称；来源仍不确定就不导出，不统一写成“Apple Watch”。`bundleId` 读不到时省略。
6. 创建一条记录的 **字典**。文本字段绑定 `id/type/start/end/unit/aggregation`；`value` 设置为“数字”，不是“文本”；`source` 设置为字典。`type=steps`，`unit=count`，`aggregation=sample`。不要用“文本”动作手拼整段 JSON，以免来源名中的引号或换行破坏 JSON。Apple 官方说明字典与列表可嵌套，并可通过 Dictionary 动作生成 JSON：[JSON 结构](https://support.apple.com/guide/shortcuts/intro-to-using-json-apd0f2e057df/ios)、[使用字典](https://support.apple.com/en-ie/guide/shortcuts/apd43b69f337/ios)。
7. 循环最后一个输出应为该记录字典。循环结束后的“重复结果”应是**字典列表**，不是换行文本。用快速查看检查；把它作为顶层字典的 `records` 数组值。
8. 顶层字典设置 `format=rainlift-health`、数字 `version=1`、`timeZone=Asia/Shanghai`（国内使用时）、`exportedAt=当前日期的带偏移 ISO 字符串`，并填入 records 列表。转换/获取该字典的文本表示后，先用“从输入中获取字典”回读，确认仍为有效 JSON 且 `records` 是数组。
9. 将 JSON 文本设名为 `RainLift-Health-日期.json`，使用 **存储文件（Save File）**，打开“询问存储位置”，选择“文件 App → **我的 iPhone**”下的本地目录。Apple 官方确认 Save File 是文件存储动作；[文件分享动作](https://support.apple.com/en-ca/guide/shortcuts/apdaf74d75a5/ios)。不要添加“获取 URL 内容”、邮件、上传、自动分享或第三方服务动作。选择 iCloud Drive 会受设备已有 iCloud 同步设置影响，不属于仅本机保存。

稳定 `id`：如果当前快捷指令能取得 Health 样本 UUID，直接使用。若没有，在同一来源内组合 `type|start|end|原始分类|规范数值|unit|aggregation` 形成不超过 200 字符的稳定文本编号，保持同一生成规则；不要每次随机生成 UUID。来源身份由 `source.name + bundleId（若有）` 共同决定，重复导出保持稳定来源名；同应用的不同设备不能仅因 bundleId 相同就当成同一来源。设备改名会保留成不同来源，不推测自动合并。应用也会按相同语义识别不同 ID 的重复样本。同一来源、同一 ID 却改了内容会被拒绝；源数据更正时，先导出健康备份，再明确删除旧记录后导入更正版。

若两个独立原始样本在可取得的所有字段上完全一致、又没有 UUID，本协议无法证明它们是否确实不同，采用保守去重，可能少计。这个限制应保留，不通过猜测补数。

## 3. 时间、范围与重复数据

- **自然日**是指定 IANA 时区当天 00:00 至次日 00:00；**过去 24 小时**是长度恰为 24 小时的移动窗口。两者不能互换，夏令时自然日也可能不是 24 小时。
- 推荐优先导出 `sample`。若已经有经核实的单来源整日步数，可使用 `daily_total`，但 start/end 必须严格对应该时区完整自然日。今天尚未结束时不要把“截至目前”伪装成完整 `daily_total`。
- `rolling_24h` 必须恰为 24 小时，原始记录可保留，但不参与自然日步数趋势。不要把查询“最近一天”直接标为整日总数。
- 同源相同语义重复样本不会累加。同日已有一个可信完整 `daily_total` 时，采用该总数，同日样本不再相加；不同日总数冲突、日界线与展示时区不一致、或只有部分重叠步数样本时，保留原记录但不输出伪精确日总数。跨午夜的步数样本不能按时间比例凭空拆分。
- iPhone、Watch、第三方应用来源分别展示，**不跨来源直接相加**。Apple Health 自身会按来源优先级整合数据；Rain-Lift 没有复刻该算法，因此样本统计可能与 Health 首页不同。[Apple 多来源规则](https://support.apple.com/en-au/108779)
- 正在进行、尚未完整结束的窗口不应伪装成已完成样本；未来时间记录不会进入当前 7 天分析。
- 睡眠保留真实跨日区间。同来源相连/重叠的睡眠片段组成一个 episode，以结束（醒来）日归属；无连接记录的片段各按自身结束日归属，不推测两侧属于同一夜。有效睡眠用区间并集避免总时长和阶段重复计数；不同具体睡眠阶段互相冲突时不输出阶段拆分，清醒与睡着区间互相矛盾时不输出可靠总时长。醒来日口径是 Rain-Lift 的展示约定，不声称与 Health 的所有视图一致。

## 4. 睡眠、心率、HRV 与运动的扩展

先逐类查看快捷指令实际支持的详情和单位，成功后才加入同一 `records` 列表。多个查找动作之间若被意外传入前一个结果，可在前面放“无（Nothing）”动作，让新查找独立读取；此行为见 Apple 的[筛选参数说明](https://support.apple.com/en-gb/guide/shortcuts/apdbdab3433f/ios)。不要假定所有 iOS 版本都能通过快捷指令完整读取运动详情、睡眠阶段、样本 UUID 和关联心率。

睡眠映射：

| Apple 实际分类 | Rain-Lift `stage` | 是否计入有效睡眠 |
| --- | --- | --- |
| asleep / asleepUnspecified（已睡着，阶段未知） | `asleep` | 是 |
| asleepCore | `core` | 是 |
| asleepDeep | `deep` | 是 |
| asleepREM | `rem` | 是 |
| awake | `awake` | 否 |
| inBed | `in_bed` | 否 |
| 来源无法确认睡/醒或无法识别的分类 | `unspecified` | 否 |

注意 `unspecified` 是本协议的“状态不明”，**不是** Apple 的 `asleepUnspecified`。在床时间不等于睡着时间。Apple 明确指出在床样本可以与详细睡眠阶段重叠，所以不能把二者简单求和；[Apple 睡眠分类说明](https://developer.apple.com/documentation/healthkit/hkcategoryvaluesleepanalysis)、[asleepUnspecified](https://developer.apple.com/documentation/healthkit/hkcategoryvaluesleepanalysis/asleepunspecified)。

静息心率只读取对应“静息心率”类别；HRV 只读取 SDNN 并转为 ms。缺失就省略，不设置正常值阈值或恢复评分。运动只在能读到真实类型、起止时间和实际持续时间时导出；运动心率摘要必须来自该次运动可核实的摘要，不能根据年龄或训练重量生成。没有 Watch 仍可使用 iPhone 已有步数及实际存在的其他来源数据。

## 5. 合成 JSON 示例

**以下均为协议演示数据，不是真实用户记录；不要导入真实使用中的站点充当测试。** 步数是一个 10 分钟样本，不是全天总数。睡眠是跨夜 450 分钟；运动在 45 分钟区间内记录 40 分钟实际持续时间。没有可用运动心率，因此省略。

```json
{
  "format": "rainlift-health",
  "version": 1,
  "timeZone": "Asia/Shanghai",
  "exportedAt": "2026-10-30T20:00:00+08:00",
  "records": [
    {
      "id": "example-phone-steps-20261030-0800",
      "type": "steps",
      "source": { "name": "示例 iPhone" },
      "start": "2026-10-30T08:00:00+08:00",
      "end": "2026-10-30T08:10:00+08:00",
      "unit": "count",
      "value": 120,
      "aggregation": "sample"
    },
    {
      "id": "example-sleep-20261030",
      "type": "sleep",
      "source": { "name": "示例睡眠来源" },
      "start": "2026-10-29T23:00:00+08:00",
      "end": "2026-10-30T06:30:00+08:00",
      "unit": "min",
      "value": 450,
      "aggregation": "sample",
      "stage": "asleep"
    },
    {
      "id": "example-rhr-20261030",
      "type": "resting_heart_rate",
      "source": { "name": "示例心率来源" },
      "start": "2026-10-30T07:00:00+08:00",
      "end": "2026-10-30T07:01:00+08:00",
      "unit": "bpm",
      "value": 60,
      "aggregation": "sample"
    },
    {
      "id": "example-hrv-20261030",
      "type": "hrv",
      "source": { "name": "示例心率来源" },
      "start": "2026-10-30T07:02:00+08:00",
      "end": "2026-10-30T07:03:00+08:00",
      "unit": "ms",
      "value": 45,
      "aggregation": "sample"
    },
    {
      "id": "example-workout-20261030",
      "type": "workout",
      "source": { "name": "示例运动来源" },
      "start": "2026-10-30T18:00:00+08:00",
      "end": "2026-10-30T18:45:00+08:00",
      "unit": "min",
      "value": 40,
      "aggregation": "sample",
      "workoutType": "传统力量训练"
    }
  ]
}
```

## 6. 导入与失败处理

1. 保留正在使用的 Rain-Lift 网址，打开“设置 → 健康与 AI → 导入 Apple Health JSON”。首次离线使用前要完成应用缓存；不要清除浏览器数据或换网址寻找记录。
2. 从“文件 App”选择 JSON。检查预览里的文件范围、记录类型、来源、新增/重复数量、重叠警告。**点确认后才保存**；取消不写入。
3. 确认后查看最近记录与 7 天趋势、上次导入时间、来源。部分指标没有记录时显示“暂无数据”；样本之和只是已导入样本合计，不保证覆盖一整天。
4. 健康数据使用独立的 `rainlift.health.v1`。训练备份与健康备份分别导出；健康导出可重新导入。指定记录删除前有确认，删除只影响 Rain-Lift 本地副本，不回写 Apple Health。

| 情况 | 处理 |
| --- | --- |
| 未授权/被拒绝 | 在快捷指令隐私详情和 iPhone 健康数据访问设置中检查当前允许的类别，重新手动运行；只授权需要的读取类别。Apple 说明快捷指令会请求所需数据权限，可在隐私详情重置；[快捷指令隐私说明](https://support.apple.com/en-euro/guide/shortcuts/apd961a4fc65/ios)。不要把空结果自动解释为数值 0。 |
| 无数据 | 核对 Health 中该日期、类别和来源，缩小查询；允许不包含该类记录。没有 Watch、没有佩戴或无测量时照常使用步数与训练功能。 |
| 单位/类型/时间错误 | 整批拒绝，原记录不变；先修正导出映射。ms 与秒、min 与小时、bpm 与普通数字不可混淆。 |
| 文件过大/条目过多 | 按日期分批导出；不要仅用“获取前 N 项”后声称是完整 7 天。 |
| ID 冲突/重复 | 相同语义自动去重；同源同 ID 内容变化需先备份并明确处理旧记录，不能直接静默覆盖。 |
| 存储空间不足或浏览器禁止写入 | 保存失败不确认成功，内存和训练记录保持原样。先导出已有备份，再检查可用空间；不要清站点数据。 |
| 另一标签页已修改健康数据 | 检测到已有外部修改则拒绝过期写入，刷新后重试并重新检查预览；此检查不是跨页原子锁，请避免同时编辑。 |
| 已有健康存储损坏 | 停止写入保护原始内容；先导出原始健康数据排查，不用空数据自动覆盖。 |

## 7. GPT 手动分析与下一阶段

在“健康与 AI”生成分析报告后，先审阅实际包含的训练与健康信息，再主动复制，或导出 JSON / 纯文本；自行选择是否发送到已有 ChatGPT 对话。复制/下载本身不会调用模型或上传。发送到 ChatGPT 是用户另行执行的外部分享，应只分享本人愿意提供的信息。

报告使用实际训练组、会话经过时间和健康样本，缺失的真实休息、RPE/RIR、主观疲劳等会说明。GPT 应给出有依据的下一次训练建议、标注信息不足，不自动修改计划。现有 ChatGPT 账户的额度或限制不由本项目保证，本项目没有新增收费调用。

Apple Watch 到货后，先积累少量真实睡眠/心率/HRV/运动记录，逐类验证快捷指令能取到的字段，再按同一协议导入；检查 Watch 与 iPhone 的来源区别与重复情况。验证稳定后可评估用户主动触发的快捷指令便利操作。**不承诺锁屏实时读取、可靠后台运行、实时四端同步或数据自动上传。**
