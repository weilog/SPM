# 爱管理 SPM

面向项目经理与项目成员的协作工作台，使用 React / TypeScript / Vite / Ant Design、NestJS REST、PostgreSQL / Prisma 和 pnpm workspaces。

本次交付编号为 **`v2.0.0-rc.1`**，是本地演示与课程验收的候选版本。功能基线为 `e1b80c3`，标签还包含发布文档与验证记录；不是各 workspace 的 npm 版本号。候选标签来自 `feat/workbench-v2-delivery`，负责人现已授权将该交付分支通过 PR 集成到 main；标签快照保持不变。[合并前验证和已接受的显示限制](docs/releases/v2.0.0-rc.1-pre-main-validation.md)单独记录。课程最终验收仍需团队人工确认。

## 已有能力

| 范围 | 当前实现 |
| --- | --- |
| 账户、项目与成员 | 登录退出、邀请注册与本地模拟找回密码、管理员账户维护、项目创建与切换、项目成员及预设角色权限 |
| 需求与故事 | 三级需求、验收标准、目标 / Epic / 故事地图、故事看板、故事状态、排序及需求与任务关联 |
| 任务 | 创建编辑、指派、本人任务、进度与状态、归档恢复、操作历史和修订冲突校验 |
| 计划 | 阶段、计划工作项、里程碑、正式甘特、日 / 周 / 月尺度、日期编辑、拖动及边缘调整 |
| 多视图 | 故事地图、故事看板、甘特图、成员任务图、UML；单视图追踪、双视图 55/45 可调比例、关联高亮与手动筛选 |
| UML 与文档 | 用例图编辑、关联时序场景持久化；项目目录、上传、下载及受支持格式的预览 |
| AI 辅助 | 手动项目诊断、覆盖核查、规划与拆分候选、草稿恢复、逐项审核后提交、只读日期推演及证据定位；需单独配置 |

业务数据来自真实 API 与 PostgreSQL。需求、故事、任务、计划和时序场景分别维护自己的状态，关联展示不代表自动修改其他对象。

## 环境

- Node.js `>=22.12`，pnpm `11.25.0`；本轮环境版本见[验证记录](docs/releases/v2.0.0-rc.1-validation.md)。
- Docker Desktop 已启动，使用 Docker Compose 运行 PostgreSQL `17.9-alpine`。
- 默认端口：Web `5173`、API `3000`、PostgreSQL `5433`；均用于本机演示。
- 命令在仓库根目录执行。依赖版本以 `pnpm-lock.yaml` 为准。

## 从交付标签启动

```powershell
git clone --branch v2.0.0-rc.1 https://github.com/weilog/SPM.git
cd SPM
node infra/init-env.mjs
pnpm install --frozen-lockfile
docker compose --env-file .env -f infra/compose.yaml up -d --wait
pnpm db:generate
pnpm db:migrate
pnpm build
```

`init-env` 只在根目录 `.env` 不存在时生成随机数据库密码和 `SEED_PASSWORD`，不覆盖已有配置。`.env.example` 是配置模板；真实 `.env` 不在交付包中。前后端及种子脚本使用根目录 `.env`。已有数据库需先备份，再执行增量迁移；不要使用 reset 或删除数据卷作为升级步骤。

选择需要的初始化方式：

```powershell
# 基础账户：admin、manager、manager_b、member、tester
pnpm db:seed

# 可选：本地五阶段示例项目、成员、需求、故事、任务、计划、文档和用例图
pnpm db:seed:demo

# 可选：在五阶段示例中补充三个关联时序场景
node scripts/seed-workbench-scenarios.cjs

pnpm dev
```

打开[工作台](http://127.0.0.1:5173/)，[API 健康检查](http://127.0.0.1:3000/api/health)。基础账户密码为本机 `.env` 的 `SEED_PASSWORD`，已有账户不被种子重置。

示例账户 `tpl_pm` 是项目经理，`tpl_frontend` / `tpl_backend` / `tpl_ops` 是开发人员，`tpl_qa` 是测试人员，`tpl_observer` 无项目成员资格。示例默认密码为 `SpmDemo!2026`，仅供本地验收；首次导入前可设置 `DEMO_SEED_PASSWORD` 更换。详细数据范围、固定日期和幂等行为见[数据包说明](docs/demo-data.md)。

五阶段示例只导入标记的本地数据，不是用户数据库备份；重复导入保留已有示例编辑。时序场景补充脚本需先导入五阶段示例。固定快照日期可能使页面显示逾期事实，这不表示程序异常。

## 使用与验证

先以 `tpl_pm` 登录并进入“爱管理协同平台建设 · 五阶段示例”，按[用户手册与演示步骤](docs/USER-GUIDE.md)浏览和操作。管理员的系统权限与项目成员权限分开；系统管理员不自动获得任意项目数据访问权。

```powershell
pnpm typecheck
pnpm build
pnpm --filter @spm/web test --maxWorkers=1
pnpm --filter @spm/api test
pnpm test:demo-data
```

前端用例验证交互与 API 契约；后端 Jest / Supertest 和导入测试使用本地 PostgreSQL 的随机隔离 schema，运行实际迁移后清理测试 schema，不重置 public。自动 API 测试禁止调用外部模型。最终结果及未重跑项目见[验证记录](docs/releases/v2.0.0-rc.1-validation.md)。

仓库另有 `test:e2e:a`、`test:e2e:v43`、`test:e2e:auth`、`test:e2e:users`、`test:e2e:ai:p3` 等浏览器脚本，需本地 Chrome / Playwright 和数据库。其历史通过证据与本标签实际执行的检查分开记录，不将旧截图当作本轮重新执行的结果。

## AI 与运行边界

根目录配置默认关闭 AI 和外部传输，不配置模型也能使用业务功能。启用需在本机 `.env` 配置供应商、模型、后端密钥及批准的数据范围，参阅[AI 配置与接口说明](docs/ai/P2-DELIVERY.md)及 `.env.example`。密钥不填写到前端、不进入 Git；分析由用户手动触发，候选经人工审核后才能写入业务数据。测试替身结果不能当作真实模型质量证明。

本仓库提供本地演示部署，不承诺公网生产部署。API 绑定 `127.0.0.1`，Vite 代理 `/api` 到 `3000`。请统一使用 `127.0.0.1`，避免与 `localhost` 混用导致 Cookie / Origin 不一致。修改 API 后执行 `pnpm --filter @spm/api build`，现有 Node watch 服务会重启；前端支持热更新。

若端口占用，先核对占用服务；更改 API 端口时需同步 Vite 代理和 `WEB_ORIGIN`。若 Docker 配置或数据库读取报权限问题，应修复相应访问权限，避免重置数据库。停止前后端使用各终端的 Ctrl+C；停止数据库使用 `docker compose --env-file .env -f infra/compose.yaml stop`，保留数据卷。

任务没有独立日期与工时模型，不提供独立任务时间条、关键路径或利用率计算。找回密码的默认邮件为明确标记的本地模拟，不发送真实邮件。Office 文件支持下载与属性，不声明浏览器内 Office 编辑能力。其余已知限制与债务见[发布说明](RELEASE_NOTES.md)。

## 交付索引

- [发布说明与已知限制](RELEASE_NOTES.md)
- [用户手册与可复现演示](docs/USER-GUIDE.md)
- [标签、源码包和交接步骤](docs/RELEASE-HANDOFF.md)
- [本候选版验证记录](docs/releases/v2.0.0-rc.1-validation.md)
- [多视图实现与截图证据](docs/WORKBENCH-V2-DELIVERY.md)
- [AI 技术验收历史](docs/ai/P3-ACCEPTANCE.md)

`docs/DELIVERY.md`、`docs/ARCHITECTURE.md` 及 `docs/S2-*` 等为各阶段历史材料，不能代替本 README 与最终发布说明。课程计划会、总复盘、自评、AI 原始互动记录和人工签字表需团队另行真实归档；本标签不表示这些过程交付物已完成。
