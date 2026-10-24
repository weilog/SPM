import { useEffect, useState } from "react";
import { Alert, Button, Checkbox, Input, Modal, Select, Spin, Tag } from "antd";
import { api } from "./api";
import { useProjectData } from "./ProjectData";
import { announceProject } from "./ui";
import { priorityLabels, type Priority } from "@spm/shared";
import type { AiDraft, AiCandidate, AiReport, CandidateKind } from "./ai-types";
import type { AiScope } from "./ai-events";
const labels: Record<CandidateKind, string> = {
  REQUIREMENT: "正式需求",
  GOAL: "产品目标",
  EPIC: "候选 Epic",
  STORY: "用户故事",
  TASK: "实施任务",
};
export function AiPlanning({
  kind,
  scope,
  onClose,
}: {
  kind: "PLANNING" | "TASK_SPLIT";
  scope: AiScope;
  onClose(): void;
}) {
  const store = useProjectData(),
    path = `/projects/${store.project.id}/ai`;
  const [request, setRequest] = useState(scope.requestText || ""),
    [taskId, setTaskId] = useState(scope.taskId || store.tasks[0]?.id),
    [draft, setDraft] = useState<AiDraft | null>(null),
    [selected, setSelected] = useState(0),
    [dirty, setDirty] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [saved, setSaved] = useState<AiDraft[] | null>(null),
    [run, setRun] = useState<AiReport | null>(null),
    [confirm, setConfirm] = useState(false),
    [inputOpen, setInputOpen] = useState(true);
  const items = draft?.items || [],
    item = items[selected];
  function depth(candidate: AiCandidate) {
    let level = 0,
      current = candidate;
    const seen = new Set<string>();
    while (current.parentKey && !seen.has(current.key)) {
      seen.add(current.key);
      const parent = items.find((i) => i.key === current.parentKey);
      if (!parent) break;
      level++;
      current = parent;
    }
    return Math.min(level, 3);
  }
  useEffect(() => {
    if (!dirty) return;
    const guard = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", guard);
    return () => window.removeEventListener("beforeunload", guard);
  }, [dirty]);
  async function perform(fn: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
      if ((e as Error).message.includes("业务数据已变化"))
        setDraft((d) => (d ? { ...d, stale: true } : d));
    } finally {
      setBusy(false);
    }
  }
  const leave = () => {
    if (!dirty || window.confirm("AI 草稿有未保存修改，确定离开？")) onClose();
  };
  async function load(id: string) {
    if (dirty && !window.confirm("放弃未保存修改并恢复所选草稿？")) return;
    const d = await api<AiDraft>(`${path}/drafts/${id}`);
    if (d.sourceRunId) {
      try {
        const r = await api<AiReport>(`${path}/analyses/${d.sourceRunId}`);
        setRequest(r.scope.requestText || "");
        setRun(r);
      } catch {
        /* Deleted sources are revalidated through the draft workflow. */
      }
    }
    setDraft(d);
    setInputOpen(false);
    setDirty(false);
    setSelected(0);
    setSaved(null);
  }
  function change(patch: Partial<AiCandidate>) {
    if (!draft || draft.status === "COMMITTED" || busy) return;
    setDraft({
      ...draft,
      items: items.map((x, i) => ({
        ...x,
        reviewed: false,
        ...(i === selected ? patch : {}),
      })),
    });
    setDirty(true);
  }
  async function save() {
    if (!draft) throw new Error("请先生成或恢复草稿");
    const d = await api<AiDraft>(`${path}/drafts/${draft.id}`, "PATCH", {
      title: draft.title,
      revision: draft.revision,
      items,
    });
    setDraft(d);
    setDirty(false);
    return d;
  }
  async function generate() {
    if (
      dirty &&
      !window.confirm(
        "重新生成成功后将打开新草稿，未保存修改不会写入旧草稿。是否继续？",
      )
    )
      return;
    await perform(async () => {
      const created = await api<{ id: string }>(`${path}/analyses`, "POST", {
        kind,
        requestKey: crypto.randomUUID(),
        ...(kind === "TASK_SPLIT"
          ? { taskId }
          : { requirementId: scope.requirementId }),
        requestText:
          request.trim() ||
          (kind === "TASK_SPLIT"
            ? "分析源任务，建议独立实施任务及执行步骤。"
            : ""),
      });
      const end = Date.now() + 150000;
      let result: AiReport | undefined;
      while (Date.now() < end) {
        const r = await api<AiReport>(`${path}/analyses/${created.id}`);
        setRun(r);
        if (!["QUEUED", "RUNNING"].includes(r.status)) {
          result = r;
          break;
        }
        await new Promise((r) => setTimeout(r, 800));
      }
      if (
        !result ||
        result.status !== "COMPLETED" ||
        !result.output?.items?.length
      )
        throw new Error(
          `生成未完成：${result?.modelState || result?.errorCode || "超时"}。原草稿与输入已保留，可手动重试。`,
        );
      const d = await api<AiDraft>(`${path}/drafts`, "POST", {
        title: (request.trim() || "任务拆分审核").slice(0, 200),
        runId: created.id,
      });
      setDraft(d);
      setInputOpen(false);
      setSelected(0);
      setDirty(false);
    });
  }
  const existing = (k: CandidateKind) =>
    k === "REQUIREMENT"
      ? store.requirements
      : k === "GOAL"
        ? store.stories.goals
        : k === "EPIC"
          ? store.stories.epics
          : k === "STORY"
            ? store.stories.stories
            : store.tasks;
  const options = (k: CandidateKind) => [
    ...existing(k).map((x) => ({
      value: `${k.toLowerCase()}:${x.id}`,
      label: `${labels[k]} #${x.id} · ${x.title}`,
    })),
    ...items
      .filter((x) => x.kind === k && x.action !== "SKIP" && x.key !== item?.key)
      .map((x) => ({ value: x.key, label: `候选 · ${x.title}` })),
  ];
  const duplicates = item
    ? existing(item.kind).filter(
        (x) => x.title.trim().toLowerCase() === item.title.trim().toLowerCase(),
      )
    : [];
  return (
    <section
      className="ai-planner"
      data-ai-dirty={dirty ? "true" : "false"}
      aria-label="AI 规划工作区"
    >
      <header className="ai-planner-heading">
        <div>
          <h1>
            ✦ {kind === "TASK_SPLIT" ? "AI 候选任务审核" : "AI 智能需求规划"}
          </h1>
          <span>输入需求 → AI 分析 → 逐项人工审核 → 确认写入</span>
        </div>
        <div className="ai-row">
          <Button
            onClick={() =>
              void perform(async () =>
                setSaved(await api<AiDraft[]>(`${path}/drafts`)),
              )
            }
          >
            我的草稿
          </Button>
          <Button onClick={leave}>返回业务页面</Button>
        </div>
      </header>
      {error && (
        <Alert
          type="error"
          title={error}
          closable
          onClose={() => setError("")}
        />
      )}
      {saved && (
        <section className="ai-box">
          <h3>我的持久草稿</h3>
          {saved.map((d) => (
            <div className="ai-history-row" key={d.id}>
              <span>
                {d.title} · {d.status} · v{d.revision}
              </span>
              <Button onClick={() => void perform(() => load(d.id))}>
                恢复草稿
              </Button>
            </div>
          ))}
          {!saved.length && "暂无草稿"}
        </section>
      )}
      <section className="ai-box">
        <details
          open={inputOpen}
          onToggle={(e) => setInputOpen(e.currentTarget.open)}
        >
          <summary>规划输入与重新生成</summary>
          {kind === "TASK_SPLIT" && (
            <Select
              aria-label="AI 拆分源任务"
              value={taskId}
              onChange={setTaskId}
              options={store.tasks.map((t) => ({
                value: t.id,
                label: `T-${t.id} · ${t.title}`,
              }))}
              style={{ width: "100%", marginBottom: 12 }}
            />
          )}
          {scope.requirementId && (
            <Tag>基于正式需求 REQ-{scope.requirementId}</Tag>
          )}
          <Input.TextArea
            aria-label="AI 规划输入"
            rows={3}
            value={request}
            maxLength={4000}
            onChange={(e) => setRequest(e.target.value)}
            placeholder="描述需要规划的业务、用户场景与约束。现有授权需求、故事和任务将作为参考。"
          />
          <div className="ai-row ai-actions">
            <Button
              type="primary"
              loading={busy}
              disabled={
                (kind === "PLANNING" && !request.trim()) ||
                (kind === "TASK_SPLIT" && !taskId)
              }
              onClick={() => void generate()}
            >
              开始 AI 分析
            </Button>
            {run && (
              <Tag>
                {run.status} {run.modelState}
              </Tag>
            )}
            <span>所有结果为候选；不会自动写入正式业务。</span>
          </div>
        </details>
      </section>
      {busy && <Spin description="正在处理，请勿重复提交" />}
      {draft && (
        <>
          <section className="ai-box ai-review-heading">
            <Input
              aria-label="草稿标题"
              value={draft.title}
              maxLength={200}
              disabled={draft.status === "COMMITTED"}
              onChange={(e) => {
                setDraft({ ...draft, title: e.target.value });
                setDirty(true);
              }}
            />
            <Tag>
              {draft.status === "COMMITTED"
                ? "已事务提交"
                : `${items.filter((x) => x.reviewed).length}/${items.length} 已审核`}
            </Tag>
            <Button
              disabled={busy || !dirty || draft.status === "COMMITTED"}
              onClick={() =>
                void perform(async () => {
                  await save();
                })
              }
            >
              保存草稿
            </Button>
            <Button
              type="primary"
              disabled={
                busy ||
                draft.status === "COMMITTED" ||
                draft.stale ||
                items.some((x) => !x.reviewed) ||
                !items.length
              }
              onClick={() => setConfirm(true)}
            >
              确认提交审核结果
            </Button>
          </section>
          {draft.stale && draft.status !== "COMMITTED" && (
            <Alert
              type="warning"
              title="草稿引用的业务数据已变化，提交前必须重新校验并逐项审核"
              action={
                <Button
                  onClick={() =>
                    void perform(async () => {
                      if (dirty) throw new Error("请先保存草稿");
                      const d = await api<AiDraft>(
                        `${path}/drafts/${draft.id}/revalidate`,
                        "POST",
                        { revision: draft.revision },
                      );
                      setDraft({ ...d, stale: false });
                    })
                  }
                >
                  重新校验引用
                </Button>
              }
            />
          )}
          <div className="ai-review-grid">
            <aside className="ai-review-tree">
              {items.map((x, i) => (
                <button
                  key={x.key}
                  style={{ paddingLeft: 12 + depth(x) * 16 }}
                  className={i === selected ? "active" : ""}
                  onClick={() => setSelected(i)}
                >
                  <span>
                    {x.reviewed ? "☑" : "□"} {labels[x.kind]} ·{" "}
                    {
                      {
                        CREATE: "创建",
                        REUSE: "复用",
                        SKIP: "跳过",
                        UPDATE: "修改验收",
                      }[x.action]
                    }
                  </span>
                  <strong>
                    {x.kind === "REQUIREMENT" && x.parentKey ? "└ " : ""}
                    {x.title}
                  </strong>
                </button>
              ))}
            </aside>
            {item && (
              <section className="ai-box ai-candidate-editor">
                <h3>{labels[item.kind]} · 审核详情</h3>
                <p className="secondary">
                  编辑内容或关联后，所有候选均需重新核对审核。
                </p>
                {item.action === "REUSE" && (
                  <Alert
                    type="info"
                    title="复用保留已有标题、描述、负责人及状态；仅合并本次明确选择的故事/需求/计划关联。"
                  />
                )}
                {duplicates.length > 0 && (
                  <Alert
                    type="warning"
                    title={`发现同名对象：${duplicates.map((x) => "#" + x.id).join("、")}，请人工判断是否复用`}
                  />
                )}
                <fieldset disabled={draft.status === "COMMITTED" || busy}>
                  <label>
                    处理方式
                    <Select
                      aria-label="候选处理方式"
                      value={item.action}
                      onChange={(v) => change({ action: v })}
                      options={[
                        { value: "CREATE", label: "创建新对象" },
                        { value: "REUSE", label: "复用已有对象" },
                        { value: "SKIP", label: "跳过" },
                        ...(["REQUIREMENT", "STORY"].includes(item.kind)
                          ? [
                              {
                                value: "UPDATE",
                                label: "仅修改已有对象验收条件",
                              },
                            ]
                          : []),
                      ]}
                    />
                  </label>
                  {["REUSE", "UPDATE"].includes(item.action) && (
                    <label>
                      已有对象
                      <Select
                        aria-label="复用对象"
                        value={item.existingId}
                        options={existing(item.kind).map((x) => ({
                          value: x.id,
                          label: `#${x.id} · ${x.title}`,
                        }))}
                        onChange={(v) => change({ existingId: v })}
                      />
                    </label>
                  )}
                  <label>
                    标题
                    <Input
                      aria-label="候选标题"
                      value={item.title}
                      maxLength={200}
                      onChange={(e) => change({ title: e.target.value })}
                    />
                  </label>
                  <label>
                    描述
                    <Input.TextArea
                      aria-label="候选描述"
                      rows={3}
                      value={item.description}
                      maxLength={10000}
                      onChange={(e) => change({ description: e.target.value })}
                    />
                  </label>
                  {["REQUIREMENT", "STORY"].includes(item.kind) && (
                    <label>
                      验收条件
                      <Input.TextArea
                        aria-label="候选验收条件"
                        rows={3}
                        value={item.acceptanceCriteria}
                        maxLength={10000}
                        onChange={(e) =>
                          change({ acceptanceCriteria: e.target.value })
                        }
                      />
                    </label>
                  )}
                  {item.kind === "REQUIREMENT" && (
                    <label>
                      上级需求
                      <Select
                        aria-label="候选上级需求"
                        allowClear
                        options={options("REQUIREMENT")}
                        value={item.parentKey}
                        onChange={(v) => change({ parentKey: v })}
                      />
                    </label>
                  )}
                  {item.kind === "EPIC" && (
                    <label>
                      产品目标
                      <Select
                        aria-label="候选产品目标"
                        options={options("GOAL")}
                        value={item.goalKey}
                        onChange={(v) => change({ goalKey: v })}
                      />
                    </label>
                  )}
                  {item.kind === "STORY" && (
                    <>
                      <label>
                        Epic
                        <Select
                          aria-label="候选 Epic"
                          options={options("EPIC")}
                          value={item.epicKey}
                          onChange={(v) => change({ epicKey: v })}
                        />
                      </label>
                      <label>
                        关联正式需求
                        <Select
                          aria-label="候选关联需求"
                          mode="multiple"
                          options={options("REQUIREMENT")}
                          value={item.requirementKeys}
                          onChange={(v) => change({ requirementKeys: v })}
                        />
                      </label>
                    </>
                  )}
                  {item.kind === "TASK" && (
                    <>
                      <p>创建独立 TODO 任务，初始进度0%；不建立父子任务。</p>
                      <label>
                        优先级
                        <Select
                          aria-label="候选优先级"
                          value={item.priority}
                          onChange={(v) => change({ priority: v })}
                          options={["URGENT", "HIGH", "MEDIUM", "LOW"].map(
                            (v) => ({
                              value: v,
                              label: priorityLabels[v as Priority],
                            }),
                          )}
                        />
                      </label>
                      <label>
                        负责人
                        <Select
                          aria-label="候选负责人"
                          allowClear
                          value={item.assigneeUserId ?? undefined}
                          options={store.members.map((m) => ({
                            value: m.userId,
                            label: m.user.username,
                          }))}
                          onChange={(v) =>
                            change({ assigneeUserId: v ?? null })
                          }
                        />
                      </label>
                      <label>
                        关联用户故事
                        <Select
                          aria-label="候选关联故事"
                          mode="multiple"
                          options={options("STORY")}
                          value={item.storyKeys}
                          onChange={(v) => change({ storyKeys: v })}
                        />
                      </label>
                      <label>
                        关联计划项
                        <Select
                          aria-label="候选关联计划"
                          mode="multiple"
                          options={store.plans.items.map((p) => ({
                            value: p.id,
                            label: p.title,
                          }))}
                          value={item.planIds}
                          onChange={(v) => change({ planIds: v })}
                        />
                      </label>
                    </>
                  )}
                  <Checkbox
                    aria-label="此候选已人工审核"
                    checked={item.reviewed}
                    onChange={(e) => {
                      setDraft({
                        ...draft,
                        items: items.map((x, i) =>
                          i === selected
                            ? { ...x, reviewed: e.target.checked }
                            : x,
                        ),
                      });
                      setDirty(true);
                    }}
                  >
                    我已核对内容、处理方式与关联，确认此项审核结果
                  </Checkbox>
                </fieldset>
              </section>
            )}
          </div>
          {draft.status === "COMMITTED" && (
            <Alert
              type="success"
              title={`事务提交成功：${draft.result?.objects.length || 0} 项已处理，业务页面已同步刷新`}
            />
          )}
        </>
      )}
      <Modal
        open={confirm}
        title="确认写入正式业务"
        centered
        onCancel={() => setConfirm(false)}
        confirmLoading={busy}
        okText="确认事务提交"
        onOk={() =>
          void perform(async () => {
            let d = draft!;
            if (dirty) d = await save();
            const result = await api<AiDraft>(
              `${path}/drafts/${d.id}/commit`,
              "POST",
              { revision: d.revision },
            );
            setDraft(result);
            setDirty(false);
            setConfirm(false);
            announceProject(store.project.id);
            await store.refresh();
          })
        }
      >
        <p>
          已逐项审核 {items.length}{" "}
          项。所有创建、复用关联和验收修改在同一事务中提交，任一校验失败整体回滚。
        </p>
        <ul>
          {items.map((x) => (
            <li key={x.key}>
              {labels[x.kind]}：{x.title} ·{" "}
              {
                {
                  CREATE: "创建",
                  REUSE: "复用",
                  SKIP: "跳过",
                  UPDATE: "修改验收",
                }[x.action]
              }
            </li>
          ))}
        </ul>
      </Modal>
    </section>
  );
}
