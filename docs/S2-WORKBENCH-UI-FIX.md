# 工作台与甘特图 UI 修复（2026-10-22）

- 根因：全局 style.css 将 `.story-board` 设为三列 grid；与后加载样式的顺序冲突，让统计区、卡片容器及说明文字成为三个并排区域。用 `.v43-shell .story-board` 明确指定外层块布局，内部 `.board-columns` 负责真正三列。窄面板在自身容器内横向滚动，不裁掉整列。
- 甘特图：信息列和日期轴之间新增可拖动分隔条，保留全部四个字段；鼠标指针捕获，支持左右方向键，宽度限制保留时间轴空间。同一组件应用于独立项目计划和工作台；不更改任务日期、状态、权限。
- 删除：地图和看板的开发说明、工作台每个面板底部说明（包括已过期的“服务待接入”）、文档目录底部授权说明、甘特图拖拽及底部说明、阶段导航底部提示。保留真实统计、字段和业务操作。

1440×900实际检查通过：单视图和双视图看板外层为块布局、统计位于三列上方；鼠标拉宽100px、键盘调整20px、工作台窄面板宽度限制；浏览器异常0。运行截图：

- [单视图看板](evidence/workbench-ui-fix/workbench-board-fixed.png)
- [双视图看板](evidence/workbench-ui-fix/workbench-board-dual-fixed.png)
- [可调整宽度的甘特图](evidence/workbench-ui-fix/gantt-resizable-fixed.png)
- [工作台甘特图](evidence/workbench-ui-fix/workbench-gantt-resizable.png)

pnpm typecheck、build通过；B浏览器12组回归通过。单元测试首次30/31，旧项目入口异步用例在并行运行时未找到按钮；未修改该测试，完整复跑前端31/31通过。最终测试日志随证据保留。

后端68/68通过，含迁移、权限和A/B接口回归。
