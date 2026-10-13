# Sprint 1 阶段 A 实施与验收记录

执行日期：2026-10-13（Asia/Shanghai）。阶段 A；分支 `feat/s1-foundation-auth`。本记录只描述本次实际执行，人工 diff 审查人及是否允许合并均待确认，不代表 Sprint 全量完成或人工 DoD 验收通过。

## 仓库核查与范围

实际克隆 `https://github.com/weilog/SPM.git` 至 `D:/Work/shiyan/SPM`。开始时 `main` 与 `origin/main` 指向 `3a2ed4c`（Initial commit）；文件树只有 README.md，内容为 SPM / 爱管理；无代码、测试或 AGENTS.md，工作树干净。执行 `git switch -c feat/s1-foundation-auth` 后才编写代码。

读取用户提供 DOCX 的正文与 ZIP 中两份 Markdown。V1.1 中七条 S1 Must 为 US01/02/03/04/06/07/09；本次只执行任务包阶段 A 的 T00–T02。DOCX 的“实验一不实施编码”属于原规划阶段描述，本次用户已明确授权实验二开发。没有实现项目、成员、任务模型及阶段 B/C/D 的业务或全量验收；没有实现 S2/S3 功能。采用原建议技术栈，无替代栈。

代码使用 Django 原生 User/Group/Permission。迁移只创建无权限的“项目经理”全局身份组；没有项目内 RBAC。后台仅允许有效且具有 staff、superuser 标志的系统管理员，普通 staff 即使有全部 auth 模型权限也被服务端拒绝。登录和后台表单都复用 Django 密码与会话机制；退出仅 POST + CSRF。

## 实际环境与命令

Python 3.11.9；Django 5.2.18；SQLite；Django Templates。requirements.txt 固定本次实际安装的 Django、asgiref 3.12.1、sqlparse 0.6.0、tzdata 2026.5。测试口令在运行时随机生成；数据库、环境及密钥未纳入提交。

关键命令按本次实际执行记录：

```powershell
git clone https://github.com/weilog/SPM.git SPM
git status --short --branch
git log -5 --oneline
git remote -v
git branch -a
git switch -c feat/s1-foundation-auth
py install 3.11
python install 3.11
& 'C:/Program Files/PyManager/pymanager.exe' install 3.11
& 'C:/Program Files/PyManager/py.exe' -V:3.11 -m venv .venv
./.venv/Scripts/python.exe -m pip install 'Django==5.2.18'
./.venv/Scripts/python.exe manage.py test --verbosity 2 --noinput
./.venv/Scripts/python.exe manage.py migrate --noinput
./.venv/Scripts/python.exe manage.py test --verbosity 2 --noinput
./.venv/Scripts/python.exe scripts/smoke.py
./.venv/Scripts/python.exe manage.py check
./.venv/Scripts/python.exe manage.py makemigrations --check --dry-run
./.venv/Scripts/python.exe -m pip check
```

测试、迁移及检查通过 PowerShell `2>&1 | Tee-Object docs/evidence/<日志名>.txt` 留存实际输出，并检查退出码。最终测试日志在增加后台表单正向登录用例后重新生成，保留首次失败日志。

## 失败与修复

1. 主机起初只有 Python 3.13。`py install 3.11` 被旧 Launcher 解释为脚本路径；`python install 3.11` 同样失败。显式调用 PyManager 成功安装 Python 3.11.9，未修改系统 PATH 或卸载既有 Python。
2. 首次 24 项测试，20 项通过、4 项失败（见 test-initial.txt）。失败均为 Admin 用户编辑请求返回 200 而预期 302。测试请求遗漏必填的 Admin 分拆日期字段 `date_joined_0` / `date_joined_1`；补齐用户本地加入日期后，编辑、授权、撤权及停用用例均通过。
3. 排查表单时，在尚未迁移的本地 SQLite 上调用 UserChangeForm 校验，遇到 `OperationalError: no such table: auth_user`。测试数据库本身正常；对本地库实际执行 migrate 后解决。数据库被忽略。
4. 代码自查发现默认 Admin 登录表单接受非管理员 staff 登录后会再次被后台拒绝；增加 SystemAdminAuthenticationForm，在登录阶段拒绝非 superuser，避免登录跳转循环。负向登录测试验证了表单报错且不建立会话。

## 测试证据与故事映射

最终回归：`Ran 25 tests in 7.765s` / `OK`，退出码 0。`check` 输出 `System check identified no issues (0 silenced).`；迁移成功；迁移检查输出 `No changes detected`；依赖检查输出 `No broken requirements found.`；真实 HTTP smoke 输出 PASS。

| 内容 | 证据 |
| --- | --- |
| 首轮测试及 4 项失败堆栈 | [test-initial.txt](evidence/test-initial.txt) |
| 最终完整回归及逐项结果 | [test-final.txt](evidence/test-final.txt) |
| 实际 SQLite 迁移 | [migrate.txt](evidence/migrate.txt) |
| Django check 无问题 | [check.txt](evidence/check.txt) |
| 无遗漏模型迁移 | [migrations-check.txt](evidence/migrations-check.txt) |
| 依赖一致性 | [dependencies-check.txt](evidence/dependencies-check.txt) |
| 真实 runserver 进程与 HTTP 请求 | [smoke.txt](evidence/smoke.txt) |

US01 自动化验证：有效登录、错误/不存在/停用账户拒绝、会话退出、GET 退出拒绝、未登录跳转、停用已登录用户失去访问、CSRF、外站 next 拒绝及本地跳转。

US02 自动化验证：管理员登录后台及访问 User/Group、创建用户与哈希密码、弱密码和重复用户名拒绝、资料编辑、组和权限授予/撤销、系统管理员身份授予/撤销、停用/删除、重置密码、组权限管理、管理员写操作 CSRF、普通用户/经理/staff/停用账户直接 GET 与 POST 越权拒绝、后台登录身份边界。

真实服务器检查：`/` 返回 302，`/login/` 返回 200 且含登录模板和 CSRF 字段，`/admin/` 返回 302，本地 CSS 返回 200，GET `/logout/` 返回 405。脚本实际启动 runserver，结束时终止该进程；没有声称完成浏览器人工操作或截图验收。

## 剩余风险与人工接手

- 待王学锋/刘博雨审查 `git diff main...feat/s1-foundation-auth`，核验权限测试并决定是否允许合并。最终 SHA 由交付回复及 `git log -1` 获取，避免提交内记录自身 SHA 的循环。
- 本次仅本地提交，未 push、未创建 PR、未合并 main。功能分支工作可供人工审查，后续开发须等待人工明确许可。
- 默认配置只用于本地教学演示。生产 HTTPS、部署、登录限流等未验收；临时开发密钥在进程重启后使会话失效，稳定会话需设置私有环境密钥。
- 系统管理员能撤销/停用自己的身份；本阶段没有“保留最后一个管理员”业务约束，演示时需谨慎，可经受信任的本地 createsuperuser 恢复。
- 项目经理组仅表示全局身份，后续 B 阶段才实现项目授权；不能把本次结果声称为完整 Sprint 1 多项目隔离验收。没有伪造会议、人工评审或批准记录。
