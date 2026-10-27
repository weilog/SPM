# P1 实际验证记录

2026-10-24 补充：已按用户授权完成 DeepSeek 最低价flash模型的真实联调；见 `docs/ai/P1-DEEPSEEK.md` 及本目录 `deepseek-live-result.json`。本文保留首轮与Docker恢复后的原始测试记录，不将当时的未联调状态冒充当前状态。

日期：2026-10-23。分支：`feat/ai-seven-pages`。远程基准再次检查为 `1d717ef378231f117f4b7bc5cfdd858cec9c839a`，没有合并 main。

## 环境与结果

Windows / Node **24.22.1**，PostgreSQL **17.9** 原生服务器，监听 `127.0.0.1:5543`。实例位于忽略目录 `.runtime/ai-pg-data`，随机密码只保存在忽略目录；每个数据库/浏览器测试使用独立随机 schema，finally 清理自己的 schema。**不是内存数据库或 Mock DbService**。

首次交付时，本机 Docker 原 PostgreSQL `5433` 未运行；Docker 启动受 Windows 残留 Unix socket 错误阻塞。当时没有重置 Docker、清理原数据卷或覆盖原业务数据库，采用 PostgreSQL 官方下载页链接的 EDB Windows 17.9 二进制独立执行测试。**用户恢复 Docker 后，已另行完成原5433实例的备份和M1部署，见文末补充复核。** 首轮日志仍保留独立实例的原始验证环境，避免混淆。

| 实际命令 | 最终结果 | 证据 |
|---|---|---|
| `pnpm typecheck` | 共享包、API、Web通过 | `typecheck.txt` |
| `pnpm build` | 通过；Vite有既有大bundle警告 | `build.txt` |
| `pnpm test` | Web **31/31**，API **96/96**；全部通过 | `tests.txt` |
| `pnpm test:e2e:a` | **13**组通过，含真实甘特拖动/缩放、文档、成员、SSE、B联动 | `browser-a.txt` |
| `pnpm test:e2e:v43` | **12**组通过，含需求树、故事拖拽、任务浮动菜单、权限、双视图 | `browser-b.txt` |
| `pnpm test:e2e:auth` | **7**组通过，含模拟邮件链接真实改密、会话撤销 | `browser-auth.txt` |
| `pnpm test:e2e:users` | **7**组通过，含真实账户管理及全局/项目权限隔离 | `browser-users.txt` |

浏览器均为真实 Chrome/Playwright，1440×900；账户脚本另覆盖移动注册。零浏览器运行时异常。P1未修改前端文件；截图仅作原功能回归证据，不是新AI UI。

## AI 专项证据

新增 **25**项后端测试，分布在 ai.spec.ts（18项）、ai-rules.spec.ts（6项）、ai-migration.spec.ts（1项）；其余71项为既有后端回归。完整Web31项保持不变。

- 真实 Nest HTTP接口、Cookie会话、CSRF请求头、数据库队列和后台执行；无 Provider配置时 PARTIAL/NOT_CONFIGURED，持久化真实规则证据，业务实体执行前后不变。
- 当前项目成员/对象校验、普通开发/测试角色不得发起或重试、全局ADMIN不得绕过项目授权、跨项目task/run/cursor拒绝、停用账号失效、执行期间撤销经理权限阻止报告发布。
- 普通成员先过滤整项风险的证据，再计算事件数和维度计数；剔除别人的Task、全项目模型推断和模型/来源私有元数据。真实接口响应样本见 `manager-report.json` 与 `member-report.json`，明确是独立数据库测试夹具的规则报告，不是生产示例或真实模型结果。
- 并发相同幂等键只落一条任务，冲突请求409；同源事件多维度不重复计数；稳定事件键跨视图一致。
- 原业务API修改Task后旧报告stale；读取/历史不触发模型。归档Task后历史证据标为非当前，成员再也读不到该Task证据；JSONB键序不会误判过期。
- 手动重试新建报告并重新取上下文，旧报告不改写，重试深度限额；Worker过期租约可见失败，不自动第二次模型调用；显式取消和后端重启后队列/历史持久化。
- 实际本机HTTP测试网关验证请求与响应合同，覆盖正常结构、非法JSON、伪造证据ID、过大响应、HTTP503、连接中断、超时和不完整输出；保留规则事实并准确降级。该网关是测试夹具，不是真实AI供应商。
- 输入字节上限、规则数量上限、模型调用预算及手动请求频控。
- M1对已有Sprint2各业务表**所有行的JSONB内容**和**全部原有列定义**升级前后比较一致；重复deploy、Prisma diff无漂移。原V1→全部迁移兼容测试也通过。

## 曾出现的失败与处理

1. 首次连接5433 ECONNREFUSED；未报告通过。切换独立真实17.9实例后完成数据库验收，原库未动。
2. 首轮AI专项19通过/2失败：JSONB键顺序导致证据误判（已修复规范化hash并覆盖删除源对象）；测试停用账号后原会话正确失效，测试改为显式重新登录后继续。修正后全部通过。
3. 新增升级夹具最初使用小写UML/文件类型，被现有数据库CHECK正确拒绝；改为原业务标准 USE_CASE/FILE，升级验收通过，没有修改业务约束。
4. B浏览器脚本最初只等页面外壳，项目数据未到就断言0≠1；仅补异步等待，仍验证1/3原预期值，复跑12组通过。
5. 完整测试一次与浏览器同时占用资源，已有v2-ui用例1秒默认等待超时（30/31）；未改业务代码或放松断言，浏览器结束后独立重跑完整 `pnpm test`，31+96全通过。

## 未通过真实供应商验证的部分

### Docker 恢复后的原库复核（2026-10-23）

- Docker Engine 29.4.1 可用；原容器 `spm-s2-stage1-postgres-1`（postgres:17.9-alpine）healthy，`127.0.0.1:5433`连接成功。Compose默认项目名与原容器项目名不同，因此通过实际容器和Prisma连接确认，未创建第二套容器或卷。
- 部署前执行真实 `pg_dump -Fc`，备份367106字节，保存在忽略目录 `.runtime/ai-original-before-m1.dump`；备份含敏感业务数据，不入Git。
- 对public中除AI表和迁移表外的全部22张表，记录排序后的每行JSONB内容SHA-256及列定义SHA-256。执行 `pnpm db:migrate` 只应用 `202610230001_ai_foundation`，随后全部22表内容和原列定义完全相同；6个项目、48条Task、46条Requirement保留。证据见 `original-data-recheck.txt`。
- `prisma migrate status`确认9项迁移全部已应用，原库schema已最新；见 `original-migration-status.txt`。
- 使用原5433 PostgreSQL服务器（测试仍各用随机schema，不修改public业务数据）重跑P1三个测试文件：**25/25通过**，包括真实数据库/API、授权隔离和增量升级测试。日志见 `docker-recheck-tests.txt`。
- 本轮仅补充部署验收记录，没有修改业务代码、页面、模型配置或进入P2；真实外部模型联调仍未完成。

### 真实供应商状态

真实外部供应商、模型和API Key尚未配置，**真实模型联调未完成**。默认 AI_ENABLED=false、AI_EXTERNAL_ENABLED=false。模型接口合同和异常分支通过本机测试服务验证。供应商确认及获准发送的字段范围确认前不启用外部传输。未开发P2–P7七页AI UI、需求规划事务或自动业务修改。
