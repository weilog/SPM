# Sprint 1 架构与任务计划

前端 React + TypeScript + Vite + Ant Design；后端 NestJS REST API；数据库 PostgreSQL，由 Docker Compose 启动；ORM Prisma；pnpm workspaces 单仓库。

apps/web 管理页面与 API 调用，apps/api 按 Auth、Users、Projects、Tasks 模块组织。packages/shared 固化公开类型与角色枚举；infra 提供数据库；docs 保存契约、执行日志和验收证据。

会话使用随机令牌的 HttpOnly Cookie，数据库保存令牌摘要及到期时间；退出删除服务端会话。每次请求查询当前用户状态与角色。写操作要求自定义请求头，并验证 Origin。项目读权限按管理员、项目经理和成员限定；管理操作只能由管理员或该项目有效经理执行。

负责人通过项目/用户复合外键关联 ProjectMember；数据库迁移补充有效用户、成员移除清理和固定 TODO 的约束。事务保护创建项目和经理成员绑定、成员移除及指派操作。业务只包含 US01/02/03/04/06/07/09。

提交顺序：初始化；认证用户；项目成员；任务分配；集成测试及交付。每阶段执行相关检查，全量构建/类型检查/Vitest/Jest/Supertest/迁移/种子/HTTP 最终验收。人工负责 diff 和最终 DoD，不自动合并 main。
