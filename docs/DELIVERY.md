# Sprint 1 实施与交付记录

日期：2026-10-13（Asia/Shanghai）。仓库 https://github.com/weilog/SPM；本地目录 D:/Work/shiyan/SPM-typescript；独立功能分支 feat/s1-typescript-rebuild。基线 main/origin/main 为 3a2ed4c3a26921b5486c356f11ef1629a247acf8，检查时仅含 README，工作区干净，没有 AGENTS.md。远端 fetch/ls-remote 实际遇到连接重置和连接超时，因此未能确认远端是否新增提交；合并前由人工重新获取远端并检查。

唯一编码智能体连续完成 Sprint 1；无子智能体。实现范围固定为实验一 V1.1 的 US01/02/03/04/06/07/09，不包含 Sprint 2/3。全部提交留在功能分支；未 push、未建 PR、未合并 main。人工代码审查及最终 DoD 尚待完成。

## 技术栈与执行环境

React 19.3.0、TypeScript 5.9.3、Vite 7.3.7、Ant Design 6.6.6；NestJS 11.2.7；Prisma 7.10.0 + PostgreSQL adapter；PostgreSQL 17.9；pnpm workspaces 11.25.0；Node 24.15.0；Vitest 4.0.18、Jest 30.2.0、Supertest 7.1.4。依赖版本和锁文件均提交。Prisma 客户端由 generate 生成，不提交生成文件、node_modules、dist、口令、.env 或运行日志目录 .runtime。

本机 Docker Desktop 启动时报模型服务 socket 错误。自动清理该运行文件被执行策略拒绝；没有重置 Docker 或删除其数据。Ubuntu 自动更新占用 dpkg 锁，常规 Docker Engine 安装失败。最终将 Docker 官方静态 Linux 引擎 29.1.3 解压到 WSL 的 /tmp/spm-docker-engine，使用专用数据目录 /var/lib/spm-docker 和 socket /var/run/spm-docker.sock；没有修改 Docker Desktop 配置。引擎实际启动，Compose 启动 PostgreSQL，健康检查成功。

Docker Hub 镜像拉取超时，使用 Docker 官方 ECR 副本 public.ecr.aws/docker/library/postgres:17.9-alpine 拉取并在本地标记 postgres:17.9-alpine。实际镜像 digest 为 sha256:c7526c0f6c3f30260a563d7bcf8ad778effac59a44f8ffa86678c35418338609。来源见 [Docker 官方镜像目录](https://gallery.ecr.aws/docker/)；未使用未知第三方镜像或替换数据库。

本机 Compose 实际命令：

```powershell
wsl -d Ubuntu-22.04 -u root -- env DOCKER_HOST=unix:///var/run/spm-docker.sock /usr/bin/docker-compose --env-file /mnt/d/Work/shiyan/SPM-typescript/.env -f /mnt/d/Work/shiyan/SPM-typescript/infra/compose.yaml up -d --wait
```

WSL 临时引擎需要保持运行；WSL/主机重启后须重新启动引擎。健康的 Docker Desktop 用户使用 README 的标准 docker compose 命令即可。专用数据库卷保持持久化；没有执行 down -v。

## 七条故事与证据

| 故事 | 实现与边界 | 证据 |
| --- | --- | --- |
| US01 | 登录、有效会话、退出撤销令牌、错误/停用登录拒绝 | Jest/Supertest、前端登录和退出测试、HTTP |
| US02 | 管理员用户增删改、身份授权/撤权、密码重置、停用、保留最后有效管理员 | 非管理员全部高权限入口拒绝、密码/停用撤销旧会话 |
| US03 | 管理员指定有效经理，经理绑定本人，原子建立经理成员 | 名称校验、普通成员拒绝、伪造经理拒绝 |
| US04 | 有效成员添加/移除、成员唯一性、不能移除项目经理 | 跨项目/成员/其他经理拒绝，重复及并发重复测试 |
| US06 | 授权项目列表、按项目 ID 切换上下文、直达项目授权 | 多项目成员、移除立即撤权、前端项目切换 |
| US07 | 项目任务创建，标题必填，默认固定 TODO | 项目/状态注入拒绝、数据库 TODO 检查 |
| US09 | 当前有效成员指派、改派、清空；移除/停用清理 | 非成员、停用、跨项目任务、数据库绕过与并发停用测试 |

任务列表只提供经理用于创建与指派的标题/负责人索引，页面不显示状态看板，不提供状态编辑、验收、个人任务或任务内容编辑。全局身份只有 ADMIN/MANAGER/MEMBER，不实现项目内完整 RBAC。

## 实际检查与结果

| 命令 | 实际结果 | 日志 |
| --- | --- | --- |
| pnpm install --frozen-lockfile | 成功；锁文件下 753 个依赖包安装 | [install](evidence/install.txt) |
| pnpm db:generate | 生成 Prisma Client 7.10.0 成功 | 工具执行输出；类型检查/构建实际使用生成客户端 |
| pnpm db:migrate | 两份迁移实际应用成功 | [migrate](evidence/migrate.txt) |
| pnpm db:seed | 创建四类演示账户，未覆盖已有口令 | [seed](evidence/seed.txt) |
| Compose up --wait / SELECT version() | 健康；实际 PostgreSQL 17.9 | [compose](evidence/compose.txt)、[version](evidence/postgres.txt) |
| pnpm typecheck | shared/web/api 全部通过 | [typecheck](evidence/typecheck.txt) |
| pnpm build | shared、NestJS、Vite 全部通过 | [build](evidence/build.txt) |
| pnpm test | 前端 12 项；后端 25 项（24 个 PostgreSQL 集成用例 + 密码单元测试）全部通过 | [完整结果](evidence/full-test.txt) |
| node infra/http-smoke.mjs | 通过真实 Vite → NestJS → PostgreSQL 链路，PASS | [HTTP](evidence/http-smoke.txt) |

测试不是 mock 数据库：Jest 为每轮生成随机 schema，并实际运行 Prisma 迁移后通过 NestJS/Supertest 请求验证，结束后清理该 schema。测试拒绝连接非本机数据库。演示 public schema 不清空。前端测试使用 mock API 验证交互和请求契约；不声称这些用例替代真实浏览器验收。最终前端日志从全量运行中提取，部分日志仅规范行尾及尾部空白，不改动结果内容。

HTTP 实际验证：未登录 401、错误密码 401、四类账户登录、管理员获取用户、经理创建两个隔离项目、添加成员、创建 TODO 任务、有效指派、非法指派 400、跨项目任务 404、成员授权列表、无权项目 404、成员管理 403、全局用户管理 403、移除成员清空指派及撤销查看、恢复演示数据、退出后旧令牌 401。两次运行生成项目 1/2 与 3/4、任务 1/2，留在本地供人工查看；脚本重复运行会生成新的演示项目。

## 问题、修复与自我审查

1. pnpm 11 不再读取 package.json 中的构建许可配置，且自动补入未批准脚本的 YAML 占位项。修正为 pnpm-workspace.yaml 中明确许可 Prisma 引擎、esbuild 和 unrs-resolver，删除重复占位键后安装成功。
2. 首次 Vite 构建无法读取共享包的 CommonJS roleLabels 导出；改为共享 ESM 包后重新构建通过。API 使用其中的类型，不引入 ESM 运行时依赖。
3. Supertest 测试辅助函数 data 类型过宽而无法编译；收紧为 object 后运行。初始失败日志见 [api-test-initial](evidence/api-test-initial.txt)。
4. 一次 Jest 在 Windows/Node 24 下异常退出（3221226505），没有足够依据确定底层原因。开启 detectOpenHandles 后单独集成测试和完整测试多次运行通过；未修改密码哈希或删除负面用例。保留该观察作为运行环境风险。
5. 前端初始 6 项失败：Ant Design 二字按钮插入空格，测试查询未匹配；beforeEach 返回 mock 函数，被 Vitest 当成清理函数调用。采用弹性文字匹配，并让 beforeEach 不返回 mock；所有原用例保留并通过。见 [前端首次失败](evidence/web-test-initial.txt)。
6. 自审补充显式 null 校验，防止可选但不可空的字段进入 Prisma 后成为 500；增加并发成员唯一性和指派/停用竞争测试。数据库复合外键、有效用户行锁及清理触发器保护负责人约束。
7. 开发启动使用 tsc 保留 NestJS 装饰器元数据。尝试新增运行依赖时 pnpm 在 Windows 下出现 EPERM，导致 Jest 链接缺失；采用已有 TypeScript 编译链，停止服务、确认路径均在工作区内，将依赖目录移入被忽略的 .runtime 备份，再按锁文件全新安装。安装与完整测试恢复正常。见 [链接错误](evidence/install-link-error.txt)、[受影响的测试运行](evidence/full-test-link-error.txt)。
8. 首次 HTTP 检查早于 API 就绪，Vite 返回空响应；加入前后端健康就绪等待后重跑成功，见 [首次 HTTP](evidence/http-smoke-initial.txt)及最终日志。
9. 自审了 DTO 白名单、用户字段脱敏、Cookie/请求来源、项目和成员/任务归属、事务、数据库约束及前端状态切换。切换项目请求使用版本计数防止旧响应覆盖新上下文；前端不作为授权依据。

## DoD 自检与剩余风险

| 项目 | 状态 |
| --- | --- |
| 七条 Must 实现、页面与 REST 契约 | 已实现并自测 |
| Prisma 迁移、种子、数据库约束 | 已实际执行与验证 |
| 必要前后端、负面授权及集成测试 | 37 项通过 |
| 类型检查、构建、启动及 HTTP 联调 | 已通过 |
| 环境示例、README、日志与提交 | 已交付；最终 SHA 见 git log 和交付回复 |
| 自我审查与修复复测 | 已完成；不代替人工审查 |
| 人工页面验收、diff 审查及合并许可 | 待确认 |

剩余风险：本地开发配置未完成生产 HTTPS、限流、备份与负载验收；Vite 构建提示约 1 MB 初始 JS 包，可后续按页面分包；WSL 临时 Docker 引擎不是开机服务；Windows Jest 曾出现一次未定位的异常退出；远端最新状态需网络恢复后再核验。没有声称开展会议、人工审查、截图或最终批准。

最终审查必须使用 `git diff main...feat/s1-typescript-rebuild`，涵盖全部五个阶段提交。完成后停止，等待人工审查，不推进 Sprint 2/3、不合并 main。
