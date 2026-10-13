# SPM
爱管理

当前实现实验一 V1.1 与 `第十组_Sprint1_Backlog_V1.0.md` 的七条 Sprint 1 Must：US01 登录退出、US02 全局用户及权限、US03 创建项目、US04 成员管理、US06 授权项目查看与切换、US07 创建任务、US09 指定负责人。人工 diff 审查和最终 DoD 验收待完成。Sprint 2/3、任务编辑/状态更新/验收、个人任务、统计和 AI 功能不在本次范围。

技术栈：Python 3.11、Django 5.2.18 LTS、SQLite、Django Templates、本地 CSS、Django 原生测试。Django 补丁版本参考[官方支持版本](https://www.djangoproject.com/download/)，本次实际安装版本固定在 requirements.txt。

Windows PowerShell 安装和运行（先安装 Python 3.11）：

```powershell
py -3.11 -m venv .venv
./.venv/Scripts/python.exe -m pip install -r requirements.txt
./.venv/Scripts/python.exe manage.py migrate
$env:DJANGO_SECRET_KEY = (& ./.venv/Scripts/python.exe -c "from django.core.management.utils import get_random_secret_key; print(get_random_secret_key())")
./.venv/Scripts/python.exe manage.py createsuperuser
./.venv/Scripts/python.exe manage.py runserver 127.0.0.1:8000
```

如果旧 Python Launcher 遮蔽安装管理器，可显式运行 `C:/Program Files/PyManager/pymanager.exe install 3.11` 安装，再通过 `C:/Program Files/PyManager/py.exe -V:3.11 -m venv .venv` 创建环境。路径依本机安装位置调整。macOS/Linux 使用 `python3.11 -m venv .venv`，后续解释器路径为 `.venv/bin/python`。

首次管理员通过交互式 createsuperuser 初始化；不要将真实口令、SECRET_KEY、`.env` 或数据库提交到 Git。默认 DEBUG=1，仅允许本机访问；缺少环境密钥时开发模式每进程生成临时密钥，重启后会话失效。如需重启后保留会话，给各进程设置相同的私有环境密钥。DEBUG=0 时必须提供密钥，且启用安全 Cookie；生产部署及 HTTPS 配置未验收。默认数据库为本地 `db.sqlite3`，被 Git 忽略；`DJANGO_DB_PATH` 可覆盖 SQLite 路径，HTTP 验证脚本使用独立临时数据库，不写入演示数据。

结构：`config/` 配置与路由；`accounts/` 用户与后台权限；`projects/` 项目、成员、权限函数、事务服务及迁移；`tasks/` 任务与指派；`templates/` 页面；`static/css/` 样式；`scripts/` 真实 HTTP 验证；`docs/` 过程与测试记录。

路由和操作：

| 路由 | 行为 |
| --- | --- |
| `/login/` | Django 登录表单；错误密码或停用账户不能登录 |
| `/` | 受保护首页，未登录跳转登录页 |
| `/logout/` | 仅 POST，页面退出按钮携带 CSRF；GET 返回 405 |
| `/admin/` | 仅 active + staff + superuser 可以使用，管理 User/Group/Permission |
| `/projects/` | 仅列出有权查看的项目，通过项目链接切换上下文 |
| `/projects/new/` | 管理员指定有效经理；项目经理创建时默认本人负责 |
| `/projects/<id>/` | 授权项目详情，经理可进入成员/任务创建与指派入口 |
| `/projects/<id>/members/` | 项目经理或系统管理员添加有效成员，重复成员拒绝 |
| `/projects/<id>/members/<membership_id>/remove/` | 仅 POST，移除本项目成员并清空其本项目任务指派 |
| `/projects/<id>/tasks/new/` | 创建本项目任务，可立即选择有效成员作为负责人 |
| `/projects/<id>/tasks/<task_id>/assign/` | 为本项目任务指派、改派或清空负责人 |

演示步骤：

1. 管理员登录 `/admin/`，在“用户”中新建用户并设置密码；可编辑资料、重置密码、停用或删除账户。
2. 编辑用户时，通过“组”“用户权限”授权或撤销全局权限。“项目经理”组由迁移建立；将用户加入此组后，可创建项目、管理本人负责的项目。组不包含 Django 模型级权限，不授予系统管理员身份；业务服务在服务端检查组身份及项目归属。
3. 系统管理员需同时勾选“有效”“职员状态”“超级用户状态”。只有现有系统管理员能执行这些操作。不要停用或撤销最后一个管理员；必要时通过本地 createsuperuser 恢复。
4. 用普通用户登录 `/login/`，确认可看到首页；点击退出后，再访问 `/` 必须重新登录。普通用户、项目经理、带 User/Group 权限的非管理员 staff 直接访问或 POST 后台 URL 均被拒绝。
5. 用项目经理进入“查看我的项目”→“创建项目”，输入名称及说明。管理员创建时须指定有效的项目经理；经理自动加入成员，不能从成员页移除。
6. 在项目内添加普通用户，随后创建任务（标题必填），选择当前项目的有效成员作为负责人。暂不指派时留空；可通过“指定任务负责人”入口改派或清空。任务默认并固定为 TODO，不提供状态编辑。
7. 用成员登录，确认项目列表仅显示所属项目，点击项目链接查看/切换。成员可查看项目基本信息；成员页与任务操作仅向有管理权限者开放。直接输入其他项目 URL 返回 404；有查看权但无管理权的操作返回 403。
8. 从成员页移除已被指派的成员，其本项目指派自动清空，其他项目指派保留；从全局 Admin 停用用户时，其所有项目指派自动清空，已有登录会话失去访问。撤销“项目经理”组立即撤销项目管理及创建权，既有成员仍可查看所属项目。

系统管理员可查看和管理全部项目；项目经理只能管理本人负责的项目，即使加入其他经理项目也只有查看权；普通用户仅查看所属项目。每次请求重新检查授权，不依赖浏览器保存的“当前项目”。项目 ID、任务 ID、成员关系 ID 均按项目归属查找。负责人有效性由表单与服务/模型校验，成员唯一性与 TODO 状态由数据库约束保护。业务写操作使用事务；项目/任务模型未注册到 Admin，以免绕过业务服务。所有页面写操作要求 POST + CSRF。成员移除、用户停用或删除后的负责人清理由信号执行。

项目经理外键采用 PROTECT：已有负责项目的用户不能直接删除，可停用；本轮未提供项目删除或经理转移功能。受信任的维护代码应使用业务服务，直接 SQL/QuerySet.update 不属于受支持的用户操作，可能绕过跨表校验或信号。

自动化检查：

```powershell
./.venv/Scripts/python.exe manage.py check
./.venv/Scripts/python.exe manage.py makemigrations --check --dry-run
./.venv/Scripts/python.exe manage.py test --verbosity 2 --noinput
./.venv/Scripts/python.exe scripts/smoke.py
./.venv/Scripts/python.exe scripts/sprint1_smoke.py
```

实际执行的 71 项完整测试通过，包含阶段 A 的 25 项；真实 HTTP 全流程与 CSRF 验证通过。运行结果、缺陷修复、七故事映射与 DoD 自检见 [Sprint 1 交付记录](docs/SPRINT1_REPORT.md)。[阶段 A 记录](docs/STAGE_A_REPORT.md)为历史记录，不表示当前仍只有阶段 A。原始日志位于 `docs/evidence/`。

最终审查必须包含阶段 A：`git diff main...feat/s1-foundation-auth`；仅查看本次新增变更可用 `git diff 2264fa1...feat/s1-foundation-auth`。本地提交完成后停止，待王学锋/刘博雨审查，不自动合并，也不自动推进 Sprint 2/3。
