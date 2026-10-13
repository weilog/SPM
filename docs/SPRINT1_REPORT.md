# Sprint 1 一体化开发与自检记录

日期：2026-10-13（Asia/Shanghai）。唯一编码智能体执行，无子智能体参与。沿用 `feat/s1-foundation-auth`，起点 `2264fa1a318e1abebd3aa513aca6c273855615df`；起始工作区干净，main 为 `3a2ed4c3a26921b5486c356f11ef1629a247acf8`，无 AGENTS.md。

本次用户明确授权连续完成剩余五条故事，覆盖原任务包 B/C/D 每阶段暂停要求；不要求或授权将未经审查代码合入 main。所有提交保留在功能分支，最终人工审查范围包含阶段 A。Python 3.11.9、Django 5.2.18 LTS、SQLite、Templates 技术栈未变。

## 七条故事的完成情况

这里的“实现并自测”不代表人工 DoD 已批准。

| 故事 | 实现情况 | 关键自动化证据 |
| --- | --- | --- |
| US01 登录退出 | 沿用 A，完整回归通过 | accounts.AuthenticationTests：有效/错误/停用登录、退出与会话、CSRF、next 安全跳转 |
| US02 全局用户及权限 | 沿用 A；与停用用户清理指派集成 | accounts.GlobalAdministrationTests：增删改、密码、组/权限授权撤销、非管理员 staff 拒绝；tasks 停用/删除用户清理 |
| US03 创建项目 | 实现并自测 | ProjectCreationTests：管理员选择经理、经理本人绑定、必填/长度校验、普通用户拒绝、伪造经理忽略、服务与 CSRF |
| US04 成员管理 | 实现并自测 | MembershipTests：添加/移除、有效用户、重复唯一性、不能移除经理、跨项目 ID、普通成员及其他经理越权 |
| US06 查看与切换 | 实现并自测 | ProjectVisibilityTests：授权列表、跨项目切换、直达无权 URL、移除后立即失权、HTML 转义 |
| US07 创建任务 | 实现并自测 | TaskTests：持久化、标题约束、项目/状态伪造无效、TODO 数据库约束、普通成员和外部经理拒绝 |
| US09 指定负责人 | 实现并自测 | TaskTests：指派/改派/清空、当前有效成员筛选、非成员/停用/跨项目拒绝、撤权、移除/停用清理 |

项目详情的经理任务标题/负责人入口仅用于 US09 找到并指派任务；没有实现 US12 的任务状态视图，也没有实现 US05/08/10/11/12/13/14/15、验收、统计或 AI 能力。

## 设计与修改文件

- projects：Project、ProjectMembership、迁移、表单、URL、视图、授权函数、事务服务、清理信号、25 项测试。
- tasks：Task、迁移、表单、URL、视图、事务服务、21 项测试；负责人可空，status 固定 TODO。
- config/settings.py、config/urls.py：注册应用和路由，支持隔离验证使用的 SQLite 路径。
- templates/base.html、accounts/home.html、projects/*、tasks/*：项目切换、项目创建、成员操作、任务创建及负责人指派。
- scripts/sprint1_smoke.py：真实 HTTP + Cookie/CSRF，全流程使用临时数据库及随机口令；启动与清理服务器，结束后删除临时数据库。
- README.md、本文、docs/evidence/sprint1-*：安装、操作、权限边界、失败/修复与结果。

系统管理员 active + staff + superuser 可以查看/管理全部项目；经理组身份只能管理本人负责的项目；加入其他经理项目不产生管理权；普通有效成员可查看其项目基本信息。撤销经理组后保留成员查看权并撤销管理权。项目经理删除采用 PROTECT，防止项目失去负责人；没有经理转移或项目删除界面。

## 实际执行和缺陷修复

1. 核查 git status/log、文件和阶段 A 配置后，新增两个应用并执行 `manage.py makemigrations projects tasks`；成功生成两份初始迁移，check 无问题。
2. 初轮 `manage.py test --verbosity 2 --noinput` 实际发现 69 项测试，14.764 秒，OK，退出码 0。保留 [首轮日志](evidence/sprint1-test-initial.txt)。
3. 自审发现 `request.POST or None` 将空 POST 当成未绑定表单。新增两个回归用例运行后实际失败 2 项，日志见 [缺陷复现](evidence/sprint1-review-regression.txt)。修复为按请求方法显式绑定 POST，创建表单返回必填错误，空负责人请求可清空指派。同时收紧视图 HTTP 方法。
4. 修复后的完整回归发现 71 项测试，14.994 秒，OK，退出码 0，见 [最终完整日志](evidence/sprint1-test-final.txt)。没有删除失败用例或更换密码哈希来掩盖问题。
5. 首次真实 HTTP 操作全部达到预期，但打印中文 PermissionDenied 日志时触发 Windows GBK/UTF-8 的 UnicodeEncodeError；脚本整体退出码 1。保留 [初次 HTTP 日志](evidence/sprint1-http-smoke-initial.txt)，其中 PASS 仅为打印异常前的业务检查，不代表命令成功。
6. 修复为父进程输出 UTF-8、子进程 PYTHONUTF8=1，且在完成日志与进程清理后打印 PASS。重跑成功，退出码 0，见 [最终 HTTP 日志](evidence/sprint1-http-smoke.txt)。日志中的 403 PermissionDenied 堆栈属于预期越权拒绝。
7. 对原阶段 A 的本地数据库执行 migrate，projects/tasks 迁移均 OK，见 [迁移日志](evidence/sprint1-migrate.txt)。独立 HTTP 临时库另外从零执行了全部迁移。
8. check 输出 `System check identified no issues (0 silenced).`；makemigrations --check --dry-run 输出 `No changes detected`；pip check 输出 `No broken requirements found.`。分别见 [check](evidence/sprint1-check.txt)、[迁移一致性](evidence/sprint1-migrations-check.txt)、[依赖](evidence/sprint1-dependencies-check.txt)。

实际命令均使用 `./.venv/Scripts/python.exe`。测试、迁移、HTTP 和检查输出通过 PowerShell `2>&1 | Tee-Object docs/evidence/<文件>.txt` 保存并检查退出码。真实 HTTP 链路：登录→经理创建项目→添加成员→创建任务→指定有效负责人→非法负责人拒绝且原指派保留→成员只见所属项目→跨项目 404→成员管理/指派 403→移除成员后清空负责人并撤销查看→POST 退出→未登录跳转。没有伪造手工浏览器验收、截图或会议。

## 自我审查与 DoD

逐项检查了阶段 A 的 AdminSite/认证/配置，与本次所有模型、迁移、表单、视图、服务、模板及测试。业务读请求先缩小到授权项目；写请求额外验证管理权；任务和成员 ID 在当前项目内查找；服务再次验证权限与模型；所有页面写操作均受 CSRF 保护；数据约束和失败请求后的数据库状态有测试。负责人清理限定相应项目，停用账户清理全部指派。项目/任务未注册到 Admin，避免绕过服务约束。

| DoD 条件 | 自检状态 | 证据或限制 |
| --- | --- | --- |
| 七条 Must 功能可运行 | 通过自动化验证 | 全量测试、真实 HTTP、README 操作步骤 |
| 每条关键路径及越权测试 | 通过 | accounts 25 + projects 25 + tasks 21 = 71 |
| 实际运行、发现错误、修复复测 | 通过 | 原始失败日志与最终退出码 0 日志 |
| 模型和迁移一致 | 通过 | 本地升级迁移、临时库全新迁移、迁移检查 |
| 关键模块职责与边界清晰 | 已自审 | 权限/服务集中、边界注释、README |
| Git 提交可追溯 | 提交后核验 | A 历史保留；最终 SHA 见交付回复和 git log |
| 运行说明和测试证据完整 | 已更新 | README 和 docs/evidence |
| 人工 diff/权限审查 | 待人工完成 | 王学锋/刘博雨；必须覆盖 main 到分支全部差异 |
| 人工验收、允许合并 | 待人工确认 | 没有宣称 DoD 完全批准 |

## 剩余问题与风险

- 尚未人工浏览器验收或多人并发压力测试；SQLite 和 runserver 用于本地教学演示，生产部署、HTTPS、限流未验收。
- 默认临时 SECRET_KEY 重启失效；保持会话需设置私有环境密钥。最后一个管理员的停用/撤权没有额外业务保护。
- 已有负责项目的经理不能直接删除；支持停用。经理转移、项目删除不属于本轮范围。
- 跨表负责人规则通过受支持的表单/服务以及成员和用户信号保证。维护代码须使用服务；直接 SQL、QuerySet.update、bulk_create 等绕过校验或信号的写法不受支持。没有承诺任意数据库写入都受跨表数据库约束保护。
- 人工审查及最终 DoD 尚待完成。未 push、未建 PR、未合并 main，不自动进入 Sprint 2/3。

完整审查：`git diff main...feat/s1-foundation-auth`（包含 A）。本次增量：`git diff 2264fa1...feat/s1-foundation-auth`。最终 SHA 和提交列表由交付回复提供，避免提交内嵌自身 SHA。
