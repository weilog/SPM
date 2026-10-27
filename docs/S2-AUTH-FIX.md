# V4.3 登录、注册和找回密码补修

2026-10-22。上次交付遗漏了 V4.3 `ab-source-data.login` 内嵌的认证页面，仍使用 Sprint 1 绿色登录界面，也没有注册/找回入口。本次按原型补齐四个 React 页面，并按用户最新要求只模拟邮件，不发送真实邮件。

## 界面与交互

保留原型的蓝白 56%/44% 双栏、品牌介绍及装饰工作台、424px 表单、标题、文案、字段、间距、密码显示按钮，以及注册/找回/返回登录导航。移动端隐藏品牌栏。注册包含用户名、邮箱、两次密码和管理员邀请码；找回包含用户名与绑定邮箱；重设包含两次新密码。原型浏览器中文正常，第一次读取时的乱码是终端显示问题，并非附件损坏。

[四个页面的原型/实际实现同尺寸对比](evidence/auth/index.html)，均为1440×900；另有390px移动端和模拟邮件截图。原型的演示提交提示已替换为实际业务反馈。

找回流程：填写已注册用户名及邮箱 → 申请密码重置 → 显示“模拟邮件已生成，未发送真实邮件”与“打开模拟邮件中的重置链接” → 设置新密码 → 返回登录。没有 SMTP 接口或邮件发送依赖。该展示链接模式用于本地验收，`AUTH_MAIL_MODE=simulation` 启用；production 环境拒绝模拟模式。

## 后端及兼容

- POST `/api/auth/register`：校验管理员邀请码和邮箱，密码至少12位，只创建 MEMBER，邮箱规范化且唯一；不能通过请求指定管理员角色。
- POST `/api/auth/forgot-password`：用户名/已绑定邮箱匹配后生成明确标注的模拟邮件链接。错配不返回链接。重复请求间隔60秒。
- POST `/api/auth/reset-password`：真实修改密码；令牌哈希入库、30分钟有效、一次性使用，拒绝过期/失效/停用账户；成功后撤销旧会话，旧密码不能登录。
- 增量迁移 `202610220002_auth_pages` 增加可空 User.email 和 PasswordReset；保留旧账号和其他记录。旧账号没有绑定邮箱时不生成链接，不能凭用户名重置。
- 本机已启用模拟模式及随机管理员邀请码。邀请码保存在被忽略的 `.runtime/registration-invite.txt`；未提交邀请码或其他凭据。

## 文件

`apps/web/src/Login.tsx`、`auth.css`、`main.tsx`、`auth-ui.test.tsx`；`apps/api/src/auth/auth.module.ts`；`apps/api/prisma/schema.prisma`、`migrations/202610220002_auth_pages/migration.sql`；`apps/api/test/auth-pages.spec.ts`、`migration.spec.ts`；`.env.example`、根 `package.json`、`scripts/auth-pages-browser.cjs`；本报告及 `docs/evidence/auth/`。没有引入邮件发送依赖。

## 实际验证

| 检查 | 结果 |
| --- | --- |
| pnpm typecheck | [通过](evidence/auth/typecheck.txt) |
| pnpm build | [通过](evidence/auth/build.txt)，保留原有 Vite 大包警告 |
| pnpm test | [前端31项、后端60项通过](evidence/auth/tests.txt)，含数据库升级无数据损失/无漂移、Sprint 1 回归 |
| pnpm test:e2e:auth | [7组通过](evidence/auth/browser.txt)：注册/校验、模拟邮件链接、真实重置/旧会话失效、登录、桌面/窄屏布局、四页原型截图、浏览器异常0 |
| pnpm test:e2e:v43 | [原有12组业务浏览器回归通过](evidence/auth/v43-regression.txt) |
| 本机迁移 | [已应用](evidence/auth/migration.txt)，未重置数据库 |

测试使用本地 PostgreSQL 的随机隔离 schema；不会创建正式测试账号或发送外部消息。浏览器运行使用 Node24.19.0 及本机 Chrome；运行命令前设置 `SPM_CHROME_PATH` 为实际 Chrome 路径。认证浏览器脚本使用3002/5175，正式应用继续运行3000/5173。

过程中的失败已修复并复测：注册必填星号影响精确标签查找，已增加明确可访问名称；旧全局 CSS 影响装饰统计卡和密码图标，已隔离样式并验证图标实际尺寸；新增外键遗漏 ON UPDATE CASCADE 导致迁移漂移，已修正且升级回归通过。早期曾实现并测试本地 SMTP，用户要求模拟后已移除该实现和全部发送依赖，最终测试/截图均为模拟版本。曾因未设置 Chrome 路径导致浏览器启动失败，配置后回归通过。

本次不改变前次报告中 A 真实计划服务仍待对接的状态。
