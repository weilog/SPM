import { useEffect, useState } from "react";
import type { PlanItemView, PlanStageView, ManagedTask } from "@spm/shared";
import { useProjectData } from "./ProjectData";
import { useTaskActions } from "./TaskActions";
import { PlanGantt } from "./PlanGantt";
import { AIcon as Icon } from "./AIcons";
import "./a-plan.css";
const states = ["TODO", "IN_PROGRESS", "DONE", "PAUSED"] as const;
const stateLabels = {
  TODO: "待处理",
  IN_PROGRESS: "进行中",
  DONE: "已完成",
  PAUSED: "暂缓",
};
const priorities = { NORMAL: "普通", HIGH: "高", MEDIUM: "中", LOW: "低" };
const transitions: Record<string, string[]> = {
  TODO: ["IN_PROGRESS", "PAUSED"],
  IN_PROGRESS: ["DONE", "PAUSED"],
  DONE: ["IN_PROGRESS"],
  PAUSED: ["TODO"],
};
export const planNumber = (i: PlanItemView) =>
  `PI-${String(i.number ?? i.id).padStart(3, "0")}`;
const status = (s: PlanItemView["status"]) => (
  <span
    className={`status-pill ${{ TODO: "pending", IN_PROGRESS: "progress", DONE: "done", PAUSED: "paused" }[s]}`}
  >
    {stateLabels[s]}
  </span>
);
const priority = (s: PlanItemView["priority"]) => (
  <span
    className={`priority-pill ${s === "HIGH" ? "high" : s === "MEDIUM" ? "medium" : "low"}`}
  >
    {priorities[s || "NORMAL"]}
  </span>
);
type Entity = PlanItemView | PlanStageView;
type Draft = {
  title: string;
  description: string;
  start: string;
  end: string;
  ownerUserId: string;
  status: PlanItemView["status"];
  priority: NonNullable<PlanItemView["priority"]>;
  taskIds: number[];
};
export function PlanView({
  embedded = false,
  highlightIds = [],
  onPlanFocus,
}: {
  embedded?: boolean;
  highlightIds?: string[];
  onPlanFocus?: (id: string) => void;
}) {
  const store = useProjectData(),
    actions = useTaskActions(),
    can = store.project.canManage;
  const [selected, setSelected] = useState<string>(),
    [view, setView] = useState(embedded ? "gantt" : "overview"),
    [search, setSearch] = useState(""),
    [owner, setOwner] = useState(""),
    [filterStatus, setFilterStatus] = useState(""),
    [query, setQuery] = useState(""),
    [collapsed, setCollapsed] = useState(embedded),
    [detailId, setDetail] = useState<string | null>(null),
    [editor, setEditor] = useState<{
      kind: "plan" | "item" | "milestone";
      entity?: Entity;
    } | null>(null),
    [draft, setDraft] = useState<Draft | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [goalTitle, setGoalTitle] = useState<string | null>(null),
    [onlyLinked, setOnlyLinked] = useState(true),
    [groups, setGroups] = useState<Record<string, boolean>>({}),
    [dragging, setDragging] = useState<PlanItemView | null>(null);
  const [goalStates, setGoalStates] = useState<Record<string, boolean>>({});
  const plans = store.plans,
    stage =
      selected === "unplanned"
        ? undefined
        : plans.stages.find((s) => s.id === selected) || plans.stages[0],
    items = plans.items.filter((i) => i.stageId === stage?.id),
    work = items.filter((i) => i.kind === "item"),
    milestones = items.filter((i) => i.kind === "milestone"),
    detail = [...plans.stages, ...plans.items].find((i) => i.id === detailId);
  useEffect(() => {
    const item = plans.items.find((i) => highlightIds.includes(i.id));
    if (item) setSelected(item.stageId);
  }, [highlightIds.join(","), plans.items]);
  useEffect(() => {
    const close = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) {
        setDetail(null);
        setEditor(null);
        setGoalTitle(null);
      }
    };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [busy]);
  function open(x: Entity) {
    setDetail(x.id);
    if ("kind" in x) onPlanFocus?.(x.id);
  }
  function edit(kind: "plan" | "item" | "milestone", entity?: Entity) {
    if (!can) return;
    setError("");
    setDetail(null);
    setEditor({ kind, entity });
    setDraft({
      title: entity?.title || "",
      description: entity?.description || "",
      start:
        entity?.start || stage?.start || new Date().toLocaleDateString("sv-SE"),
      end: entity?.end || stage?.end || new Date().toLocaleDateString("sv-SE"),
      ownerUserId: String(entity?.ownerUserId ?? stage?.ownerUserId ?? ""),
      status: entity && "status" in entity ? entity.status : "TODO",
      priority:
        entity && "priority" in entity ? entity.priority || "NORMAL" : "NORMAL",
      taskIds: entity && "taskIds" in entity ? entity.taskIds || [] : [],
    });
  }
  async function save(again = false) {
    if (!editor || !draft || busy) return;
    setBusy(true);
    setError("");
    try {
      const body = {
        title: draft.title,
        description: draft.description,
        start: draft.start,
        end: editor.kind === "milestone" ? draft.start : draft.end,
        ownerUserId: draft.ownerUserId ? Number(draft.ownerUserId) : null,
        ...(editor.entity ? { revision: editor.entity.revision } : {}),
        ...(editor.kind === "plan"
          ? {}
          : {
              stageId: stage?.id,
              kind: editor.kind,
              status: draft.status,
              priority: draft.priority,
              taskIds: editor.kind === "item" ? draft.taskIds : [],
            }),
      };
      const path = `/plan-adapter/${editor.kind === "plan" ? "stages" : "items"}`;
      const saved = await store.write<Entity>(
        path + (editor.entity ? "/" + editor.entity.id : ""),
        editor.entity ? "PATCH" : "POST",
        body,
      );
      if (editor.kind === "plan") setSelected(saved.id);
      if (again && !editor.entity) {
        setDraft({ ...draft, title: "", description: "", taskIds: [] });
      } else {
        setEditor(null);
        setDraft(null);
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function stateChange(item: PlanItemView, to: string) {
    setDragging(null);
    if (to === item.status) return;
    if (!transitions[item.status].includes(to)) {
      store.onError(new Error("不允许该计划项状态流转"));
      return;
    }
    try {
      await store.write(`/plan-adapter/items/${item.id}`, "PATCH", {
        status: to,
        revision: item.revision,
      });
    } catch (e) {
      store.onError(e);
    }
  }
  const filtered = work.filter(
    (i) =>
      (!owner ||
        (view === "members" && i.tasks?.length
          ? i.tasks.some((t) => String(t.assigneeUserId) === owner)
          : String(i.ownerUserId) === owner)) &&
      (!filterStatus || i.status === filterStatus) &&
      `${i.title} ${planNumber(i)} ${(i.tasks || []).map((t) => `T-${String(t.id).padStart(3, "0")} ${t.title}`).join(" ")}`
        .toLowerCase()
        .includes(query.toLowerCase()),
  );
  function clear() {
    setOwner("");
    setFilterStatus("");
    setQuery("");
  }
  const toolbar = (
    <div className="work-toolbar">
      <div className="tool-group">
        {can && (
          <button
            className="btn primary sm"
            onClick={() => edit("item")}
            disabled={!stage}
          >
            <Icon name="plus" />
            创建计划项
          </button>
        )}
        <span className="work-count">
          计划项 <b>{work.length}</b>　里程碑 <b>{milestones.length}</b>
        </span>
      </div>
      <div className="tool-group wrap-tools">
        <select
          className="input tiny"
          aria-label="筛选负责人"
          value={owner}
          onChange={(e) => setOwner(e.target.value)}
        >
          <option value="">负责人：全部</option>
          {store.members.map((m) => (
            <option key={m.userId} value={m.userId}>
              {m.user.username}
            </option>
          ))}
        </select>
        <select
          className="input tiny"
          aria-label="筛选状态"
          value={filterStatus}
          onChange={(e) => setFilterStatus(e.target.value)}
        >
          <option value="">状态：全部</option>
          {states.map((s) => (
            <option key={s} value={s}>
              {stateLabels[s]}
            </option>
          ))}
        </select>
        <button className="btn sm" onClick={clear}>
          ⌕ 清除筛选
        </button>
      </div>
    </div>
  );
  const subtoolbar = (
    <div className="subtoolbar">
      <div className="left-sub">
        <Icon name="layers" />
        <b>计划工作项</b>
        <span>列表模式 · {filtered.length} 项</span>
      </div>
      <div className="right-sub">
        <input
          className="input search-work"
          aria-label="搜索计划项"
          placeholder="搜索计划名称 / 任务编号"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        {can && (
          <button
            className="btn sm"
            onClick={() => edit("milestone")}
            disabled={!stage}
          >
            ◆ 里程碑
          </button>
        )}
      </div>
    </div>
  );
  const taskSet = [...new Set(work.flatMap((i) => i.taskIds || []))],
    people = [...new Set(work.map((i) => i.ownerUserId).filter(Boolean))];
  const tracking = filtered.filter(
    (i) =>
      (!onlyLinked || (i.tasks || []).length > 0) &&
      (can || (i.tasks || []).some((t) => t.assigneeUserId === store.user.id)),
  );
  const trackingRows = tracking.flatMap<{
    item: PlanItemView;
    task: ManagedTask | null;
    member: number | null;
    label: string;
  }>((i) =>
    i.tasks?.length
      ? i.tasks
          .filter((t) => can || t.assigneeUserId === store.user.id)
          .map((t) => ({
            item: i,
            task: t,
            member: t.assigneeUserId,
            label:
              store.members.find((m) => m.userId === t.assigneeUserId)?.user
                .username || "未指派",
          }))
      : [{ item: i, task: null, member: null, label: "未关联任务" }],
  );
  const groupLabels = [...new Set(trackingRows.map((x) => x.label))];
  return (
    <div className={`a-plan-view ${embedded ? "a-plan-embedded" : ""}`}>
      <div className="workbody">
        <aside className={`stagepane ${collapsed ? "gantt-ministage" : ""}`}>
          <div className="stagetool">
            <div className="stageheadline">
              {can && (
                <button className="stagecreate" onClick={() => edit("plan")}>
                  <Icon name="plus" />
                  新建阶段计划
                </button>
              )}
              <button
                className="iconbutton"
                aria-label="展开或收起阶段栏"
                onClick={() => setCollapsed((v) => !v)}
              >
                <Icon name="list" />
              </button>
            </div>
            <div className="stagefilter">
              <Icon name="search" />
              <input
                placeholder="搜索阶段计划"
                aria-label="搜索阶段计划"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
          </div>
          <div className="stagelist">
            <button
              className="unplanned-row"
              onClick={() => {
                setSelected("unplanned");
                setView("list");
                clear();
              }}
            >
              <Icon name="folder" />
              待规划 <span style={{ marginLeft: "auto" }}>0</span>
            </button>
            <div className="sectionhint">阶段计划（{plans.stages.length}）</div>
            {plans.stages
              .filter((s) => `${s.title} ${s.description}`.includes(search))
              .map((s) => {
                const arr = plans.items.filter(
                    (i) => i.stageId === s.id && i.kind === "item",
                  ),
                  percent = arr.length
                    ? Math.round(
                        (arr.filter((i) => i.status === "DONE").length /
                          arr.length) *
                          100,
                      )
                    : 0;
                return (
                  <button
                    className={`stagecard ${s.id === stage?.id ? "active" : ""}`}
                    key={s.id}
                    onClick={() => {
                      setSelected(s.id);
                      clear();
                    }}
                  >
                    <div className="stagename">
                      <span className="stageicon">
                        <Icon name="flag" size={15} />
                      </span>
                      <span>{s.title}</span>
                    </div>
                    <span className="stagedate">
                      {s.start} — {s.end}
                    </span>
                    <div className="stagecounts">
                      <span>完成 {percent}%</span>
                      <span>
                        计划项 {arr.length} · 里程碑{" "}
                        {
                          plans.items.filter(
                            (i) => i.stageId === s.id && i.kind === "milestone",
                          ).length
                        }
                      </span>
                    </div>
                    <div className="stage-progress">
                      <span style={{ width: percent + "%" }} />
                    </div>
                  </button>
                );
              })}
          </div>
        </aside>
        <div className="pagearea">
          <div className="stageheading">
            <div className="stageline">
              <div className="titlegroup">
                <div className="bigstageicon">
                  <Icon name="flag" size={22} />
                </div>
                <div style={{ minWidth: 0 }}>
                  <h1>{stage?.title || "暂无阶段计划"}</h1>
                  <div className="titledate">
                    {embedded && (
                      <select
                        aria-label="工作台阶段"
                        value={stage?.id || ""}
                        onChange={(e) => setSelected(e.target.value)}
                      >
                        {plans.stages.map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.title}
                          </option>
                        ))}
                      </select>
                    )}
                    <span>
                      {stage
                        ? `${stage.start} — ${stage.end}`
                        : "请创建阶段计划"}
                    </span>
                    <span>负责人：{stage?.owner || "未指派"}</span>
                  </div>
                </div>
              </div>
              <div className="headbuttons">
                <button
                  className="btn sm"
                  disabled={!stage}
                  onClick={() => stage && open(stage)}
                >
                  <Icon name="info" size={15} />
                  详情
                </button>
                {can && (
                  <>
                    <button
                      className="btn sm"
                      disabled={!stage}
                      onClick={() => edit("plan", stage)}
                    >
                      <Icon name="edit" size={15} />
                      编辑阶段
                    </button>
                    <button
                      className="btn primary sm"
                      disabled={!stage}
                      onClick={() => edit("item")}
                    >
                      <Icon name="plus" size={15} />
                      添加计划项
                    </button>
                  </>
                )}
              </div>
            </div>
            {!embedded && (
              <div className="viewtabs">
                {[
                  ["overview", "概览"],
                  ["list", "列表"],
                  ["kanban", "看板"],
                  ["gantt", "甘特图"],
                  ["members", "成员任务跟踪"],
                ].map(([id, label]) => (
                  <button
                    key={id}
                    className={`tab ${view === id ? "active" : ""}`}
                    onClick={() => {
                      setView(id);
                      clear();
                    }}
                  >
                    {label}
                  </button>
                ))}
              </div>
            )}
          </div>
          <main className="board">
            {view === "gantt" ? (
              <PlanGantt
                stage={stage}
                items={items}
                onOpen={open}
                onCreate={() => edit("item")}
                collapsed={collapsed}
                onCollapse={() => setCollapsed((v) => !v)}
                highlightIds={highlightIds}
                onPlanFocus={onPlanFocus}
              />
            ) : !stage ? (
              <div className="blank plan-empty-state">
                <span>暂无阶段计划</span>
                {can && (
                  <button className="btn primary" onClick={() => edit("plan")}>
                    新建阶段计划
                  </button>
                )}
              </div>
            ) : view === "overview" ? (
              <>
                <div className="metrics">
                  {[
                    ["阶段计划项", work.length, "计划项"],
                    ["关联任务", taskSet.length, "任务"],
                    ["阶段里程碑", milestones.length, "里程碑"],
                    ["覆盖负责人", people.length, "成员"],
                  ].map(([label, count, unit]) => (
                    <div className="card metric" key={label}>
                      <div className="statname">{label}</div>
                      <div className="metricbody">
                        <div className="donut" />
                        <div>
                          <div className="statnumber">{count}</div>
                          <div className="statsub">{unit}</div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
                <section className="card timecard">
                  <div className="cardtitle">
                    关键时间
                    <button
                      className="linkbtn"
                      onClick={() => setView("gantt")}
                    >
                      查看甘特图 →
                    </button>
                  </div>
                  <div className="timetrack">
                    {[
                      { title: "开始时间", date: stage.start },
                      ...(milestones.length
                        ? [
                            {
                              title: milestones[0].title,
                              date: milestones[0].start,
                            },
                          ]
                        : []),
                      { title: "结束时间", date: stage.end },
                    ].map((s, i) => (
                      <div className="timepoint" key={i}>
                        <span className="pointdot" />
                        <span className="pointname">{s.title}</span>
                        <span className="pointdate">{s.date}</span>
                      </div>
                    ))}
                  </div>
                </section>
                <div className="lower">
                  <section className="card infocard">
                    <div className="cardtitle">
                      基本信息
                      {can && (
                        <button
                          className="iconbutton"
                          title="编辑计划"
                          onClick={() => edit("plan", stage)}
                        >
                          ✎
                        </button>
                      )}
                    </div>
                    <div className="infohero">
                      <div className="herohead">
                        <span className="stageicon">
                          <Icon name="flag" size={15} />
                        </span>
                        {stage.title}
                        <span className="minitag">阶段计划</span>
                      </div>
                      <div className="herosub">
                        <span>负责人：{stage.owner}</span>
                        <span>
                          起止日期：{stage.start} 至 {stage.end}
                        </span>
                      </div>
                    </div>
                    <div className="infodesc">
                      {stage.description || "暂无阶段说明"}
                    </div>
                    <div className="infopieces">
                      {[
                        [work.length, "计划项"],
                        [taskSet.length, "关联任务"],
                        [milestones.length, "里程碑"],
                      ].map(([n, t]) => (
                        <div className="piece" key={t}>
                          <strong>{n}</strong>
                          <small>{t}</small>
                        </div>
                      ))}
                    </div>
                  </section>
                  <section className="card goalscard">
                    <div className="cardtitle">
                      计划目标
                      {can && (
                        <button
                          className="linkbtn"
                          onClick={() => {
                            setError("");
                            setGoalTitle("");
                          }}
                        >
                          + 添加目标
                        </button>
                      )}
                    </div>
                    {stage.goals.map((g) => (
                      <label
                        className={`goalitem ${g.done ? "done" : ""}`}
                        key={g.id}
                      >
                        <input
                          type="checkbox"
                          checked={goalStates[g.id] ?? g.done}
                          disabled={!can || g.id in goalStates}
                          onChange={(e) => {
                            const done = e.target.checked;
                            setGoalStates((x) => ({ ...x, [g.id]: done }));
                            void store
                              .write(
                                `/plan-adapter/stages/${stage.id}/goals/${g.id}`,
                                "PATCH",
                                { done },
                              )
                              .catch(store.onError)
                              .finally(() =>
                                setGoalStates((x) => {
                                  const next = { ...x };
                                  delete next[g.id];
                                  return next;
                                }),
                              );
                          }}
                        />
                        <span>{g.title}</span>
                      </label>
                    ))}
                    <div className="links">
                      计划目标与计划项共同归属当前阶段
                    </div>
                  </section>
                </div>
                <section className="card compactpanel">
                  <div className="cardtitle">
                    阶段工作项
                    <button className="linkbtn" onClick={() => setView("list")}>
                      查看完整列表 →
                    </button>
                  </div>
                  <div className="minirows">
                    {work.slice(0, 3).map((i) => (
                      <div className="minirow" key={i.id}>
                        <button onClick={() => open(i)}>{i.title}</button>
                        <span>{i.owner}</span>
                        <span>{i.start} 起</span>
                      </div>
                    ))}
                  </div>
                </section>
              </>
            ) : view === "list" ? (
              <section className="data-workspace">
                {toolbar}
                {subtoolbar}
                <div className="data-scroll">
                  <div className="data-head">
                    {[
                      "",
                      "标题",
                      "负责人",
                      "优先级",
                      "预计开始",
                      "预计结束",
                      "状态",
                      "关联任务",
                    ].map((s, i) => (
                      <span key={i}>
                        {i === 0 ? (
                          <input
                            type="checkbox"
                            disabled
                            aria-label="选择全部"
                          />
                        ) : (
                          s
                        )}
                      </span>
                    ))}
                  </div>
                  <div className="data-row group-row">
                    <span>⌄</span>
                    <span style={{ fontWeight: 700 }}>
                      {stage.title} ({filtered.length})
                    </span>
                    <span />
                    <span />
                    <span>{stage.start}</span>
                    <span>{stage.end}</span>
                    <span />
                    <span />
                  </div>
                  {[
                    ...filtered,
                    ...milestones.filter(
                      (i) => !query || i.title.includes(query),
                    ),
                  ].map((i) => (
                    <div
                      key={i.id}
                      className={`data-row ${i.kind === "milestone" ? "milestone-row" : ""}`}
                    >
                      <span>
                        {i.kind === "milestone" ? (
                          "◇"
                        ) : (
                          <input
                            type="checkbox"
                            disabled
                            aria-label={`选择计划项 ${i.title}`}
                          />
                        )}
                      </span>
                      <span className="row-title">
                        <span
                          className={`type-dot ${i.kind === "milestone" ? "milestone" : ""}`}
                        >
                          {i.kind === "milestone" ? "◆" : "项"}
                        </span>
                        <button className="title-link" onClick={() => open(i)}>
                          {i.title}
                        </button>
                      </span>
                      <span>{i.owner}</span>
                      <span>
                        {i.kind === "item" ? priority(i.priority) : "—"}
                      </span>
                      <span>{i.start}</span>
                      <span>{i.end}</span>
                      <span>
                        {i.kind === "item" ? (
                          status(i.status)
                        ) : (
                          <span className="minitag mile">里程碑</span>
                        )}
                      </span>
                      <span>
                        {i.taskIds?.map((id) => (
                          <button
                            className="title-link"
                            key={id}
                            onClick={() => actions.open(id)}
                          >
                            T-{String(id).padStart(3, "0")}
                          </button>
                        )) || "—"}
                      </span>
                    </div>
                  ))}
                </div>
                <div className="workspace-foot">
                  列表、看板与甘特图读取同一份计划项数据；计划项状态不会修改独立项目任务的状态。
                </div>
              </section>
            ) : view === "kanban" ? (
              <section className="kanban-workspace">
                {toolbar}
                <div className="subtoolbar">
                  <div className="left-sub">
                    <Icon name="layers" />
                    <b>阶段工作项看板</b>
                    <span>按计划项状态分组</span>
                  </div>
                  <span className="muted">
                    {can
                      ? "拖拽卡片按计划项流程变更状态"
                      : "当前身份只读，可查看计划项详情"}
                  </span>
                </div>
                <div className="board-flow-help">
                  待处理 → 进行中 →
                  已完成；暂缓后可恢复到待处理；已完成可重新进入进行中。
                </div>
                <div className="kanban-cols">
                  {states.map((s) => (
                    <div
                      key={s}
                      className={`kanban-col ${dragging && s !== dragging.status && !transitions[dragging.status].includes(s) ? "drop-denied" : ""}`}
                      data-plan-status={s}
                      onDragOver={(e) => {
                        if (
                          can &&
                          dragging &&
                          (dragging.status === s ||
                            transitions[dragging.status].includes(s))
                        )
                          e.preventDefault();
                      }}
                      onDrop={(e) => {
                        e.preventDefault();
                        const item =
                          dragging ||
                          work.find(
                            (i) =>
                              i.id ===
                              e.dataTransfer.getData("application/x-spm-plan"),
                          );
                        if (can && item) void stateChange(item, s);
                      }}
                    >
                      <div className="kanban-col-title">
                        <b>{stateLabels[s]}</b>
                        <span className="col-counter">
                          {filtered.filter((i) => i.status === s).length}
                        </span>
                        {can && (
                          <button
                            className="iconbutton"
                            aria-label={`新建${stateLabels[s]}计划项`}
                            onClick={() => edit("item")}
                          >
                            ＋
                          </button>
                        )}
                      </div>
                      <div className="kanban-card-list">
                        {filtered
                          .filter((i) => i.status === s)
                          .map((i) => (
                            <article
                              className="kanban-card"
                              data-plan-id={i.id}
                              draggable={can}
                              onDragStart={(e) => {
                                e.dataTransfer.effectAllowed = "move";
                                e.dataTransfer.setData(
                                  "application/x-spm-plan",
                                  i.id,
                                );
                                setDragging(i);
                              }}
                              onDragEnd={() => setDragging(null)}
                              key={i.id}
                            >
                              <div className="kanban-item-top">
                                <span className="type-dot">项</span>
                                <button
                                  className="title-link"
                                  onClick={() => open(i)}
                                >
                                  {i.title}
                                </button>
                              </div>
                              <div className="kanban-dates">
                                {i.start} － {i.end}
                              </div>
                              <div className="kanban-item-foot">
                                <span className="person-chip">
                                  <span className="person-avatar">
                                    {i.owner[0]}
                                  </span>
                                  {i.owner}
                                </span>
                                {priority(i.priority)}
                              </div>
                            </article>
                          ))}
                        {!filtered.some((i) => i.status === s) && (
                          <div className="kanban-empty">
                            {can ? "拖入计划项至此" : "暂无计划项"}
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
                <div className="workspace-foot">
                  此看板管理计划项状态，与用户故事看板和独立项目任务分别维护。
                </div>
              </section>
            ) : (
              <section className="member-v32">
                <div className="mv-toolbar">
                  <div className="mv-title">
                    成员任务跟踪 <span>按负责人展开与追踪计划关联任务</span>
                  </div>
                  <div className="mv-tools">
                    <input
                      type="search"
                      aria-label="搜索关联任务"
                      placeholder="搜索任务或计划项"
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                    />
                    <select
                      aria-label="筛选负责人"
                      value={owner}
                      onChange={(e) => setOwner(e.target.value)}
                    >
                      <option value="">全部负责人</option>
                      {store.members.map((m) => (
                        <option key={m.userId} value={m.userId}>
                          {m.user.username}
                        </option>
                      ))}
                    </select>
                    <select
                      aria-label="筛选计划项状态"
                      value={filterStatus}
                      onChange={(e) => setFilterStatus(e.target.value)}
                    >
                      <option value="">全部状态</option>
                      {states.map((s) => (
                        <option key={s} value={s}>
                          {stateLabels[s]}
                        </option>
                      ))}
                    </select>
                    <button className="mv-secondary" onClick={clear}>
                      重置
                    </button>
                  </div>
                </div>
                <div className="mv-summary">
                  <div>
                    <b>
                      {
                        new Set(
                          trackingRows
                            .filter((x) => x.task)
                            .map((x) => x.member),
                        ).size
                      }
                    </b>
                    <span>相关成员</span>
                  </div>
                  <div>
                    <b>
                      {
                        new Set(
                          trackingRows
                            .filter((x) => x.task)
                            .map((x) => x.task!.id),
                        ).size
                      }
                    </b>
                    <span>关联任务</span>
                  </div>
                  <div>
                    <b>
                      {
                        tracking.filter((i) => i.status === "IN_PROGRESS")
                          .length
                      }
                    </b>
                    <span>进行中的计划项</span>
                  </div>
                  <div className="mv-endnote">
                    仅显示当前阶段及本人有权查看的任务
                  </div>
                </div>
                <div className="mv-options">
                  <label>
                    <input
                      type="checkbox"
                      checked={onlyLinked}
                      onChange={(e) => setOnlyLinked(e.target.checked)}
                    />{" "}
                    仅显示已关联任务
                  </label>
                  <button
                    onClick={() =>
                      setGroups(
                        Object.fromEntries(groupLabels.map((g) => [g, true])),
                      )
                    }
                  >
                    全部展开
                  </button>
                  <button
                    onClick={() =>
                      setGroups(
                        Object.fromEntries(groupLabels.map((g) => [g, false])),
                      )
                    }
                  >
                    全部收起
                  </button>
                  <span>共 {trackingRows.length} 条计划关联记录</span>
                </div>
                <div className="mv-tablewrap">
                  <div className="mv-th">
                    {[
                      "成员 / 任务标题",
                      "关联任务 ID",
                      "优先级",
                      "预计开始",
                      "预计结束",
                      "计划项状态",
                    ].map((t) => (
                      <div key={t}>{t}</div>
                    ))}
                  </div>
                  {groupLabels.map((name) => (
                    <div className="mv-group" key={name}>
                      <button
                        className="mv-grouphead"
                        onClick={() =>
                          setGroups((g) => ({
                            ...g,
                            [name]: g[name] === false,
                          }))
                        }
                      >
                        <span className="mv-arrow">
                          {groups[name] === false ? "▸" : "▾"}
                        </span>
                        <span className="mv-avatar">{name[0]}</span>
                        <b>{name}</b>
                        <span className="mv-pill">
                          {
                            new Set(
                              trackingRows
                                .filter((x) => x.label === name && x.task)
                                .map((x) => x.task!.id),
                            ).size
                          }{" "}
                          个任务
                        </span>
                        <span className="mv-group-total">
                          计划项{" "}
                          {trackingRows.filter((x) => x.label === name).length}{" "}
                          条
                        </span>
                      </button>
                      {groups[name] !== false &&
                        trackingRows
                          .filter((x) => x.label === name)
                          .map(({ item: i, task: t }, n) => (
                            <div className="mv-data-row" key={i.id + "-" + n}>
                              <div className="mv-workname">
                                <span className="mv-task-ico">任</span>
                                <div>
                                  <button
                                    className="mv-open"
                                    onClick={() =>
                                      t ? actions.open(t.id) : open(i)
                                    }
                                  >
                                    {t?.title || i.title}
                                  </button>
                                  <button
                                    className="mv-subtitle"
                                    onClick={() => open(i)}
                                  >
                                    关联计划项：{i.title}
                                  </button>
                                </div>
                              </div>
                              <div className="mv-id">
                                {t ? `T-${String(t.id).padStart(3, "0")}` : "—"}
                              </div>
                              <div>{priority(i.priority)}</div>
                              <div>{i.start}</div>
                              <div>{i.end}</div>
                              <div>{status(i.status)}</div>
                            </div>
                          ))}
                    </div>
                  ))}
                  {!trackingRows.length && (
                    <div className="mv-norows">
                      当前阶段没有符合条件的关联任务
                    </div>
                  )}
                </div>
                <div className="mv-footer">
                  按任务管理的真实负责人分组；任务本体归任务管理维护。与成员任务图共享任务
                  ID，分别保留各自视图。
                </div>
              </section>
            )}
          </main>
        </div>
      </div>
      {detail && (
        <div
          className="drawer-overlay visible"
          onClick={(e) => {
            if (e.target === e.currentTarget) setDetail(null);
          }}
        >
          <aside
            className="drawer"
            role="dialog"
            aria-modal="true"
            aria-label="计划详情"
          >
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <b>详细信息</b>
              <button
                className="iconbutton"
                onClick={() => setDetail(null)}
                aria-label="关闭计划详情"
              >
                ×
              </button>
            </div>
            <h2 style={{ fontSize: 22, margin: "25px 0 8px" }}>
              {detail.title}
            </h2>
            <div style={{ color: "#4384e7", fontSize: 12 }}>
              {"kind" in detail
                ? detail.kind === "item"
                  ? "计划项"
                  : "里程碑"
                : "阶段计划"}
            </div>
            {[
              [
                "所属阶段",
                "stageId" in detail
                  ? plans.stages.find((s) => s.id === detail.stageId)?.title
                  : detail.title,
              ],
              ["负责人", detail.owner],
              ["开始/目标日期", detail.start],
              ["结束日期", detail.end],
              ["描述", detail.description || "未填写"],
              ...("status" in detail
                ? [
                    ["计划项状态", stateLabels[detail.status]],
                    ["优先级", priorities[detail.priority || "NORMAL"]],
                  ]
                : []),
            ].map(([t, v]) => (
              <div className="detailfield" key={t}>
                <label>{t}</label>
                <strong>{v}</strong>
              </div>
            ))}
            {"taskIds" in detail && (
              <div className="detailfield">
                <label>关联任务</label>
                {detail.taskIds?.map((id) => (
                  <button
                    className="title-link"
                    key={id}
                    onClick={() => {
                      setDetail(null);
                      actions.open(id);
                    }}
                  >
                    T-{String(id).padStart(3, "0")}
                  </button>
                ))}
              </div>
            )}
            <div className="modalactions">
              {can && (
                <button
                  className="btn"
                  onClick={() =>
                    edit("kind" in detail ? detail.kind : "plan", detail)
                  }
                >
                  编辑
                </button>
              )}
              <button className="btn" onClick={() => setDetail(null)}>
                关闭
              </button>
            </div>
          </aside>
        </div>
      )}
      {editor && draft && (
        <div
          className={`overlay visible ${editor.kind === "item" ? "item-edit-overlay" : ""}`}
          onClick={(e) => {
            if (e.target === e.currentTarget && !busy) setEditor(null);
          }}
        >
          <div
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-label={`${editor.entity ? "编辑" : "新建"}${editor.kind === "plan" ? "阶段计划" : editor.kind === "item" ? "计划项" : "里程碑"}`}
          >
            <div className="editor-context">
              当前项目 / 项目计划 / 计划工作项
            </div>
            <h2 className="modaltitle">
              {editor.entity ? "编辑" : "新建"}
              {editor.kind === "plan"
                ? "阶段计划"
                : editor.kind === "item"
                  ? "计划项"
                  : "里程碑"}
            </h2>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void save();
              }}
            >
              <fieldset
                disabled={busy}
                style={{ border: 0, padding: 0, margin: 0 }}
              >
                <div className="formfields">
                  <label className="field full">
                    {editor.kind === "plan"
                      ? "阶段计划"
                      : editor.kind === "item"
                        ? "计划项"
                        : "里程碑"}
                    名称 *
                    <input
                      required
                      maxLength={200}
                      value={draft.title}
                      onChange={(e) =>
                        setDraft({ ...draft, title: e.target.value })
                      }
                      autoFocus
                    />
                  </label>
                  <label className="field full">
                    描述
                    <textarea
                      value={draft.description}
                      maxLength={10000}
                      onChange={(e) =>
                        setDraft({ ...draft, description: e.target.value })
                      }
                    />
                  </label>
                  <label className="field">
                    {editor.kind === "milestone" ? "目标日期 *" : "开始日期 *"}
                    <input
                      type="date"
                      required
                      value={draft.start}
                      onChange={(e) =>
                        setDraft({ ...draft, start: e.target.value })
                      }
                    />
                  </label>
                  {editor.kind !== "milestone" && (
                    <label className="field">
                      结束日期 *
                      <input
                        type="date"
                        required
                        min={draft.start}
                        value={draft.end}
                        onChange={(e) =>
                          setDraft({ ...draft, end: e.target.value })
                        }
                      />
                    </label>
                  )}
                  <label className="field">
                    负责人
                    <select
                      aria-label="负责人"
                      value={draft.ownerUserId}
                      onChange={(e) =>
                        setDraft({ ...draft, ownerUserId: e.target.value })
                      }
                    >
                      <option value="">未指派</option>
                      {store.members.map((m) => (
                        <option key={m.userId} value={m.userId}>
                          {m.user.username}
                        </option>
                      ))}
                    </select>
                  </label>
                  {editor.kind === "item" && (
                    <>
                      <label className="field">
                        计划项状态
                        <select
                          aria-label="计划项状态"
                          value={draft.status}
                          onChange={(e) =>
                            setDraft({
                              ...draft,
                              status: e.target.value as Draft["status"],
                            })
                          }
                        >
                          {states.map((s) => (
                            <option
                              key={s}
                              value={s}
                              disabled={
                                !!editor.entity &&
                                "status" in editor.entity &&
                                editor.entity.status !== s &&
                                !transitions[editor.entity.status].includes(s)
                              }
                            >
                              {stateLabels[s]}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="field">
                        优先级
                        <select
                          aria-label="优先级"
                          value={draft.priority}
                          onChange={(e) =>
                            setDraft({
                              ...draft,
                              priority: e.target.value as Draft["priority"],
                            })
                          }
                        >
                          {Object.entries(priorities).map(([s, t]) => (
                            <option key={s} value={s}>
                              {t}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="field">
                        关联项目任务
                        <select
                          aria-label="关联项目任务"
                          value={draft.taskIds[0] ?? ""}
                          onChange={(e) =>
                            setDraft({
                              ...draft,
                              taskIds: e.target.value
                                ? [Number(e.target.value)]
                                : [],
                            })
                          }
                        >
                          <option value="">不关联</option>
                          {store.tasks.map((t) => (
                            <option key={t.id} value={t.id}>
                              T-{String(t.id).padStart(3, "0")} · {t.title}
                            </option>
                          ))}
                        </select>
                      </label>
                    </>
                  )}
                </div>
                {error && (
                  <div role="alert" className="a-form-error">
                    {error}
                  </div>
                )}
                <div className="modalactions">
                  <button
                    type="button"
                    className="btn"
                    onClick={() => setEditor(null)}
                  >
                    取消
                  </button>
                  {!editor.entity && editor.kind === "item" && (
                    <button
                      type="button"
                      className="btn editor-continuation"
                      onClick={() => void save(true)}
                    >
                      保存并继续创建
                    </button>
                  )}
                  <button type="submit" className="btn primary">
                    {busy ? "保存中…" : "保存"}
                  </button>
                </div>
              </fieldset>
            </form>
          </div>
        </div>
      )}
      {goalTitle !== null && (
        <div className="overlay visible">
          <div
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-label="添加计划目标"
          >
            <h2 className="modaltitle">添加计划目标</h2>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (!stage || busy) return;
                setBusy(true);
                void store
                  .write(`/plan-adapter/stages/${stage.id}/goals`, "POST", {
                    title: goalTitle,
                  })
                  .then(() => setGoalTitle(null))
                  .catch((e) => setError((e as Error).message))
                  .finally(() => setBusy(false));
              }}
            >
              <label className="field full">
                计划目标
                <input
                  required
                  maxLength={200}
                  value={goalTitle}
                  onChange={(e) => setGoalTitle(e.target.value)}
                />
              </label>
              {error && <div role="alert">{error}</div>}
              <div className="modalactions">
                <button
                  type="button"
                  className="btn"
                  disabled={busy}
                  onClick={() => setGoalTitle(null)}
                >
                  取消
                </button>
                <button className="btn primary" disabled={busy}>
                  保存
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
