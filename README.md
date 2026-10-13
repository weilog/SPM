# 爱管理 SPM Sprint 1

React + TypeScript + Vite + Ant Design 前端，NestJS REST 后端，PostgreSQL + Prisma，pnpm workspaces。当前实现实验一 V1.1 七条 Must：US01 登录退出、US02 全局用户/权限、US03 创建项目、US04 成员管理、US06 查看/切换授权项目、US07 创建任务、US09 指定负责人。

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

页面：[http://127.0.0.1:5173](http://127.0.0.1:5173)；API：[http://127.0.0.1:3000/api/health](http://127.0.0.1:3000/api/health)。Vite 的 /api 代理连接 NestJS。种子创建 admin、manager、manager_b、member；密码为私有 .env 中的 SEED_PASSWORD。种子不覆盖已有用户和密码。不要提交 .env 或真实口令。init-env 仅在文件不存在时生成随机密码；也可按 .env.example 手工配置。

开发脚本先使用 tsc 生成 NestJS 装饰器元数据，再通过 Node watch 运行 dist；修改 API 源码后另开终端执行 `pnpm --filter @spm/api build`，Node 自动重启。前端 Vite 支持热更新。构建后的 API 也可通过 `pnpm --filter @spm/api start` 单独启动。请用同一个 127.0.0.1 地址访问，避免 localhost 与 127.0.0.1 的 Cookie/Origin 差异。

本机 Docker Desktop 启动异常时，本次使用了 WSL 独立 Docker 引擎；仍通过同一 Compose 文件启动 PostgreSQL，未更换数据库。具体运行命令和网络回退见 docs/DELIVERY.md；健康的 Docker Desktop 可直接使用上面的标准命令。

操作验收：

1. 用 admin 登录“用户管理”，创建用户、编辑身份、停用账户、重置密码；manager/member 不显示该入口，直接 API 调用也返回 403。最后一个有效管理员不能停用/降级；不能删除当前管理员。
2. 用 manager 创建项目，经理自动绑定本人并加入成员。admin 创建时须指定有效 MANAGER。项目名称必填；普通成员不能创建。经理不能指定其他经理。
3. 进入项目“成员管理”，添加有效用户；重复添加拒绝。移除成员会清空其本项目任务指派。经理自身不能移除；其他项目经理即使加入本项目，也只有查看权限。
4. 用 member 查看“我的项目”，仅看到所属项目。通过项目卡片进入，再返回列表切换。无权项目 API 返回 404；有查看权但无管理权的成员/任务操作返回 403。
5. 经理打开“任务创建与指派”，输入标题，可立即指定当前有效成员；创建后 status 为 TODO。通过“指定负责人”改派或清空；非成员和已停用用户不能指定。此界面不提供任务编辑、状态更新、验收或统计。
6. admin 停用用户后，既有会话立即失效且所有指派清空；角色撤销在下次请求生效；密码重置撤销已有会话。已有负责项目的用户不能直接删除，可停用。
7. 点击退出后，服务端会话被撤销，复制的旧令牌也无法访问。错误密码与未登录 API 分别返回 401。

验证命令：

```powershell
pnpm typecheck
pnpm build
pnpm test
node infra/http-smoke.mjs
```

Jest/Supertest 使用本机 PostgreSQL 中随机生成的独立测试 schema，执行实际迁移并在结束后清理，不清空演示数据库。Vitest 检查登录、权限入口、项目切换、任务提交和 API 客户端。HTTP 脚本需前后端已启动；通过 Vite 代理验证完整链路，并创建两组带随机后缀的本地演示项目及任务，供人工审查。重复执行会创建新的演示项目。

数据库使用负责人复合外键、成员唯一性、有效负责人触发器、停用/移除成员清理触发器和 TODO 检查约束。事务采用 Serializable，并重试序列化冲突。会话只在数据库存摘要，Cookie 为 HttpOnly + SameSite=Strict，写操作校验自定义请求头与 Origin。

本轮不实现 Sprint 2/3、项目内 RBAC、任务编辑/状态流转、个人任务、验收、统计或 AI。数据库端口只绑定本机；开发服务不代表生产部署。生产 HTTPS、安全 Cookie、限流、备份和性能验收尚待后续部署工作。

详见 [API 契约](docs/API.md)、[架构](docs/ARCHITECTURE.md)、[交付与真实测试证据](docs/DELIVERY.md)。评审命令：`git diff main...feat/s1-typescript-rebuild`。所有代码保留在功能分支，人工审查和最终 DoD 待确认，不自动合并 main。
