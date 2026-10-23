# P1 共用 AI 基础设施交付

本次范围严格限定 P1。基于远程 `origin/feat/s2-owner-a-integration` 的 `1d717ef378231f117f4b7bc5cfdd858cec9c839a` 创建 `feat/ai-seven-pages`，不是从模板数据分支开发。没有修改七个业务页面、导航、需求层级规则或正式业务写入接口，没有进入 P2–P7。

## 实现与文件

| 文件 | 职责 |
|---|---|
| `apps/api/src/ai/ai.module.ts` | 统一模块、DTO、会话保护下的 HTTP 接口 |
| `apps/api/src/ai/ai.config.ts` | 后端开关、供应商/模型/密钥、超时、额度、上下文限制 |
| `apps/api/src/ai/ai.types.ts` | 分析范围、规则事实、证据、模型推断类型 |
| `apps/api/src/ai/context.service.ts` | 真实数据库授权快照、对象所属检查、SHA-256 来源版本 |
| `apps/api/src/ai/rules.ts` | 可复核的确定性规则、稳定事件键与维度合并 |
| `apps/api/src/ai/provider.ts` | JSON HTTP 网关适配、输入/输出限制、证据约束与降级 |
| `apps/api/src/ai/analysis.service.ts` | 手动提交、幂等、历史、权限过滤、过期检测、重试/取消 |
| `apps/api/src/ai/analysis.worker.ts` | PostgreSQL 持久队列、并发领取、租约、失败恢复 |
| `apps/api/src/app.module.ts` | 注册模块，不改变已有模块行为 |
| `apps/api/prisma/schema.prisma` | 仅增加 AI 表和 User/Project 反向关系 |
| `apps/api/prisma/migrations/202610230001_ai_foundation/migration.sql` | M1 增量迁移 |
| `apps/api/test/ai-rules.spec.ts` | 规则、模型输出验证、配置单元测试 |
| `apps/api/test/ai.spec.ts` | 真实 PostgreSQL + Nest HTTP + 会话 + Worker 集成及权限测试 |
| `apps/api/test/ai-migration.spec.ts` | 含既有 Sprint 2 需求树/故事/任务/计划/UML/文档数据的 M1 升级、全表数据/列兼容和无漂移验证 |
| `apps/api/test/migration.spec.ts` | 在原 V1 升级测试中检查新增 AI 表 |
| `scripts/s2-v43-browser.cjs` | 修复既有浏览器脚本在项目数据加载前就断言的竞态；原预期值不变，无业务UI改动 |
| `.env.example` | 后端配置清单，默认关闭 AI 和外部传输 |
| `docs/ai/P1-DELIVERY.md` | 本说明和 API/证据口径 |
| `docs/evidence/ai-p1/` | 实际执行的验证结果（最终结果另附） |

## M1 与兼容性

新增 `AiAnalysisRun`（项目、发起人、类型/范围、幂等键、执行状态、来源 hash/日期、规则版本、模型状态、脱敏模型信息、错误码、重试关系、领取租约和时间戳）及 `AiRiskFinding`（事件键、规则、严重度、维度、确定性事实、证据 JSON、独立推断 JSON）。

唯一键：每个项目/发起人/请求键一条任务；同一报告/事件键一条风险。项目删除级联删除 AI 报告，用户删除保留报告但发起人置空。状态、类型、严重度和非负重试深度有数据库 CHECK。队列、历史与模型额度统计有索引。

没有 ALTER 现有业务列，没有数据回填/清空，没有新增 Requirement.acceptanceCriteria 或 revision，没有修改需求树深度、Task/Plan 关系及原权限。部署前正常备份，再运行 `pnpm db:generate`、`pnpm db:migrate`。应用启用 AI 前必须先部署 M1。P1 回退可关闭 `AI_ENABLED` 并回退应用代码，保留增量表；不提供自动删表回退。

## HTTP API

所有路径前缀 `/api/projects/:projectId/ai`。使用现有登录 Cookie，写请求继续要求 `X-SPM-Request: 1` 与合法 Origin。客户端不能传 actor、角色、项目上下文快照或模型结果。

| 方法与路径 | 行为 |
|---|---|
| `GET /capabilities` | 项目经理查看脱敏配置状态；普通成员只收到能否查看有限结果的信息 |
| `POST /analyses` | 项目经理手动创建持久任务；默认 201 |
| `GET /analyses?limit=10&cursor=<UUID>` | 当前授权下历史元数据，最大20条；无全项目未过滤风险总数 |
| `GET /analyses/:runId` | 当前授权过滤后的报告、证据有效性、风险计数与过期标记 |
| `POST /analyses/:runId/retry` | 只对 FAILED/PARTIAL 手动新建任务，保留原记录，默认最多2层重试 |
| `POST /analyses/:runId/cancel` | 项目经理取消 QUEUED/RUNNING，已完成记录保持不变 |

请求示例：

```json
{"kind":"HEALTH","requestKey":"f4c87b18-4f3c-496c-8e7c-294264e9b042"}
```

```json
{"kind":"TASK","taskId":123,"requestKey":"5442a6e3-25ec-4c6b-a975-6e022813a77f"}
```

```json
{"kind":"PLAN","stageId":"实际阶段ID"}
```

六种只读规则分析类型为 HEALTH/COVERAGE/TASK/PLAN/MEMBER/CROSS_VIEW。TASK 可指定单个实际 taskId；PLAN/MEMBER 可指定实际 stageId。其他范围组合拒绝。需求规划的生成/审核/提交接口尚未开放，不把 P1 类型当作七页功能已完成。

创建响应形状（ID/时间由实际请求生成）：

```json
{"id":"<UUID>","status":"QUEUED","kind":"HEALTH","createdAt":"<ISO8601>"}
```

报告示意形状（不是内置演示结果）：

```json
{
  "id":"<UUID>","kind":"HEALTH","status":"PARTIAL","scope":{},
  "sourceDate":"2026-10-23","rulesVersion":"p1-2026-10-23.1","stale":false,
  "summary":{"uniqueEvents":1,"dimensions":{"PROGRESS":1,"ALLOCATION":1}},
  "findings":[{
    "id":"<UUID>","eventKey":"TASK_UNASSIGNED:123","ruleId":"TASK_UNASSIGNED",
    "severity":"MEDIUM","dimensions":["PROGRESS","ALLOCATION"],
    "fact":"任务 T-123 尚未完成且负责人为空；是否需要分配由项目经理核查。",
    "evidence":[{"key":"task:123","entityType":"task","entityId":123,"fields":{"title":"真实任务标题","status":"TODO","progress":0,"priority":"MEDIUM","assigneeUserId":null,"planIds":[]}}],
    "inference":null,"evidenceCurrent":true
  }],
  "visibility":"PROJECT_MANAGER","modelState":"NOT_CONFIGURED","modelInfo":{"rulesTruncated":false},
  "errorCode":null,"sourceHash":"<SHA256>","retryDepth":0
}
```

普通成员不返回 sourceHash、modelState/modelInfo、errorCode、retryDepth 或 inference。当前访问不到的证据对应整项风险被移除，再统计 uniqueEvents/dimensions；不向成员提供模型生成的全项目正文。对象作用域已不再授权的报告返回404，历史跳过该条。

HTTP 400：非法字段/范围、上下文过大、不可重试/重试超限；401：未登录/停用；403：非项目经理写操作；404：无项目访问权、跨项目对象/报告；409：幂等键冲突或读取期间授权变化；429：手动请求额度超限；503：AI 开关关闭。

## 确定性规则及证据

| 规则 | 可复核事实与边界 |
|---|---|
| TASK_UNASSIGNED | 实际非归档 Task 未完成且 assigneeUserId 为空；同一事件合并进度/分配两个维度 |
| TASK_WITHOUT_PLAN | TaskPlanReference 数量为0；INFO，仅说明无法从计划推导日期，不声称 Task 逾期 |
| PLAN_OVERDUE / MILESTONE_OVERDUE | 实际 PlanItem.end 早于检查日且状态非 DONE；证据明确是计划日期 |
| PLAN_OUTSIDE_STAGE | PlanItem 日期超出其真实 PlanStage 区间，附两者日期证据 |
| TASK_PRIORITY_CONCENTRATION | 同一实际负责人有至少3项未完成 HIGH/URGENT Task；只是任务集中信号，不是工时负荷 |
| SAME_OWNER_PLAN_OVERLAP | 同一计划负责人两个 TODO/IN_PROGRESS 普通计划项日期区间交叠；LOW，不断言资源冲突 |
| LEAF_REQUIREMENT_WITHOUT_STORY | 只检查叶子正式需求的直接故事关联，不误报父节点没有直接故事 |
| STORY_WITHOUT_REQUIREMENT | 用户故事无直接正式需求关联，人工判断是否需要补齐 |
| STORY_WITHOUT_UML | 仅 CROSS_VIEW 中的 INFO：无直接 UML 用例关联，不要求每个故事都建模用例 |

事件键由规则ID+稳定对象ID（对象对排序）构成；同一次报告去重，不因属于多个维度而重复计为多个事件。相同事件跨历史报告保持同一事件键，各报告保留当时证据，不覆盖历史。风险上限触发时标记 rulesTruncated 和 PARTIAL，不伪装成完整结果。没有工时容量、依赖、Task 原生截止日期，也不生成资源利用率、关键路径或精确延期概率。

## 权限、来源版本与执行状态

每次创建、执行、报告读取和持久化都复用 ProjectsService 当前项目成员权限和账号 active 状态；全局 ADMIN 不绕过项目成员权限。执行期间撤销经理权限会取消结果发布。

上下文从真实数据库按类型取最小集合：非归档 Task 及负责人/优先级/关联计划ID，计划/阶段日期及负责人，需求父子与故事关联、故事与需求/UML用例关联。经理任务范围为全项目；普通成员仅本人 Task，计划与需求/故事保留现有可读业务范围。受数量上限保护，超限显式拒绝，不悄悄截断输入。不开启外部模型时只做规则检测。

来源 hash 包括所选实体、现有 revision/updatedAt、真实关联、成员授权与检查日期（默认 Asia/Shanghai），仅报告读取时比对。经理比较完整来源 hash；成员仅比较可见证据与日期/规则版本，避免隐藏对象变化成为旁路。业务变化只标记 stale，不自动创建任务或调用模型。历史事实仍为快照，evidenceCurrent 提醒单项证据是否变化，重试重新取真实授权数据。

状态：QUEUED → RUNNING → COMPLETED（模型结构合格且规则完整）/ PARTIAL（规则成功但模型未配置、异常或截断）/ FAILED；人工取消、权限丧失可进入 CANCELLED。租约超时标记 FAILED/WORKER_INTERRUPTED，用户决定是否重试，不自动再次付费调用。并发领取有数据库状态和租约令牌校验，旧 Worker 不能覆盖后续状态。后台轮询只执行用户已创建的队列任务，不轮询业务变化触发分析。

默认额度：每项目/发起人10次手动请求/滚动分钟、每项目100次/滚动24小时、每项目20次模型尝试/滚动24小时；并发2为每进程上限。多实例分享数据库任务领取和额度，部署多实例需考虑总并发相加。所有模型尝试包括失败都占用额度，禁用供应商时不计模型调用。幂等重复键不新增任务；不同内容复用同键409。

## Provider 真实状态和数据外发

**尚未配置真实供应商/API Key，尚未完成真实模型联调。** 本次实现 json-http 可配置网关适配和测试专用本机 HTTP 服务，不宣称已直连 OpenAI/DeepSeek 等协议，也没有生产 Mock/Stub 成功结果。未来选定供应商需要实现或配置遵循本合同的真实网关，确认供应商、模型和数据处理范围，再显式启用。密钥只从后端环境读取，不在响应、前端或日志中输出。

启用条件同时要求 AI_EXTERNAL_ENABLED=true、AI_PROVIDER=json-http、非空 AI_SUPPLIER/AI_MODEL/AI_API_KEY、AI_APPROVED_DATA_SCOPE=project-evidence-v1，以及无内嵌凭证的 HTTPS 地址；仅本机测试允许 HTTP localhost/127.0.0.1。不跟随重定向。

出站只包含确定性 findings（eventKey/ruleId/severity/dimensions/fact）及对应 evidence（类型、ID、标题、状态/优先级/进度/负责人ID、关联ID、计划日期），不发送密码、会话、邮件、项目文档内容或无关描述。标题视为不可信业务数据。没有模型工具调用和业务写权限。

网关请求：`Authorization: Bearer <后端密钥>`，JSON `{model,maxOutputTokens,instructions,input:{scope:"project-evidence-v1",findings:[...]},outputSchemaVersion:1}`。响应要求 `{explanations:[{eventKey,explanation,recommendation,evidenceKeys}]}`。每项必须对应已知事件，非空文字各不超过2000字符，证据必须属于同一事件，重复/伪造事件和跨事件引用全部拒绝。未知字段不会入库。推断保存在独立 inference 字段，不改写 rule fact。

超时 TIMEOUT、网络 TRANSPORT_ERROR、HTTP_ERROR、FORMAT_ERROR、INCOMPLETE_OUTPUT、INPUT_TOO_LARGE、BUDGET_EXCEEDED、NOT_CONFIGURED 均保留规则事实并标记 PARTIAL。响应最大64KiB，请求默认120KB，超时默认15秒，输出token预算默认2000（网关必须遵守预算）；错误响应正文不回传。P1 只有只读报告，后续修改类建议的审核/业务事务留待对应阶段，不开放 apply/commit 路由。

## 测试与限制

最终实际结果见 `docs/evidence/ai-p1/verification.md` 及日志。数据库测试使用真实 PostgreSQL、独立随机schema、正式迁移、Nest路由、真实会话和后台Worker；没有替换 DbService/ProjectsService。仅外部供应商测试使用明确标注的本机 HTTP 测试服务，不能据此称真实模型联调通过。

未实现：七页 AI 正式 UI、需求AI生成/人工审核提交事务、供应商专用协议适配和真实外部联调、后续各页语义分析。均属于未授权阶段或需要明确真实供应商/模型后再接入。P1 完成后停止，不自动进入 P2。
