import { AiConfig } from "../src/ai/ai.config";
import { AiProvider } from "../src/ai/provider";
import type { Finding } from "../src/ai/ai.types";

// These protocol tests explicitly replace network fetch. Only the separately
// recorded manual smoke test may contact the real supplier and incur charges.
describe("DeepSeek native adapter, no paid network calls in test suite", () => {
  const findings: Finding[] = [
    {
      eventKey: "TASK_UNASSIGNED:1",
      ruleId: "TASK_UNASSIGNED",
      severity: "MEDIUM",
      dimensions: ["ALLOCATION"],
      fact: "Task has no owner",
      evidence: [
        {
          key: "task:1",
          entityType: "task",
          entityId: 1,
          fields: { title: "Untrusted title" },
        },
      ],
    },
  ];
  const output = {
    explanations: [
      {
        eventKey: findings[0].eventKey,
        explanation: "可能存在分配风险",
        recommendation: "人工核查",
        evidenceKeys: ["task:1"],
      },
    ],
  };
  let config: AiConfig,
    provider: AiProvider,
    spy: jest.SpiedFunction<typeof fetch>;
  beforeEach(() => {
    config = new AiConfig();
    Object.assign(config, {
      externalEnabled: true,
      provider: "deepseek",
      supplier: "DeepSeek",
      model: "deepseek-flash",
      apiKey: "TEST_NOT_REAL",
      endpoint: "https://api.deepseek.com/chat/completions",
      approvedScope: "project-evidence-v1",
      timeoutMs: 1000,
      maxOutputTokens: 1000,
    });
    provider = new AiProvider(config);
    spy = jest.spyOn(globalThis, "fetch");
  });
  afterEach(() => jest.restoreAllMocks());
  const response = (content = JSON.stringify(output), finish = "stop") =>
    new Response(
      JSON.stringify({
        model: "deepseek-flash",
        choices: [{ finish_reason: finish, message: { content } }],
        usage: {
          prompt_tokens: 100,
          completion_tokens: 50,
          total_tokens: 150,
          prompt_cache_hit_tokens: 0,
          prompt_cache_miss_tokens: 100,
        },
      }),
    );
  it("pins the cheapest selected model and native endpoint; disables thinking and requests bounded JSON output", async () => {
    spy.mockResolvedValue(response());
    const r = await provider.explain(findings, new AbortController().signal);
    expect(r.state).toBe("SUCCEEDED");
    expect(r.explanations).toEqual(output.explanations);
    expect(r.info).toMatchObject({
      supplier: "DeepSeek",
      actualModel: "deepseek-flash",
      total_tokens: 150,
    });
    const [url, options] = spy.mock.calls[0];
    expect(url).toBe("https://api.deepseek.com/chat/completions");
    const body = JSON.parse(options!.body as string);
    expect(body).toMatchObject({
      model: "deepseek-flash",
      thinking: { type: "disabled" },
      response_format: { type: "json_object" },
      max_tokens: 1000,
      stream: false,
    });
    expect(body.messages[0].content).toContain("JSON");
    expect(JSON.parse(body.messages[1].content).findings).toEqual(findings);
    expect(body).not.toHaveProperty("tools");
    expect(JSON.stringify(r)).not.toContain("TEST_NOT_REAL");
  });
  it.each([
    ["", "stop", "FORMAT_ERROR"],
    ["{broken", "stop", "FORMAT_ERROR"],
    [JSON.stringify(output), "length", "OUTPUT_LIMIT"],
    [JSON.stringify(output), "tool_calls", "FORMAT_ERROR"],
  ])(
    "safely degrades empty/truncated/invalid/tool output (%s, %s)",
    async (content, finish, state) => {
      spy.mockResolvedValue(response(content, finish));
      const r = await provider.explain(findings, new AbortController().signal);
      expect(r.state).toBe(state);
      expect(r.explanations).toEqual([]);
    },
  );
  it("retains validation of same-event evidence references from real-protocol envelopes", async () => {
    spy.mockResolvedValue(
      response(
        JSON.stringify({
          explanations: [
            { ...output.explanations[0], evidenceKeys: ["task:999"] },
          ],
        }),
      ),
    );
    expect(
      (await provider.explain(findings, new AbortController().signal)).state,
    ).toBe("FORMAT_ERROR");
  });
  it("does not send keys to a different origin, choose a more expensive model, or call without approval", async () => {
    for (const patch of [
      { endpoint: "https://other.invalid/chat/completions" },
      {
        endpoint: "https://api.deepseek.com/chat/completions",
        model: "deepseek-v4-pro",
      },
      { model: "deepseek-flash", approvedScope: "" },
    ]) {
      Object.assign(config, patch);
      expect(
        (await provider.explain(findings, new AbortController().signal)).state,
      ).toBe("NOT_CONFIGURED");
    }
    expect(spy).not.toHaveBeenCalled();
  });
  it("does not persist untrusted provider usage strings or reasoning content", async () => {
    spy.mockResolvedValue(
      new Response(
        JSON.stringify({
          model: "deepseek-flash",
          choices: [
            {
              finish_reason: "stop",
              message: {
                content: JSON.stringify(output),
                reasoning_content: "private raw reasoning",
              },
            },
          ],
          usage: { total_tokens: "untrusted data" },
        }),
      ),
    );
    const r = await provider.explain(findings, new AbortController().signal);
    expect(r.info).not.toHaveProperty("total_tokens");
    expect(JSON.stringify(r)).not.toContain("private raw reasoning");
  });
});
