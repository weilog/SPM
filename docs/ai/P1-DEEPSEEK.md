# P1 DeepSeek 原生接入与真实联调

2026-10-24：用户确认使用 DeepSeek 并选择费用最低的模型，授权补做 P1 模型联调。没有进入 P2，没有修改七页业务 UI、数据库模型或业务写入逻辑。

## 实际模型及协议

根据当日[官方价格表](https://api-docs.deepseek.com/zh-cn/quick_start/pricing/)，当前提供的模型中 `deepseek-flash` 价格最低。真实 `GET https://api.deepseek.com/models` 返回200，并列出 `deepseek-flash` 与 `deepseek-v4-pro`。采用前者，关闭思考模式，不启用工具/搜索/抓取，不做自动失败重试。

原生接口为 `POST https://api.deepseek.com/chat/completions`，参照[官方接口](https://api-docs.deepseek.com/zh-cn/api/create-chat-completion/)、[JSON模式](https://api-docs.deepseek.com/zh-cn/guides/json_mode/)及[思考模式](https://api-docs.deepseek.com/zh-cn/guides/thinking_mode/)。发送 system/user messages、`thinking.type=disabled`、`response_format.type=json_object`、`max_tokens` 和 `stream=false`，不套用原 json-http 网关格式。

模型返回的 content 经 JSON 解析后，继续通过 P1 同事件/同证据、唯一事件、字段长度与结构校验；不会把供应商原始正文直接作为正式报告。截断为 OUTPUT_LIMIT，空内容/非法JSON/工具调用为 FORMAT_ERROR，保留确定性事实并降级 PARTIAL。只白名单记录实际模型名和数值token用量，不记录密钥或原始推理内容。

## 后端配置

本机配置保存在 Git 忽略的 `.env`，不进入前端或仓库：

```dotenv
AI_ENABLED=true
AI_EXTERNAL_ENABLED=true
AI_PROVIDER=deepseek
AI_SUPPLIER=DeepSeek
AI_ENDPOINT=https://api.deepseek.com/chat/completions
AI_MODEL=deepseek-flash
AI_APPROVED_DATA_SCOPE=project-evidence-v1
AI_TIMEOUT_MS=60000
AI_MAX_OUTPUT_TOKENS=1000
AI_MAX_MODEL_CALLS_PER_PROJECT_24H=5
AI_CONCURRENCY=1
# AI_API_KEY is configured privately; deliberately omitted here.
```

DeepSeek原生模式只接受上述官方HTTPS端点、供应商和flash模型，避免把密钥发给其他地址或意外切换更贵模型。原 json-http 网关适配继续保留。5次是每项目滚动24小时模型尝试上限，不是金额预算或跨项目总额；本轮人工联调额外限制最多5次，实际只用1次。没有自动分析触发器。

外发仅为项目经理授权下的规则风险及对应最小证据（对象编号、标题、状态、优先级、进度、负责人ID、关联ID和计划日期）。不发送密码、会话、邮箱、文档内容。本轮选取一条真实任务，没有发送全项目业务正文。用户曾在聊天提供密钥，已建议在供应商控制台轮换；轮换后仅更新本机后端配置。

## 真实联调结果

链路：现有项目经理真实登录 → 正式创建分析API（TASK范围）→ PostgreSQL队列 → 授权数据库上下文/规则 → DeepSeek官方端点 → 结构/证据校验 → 报告入库 → 正式读取API。

- 实际付费模型请求：**1次**，不是Mock或本机网关。
- 报告 `c86cff6c-4b03-4471-a65d-87a04c911362`，项目2、任务5；COMPLETED / SUCCEEDED。
- 1项确定性风险、1项校验通过的模型推断；来源hash已保存，读取时stale=false。
- 用量：输入304 tokens（未命中缓存），输出87 tokens，总计391。
- 联调时为北京时间周六空闲时段。按查阅时官方单价（未命中输入1元/百万tokens、输出4元/百万tokens），估算约 **0.000652元**；此为根据用量的计算值，实际账单以DeepSeek控制台为准。
- 原Task、Requirement、UserStory、PlanItem数据在分析前后内容hash一致。
- 可公开的脱敏结果元数据见 `docs/evidence/ai-p1/deepseek-live-result.json`。真实业务标题、模型全文及密钥留在忽略目录，不写入交付资料。

## 代码与验证

修改 `apps/api/src/ai/ai.config.ts`、`apps/api/src/ai/provider.ts` 和 `.env.example`，新增 `apps/api/test/ai-deepseek.spec.ts`，没有新增依赖/迁移。

供应商协议单元测试明确替换fetch，不发生付费请求；覆盖固定官方地址/便宜模型、关闭思考、JSON结构、用量白名单、截断/空内容/非法结构/工具调用、伪造证据、私有推理不落库等。它们和上述单独记录的真实联调相互区分。

最终 `pnpm typecheck`、`pnpm build`通过；`pnpm test`前端31/31、后端104/104（含8项新增DeepSeek协议测试）通过。记录见 `docs/evidence/ai-p1/` 中 `deepseek-typecheck.txt`、`deepseek-build.txt`、`deepseek-tests.txt`。Vite仍有既有大bundle警告。尚未实施七页AI正式UI和P2–P7功能；后端模型接通不代表七页AI功能已完成。
