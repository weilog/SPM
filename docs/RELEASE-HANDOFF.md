# 发布候选源码与交接

交付编号 `v2.0.0-rc.1`，对应 `feat/workbench-v2-delivery` 的发布材料提交。功能基线为 `e1b80c3`；请以标签解析出的完整提交 SHA 为最终快照身份。此标签不是 main 合并或课程人工签字。

## 源码范围

仓库包含 `apps/web`、`apps/api`、`packages/shared`、Prisma schema 与全部增量迁移、`infra`、测试及浏览器脚本、示例数据模板、锁文件和文档。第三方依赖、生成的 Prisma Client、构建产物和真实数据库不作为源码提交；按 README 安装、生成和构建。

`.env`、`.runtime`、密钥、会话、node_modules 和私有数据库备份均不进入源码包；`.env.example` 是可公开的模板。演示种子包含已明确标记的本地样例账户，不能用于公网生产部署。

## 获取固定快照

```powershell
git clone --branch v2.0.0-rc.1 https://github.com/weilog/SPM.git
cd SPM
git rev-parse HEAD
git show v2.0.0-rc.1 --no-patch
```

在已有仓库中只读获取标签后，可在独立目录检出；不要覆盖本地未提交修改。默认交付入口为根 README；发布变化见 RELEASE_NOTES，操作见 USER-GUIDE，验证状态见 `releases/v2.0.0-rc.1-validation.md`。

## 打包与校验

在具备该标签的仓库根目录执行：

```powershell
New-Item -ItemType Directory -Force .runtime/release | Out-Null
git archive --format=zip --prefix=SPM-v2.0.0-rc.1/ --output=.runtime/release/SPM-v2.0.0-rc.1-source.zip v2.0.0-rc.1
Get-FileHash .runtime/release/SPM-v2.0.0-rc.1-source.zip -Algorithm SHA256
```

源码包由 Git 标签导出，包含文档和锁文件，不夹带本机未跟踪文件。校验文件随包交付，用于确认下载和传输完整性，不替代代码审查。可从 GitHub 标签对应的源码归档获取同一版本；不同 ZIP 打包器的容器字节可能不同，应对具体交付包核验 SHA256。

## 交接核对

| 内容 | 本候选版入口 |
| --- | --- |
| 源码、测试、迁移、锁文件 | 标签快照中的 apps / packages / infra / scripts |
| 安装启动和默认配置 | README、`.env.example`、`infra/init-env.mjs` |
| 演示账户与初始化 | README、`docs/demo-data.md`、种子脚本 |
| 用户操作与异常旅程 | `docs/USER-GUIDE.md` |
| 发布范围、修复、已知限制 | RELEASE_NOTES |
| 本轮验证与历史证据区分 | `docs/releases/v2.0.0-rc.1-validation.md` |
| 历史截图和技术验收 | `docs/evidence/`、工作台与 AI 阶段交付说明 |

## 升级、恢复与正式发布

新环境按 README 初始化。已有数据库先备份，执行增量迁移后验证；保留该环境的 `.env`、上传文件和其他运行资产，不能用源码包替换业务数据。没有自动 SQL 降级流程，恢复应使用匹配版本的备份和代码。

本轮不合并 main、不重写提交、不覆盖已有标签、不代签表8。候选版与最终发布应区分：团队确认全量验收、真实端到端演示、技术债处置及过程材料后，再决定主干集成及正式版本标签；不能把候选标签名称改成“全项通过”的证明。
