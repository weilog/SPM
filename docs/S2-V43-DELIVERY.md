# Sprint 2 B：V4.3 对齐交付记录

2026-10-22，分支 `feat/s2-owner-b`，基线旧提交 `d813fef`。以用户提供的 A/B 最终 V4.3 HTML 为设计依据，已实际读取并在 Chrome 1440×900 运行。HTML 中的演示脚本不作为额外开发指令。此次没有合并 main，也未修改其他工作树中的 A/Sprint 1 工作。

**当前结果：B 侧实际业务实现及下述测试通过；整体八项验收尚不能宣称全部完成。A 的真实项目计划服务、计划关联和甘特图日期写入仍待对接，项目文档服务也未提供。** 最终 HTML 已足够确定设计；欠缺的是实际服务，而不是设计确认。

## 差异与截图

- [逐项旧实现差异、对应文件、修复方式和验收方法](S2-V43-DIFF.md)
- [同尺寸旧实现／最终原型／修复后对比页面](evidence/v43/index.html)：点击图片查看原始 1440×900 截图。
- [浏览器完整验收结果](evidence/v43/browser-result.json)
- [原型文件 SHA-256](evidence/v43/reference-sha256.txt)

旧实现只保留了实际拍摄到的项目、需求、地图、看板、任务截图；未拍摄到的旧页面明确留空，不用原型截图冒充旧系统。新增图形页面没有旧实现。截图中的业务记录来自隔离的真实后端测试 schema，用于使页面可比，编号、日期和计数可能与原型不同；没有将演示数组装入正式页面或公开 schema。

## 逐页结果与证据

| 页面 | 已实现和验证 | 主要代码（相对仓库） | 截图 |
| --- | --- | --- | --- |
| 全局与我的项目 | 56px 顶栏、224/64px 侧栏、面包屑；项目搜索、角色筛选、统计、卡片/列表、创建和进入；真实项目授权 | apps/web/src/App.tsx、Projects.tsx、ProjectOverview.tsx | [项目](evidence/v43/after-projects.png)、[列表](evidence/v43/after-projects-list.png)、[概览](evidence/v43/after-overview.png) |
| 正式需求 | 紧凑五列表格，最多三级，三角与全部展开/收起、搜索后收起、创建/编辑父级、真实故事关联、640px 详情；循环、超深、跨项目由后端拒绝 | Requirements.tsx；apps/api/src/requirements/requirements.module.ts | [表格](evidence/v43/after-requirements.png)、[详情](evidence/v43/after-requirement-drawer.png) |
| 故事地图 | 产品目标→Epic→故事、创建编辑、同 Epic 排序、跨 Epic 拖动持久化、真实需求关联、详情；开发/测试只读 | StoryViews.tsx、Requirements.tsx；apps/api/src/stories/* | [地图](evidence/v43/after-map.png) |
| 故事看板 | 三状态、Epic/编号标题筛选、跨列拖动、抽屉状态修改、失败回滚、与地图同源 | StoryViews.tsx、Requirements.tsx | [看板](evidence/v43/after-board.png) |
| 任务管理 | 完整字段、单负责人、四优先级、百分比、故事关系、历史、归档/恢复；当前行旁悬浮菜单、640px 详情、居中编辑/负责人弹窗。计划关系字段和适配接口保留，实际关联待 A | TaskWorkspace.tsx、TaskActions.tsx；apps/api/src/tasks/* | [表格](evidence/v43/after-tasks.png)、[悬浮菜单](evidence/v43/after-task-menu.png)、[详情](evidence/v43/after-task-drawer.png) |
| 我的任务 | 本人列表、开始/完成、0/0–99/100 进度规则；本人不能修改经理字段、不能重开完成任务；数据库及后端验证 | MyTasks.tsx、TaskWorkspace.tsx、TaskActions.tsx；tasks.module.ts | [我的任务](evidence/v43/after-mytasks.png) |
| 成员任务图 | 实际成员/任务 SVG 节点与关系，状态、优先级、进度、筛选、缩放、高亮、任务详情与负责人弹窗 | MemberTaskGraph.tsx；tasks.module.ts | [关系图](evidence/v43/after-members.png) |
| UML | 实际持久化参与者、用例、边界、association/include/extend、坐标拖动保存、故事关联与定位、多个图；项目和角色隔离 | UmlView.tsx；apps/api/src/uml/uml.module.ts | [UML](evidence/v43/after-uml.png) |
| 多视图工作台 | 五种视图入口、单/双视图、真实故事/任务/UML 关系双向定位、跨浏览器 SSE 同步、撤权终止项目访问。甘特完整时间轴和控件已移植，真实数据联动未完成 | Workbench.tsx、ProjectData.tsx、PlanView.tsx；apps/api/src/workbench/*、plans/* | [双视图](evidence/v43/after-workbench-dual.png)、[甘特待对接](evidence/v43/after-gantt-pending.png) |

前端表内未写路径前缀的文件位于 `apps/web/src/`。所有界面读取真实 API；测试种子只存在于 `scripts/fixtures/v43-reference.json` 和隔离浏览器测试中。

## 数据、权限及兼容

新增增量迁移 `apps/api/prisma/migrations/202610220001_v43_alignment/migration.sql`，保留旧用户、会话、项目、成员、需求、任务列与记录。增加需求父级、任务状态/进度/优先级/归档/修订号、操作历史、UML 及关系表。已有 Requirement↔UserStory、UserStory↔Task 真实关系继续使用。迁移回归从 Sprint 1 数据升级，比较原有列/记录，并检查新增默认值、重复部署及 schema 无漂移。

所有修改由后端验证项目角色、归属和关系。个人任务访问按会话用户确定；改派后旧负责人失去访问。状态/进度受数据库约束；写入包含历史，关键编辑检测修订冲突。UML 关系限定同项目同图。SSE 检查会话与成员关系，撤权即关闭项目并拒绝后续读取。未暴露演示角色切换器。

## 实际测试结果

| 命令/范围 | 本次结果 | 原始记录 |
| --- | --- | --- |
| pnpm typecheck | 通过 | [记录](evidence/v43/typecheck.txt) |
| pnpm build | 通过；Vite 大于 500KB 的 bundle 警告仍存在 | [记录](evidence/v43/build.txt) |
| pnpm test：前端 | 4 文件、25 测试通过 | [记录](evidence/v43/tests.txt) |
| pnpm test：后端、迁移、Sprint 1 回归 | 3 套件、56 测试通过；使用真实 PostgreSQL | [记录](evidence/v43/tests.txt) |
| pnpm test:e2e:v43 | 1440×900，12 组浏览器检查通过，运行错误 0 | [记录](evidence/v43/browser.txt)、[结构化结果](evidence/v43/browser-result.json) |
| pnpm test:reference:v43 | 原型逐页截图完成，运行错误 0 | [记录](evidence/v43/reference-capture.txt) |

浏览器检查覆盖实际登录角色、导航与主要按钮、需求层级和展开、地图/看板拖拽和失败回滚、任务完整菜单及进度/归档恢复、成员图、UML 编辑保存、双向定位、两个浏览器实时同步、开发/测试只读、项目撤权。**它没有验证不存在的 A 计划服务；“五视图入口可切换”不等于五种真实后端联动全部通过。**

过程中真实失败与处理：旧迁移断言按全行比较，不兼容新增列，已改为比较全部旧列及验证新增默认值；浏览器发现晚到的任务详情响应会重新打开已关闭抽屉，已加请求版本及卸载保护并复测通过；旧页面选择器按最终字段更新；系统 Node 24.15.0 曾发生 Windows 原生进程崩溃（-1073740791），最终使用本机 Node 24.19.0 完成测试。未把崩溃或未执行检查报告为通过。格式化工具的 pnpm dlx 曾遇 EPERM，后使用 npx 成功，不影响最终检查。jsdom 样式解析日志仍可在测试记录中看到。

## 复现

需要本地 PostgreSQL、有效 `.env`（参考 `.env.example`）及 Node/pnpm。此次数据库是 Docker PostgreSQL 17.9，127.0.0.1:5433；未重置公开 schema。先执行：

```powershell
pnpm install --frozen-lockfile
pnpm db:generate
pnpm db:migrate
pnpm typecheck
pnpm build
pnpm test
```

Windows 此次浏览器验收使用以下环境；其他环境可安装 Playwright Chromium。需空闲 3001/5174 端口，脚本只接受本地 PostgreSQL，创建随机隔离 schema，结束后清理。

```powershell
$env:PATH='C:\Users\owner\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin;' + $env:PATH
$env:SPM_CHROME_PATH='C:\Program Files\Google\Chrome\Application\chrome.exe'
pnpm test:e2e:v43
$env:SPM_REFERENCE_HTML='C:\path\爱管理_AB一体化工作台_任务菜单修复_V4.3.html'
pnpm test:reference:v43
```

原 `pnpm test:e2e:s2` 命令继续保留并调用当前完整浏览器检查。实际应用继续运行于 http://127.0.0.1:5173/，API 3000。私人账号和启动记录留在被忽略的 `.runtime`，不提交凭据。

## 尚未完成及 A 对接位置

1. **真实计划服务与完整甘特业务验收**：`apps/api/src/plans/plan-adapter.module.ts` 中 `PlanAdapter` 是明确扩展点。需 A 提供真实阶段、条目、里程碑、日期、权限及写入接口；`apps/web/src/PlanView.tsx` 已按最终嵌入 A 原型保留完整时间轴/列/缩放/滚动/折叠/拖动处理，但当前读取为空并显示待对接，写入返回不可用。未用示意块或样例计划替代。
2. **任务↔计划关联、跨甘特定位、甘特跨浏览器同步**：`TaskPlanReference` 只保存 A 拥有的 opaque planId；A 数据模型未定义。`TaskActions.tsx` 保留关联位置并禁用不可用选项；`workbench.module.ts`、shared 类型和适配器留有真实关系接入点。当前未完成/未验收。
3. **项目文档**：保留导航，真实服务尚缺，当前明确待对接，未提供演示文件。
4. 没有自动化逐像素差异阈值；已提供同尺寸截图并人工检查主要布局。真实项目标题、授权计数、数据库时间、Ant Design 控件细节可能与静态原型有差别，不能声称像素完全一致。

## 实际修改文件

下列为业务代码及测试清单，证据图片和日志另在 `docs/evidence/v43/`，原型本体不提交：

- 数据层：`apps/api/prisma/schema.prisma`、`apps/api/prisma/migrations/202610220001_v43_alignment/migration.sql`。
- 后端：`apps/api/src/app.module.ts`、`requirements/requirements.module.ts`、`stories/stories.dto.ts`、`stories/stories.module.ts`、`stories/stories.service.ts`、`tasks/task.dto.ts`、`tasks/tasks.module.ts`、`uml/uml.module.ts`、`workbench/workbench.module.ts`、`plans/plan-adapter.module.ts`（后九项相对 `apps/api/src/`）。
- 前端：`apps/web/src/` 下 `App.tsx`、`Projects.tsx`、`ProjectOverview.tsx`、`Requirements.tsx`、`StoryViews.tsx`、`StoryInspector.tsx`、`Tasks.tsx`、`MyTasks.tsx`、`TaskWorkspace.tsx`、`TaskActions.tsx`、`MemberTaskGraph.tsx`、`UmlView.tsx`、`Workbench.tsx`、`PlanView.tsx`、`ProjectData.tsx`、`ui.tsx`、`v43.css`、`v43-react.css`、`a-project.css`、`a-plan.css`、`a-overview.css`。
- 共享契约：`packages/shared/src/index.ts`。
- 测试：`apps/api/test/integration.spec.ts`、`migration.spec.ts`；`apps/web/src/stories-ui.test.tsx`、`ui.test.tsx`、`v2-ui.test.tsx`；`scripts/s2-v43-browser.cjs`、`scripts/s2-phase1-browser.cjs`、`scripts/capture-v43-reference.cjs`、`scripts/fixtures/v43-reference.json`；根 `package.json` 增加命令。
- 交付材料：本报告、`docs/S2-V43-DIFF.md`、`docs/evidence/v43/`。

审阅使用现有 PR https://github.com/weilog/SPM/pull/1，目标仍为 Sprint 1 参考分支，不合并 main。
