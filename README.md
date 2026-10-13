# SPM
爱管理

当前只交付 Sprint 1 阶段 A（T00–T02）：工程基础、US01 登录退出、US02 全局用户及权限。依据实验一 V1.1 和 `第十组_Sprint1_Backlog_V1.0.md`。项目、成员、任务等阶段 B/C 功能尚未实现；Sprint 2/3、统计与 AI 功能不在本次范围。人工 diff 审查和最终 DoD 验收待完成。

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

首次管理员通过交互式 createsuperuser 初始化；不要将真实口令、SECRET_KEY、`.env` 或数据库提交到 Git。默认 DEBUG=1，仅允许本机访问；缺少环境密钥时开发模式每进程生成临时密钥，重启后会话失效。如需重启后保留会话，给各进程设置相同的私有环境密钥。DEBUG=0 时必须提供密钥，且启用安全 Cookie；生产部署及 HTTPS 配置未在阶段 A 验收。数据库存放在本地 `db.sqlite3`，被 Git 忽略。

结构：`config/` 配置与路由；`accounts/` 后台权限策略、首页、身份组迁移和测试；`templates/` 页面；`static/css/` 样式；`scripts/smoke.py` 真实服务器检查；`docs/` 验收记录。

路由和操作：

| 路由 | 行为 |
| --- | --- |
| `/login/` | Django 登录表单；错误密码或停用账户不能登录 |
| `/` | 受保护首页，未登录跳转登录页 |
| `/logout/` | 仅 POST，页面退出按钮携带 CSRF；GET 返回 405 |
| `/admin/` | 仅 active + staff + superuser 可以使用，管理 User/Group/Permission |

演示步骤：

1. 管理员登录 `/admin/`，在“用户”中新建用户并设置密码；可编辑资料、重置密码、停用或删除账户。
2. 编辑用户时，通过“组”“用户权限”授权或撤销全局权限。“项目经理”组由迁移建立，本阶段没有任何业务权限；加入该组不授予系统管理员身份。
3. 系统管理员需同时勾选“有效”“职员状态”“超级用户状态”。只有现有系统管理员能执行这些操作。不要停用或撤销最后一个管理员；必要时通过本地 createsuperuser 恢复。
4. 用普通用户登录 `/login/`，确认可看到首页；点击退出后，再访问 `/` 必须重新登录。普通用户、项目经理、带 User/Group 权限的非管理员 staff 直接访问或 POST 后台 URL 均被拒绝。

授权检查由自定义 AdminSite 和后台登录表单在服务端执行；首页链接只负责展示。复用 Django 密码哈希、密码校验、Session、CSRF、迁移与后台审计日志。此阶段不实现自助注册及项目内 RBAC。

自动化检查：

```powershell
./.venv/Scripts/python.exe manage.py check
./.venv/Scripts/python.exe manage.py makemigrations --check --dry-run
./.venv/Scripts/python.exe manage.py test --verbosity 2 --noinput
./.venv/Scripts/python.exe scripts/smoke.py
```

实际运行结果、首次失败及修复见 [阶段 A 记录](docs/STAGE_A_REPORT.md)，原始日志位于 `docs/evidence/`。评审差异命令：`git diff main...feat/s1-foundation-auth`。本地提交完成后停止，待王学锋/刘博雨审查，不自动合并。
