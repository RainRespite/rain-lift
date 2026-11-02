# v1.8.2 验证材料

本目录新增备份、报告、截图中的体重与训练全部为隔离合成数据，不是真实个人记录。

- baseline-tests.txt：本轮实际运行的 v1.8.1 功能基线，221 项通过。
- tests-final.txt：最终发布资源对应的完整回归结果，255 项通过。
- compatibility.json：16 个静态资源的一致性和 SHA-256、JS 语法、旧读取器拒绝新版、健康核心未改校验。
- browser-full-backup.synthetic.json：实际浏览器下载并重新导入的完整合成备份（该阶段两次训练，当前体重70）。
- browser-current70-prior68.*：新训练70、旧训练快照68的页面证据。
- browser-server-unreachable.* / browser-offline-report.synthetic.txt：关闭本地服务器后缓存启动、改体重70.5、记组并生成报告的证据；不是 iPhone 飞行模式。
- report-example.synthetic.*：最终报告模块对实际浏览器合成备份的本地分析示例。
- browser-*-report.synthetic.txt：不同验收阶段的真实页面报告文本，阶段之间合成训练次数可能不同。

development 下保留了本地开发期间的诊断输出，不纳入公开发布；最终结论以 tests-final 和交付/发布说明为准。
