import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Alert, Button, Drawer, Empty, Input, Select, Spin, Tag } from "antd";
import {
  evidenceFields,
  evidenceLabel,
  riskNames,
  severityNames,
} from "./ai-labels";
import { api } from "./api";
import { useProjectData } from "./ProjectData";
import { useTaskActions } from "./TaskActions";
import { AiPlanning } from "./AiPlanning";
import { AiEntry, aiNames, type AiKind, type AiScope } from "./ai-events";
import type { AiEvidence, AiFinding, AiReport, AiScenario } from "./ai-types";
import "./ai.css";
import { AiHintContext } from "./ai-hints";
const dimensions = [
  ["PROGRESS", "进度风险"],
  ["PLAN", "计划风险"],
  ["ALLOCATION", "任务分配风险"],
  ["MEMBER", "人员负载风险"],
];
const statusNames: Record<string, string> = {
  QUEUED: "诊断中",
  RUNNING: "诊断中",
  COMPLETED: "已完成",
  PARTIAL: "部分成功",
  FAILED: "失败",
  CANCELLED: "已取消",
};
type Descriptor = { kind: AiKind; scope: AiScope };
const C = createContext<{ health: AiReport | null } | null>(null);
export function AiHealthSummary() {
  const ctx = useContext(C);
  if (!ctx) return null;
  const r = ctx.health;
  return (
    <section className="ai-health-summary">
      <div className="ai-row">
        <strong>✦ AI 项目健康诊断</strong>
        <Tag>{r ? (r.stale ? "已过期" : statusNames[r.status]) : "未诊断"}</Tag>
        <span className="ai-push" />
        <AiEntry kind="HEALTH" label="查看诊断报告" />
      </div>
      <div className="ai-health-metrics">
        <div>
          <b>{r?.summary?.uniqueEvents ?? "—"}</b>
          <span>同源风险总数</span>
        </div>
        {dimensions.map(([key, label]) => (
          <div key={key}>
            <b>{r?.summary?.dimensions[key] ?? "—"}</b>
            <span>{label}</span>
          </div>
        ))}
      </div>
    </section>
  );
}
export function AiWorkspaceProvider({
  children,
  onNavigate,
  page,
}: {
  page: string;
  children: ReactNode;
  onNavigate(page: string): void;
}) {
  const store = useProjectData(),
    tasks = useTaskActions(),
    p = store.project.id,
    path = `/projects/${p}/ai`;
  const [opened, setOpened] = useState<Descriptor | null>(null),
    [planning, setPlanning] = useState<Descriptor | null>(null),
    [report, setReport] = useState<AiReport | null>(null),
    [health, setHealth] = useState<AiReport | null>(null),
    [history, setHistory] = useState<AiReport[]>([]),
    [cursor, setCursor] = useState<string | null>(null),
    [tab, setTab] = useState("all"),
    [filter, setFilter] = useState(""),
    [severity, setSeverity] = useState("all"),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [scenarios, setScenarios] = useState<AiScenario[]>([]),
    [shifts, setShifts] = useState([3, 7]);
  useEffect(() => setPlanning(null), [page]);
  const requestVersion = useRef(0),
    latest = useRef(opened);
  latest.current = opened;
  const safe = (fn: () => Promise<void>) => {
    setBusy(true);
    setError("");
    void fn()
      .catch((e) => setError((e as Error).message))
      .finally(() => setBusy(false));
  };
  async function read(id: string) {
    const version = requestVersion.current;
    const next = await api<AiReport>(`${path}/analyses/${id}`);
    if (version !== requestVersion.current) return;
    if (next.kind === "HEALTH") setHealth(next);
    setReport(next);
    setScenarios(next.output?.scenarios || []);
  }
  async function histories(next?: string) {
    const data = await api<{ items: AiReport[]; nextCursor: string | null }>(
      `${path}/analyses?limit=20${next ? "&cursor=" + next : ""}`,
    );
    setHistory((old) => (next ? [...old, ...data.items] : data.items));
    setCursor(data.nextCursor);
    return data.items;
  }
  useEffect(() => {
    let live = true;
    void api<{ items: AiReport[] }>(`${path}/analyses?limit=20`)
      .then(async (data) => {
        if (!live || !Array.isArray(data.items)) return;
        const h = data.items.find((r) => r.kind === "HEALTH");
        if (h) {
          const r = await api<AiReport>(`${path}/analyses/${h.id}`);
          if (live) setHealth(r);
        }
      })
      .catch(() => undefined);
    return () => {
      live = false;
      requestVersion.current++;
    };
  }, [p]);
  useEffect(() => {
    if (!health) return;
    let live = true;
    void api<AiReport>(`${path}/analyses/${health.id}`)
      .then((r) => {
        if (live) setHealth(r);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [store.tasks, store.requirements, store.stories, store.plans]);
  useEffect(() => {
    if (!report || !opened || ["QUEUED", "RUNNING"].includes(report.status))
      return;
    let live = true;
    void api<AiReport>(`${path}/analyses/${report.id}`)
      .then((r) => {
        if (live) setReport(r);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [store.tasks, store.requirements, store.stories, store.plans]);
  useEffect(() => {
    const listener = (e: Event) => {
      const detail = (e as CustomEvent<Descriptor & { projectId: number }>)
        .detail;
      if (detail.projectId !== p) return;
      if (["PLANNING", "TASK_SPLIT"].includes(detail.kind)) {
        if (store.project.canManage) {
          setOpened(null);
          setPlanning(detail);
        }
        return;
      }
      setOpened(detail);
      setReport(null);
      setTab("all");
      setFilter("");
      setSeverity("all");
      setScenarios([]);
      const v = ++requestVersion.current;
      safe(async () => {
        const list = await histories();
        if (v !== requestVersion.current) return;
        const r = list.find(
          (r) =>
            r.kind === detail.kind &&
            JSON.stringify(r.scope || {}) ===
              JSON.stringify(detail.scope || {}),
        );
        if (r) await read(r.id);
      });
    };
    window.addEventListener("spm-ai-open", listener);
    return () => window.removeEventListener("spm-ai-open", listener);
  }, [p, store.project.canManage]);
  useEffect(() => {
    if (!opened || !report || !["QUEUED", "RUNNING"].includes(report.status))
      return;
    let live = true;
    const timer = setTimeout(() => {
      void api<AiReport>(`${path}/analyses/${report.id}`)
        .then((r) => {
          if (live) {
            setReport(r);
            if (r.kind === "HEALTH") setHealth(r);
          }
        })
        .catch((e) => {
          if (live) setError((e as Error).message);
        });
    }, 750);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [opened, report]);
  async function analyze(retry = false) {
    if (!opened) return;
    const d =
      retry && report
        ? await api<{ id: string }>(
            `${path}/analyses/${report.id}/retry`,
            "POST",
            { requestKey: crypto.randomUUID() },
          )
        : await api<{ id: string }>(`${path}/analyses`, "POST", {
            kind: opened.kind,
            ...(report?.scope || opened.scope),
            requestKey: crypto.randomUUID(),
          });
    await read(d.id);
    await histories();
  }
  function locate(e: AiEvidence) {
    setOpened(null);
    const detail = {
      projectId: p,
      entityType: e.entityType,
      entityId: e.entityId,
    };
    if (opened?.kind === "CROSS_VIEW" && e.entityType !== "requirement") {
      onNavigate("workspace");
      setTimeout(
        () =>
          window.dispatchEvent(new CustomEvent("spm-ai-locate", { detail })),
        120,
      );
      return;
    }
    if (e.entityType === "task") {
      tasks.open(Number(e.entityId));
      return;
    }
    const page = ["story", "requirement", "goal", "epic"].includes(e.entityType)
      ? "requirements"
      : "plan";
    onNavigate(page);
    setTimeout(
      () => window.dispatchEvent(new CustomEvent("spm-ai-locate", { detail })),
      120,
    );
  }
  const openPlanning = (
    kind: "PLANNING" | "TASK_SPLIT",
    scope: AiScope = {},
  ) => {
    setOpened(null);
    setPlanning({ kind, scope });
  };
  const visible = (report?.findings || []).filter(
    (f) =>
      (tab === "all" ||
        tab === "history" ||
        tab === "advice" ||
        tab === "scenarios" ||
        tab === "evidence" ||
        f.dimensions.includes(tab)) &&
      (severity === "all" || f.severity === severity) &&
      `${f.fact} ${f.ruleId} ${f.eventKey} ${JSON.stringify(f.evidence)}`
        .toLowerCase()
        .includes(filter.toLowerCase()),
  );
  function risk(f: AiFinding) {
    return (
      <article className="ai-risk" key={f.id}>
        <div className="ai-row">
          <Tag
            color={
              f.severity === "HIGH"
                ? "red"
                : f.severity === "MEDIUM"
                  ? "orange"
                  : "blue"
            }
          >
            {severityNames[f.severity] || f.severity}
          </Tag>
          <strong title={f.ruleId}>
            {riskNames[f.ruleId] || "业务风险核查"}
          </strong>
          <span className="ai-push" />
          {!f.evidenceCurrent && <Tag color="orange">证据已变化</Tag>}
        </div>
        <h4>确定性事实</h4>
        <p>{f.fact}</p>
        <details open={tab === "evidence"}>
          <summary>证据 · {f.evidence.length} 个对象</summary>
          {f.evidence.map((e) => (
            <div key={e.key} className="ai-evidence">
              <button aria-label={`定位 ${e.key}`} onClick={() => locate(e)}>
                查看 {evidenceLabel(e)}
              </button>
              <dl>
                {evidenceFields(e).map((field) => (
                  <div key={field.key}>
                    <dt>{field.label}</dt>
                    <dd>{field.value}</dd>
                  </div>
                ))}
              </dl>
            </div>
          ))}
        </details>
        <h4>AI 推断 · 待核查</h4>
        <p>
          {f.inference?.explanation ||
            (store.project.canManage
              ? "尚无有效模型解释，规则事实仍可复核。"
              : "当前角色仅可查看授权事实。")}
        </p>
        {f.inference && (
          <>
            <h4>处理建议 · 人工执行</h4>
            <p>{f.inference.recommendation}</p>
          </>
        )}
        <div className="ai-row">
          {f.evidence.slice(0, 3).map((e) => (
            <Button
              size="small"
              key={e.key}
              aria-label={`定位 ${e.key}`}
              onClick={() => locate(e)}
            >
              定位 {evidenceLabel(e)}
            </Button>
          ))}
          {store.project.canManage && opened?.kind === "COVERAGE" && (
            <Button
              size="small"
              onClick={() =>
                openPlanning("PLANNING", {
                  requestText: `依据当前覆盖检查，核查 ${f.eventKey}，提出关联、补充故事和验收建议。优先复用现有对象。`,
                })
              }
            >
              进入完善建议审核
            </Button>
          )}
        </div>
      </article>
    );
  }
  const coverage = store.requirements.filter(
      (r) => !store.requirements.some((child) => child.parentId === r.id),
    ),
    covered = coverage.filter((r) => (r.storyIds?.length || 0) > 0).length;
  const hints: Record<string, number> = {},
    seen = new Set<string>();
  for (const source of [health, report]) {
    if (!source || source.stale) continue;
    for (const finding of source.findings || []) {
      if (seen.has(finding.eventKey)) continue;
      seen.add(finding.eventKey);
      const keys = new Set(finding.evidence.map((e) => e.key));
      for (const evidence of finding.evidence) {
        const owner =
          evidence.fields.assigneeUserId ?? evidence.fields.ownerUserId;
        if (typeof owner === "number") keys.add(`member:${owner}`);
      }
      for (const key of keys) hints[key] = (hints[key] || 0) + 1;
    }
  }
  return (
    <AiHintContext.Provider value={hints}>
      <C.Provider value={{ health }}>
        <div hidden={!!planning}>{children}</div>
        {planning && (
          <AiPlanning
            key={`${p}:${planning.kind}:${planning.scope.requirementId ?? planning.scope.taskId ?? "all"}`}
            kind={planning.kind as "PLANNING" | "TASK_SPLIT"}
            scope={planning.scope}
            onClose={() => setPlanning(null)}
          />
        )}
        <Drawer
          className="ai-drawer"
          title={opened ? aiNames[opened.kind] : ""}
          open={!!opened}
          onClose={() => {
            requestVersion.current++;
            setOpened(null);
          }}
          size={640}
          styles={{ wrapper: { top: 56, height: "calc(100% - 56px)" } }}
        >
          {opened && (
            <>
              <div className="ai-row ai-actions">
                <Tag>
                  {report
                    ? report.stale
                      ? "已过期"
                      : report.summary?.uniqueEvents === 0 &&
                          report.status === "COMPLETED"
                        ? "无风险"
                        : statusNames[report.status]
                    : "未诊断"}
                </Tag>
                {report && (
                  <span>
                    {report.sourceDate} · {report.summary?.uniqueEvents || 0}{" "}
                    个同源事件
                  </span>
                )}
                <span className="ai-push" />
                {store.project.canManage && (
                  <Button
                    type="primary"
                    disabled={
                      busy ||
                      (!!report &&
                        ["QUEUED", "RUNNING"].includes(report.status))
                    }
                    onClick={() => safe(() => analyze())}
                  >
                    {report ? "重新分析" : "开始分析"}
                  </Button>
                )}
              </div>
              {error && (
                <Alert
                  type="error"
                  title={error}
                  closable
                  onClose={() => setError("")}
                />
              )}
              {busy && <Spin />}
              {report?.stale && (
                <Alert
                  type="warning"
                  title="来源数据已变化，报告仅供历史参考；需要项目经理手动重新分析。"
                />
              )}
              {report?.status === "PARTIAL" && (
                <Alert
                  type="warning"
                  title={`部分成功：${report.modelState || "仅显示授权规则结果"}，不代表完整AI分析。`}
                />
              )}
              {report &&
                ["FAILED", "PARTIAL"].includes(report.status) &&
                store.project.canManage && (
                  <Button
                    onClick={() => safe(() => analyze(true))}
                    disabled={busy}
                  >
                    手动重试
                  </Button>
                )}
              {opened.kind === "COVERAGE" && (
                <section className="ai-box">
                  叶子需求直接关联口径：{covered}/{coverage.length}{" "}
                  已关联故事；分母仅为当前项目叶子需求，不是语义验收覆盖率。
                  <p>产品目标、Epic与故事可在原地图继续编辑。</p>
                  {store.project.canManage && (
                    <Button
                      onClick={() =>
                        openPlanning("PLANNING", {
                          requestText:
                            "检查需求和故事语义匹配、疑似重复、验收覆盖与Epic归属，优先复用并提出逐项审核的完善候选。",
                        })
                      }
                    >
                      生成完善候选
                    </Button>
                  )}
                </section>
              )}
              {opened.kind === "TASK" && store.project.canManage && (
                <div className="ai-row">
                  <AiEntry
                    kind="TASK_SPLIT"
                    label="生成独立候选任务"
                    scope={report?.scope || opened.scope}
                  />
                  <span>任务拆分不创建父子任务，不自动设置完成日期。</span>
                </div>
              )}
              {opened.kind === "MEMBER" && (
                <Alert
                  type="info"
                  title="按Task ID去重统计；Task实际负责人和计划负责人分别核对。集中与重叠不是工时利用率或超负荷证明。"
                />
              )}
              {opened.kind === "CROSS_VIEW" && (
                <Alert
                  type="info"
                  title="证据按真实对象ID定位，直接关联与多跳可达不等于因果、依赖或关键路径。"
                />
              )}
              <div className="ai-tabs">
                {[
                  ["all", "风险清单"],
                  ...(opened.kind === "HEALTH" ? dimensions : []),
                  ...(opened.kind === "PLAN"
                    ? [["scenarios", "方案推演"]]
                    : []),
                  ...(opened.kind === "CROSS_VIEW"
                    ? [["evidence", "关联证据"]]
                    : []),
                  ["history", "历史报告"],
                ].map(([key, title]) => (
                  <button
                    key={key}
                    className={key === tab ? "active" : ""}
                    onClick={() => {
                      setTab(key);
                      if (key === "history")
                        safe(async () => {
                          await histories();
                        });
                    }}
                  >
                    {title}
                  </button>
                ))}
              </div>
              {tab === "history" ? (
                <section>
                  {history
                    .filter((h) => h.kind === opened.kind)
                    .map((h) => (
                      <div className="ai-history-row" key={h.id}>
                        <span>
                          {new Date(h.createdAt).toLocaleString("zh-CN")} ·{" "}
                          {statusNames[h.status]} ·{" "}
                          {h.summary?.uniqueEvents ?? "—"} 项
                        </span>
                        <Button
                          size="small"
                          onClick={() =>
                            safe(async () => {
                              await read(h.id);
                              setTab("all");
                            })
                          }
                        >
                          查看报告
                        </Button>
                      </div>
                    ))}
                  {cursor && (
                    <Button
                      onClick={() =>
                        safe(async () => {
                          await histories(cursor);
                        })
                      }
                    >
                      加载更多历史
                    </Button>
                  )}
                </section>
              ) : tab === "scenarios" ? (
                <section className="ai-scenarios">
                  <p>候选日期仅作规则推演，不会直接修改正式计划。</p>
                  <div className="ai-row">
                    {shifts.map((s, i) => (
                      <Input
                        key={i}
                        type="number"
                        aria-label={`候选方案${i + 1}位移天数`}
                        value={s}
                        onChange={(e) =>
                          setShifts(
                            shifts.map((n, j) =>
                              j === i ? Number(e.target.value) : n,
                            ),
                          )
                        }
                      />
                    ))}
                    <Button
                      disabled={
                        !store.project.canManage ||
                        !report ||
                        report.stale ||
                        busy
                      }
                      onClick={() =>
                        safe(async () => {
                          const result = await api<{ scenarios: AiScenario[] }>(
                            `${path}/analyses/${report!.id}/scenarios`,
                            "POST",
                            { shifts },
                          );
                          setScenarios(result.scenarios);
                        })
                      }
                    >
                      生成候选方案对比
                    </Button>
                  </div>
                  {scenarios.map((s, i) => (
                    <section className="ai-box" key={i}>
                      <h3>
                        {s.name} · {s.shiftDays}天
                      </h3>
                      <p>
                        基线风险 {s.baselineRisks} → 候选风险 {s.candidateRisks}
                        ；待核查冲突 {s.conflicts.length}
                      </p>
                      <p>{s.uncertainty}</p>
                      {s.changes.map((c) => (
                        <div key={c.id} className="ai-scenario-change">
                          <strong>{c.title}</strong>
                          <span>
                            {c.originalStart}～{c.originalEnd}
                          </span>
                          <span>
                            候选：{c.start}～{c.end}
                          </span>
                          <Button
                            disabled={report?.stale}
                            onClick={() => {
                              setOpened(null);
                              onNavigate("plan");
                              setTimeout(
                                () =>
                                  window.dispatchEvent(
                                    new CustomEvent("spm-ai-edit-plan", {
                                      detail: {
                                        projectId: p,
                                        id: c.id,
                                        revision: c.revision,
                                        start: c.start,
                                        end: c.end,
                                      },
                                    }),
                                  ),
                                120,
                              );
                            }}
                          >
                            打开原编辑器
                          </Button>
                        </div>
                      ))}
                    </section>
                  ))}
                </section>
              ) : (
                <>
                  <div className="ai-row ai-filter">
                    <Input
                      aria-label="搜索 AI 风险"
                      placeholder="搜索事实、规则或对象编号"
                      value={filter}
                      onChange={(e) => setFilter(e.target.value)}
                    />
                    <Select
                      aria-label="AI 风险等级"
                      value={severity}
                      onChange={setSeverity}
                      options={["all", "HIGH", "MEDIUM", "LOW", "INFO"].map(
                        (v) => ({
                          value: v,
                          label:
                            v === "all" ? "全部等级" : severityNames[v] || v,
                        }),
                      )}
                    />
                  </div>
                  {visible.map(risk)}
                  {!visible.length && !busy && (
                    <Empty
                      description={
                        report
                          ? "当前授权与筛选下无风险记录"
                          : "暂无报告，由项目经理手动发起分析"
                      }
                    />
                  )}
                </>
              )}
            </>
          )}
        </Drawer>
      </C.Provider>
    </AiHintContext.Provider>
  );
}
