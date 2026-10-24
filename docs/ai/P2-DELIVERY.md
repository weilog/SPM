# 爱管理七页 AI 化 P2 交付与审核

分支：`feat/ai-seven-pages`；基于负责人 A 集成分支，延续 P1；不合并 main。实现范围为本轮授权的完整 P2，未启动 P3。设计依据：`docs/ai-design/` 中 V2.0 原型与规格；A/B 原业务组件优先，原型示例数据不进入正式业务。

## 七页实现与差异核对

| 页面 | 已实现 AI 功能 | 保留的业务界面与设计差异 | 验证 |
|---|---|---|---|
| 项目概览 | 原三张统计卡下面新增健康摘要；手动诊断、四维风险、同源事件去重、过滤、历史报告、过期提示 | 原项目信息、快捷入口、最近工作不替换；采用仓库的三张统计卡而非复制原型统计数字 | 七页浏览器组 1；A 回归组 1 |
| 需求管理 | 内部规划工作区；现有需求入口；1–3 层 AI 需求候选、目标/Epic/故事/独立任务；持久化草稿恢复、逐项编辑审核、创建/复用/跳过/更新验收、重复标题提示、未保存保护；单事务提交 | 原三 Tab、树表、搜索/展开/重设父节点、详情抽屉、创建编辑弹窗保留；原需求层级校验仍由原服务负责。规划是业务页内状态，不增加一级导航 | 七页组 2；真实 PostgreSQL/API 15 项 P2 用例 |
| 故事地图 | 叶子需求直接关联覆盖、语义关联核查建议、生成完善候选后进入同一审核工作区、故事风险提示和证据定位 | 原目标→Epic→故事、排序/跨 Epic 移动、看板状态、详情均保留；直接关联覆盖不冒充验收语义覆盖 | 七页组 3；B 回归故事拖拽/回滚 |
| 任务管理 | 项目/单任务执行建议；真实描述、关联及最近操作作为授权上下文；独立任务候选审核，正式写入复用原 Task 服务和操作历史 | 全部原筛选、列、行旁“···”、状态/进度/负责人/归档恢复保留。没有 Task 父子模型和原生截止日期，候选不伪造这些字段 | 七页组 4；B 任务及个人任务回归 |
| 项目计划/甘特图 | 风险报告；两组人工输入日期位移方案、基线/候选风险对比、日期冲突、打开原编辑器；保存前检查版本 | 复用原完整甘特组件、五 Tab、阶段栏、拖拽/伸缩/缩放；不提供整体应用，不自动改正式计划。方案为日期区间规则推演，不宣称关键路径或精确延期预测 | 七页组 5；A 甘特/共享组件/SSE 回归 |
| 成员任务跟踪 | 按真实 Task ID 去重、实际任务负责人集中度、高优先级任务集中、计划负责人日期重叠、证据与定位 | A 原成员分组、展开/收起、过滤、任务详情保留；B 成员关系图独立保留。不计算工时容量或利用率 | 七页组 6；A 成员重分配/SSE 回归 |
| 多视图工作台 | 同源跨视图风险聚合、事实/推断区分、证据查看、真实对象定位；需求证据打开正式需求抽屉，其余证据选择适当双视图并定位 | 原五视图、单/双视图、双向关联、完整 A 甘特、UML 均保留；关系解析增加需求起点及需求 ID，直接关联与多跳可达不宣称因果/依赖 | 七页组 7、8；A/B 五视图与权限回归 |

AI 抽屉保持右侧 640px、顶部避让 56px，56/224/64px 框架保留。风险标题、等级、证据字段用中文显示；对象内部 ID 仍用于精确定位。不存在 iframe/静态 HTML 替代业务页面。

截图：[原业务 / V2.0 原型 / P2 实现逐页对照](../evidence/ai-p2/index.html)。七页运行图来自实际 React + NestJS + Docker PostgreSQL 隔离数据库，模型为明确标记的本地协议测试替身；不将其标为真实模型结果。另附实际本机业务数据库、真实 DeepSeek 草稿恢复截图及联调记录。

## 文件与架构

新增后端：`apps/api/src/ai/planning.service.ts`（授权生成上下文、草稿、校验、原服务事务编排）、`scenarios.service.ts`（只读日期方案推演）。

复用并扩展 P1：`ai.module.ts`、`ai.types.ts`、`ai.config.ts`、`analysis.service.ts`、`analysis.worker.ts`、`context.service.ts`、`provider.ts`、`rules.ts`。沿用同一队列、租约、调用限额、取消、重试、报告、来源哈希、权限过滤与 Provider；没有第二套 AI 后端。

原业务后端必要变更：`requirements/requirements.module.ts`（验收字段、可选乐观版本、可注入事务）、`stories/stories.module.ts` / `stories.service.ts`、`tasks/tasks.module.ts`（导出和事务复用）、`workbench/workbench.module.ts`（需求关联定位）。仍执行原项目授权、层级、状态、分配规则和业务事件。

新增前端：`AiWorkspace.tsx`、`AiPlanning.tsx`、`ai-events.tsx`、`ai-types.ts`、`ai-hints.tsx`、`ai-labels.ts`、`ai.css`。公共项目 Provider 内增量嵌入，角色改变时清除经理报告状态。

嵌入点：`App.tsx`、`ProjectOverview.tsx`、`Requirements.tsx`、`StoryViews.tsx`、`TaskWorkspace.tsx`、`TaskActions.tsx`、`PlanView.tsx`、`PlanGantt.tsx`、`Workbench.tsx`；`packages/shared/src/index.ts` 增加向后兼容的需求属性和需求定位类型。涉及 B 文件仅用于 AI 入口、提示、原需求验收字段和共享定位；不重做 B 页面。

测试与配置：`apps/api/test/ai-p2.spec.ts`、`ai-deepseek.spec.ts`、`ai-migration.spec.ts`、`ai.spec.ts`、`disable-paid-ai.cjs`、`apps/api/jest.config.cjs`、`scripts/ai-p2-browser.cjs`、`scripts/s2-v43-browser.cjs`、`.env.example`。B 原生拖拽脚本改用可见 Epic 标题作为落点，避免新增工具栏后整个高列的中心落到视口外；仍真实拖拽并核验数据库。

## M2 增量迁移

`apps/api/prisma/migrations/202610240001_ai_planning/migration.sql`，配套 `schema.prisma`：

- Requirement 增加 `acceptanceCriteria`（空字符串默认）、`revision`（0 默认）；旧客户端不传版本仍兼容，AI/新表单传版本进行冲突校验。
- AiAnalysisRun 增加 `output` JSON，可保存候选、基线及只读推演；kind 校验追加 PLANNING、TASK_SPLIT。
- 新增 AiDraft：项目、作者、来源报告外键，候选和基线 JSON、revision、DRAFT/COMMITTED 状态、提交结果和时间；索引与约束。
- 不改变 Task/PlanItem/ProductGoal/Epic 的业务身份，不重置任何表。

真实数据库已备份后应用迁移。自动迁移测试比较旧字段/旧记录及 Prisma 无漂移；本机 public 24 张原表全部旧字段内容逐行哈希相同，原项目/任务/需求数仍为 6/48/46。新增需求默认值正确。备份及原始内容只放在忽略目录 `.runtime/`，不提交私有数据库。

## API

均在 `/api/projects/:projectId/ai` 下，要求原登录 Cookie 和写请求 `X-SPM-Request: 1`。沿用 P1 analyses、history、report、retry、cancel、capabilities。

| 方法/路径 | 行为 |
|---|---|
| POST `/analyses` | 新增 kind PLANNING/TASK_SPLIT；可传 requestText、requirementId 或 taskId，手动入队 |
| GET `/drafts` | 当前项目经理本人草稿；不跨作者返回 |
| POST `/drafts` | 从本人成功生成报告创建未审核草稿，或建立空草稿 |
| GET `/drafts/:id` | 内容、版本、状态、来源过期状态 |
| PATCH `/drafts/:id` | 带 revision 保存人工编辑及审核状态 |
| POST `/drafts/:id/revalidate` | 带 revision 校验最新项目对象，刷新基线并清除审核，需要重新逐项核对 |
| POST `/drafts/:id/commit` | 带 revision；授权、对象归属、引用、全量审核、来源版本验证后，在 Serializable 事务调用原业务服务；失败整体回滚，重复提交返回同一提交结果 |
| POST `/analyses/:id/scenarios` | `{"shifts":[3,7]}`，返回两组日期及风险对比，只保存分析输出 |

分析请求示例：

```json
{"kind":"PLANNING","requestText":"完善已有成员授权需求，生成父子需求并给出验收标准","requestKey":"客户端生成的UUID"}
```

入队响应：`{"id":"报告UUID","status":"QUEUED","kind":"PLANNING","createdAt":"..."}`。GET 报告成功后：`output.items` 为候选，每项 `reviewed:false`；`output.baseline` 为来源版本。

草稿请求：`{"title":"成员授权完善","runId":"成功报告UUID"}`。PATCH 请求包含 `revision`、`title`、`items`。候选示例：

```json
{"key":"r1","kind":"REQUIREMENT","title":"成员角色管理","description":"调整项目成员角色","acceptanceCriteria":"非经理操作返回403；刷新后角色保持","action":"CREATE","reviewed":true,"requirementKeys":[],"storyKeys":[],"planIds":[],"priority":"MEDIUM"}
```

子需求使用 `parentKey:"r1"`；现有对象引用如 `requirement:12`、`epic:4`，由后端再次检查类型/归属/权限。`REUSE` 要明确 existingId，仅复用关联，不覆盖原标题/状态/负责人；`UPDATE` 仅支持需求或故事验收。任务重用通过原接口合并关联并保留历史。提交请求 `{"revision":1}`；成功结果含 `status:"COMMITTED"` 和实际对象 ID。403 无权、404 对象不可访问、409 来源或版本变化、400 内容/层级/引用异常；不做部分成功。

## 权限、事实和模型

项目经理可手动分析/看完整报告；普通成员只读经对象权限过滤后的有限事实，再统计数量，不能分析、草稿写入或推演。不能读取生成报告正文。非成员 404；跨项目引用、其他经理的草稿、过期基线及取消授权均拒绝。角色切换清除前端完整经理报告。模型输出不具有业务写权限。

同源事件键为规则+真实对象 ID，同一事件跨维度只记一次；四维数字可重叠，不相加冒充总量。证据保存快照并检查当前版本，事实与模型解释/建议单独展示。结构覆盖按当前叶子需求与正式关联统计；语义覆盖、重复/归属/验收完善标为 AI 待核查推断。

规则：未完成任务无负责人、任务无计划关联、未完成计划/里程碑已超过计划结束日期、计划超出阶段日期、同人高优先级未完成任务集中、同计划负责人日期重叠、叶子需求无故事、故事无需求、故事无用例。P2 新增任务执行和需求故事语义核查 INFO 证据入口，**不是模型确认的缺陷或额外高风险**。

Provider：同一 DeepSeek 原生适配层，`deepseek-flash`、关闭 thinking、JSON 输出。本机后端 `project-planning-v2` 范围允许当前授权项目需求/故事的标题、描述、验收、目标/Epic、任务描述/关联/状态/优先级及最近十条操作名称、计划日期/关联和内部编号；不发送密码、会话、密钥、邮箱、文件内容或其他项目数据。密钥只在忽略的后端 .env。输入/输出/调用次数/并发/超时限额继续生效。

真实联调 **2 次**：PLANNING 4988 tokens、TASK_SPLIT 2696 tokens，均 COMPLETED/SUCCEEDED，每次两项候选，全部未审核、持久化 DRAFT；正式需求/任务/故事/计划哈希不变。元数据在 `deepseek-live-result.json`，真实草稿可在原项目“我的草稿”恢复；没有代理审核或提交正式数据。历史调用不因本次启动自动重跑。

自动化使用显式本地协议夹具，Jest 和七页浏览器脚本封锁非 loopback 请求；**自动化付费调用为 0**。失败、超时、输出非法/超层/错误类型退化为 PARTIAL/规则事实，不生成伪成功候选；失败重新生成不覆盖已保存的人工作业。手动重试复用 P1 队列限额与重试上限。

## 验证与交付边界

| 检查 | 结果 | 证据 |
|---|---|---|
| pnpm typecheck / pnpm build | 通过；已有大 bundle 警告仍在 | typecheck.txt / build.txt |
| pnpm test | 前端31、后端121全部通过；包含真实 PG 随机 schema 的迁移/API/权限/原业务回归 | tests.txt |
| 七页交互 | 8 组通过、0 运行异常、0 付费调用 | browser-ai.txt / browser-result.json |
| 原 A 页面/共享甘特/文档/成员/SSE | 13 组通过 | browser-a.txt |
| 原 B 需求树/故事拖拽/任务菜单/五视图/UML/权限/SSE | 12 组通过 | browser-b.txt |
| 登录注册找回/系统用户管理 | 分别7组通过 | browser-auth.txt / browser-users.txt |
| 原 public M2 / 旧数据核对 | 迁移通过；24张旧表旧记录无变化 | migration.txt / original-data.txt |
| DeepSeek 原生生成 + 本机 UI 恢复 | 2真实调用成功、候选未审核、正式数据未变 | deepseek-live-result.json / live-ui.txt / live-deepseek-planning.png |

P2 API 测试额外覆盖：三层需求/关联/Task 审核提交、错误中途全回滚、循环/四层/跨项目拒绝、过期与重新审核、重用合并、并发重复提交不重复写入、模型失败保留草稿、方案只读与过期拒绝、成员与非成员隔离。七页截图均为 1440×900，原型对照来自交付 V2.0 文件，原业务对照来自仓库原截图。

过程中曾出现的失败：原 B 拖拽脚本因列中心位置改变超出视口而超时，已用可见 Epic 标题落点修正并完整回归通过；并发执行共享包 build 引起 Vite 热更新，浏览器改在构建后执行，最终回归通过；真实联调首次选到了无任务项目，在模型调用前失败，改为选择本人可管理且有任务的项目后成功。不存在掩盖未通过结果。

未实现/风险：P3 整体业务验收与长时间并发/质量评估未执行；模型建议仍需实际负责人审核，不能证明语义正确或项目风险因果。没有容量、工时、依赖、Task 原生截止日期，因此不提供利用率、关键路径或精确延期概率。日期方案仅比较人工位移的两组候选，不是约束求解器。不新增批量整体应用计划。旧 bundle 大小警告未在本轮做无关重构。实时启动服务只供本机预览，未做外网部署。

P2 全七页实现与测试已交付，待审核；**不自动启动 P3**。
