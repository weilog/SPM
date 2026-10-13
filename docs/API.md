# Sprint 1 REST 契约

前缀 /api。请求/响应为 JSON；前端通过 Vite 代理访问后端。身份来自 spm_session HttpOnly Cookie。除登录、health 外均需有效会话。写请求必须携带 X-SPM-Request: 1；若提供 Origin，必须等于 WEB_ORIGIN。前端默认携带 cookies，自定义请求头阻止跨站表单伪造。

统一错误：`{statusCode, code, message}`。message 为字符串或校验消息数组。401 会话失效，403 有查看权但无操作权/全局权限不足，404 项目不可见或对象不属于当前项目，400 DTO/业务输入问题，409 唯一性/引用/并发冲突。不会返回密码哈希或数据库错误详情。

| 方法与路径 | 请求与响应 | 权限 |
| --- | --- | --- |
| GET /health | `{ok:true}` | 公开 |
| POST /auth/login | username/password → User，设置 Cookie | 公开；写来源校验 |
| GET /auth/me | User | 有效会话 |
| POST /auth/logout | 撤销服务端会话并清 Cookie | 有效会话 |
| GET /users | User[] | ADMIN |
| POST /users | username/password/role → User | ADMIN |
| PATCH /users/:id | username/password/role/active 可选 → User | ADMIN |
| DELETE /users/:id | `{ok:true}` | ADMIN；不能删除当前管理员或负责项目的用户 |
| GET /projects | Project[]，含 manager/canManage | ADMIN 全部，其他仅负责/成员项目 |
| POST /projects | name/description?/managerId? → Project | ADMIN 指定有效经理；MANAGER 默认本人 |
| GET /projects/managers | 有效经理 User[] | ADMIN |
| GET /projects/:id | Project，含 canManage | 授权项目用户 |
| GET /projects/:id/members | ProjectMember[]，含 user | ADMIN 或本项目有效 MANAGER |
| GET /projects/:id/member-candidates | 可添加的有效 User[] | 同上 |
| POST /projects/:id/members | userId → ProjectMember | 同上；不允许重复 |
| DELETE /projects/:id/members/:userId | `{ok:true}`，清空本项目指派 | 同上；不能移除项目经理 |
| GET /projects/:id/tasks | Task[]，用于经理指派入口 | 同上 |
| POST /projects/:id/tasks | title/description?/assigneeUserId? → Task | 同上 |
| PATCH /projects/:id/tasks/:taskId/assignee | assigneeUserId（整数或显式 null）→ Task | 同上；任务属于该项目 |

角色为 ADMIN/MANAGER/MEMBER；用户名允许字母、数字、下划线、点和短横线，长度 1–80；新密码长度 12–128。项目名和任务标题去首尾空白后长度 1–200；说明不超过 10000 字符。负责人必须是当前项目有效成员，null 表示未指派。任务 status 固定 TODO；不允许额外字段改变项目归属/状态或编辑任务内容。

POST 成功返回 201，GET/PATCH/DELETE 返回 200。共享公开结构位于 packages/shared/src/index.ts。经理任务入口只实现创建与指派，不提供任务编辑、状态更新、验收或统计。
