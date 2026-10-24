import { Injectable } from "@nestjs/common";
function integer(name: string, fallback: number, min: number, max: number) {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min || value > max)
    throw new Error(`Invalid ${name}`);
  return value;
}
@Injectable()
export class AiConfig {
  readonly enabled = process.env.AI_ENABLED === "true";
  readonly externalEnabled = process.env.AI_EXTERNAL_ENABLED === "true";
  readonly supplier = process.env.AI_SUPPLIER || "";
  readonly provider = process.env.AI_PROVIDER || "disabled";
  readonly endpoint = process.env.AI_ENDPOINT || "";
  readonly model = process.env.AI_MODEL || "";
  readonly apiKey = process.env.AI_API_KEY || "";
  readonly approvedScope = process.env.AI_APPROVED_DATA_SCOPE || "";
  readonly timeoutMs = integer("AI_TIMEOUT_MS", 15000, 50, 60000);
  readonly concurrency = integer("AI_CONCURRENCY", 2, 1, 8);
  readonly pollMs = integer("AI_WORKER_POLL_MS", 1000, 25, 60000);
  readonly leaseMs = integer("AI_LEASE_MS", 90000, 1000, 300000);
  readonly maxRunsMinute = integer("AI_MAX_RUNS_PER_MINUTE", 10, 1, 1000);
  readonly maxRuns24h = integer("AI_MAX_RUNS_PER_PROJECT_24H", 100, 1, 10000);
  readonly maxCalls24h = integer(
    "AI_MAX_MODEL_CALLS_PER_PROJECT_24H",
    20,
    1,
    10000,
  );
  readonly maxRetries = integer("AI_MAX_RETRIES", 2, 0, 5);
  readonly maxEntities = integer("AI_MAX_CONTEXT_ENTITIES", 1000, 10, 10000);
  readonly maxFindings = integer("AI_MAX_FINDINGS", 300, 1, 2000);
  readonly maxInputBytes = integer("AI_MAX_INPUT_BYTES", 120000, 1024, 1000000);
  readonly maxOutputTokens = integer("AI_MAX_OUTPUT_TOKENS", 2000, 100, 8000);
  readonly timeZone = process.env.AI_TIME_ZONE || "Asia/Shanghai";
  constructor() {
    new Intl.DateTimeFormat("sv-SE", { timeZone: this.timeZone }).format();
    if (this.leaseMs <= this.timeoutMs + 500)
      throw new Error("AI_LEASE_MS must exceed model timeout");
  }
  configured() {
    if (
      !this.externalEnabled ||
      !["json-http", "deepseek"].includes(this.provider) ||
      !this.supplier ||
      !this.model ||
      !this.apiKey ||
      !["project-evidence-v1", "project-planning-v2"].includes(
        this.approvedScope,
      )
    )
      return false;
    try {
      const url = new URL(this.endpoint);
      if (this.provider === "deepseek")
        return (
          this.supplier === "DeepSeek" &&
          url.href === "https://api.deepseek.com/chat/completions" &&
          this.model === "deepseek-flash"
        );
      return (
        !url.username &&
        !url.password &&
        (url.protocol === "https:" ||
          (url.protocol === "http:" &&
            ["127.0.0.1", "localhost"].includes(url.hostname)))
      );
    } catch {
      return false;
    }
  }
  capabilities() {
    return {
      enabled: this.enabled,
      externalConfigured: this.configured(),
      provider: this.provider,
      supplier: this.supplier || null,
      model: this.model || null,
      approvedDataScope: this.approvedScope || null,
    };
  }
}
