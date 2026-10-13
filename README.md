# 爱管理 SPM Sprint 1

React + TypeScript + Vite + Ant Design 前端，NestJS REST 后端，PostgreSQL + Prisma，pnpm workspaces。当前实现 V2.0 Sprint 1 的 11 条 Must：US01 登录退出、US02 账户维护、US03 创建项目、US04 成员管理、US05 项目预设角色、US06 授权项目查看与切换、US07 创建任务、US09 指派负责人、US10 个人任务、US20 正式需求查看、US21 正式需求创建与编辑。

目录：apps/web、apps/api、packages/shared、infra、docs。版本与依赖固定在 package.json 和 pnpm-lock.yaml；本次运行 Node 24.15.0、pnpm 11.25.0、Prisma 7.10.0、PostgreSQL 17.9。启动前需 Node >=22.12 和可运行的 Docker Compose。

在仓库根目录执行：

```powershell
node infra/init-env.mjs
pnpm install --frozen-lockfile
docker compose --env-file .env -f infra/compose.yaml up -d --wait
pnpm db:generate
pnpm db:migrate
pnpm db:seed
pnpm build
pnpm dev
```

页面：[http://127.0.0.1:5173](http://127.0.0.1:5173)；API：[http://127.0.0.1:3000/api/health](http://127.0.0.1:3000/api/health)。Vite 的 /api 代理连接 NestJS。种子创建 admin、manager、manager_b、member、tester；密码为私有 .env 中的 SEED_PASSWORD。种子不覆盖已有用户和密码；开发/测试身份按项目成员角色分配。不要提交 .env 或真实口令。init-env 仅在文件不存在时生成随机密码；也可按 .env.example 手工配置。升级现有库只需正常执行 db:migrate，不运行 reset，不清空旧数据。

开发脚本先使用 tsc 生成 NestJS 装饰器元数据，再通过 Node watch 运行 dist；修改 API 源码后另开终端执行 `pnpm --filter @spm/api build`，Node 自动重启。前端 Vite 支持热更新。构建后的 API 也可通过 `pnpm --filter @spm/api start` 单独启动。请用同一个 127.0.0.1 地址访问，避免 localhost 与 127.0.0.1 的 Cookie/Origin 差异。

本机 Docker Desktop 启动异常时，本次使用了 WSL 独立 Docker 引擎；仍通过同一 Compose 文件启动 PostgreSQL，未更换数据库。具体运行命令和网络回退见 docs/DELIVERY.md；健康的 Docker Desktop 可直接使用上面的标准命令。

操作验收：

1. admin 在“用户管理”创建和维护账户、停用账户、重置密码。新账户默认系统用户；页面/API 均不提供全局角色调整（US16 属于 Sprint 2）。不能停用最后一个有效管理员或删除当前管理员。
2. 具备初始化项目创建身份或已担任项目经理的用户可创建项目并绑定本人。admin 可创建项目并选择有效账户作为项目经理；仅被指定经理加入该项目，创建者不自动获得项目业务权限。
3. 项目经理在“成员与项目角色”中添加成员并选择 MANAGER/DEVELOPER/TESTER 预设角色；可调整已有成员角色，不支持自定义角色。权限按每个项目独立判断，系统管理员若只是开发/测试成员，也不能管理该项目。移除或降级最后一名有效项目经理会被拒绝；经理交接后主经理引用相应更新。
4. 所有用户的项目列表都仅显示自己的成员项目，包括 admin。角色变更立即影响后续请求和界面；无权项目返回 404，有成员查看权但无管理权的操作返回 403。
5. 项目经理创建任务并指派当前有效成员；任务固定 TODO，不提供任务内容编辑、状态更新、验收或统计。开发/测试成员在项目“我的任务”中查看本人列表及详情，不能按他人 ID 查询私人任务，也不能跨项目查看。
6. 所有授权项目成员可在“正式需求”查看列表及详情；仅本项目经理可以直接创建和编辑标题/说明。正式需求独立于需求建议，不提供需求建议或需求—任务关联。本轮也不实现需求完成判定。
7. 停用账户会撤销会话、清空所有任务指派；移除项目成员仅清空相应项目指派。密码重置使旧会话失效。已有负责项目的用户不能直接删除，可停用或先由项目经理完成交接。
8. 点击退出后会话在服务端撤销，旧令牌无法访问；错误密码及未登录访问返回 401。

验证命令：

```powershell
pnpm typecheck
pnpm build
pnpm test
node infra/http-smoke.mjs
```

Jest/Supertest 使用本机 PostgreSQL 中独立测试 schema，执行实际迁移后清理，不清空演示库；另有填充 V1 数据后升级 V2 的迁移保留测试。回归覆盖 11 条故事、角色撤权、管理员项目边界、个人任务隐私、正式需求隔离及并发约束。Vitest 验证页面交互与 API 契约。HTTP 脚本需前后端和种子账户已就绪；它验证完整 V2 链路并创建带随机后缀的演示项目、需求、任务，重复执行会新增演示记录。

数据库使用负责人复合外键、成员唯一性、有效负责人触发器、停用/移除成员清理触发器和 TODO 检查约束。ProjectMember 新增项目角色；Requirement 只关联项目，未关联任务。V2 增量迁移保留原有数据，将既有主经理成员初始化为 MANAGER，其余成员为 DEVELOPER。事务采用 Serializable，兼容 Prisma 和 PostgreSQL 驱动层的序列化/死锁重试。会话只存摘要，Cookie 为 HttpOnly + SameSite=Strict，写操作校验自定义请求头与 Origin。

本轮不实现 Sprint 2/3：全局角色调整、任务内容编辑/状态流转、需求建议处理、需求—任务关联、测试验收、统计或 AI。数据库端口只绑定本机；生产 HTTPS、安全 Cookie、限流、备份和性能验收尚待部署工作。

新增 API：PATCH /api/projects/:id/members/:userId/role；GET /api/projects/:id/tasks/mine 及 /mine/:taskId；GET/POST /api/projects/:id/requirements 与 GET/PATCH /:requirementId。所有写请求继续要求 X-SPM-Request: 1，使用 HttpOnly 会话 Cookie。账户写入不接受 role；项目创建选项通过 /api/projects/creation-options 获取。

docs/ 中的既有记录保留为历史材料，本次不修改课程报告。评审使用 `git diff main...feat/s1-typescript-rebuild`；本次增量基线为 1323a84。全部更新留在原分支，不自动合并 main。
