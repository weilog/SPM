# Sprint 2 负责人 B 第一阶段交付

基线：`feat/s2-owner-b`，起点 `4931137`（与已提交的 `feat/s1-typescript-rebuild` 相同）。使用独立 worktree，未改动原 Sprint 1 工作区的未提交内容，未合并 main。

已读取用户提供的《Sprint 2 A/B 开发规格 V0.9》和 `ai_management_sprint2_preview.html`。规格是设计候选；以本次明确授权实施第一阶段。未将原型的本地示例数据或 DOM 代码作为业务实现。

## 完成范围

正式需求包含需求列表、故事地图、故事看板三个 Tab。支持需求编号/标题搜索、详情 Drawer、居中创建/编辑 Modal，以及需求与故事双向维护的真实多对多关系。

故事地图按产品目标 → Epic → 用户故事展示；目标和 Epic 可创建、改名、调整排序位置；故事可创建、编辑描述/验收标准/关联需求，在同一 Epic 内拖拽排序或跨 Epic 移动。卡片落在另一张卡片上表示插入其前方，落在 Epic 的空白处表示放到末尾。

看板使用同一份 UserStory 数据，三列为 TODO / IN_PROGRESS / DONE，支持 Epic 筛选、编号/标题搜索、经理跨列拖拽及详情抽屉状态修改。失败的状态写入回滚本地卡片并提示。经理写，开发/测试只读；服务端逐次校验有效账户、项目成员及项目角色，无 ADMIN 自动放行。

故事修改使用 revision 乐观并发控制；移动时在串行化事务内重排两个 Epic，受影响卡片 revision 同步递增；陈旧修改返回 409。关系替换与内容保存是一个事务。反向修改需求关联也递增受影响故事的 revision。切换项目清空视图状态并忽略旧响应。

固定 56px 顶栏；浅色导航展开 224px / 折叠 64px；Ant Design 蓝白主题。保留登录、用户管理、项目、成员角色、任务创建/指派和我的任务入口。

## 数据库与升级

`202610210001_story_management` 是增量迁移，增加 ProductGoal、Epic、UserStory、StoryRequirement、StoryTask 和独立 StoryStatus 枚举。所有父子及关联表均使用含 projectId 的复合外键，数据库也拒绝跨项目关联。Task/Requirement 仅增加组合唯一索引与反向 Prisma 关系，不更改旧数据列或 Task.status 的 Sprint 1 约束。

StoryTask 已可真实存储多对多关系，本阶段不开放任务关联维护 API，也不向普通成员暴露全项目任务明细。

部署：配置 `.env` 后运行 `pnpm install --frozen-lockfile`、`pnpm db:generate`、`pnpm db:migrate`。不使用 reset 或 db push。

## API 契约

全部路径以 `/api/projects/:projectId` 开头，沿用 HttpOnly Cookie、`X-SPM-Request: 1` 和 Origin 校验。

| 路径 | 方法 | 请求/返回 |
| --- | --- | --- |
| `/story-map` | GET | 授权一致快照 `{goals, epics, stories}` |
| `/goals` | GET / POST | 列表；创建 `{title}` |
| `/goals/:id` | PATCH | `{revision, title?, sortOrder?}` |
| `/epics` | GET / POST | 列表；创建 `{title, goalId}` |
| `/epics/:id` | PATCH | `{revision, title?, sortOrder?}` |
| `/stories` | GET / POST | 列表；创建 `{title, epicId, description?, acceptanceCriteria?, requirementIds?}` |
| `/stories/:id` | GET / PATCH | 详情；编辑 `{revision, title?, description?, acceptanceCriteria?, requirementIds?}` |
| `/stories/:id/move` | PATCH | `{revision, epicId, position}`；移除当前卡片后从 0 开始的插入位置 |
| `/stories/:id/status` | PATCH | `{revision, status}` |
| `/requirements`、`/requirements/:id` | 原有 GET/POST/PATCH | 返回额外 `storyIds`；创建/编辑可提交 `storyIds` |

sortOrder/position 超过同级数量时放到末尾。数组省略表示不变，空数组表示清除关联。编号 REQ-xxx / US-xxx 仅用于显示，API 使用真实整数 ID。

## 验证与复现

本地 PostgreSQL 使用独立 Compose 项目 `spm-s2-stage1`；测试在随机隔离 schema 中运行并清理，不 reset 业务库。

```powershell
docker compose --env-file .env -f infra/compose.yaml -p spm-s2-stage1 up -d --wait
pnpm db:generate
pnpm typecheck
pnpm build
pnpm test
pnpm exec playwright install chromium
pnpm test:e2e:s2
```

浏览器验收需要空闲的 3000/5173 端口。可用 `SPM_CHROME_PATH` 指定已安装的 Chrome 代替下载 Chromium。脚本使用随机密码、独立数据库 schema 和真实 HTTP 请求；创建的业务测试数据结束后清理。截图保存在 `.runtime/s2-browser/`。

测试覆盖目标/Epic 创建编辑排序、故事编辑、同 Epic 排序、跨 Epic 移动、状态持久化且 Task 不变、双向关联、并发 409、角色矩阵、撤权、跨项目 API 和数据库约束、空值/重复数组/伪造字段、旧项目响应隔离及失败回滚。迁移测试在已填充 Sprint 1 数据库上对比用户、会话、项目、成员、任务、正式需求，重复部署并检查 schema 无漂移。

2026-10-21 最终执行结果：

| 检查 | 结果与原始输出 |
| --- | --- |
| `pnpm typecheck` | 通过，[输出](evidence/s2-phase1-typecheck.txt) |
| `pnpm build` | 通过，[输出](evidence/s2-phase1-build.txt) |
| `pnpm test` | 前端 25、后端 48 项通过，[输出](evidence/s2-phase1-tests.txt) |
| 增量迁移 / Sprint 1 回归 | 上述测试内执行，旧数据一致、重复部署成功、Prisma diff 无漂移 |
| `pnpm test:e2e:s2` | Chrome、真实 React/NestJS/PostgreSQL 全流程通过，pageErrors 为空，[输出](evidence/s2-phase1-browser.txt) |

浏览器覆盖真实 UI 创建、故事关联、同 Epic/跨 Epic 拖拽、刷新重新进入项目、状态拖拽、抽屉状态和标题修改、Epic/编号筛选、模拟服务器拒绝后的回滚、导航尺寸及 390px 移动端无页面横向溢出，最后验证开发人员只读与 Sprint 1 我的任务。

最初基线测试因 Docker 未启动报 ECONNREFUSED；启动 PostgreSQL 后重新执行通过。Vitest/jsdom 会输出 Ant Design CSS 解析警告；构建有单包体积提示，均需如实保留在测试输出中。

## A 侧对接与后续阶段

| 对接点 | 文件 | 状态 |
| --- | --- | --- |
| 项目/权限上下文 | `apps/web/src/App.tsx`、`apps/api/src/projects/projects.module.ts` | 复用已有 Project.canManage 与 ProjectsService.authorized；壳层仅加入必要导航和样式 |
| 嵌入地图/看板 | `apps/web/src/StoryViews.tsx` | 导出 StoryMap / StoryBoard，纯数据与回调驱动；支持 readOnly、busy、focus、onFocusChange、embedded |
| 统一焦点候选 | `packages/shared/src/index.ts` | ViewFocus / WorkbenchViewProps 为扩展点；未实现关联 resolve 或五视图容器 |
| 计划模型与甘特图 | A 负责 | 未定义 PlanItem、计划日期或 Task↔PlanItem 最终模型 |
| 多浏览器实时通知 | A/B 待统一 | 当前同组件三视图共享数据、写后重拉、窗口重新聚焦时重拉及手动刷新；未实现 SSE/WebSocket |

第二阶段的任务扩展、成员任务图、UML 用例图、多视图工作台不在本次实现范围；Sprint 2 八页整体 DoD 尚未完成。Requirement 删除/归档策略未擅自新增。

## 实际修改文件

| 类别 | 文件 |
| --- | --- |
| 数据库 | `apps/api/prisma/schema.prisma`、`apps/api/prisma/migrations/202610210001_story_management/migration.sql` |
| 后端 | `apps/api/src/app.module.ts`、`apps/api/src/requirements/requirements.module.ts`、`apps/api/src/stories/stories.dto.ts`、`stories.service.ts`、`stories.module.ts` |
| 前端 | `apps/web/src/Requirements.tsx`、`StoryViews.tsx`、`App.tsx`、`main.tsx`、`style.css` |
| 共享类型 | `packages/shared/src/index.ts` |
| 测试 | `apps/api/test/integration.spec.ts`、`migration.spec.ts`、`apps/web/src/stories-ui.test.tsx`、`ui.test.tsx`、`v2-ui.test.tsx`、`scripts/s2-phase1-browser.cjs` |
| 工具与交付说明 | `package.json`、`pnpm-lock.yaml`、`docs/S2-B-PHASE1.md`、`docs/evidence/s2-phase1-*` |

旧 UI 测试仅补充新 story-map 查询的空快照 fixture，保留原断言。Playwright 是开发依赖，运行时技术栈未变化。
