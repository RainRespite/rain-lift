# GitHub v1.8 交付备注与旧版恢复

2026-11-01：用户在本地验收完成后授权推送 GitHub、标记日志、补备注和旧版恢复。本轮通过GitHub Desktop推送开发分支 `codex/rain-lift-v1.8` 及版本标签 `v1.8.0`，保留旧版标签 `v1.7.0`。不合并 main、不部署生产；手机原入口不会因分支推送自动升级。PR尚未创建，恢复写权限后再提交变更、验证与回滚备注。

## 推送实际结果

Git与连接器最初均返回403。用户授权使用GitHub Desktop后，已成功发布开发分支，远端核对 main 仍为v1.7。版本标签随最终备注同步推送并核验；不合并main，不部署生产。提交历史保留此前失败记录，避免伪造一次成功。

## 已知状态

- v1.7 基线：`ab19095da06e282a047b8c8aeb3832bc158e73a8`。原本地 v1.7 与更早工作目录保留；未重置用户已有修改。
- v1.8：全历史精简报告、自重/辅助类型、指定位置排序与输入保留。192项自动化通过；390/320桌面窄屏、实际导入/复制/导出与停服缓存验证完成，iPhone真机尚待验收。
- 不调用收费 API、不新增运行依赖、不自动上传个人数据。GitHub 内 qa 示例与截图全部为合成数据。
- 提交、标签、PR 是代码交付凭据，不表示已部署或手机已载入新版。

## 恢复代码

先备份设备数据。训练、健康、动作类型分别导出；保留原网址与主屏幕图标。**回滚代码不需要导入旧训练备份**，否则可能覆盖新记录。v1.7 不展示动作类型，但独立元数据 key 保留，之后可再次升级。

版本标签推送并核验后，可用以下命令在新目录查看旧代码：

```sh
git clone --branch v1.7.0 https://github.com/RainRespite/rain-lift.git rain-lift-v1.7-recovery
```

如果未来已经上线 v1.8，需要将原入口恢复到 v1.7，先在 v1.8 仓库生成恢复文件：

```sh
git fetch origin --tags
node scripts/prepare-rollback.mjs --out /absolute/path/to/new-rollback-directory
```

此命令只创建全新目录，不覆写任何现有路径，不改当前分支或设备数据，不联网、不部署。它从已核对的 v1.7 基线提取原始 dist 文件，同步生成 docs 副本和 package.json；给 sw.js 分配唯一的 rollback 缓存名，避免手机继续命中新版应用壳。清单记录基线、缓存和文件。不存在 v1.7 标签或标签偏移时会拒绝执行。

审阅生成结果后，在独立回滚分支将对应静态资源和 package.json 作为一个**新的恢复提交**应用到当时最新代码，保留 README/CHANGELOG 的版本历史，注明回滚原因及验证结果。不要 force push、reset 远端或删除 v1.8 标签。提交 PR，针对实际部署入口验证后再按用户授权发布；仅撤销源码提交不能代替缓存检查。

发布恢复版本后，手机保留原入口，联网检查更新并按提示刷新，核对版本1.7、近期历史、健康和进行中训练。所有模块下载完整前旧缓存继续有效；不清网站数据、不删除图标。分别验证 Safari/主屏幕环境，不以另一个网址的显示作为数据恢复依据。

## 本地恢复包（当前可用）

工作区旁保存 `rain-lift-v1.8-recovery-20261101/`，包含 Git bundle、v1.7静态ZIP、校验文件及脚本实际生成的回滚副本。Git bundle 保留两版本和开发分支，可离线克隆；ZIP只保存代码，不能恢复设备个人数据。恢复包不推入仓库以避免重复存档膨胀。

恢复脚本已在新临时目录实际运行并核对：原v1.7 app/data/health文件字节一致，docs/dist一致，缓存名新生成，训练和健康key不变，重复目标路径拒绝。没有执行生产回滚或在真实个人历史上覆盖恢复。

离线恢复可使用最新 `rain-lift-v1.7-v1.8-pending.bundle`：

```sh
git clone --branch codex/rain-lift-v1.8 /absolute/path/to/rain-lift-v1.7-v1.8-pending.bundle rain-lift-offline-recovery
git -C rain-lift-offline-recovery switch --detach v1.7.0
```

以上只在新目录查看旧代码；部署恢复仍需前述独立缓存名，不覆盖设备数据。
