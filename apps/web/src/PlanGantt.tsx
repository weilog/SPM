import { useEffect, useMemo, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import type {
  ManagedTask,
  ViewFocus,
  PlanItemView,
  PlanStageView,
} from "@spm/shared";
import { useProjectData } from "./ProjectData";
import { AiEntry } from "./ai-events";
import { AiHint } from "./ai-hints";
const day = 86400000;
const date = (s: string) => new Date(s + "T00:00:00Z");
const add = (s: string, n: number) =>
  new Date(date(s).getTime() + n * day).toISOString().slice(0, 10);
const diff = (a: string, b: string) =>
  Math.round((date(a).getTime() - date(b).getTime()) / day);

export function PlanGantt({
  stage,
  items,
  onOpen,
  collapsed,
  onCollapse,
  highlightIds = [],
  onPlanFocus,
  showAi = true,
  focus,
  taskHighlightIds = [],
  onlyRelated = false,
  onTaskFocus,
  onOpenTask,
  onTaskLocate,
}: {
  stage?: PlanStageView;
  focus?: ViewFocus | null;
  taskHighlightIds?: number[];
  onlyRelated?: boolean;
  onTaskFocus?: (id: number) => void;
  onOpenTask?: (id: number) => void;
  onTaskLocate?: (id: number) => void;
  items: PlanItemView[];
  onOpen(item: PlanStageView | PlanItemView): void;
  collapsed: boolean;
  onCollapse(): void;
  highlightIds?: string[];
  onPlanFocus?: (id: string) => void;
  showAi?: boolean;
}) {
  const store = useProjectData(),
    snapshot = store.plans;
  const [scale, setScale] = useState<"day" | "week" | "month">("week"),
    [anchor, setAnchor] = useState(""),
    [draft, setDraft] = useState<{
      id: string;
      left: number;
      width: number;
    } | null>(null);
  const scroller = useRef<HTMLDivElement>(null),
    dragging = useRef<{
      item: PlanItemView;
      side: string;
      startX: number;
      moved: boolean;
    } | null>(null);
  const [expandedTasks, setExpandedTasks] = useState<Set<string>>(new Set());
  const [infoWidth, setInfoWidth] = useState(445);
  const [infoCollapsed, setInfoCollapsed] = useState(false);
  const pan = useRef<{ x: number; scroll: number } | null>(null);
  const shownInfoWidth = infoCollapsed ? 0 : infoWidth;
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const wheel = (e: WheelEvent) => {
      if (
        e.ctrlKey ||
        !(e.target instanceof Element) ||
        !e.target.closest(".gv-timeline")
      )
        return;
      const delta =
        Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
      const next = Math.max(
        0,
        Math.min(el.scrollWidth - el.clientWidth, el.scrollLeft + delta),
      );
      if (next !== el.scrollLeft) {
        e.preventDefault();
        el.scrollLeft = next;
      }
    };
    el.addEventListener("wheel", wheel, { passive: false });
    return () => el.removeEventListener("wheel", wheel);
  }, []);
  const resizeStart = useRef<{ x: number; width: number } | null>(null);
  const maxInfoWidth = useRef(720);
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const observer = new ResizeObserver(() => {
      maxInfoWidth.current = Math.max(280, Math.min(720, el.clientWidth - 140));
      setInfoWidth((value) => Math.min(value, maxInfoWidth.current));
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  function resizeInfo(value: number) {
    setInfoWidth(Math.max(280, Math.min(maxInfoWidth.current, value)));
  }
  const unit = scale === "day" ? 36 : scale === "month" ? 11 : 23,
    count = scale === "day" ? 51 : scale === "month" ? 210 : 105;
  const today = new Date().toLocaleDateString("sv-SE");
  const base = anchor
    ? add(anchor, -Math.min(24, Math.floor(count * 0.28)))
    : add(stage?.start || today, -9);
  const width = count * unit,
    days = Array.from({ length: count }, (_, i) => add(base, i));
  const todayPos = diff(today, base) * unit;
  const groups = useMemo(() => {
    const a: { key: string; label: string; width: number }[] = [];
    for (const dateString of days) {
      const key =
        scale === "month"
          ? dateString.slice(0, 7)
          : add(dateString, -(date(dateString).getUTCDay() + 6) % 7);
      const last = a[a.length - 1];
      if (last?.key === key) last.width += unit;
      else
        a.push({
          key,
          label:
            scale === "month"
              ? key.replace("-", " 年 ") + " 月"
              : key.slice(5).replace("-", "/") +
                " — " +
                add(key, 6).slice(5).replace("-", "/"),
          width: unit,
        });
    }
    return a;
  }, [base, scale]);
  useEffect(() => {
    const el = scroller.current;
    if (el)
      el.scrollLeft = Math.max(
        0,
        diff(stage?.start || today, base) * unit - 50,
      );
  }, [stage?.id, scale]);
  useEffect(() => {
    const target = items.find((i) => highlightIds.includes(i.id));
    if (target && scroller.current)
      scroller.current.scrollLeft = Math.max(
        0,
        diff(target.start, base) * unit - 40,
      );
  }, [highlightIds.join(","), stage?.id, base, unit]);
  useEffect(() => {
    if (focus?.entityType !== "task") return;
    const task = store.tasks.find((t) => t.id === focus.entityId);
    if (task) setExpandedTasks((old) => new Set([...old, ...task.planIds]));
  }, [focus?.entityType, focus?.entityId, store.tasks]);
  type TaskRow = {
    kind: "linkedTask";
    id: string;
    task: ManagedTask;
    parentId: string;
  };
  const rows: (
    | PlanItemView
    | (PlanStageView & { kind: "plan"; status: "TODO" })
    | TaskRow
  )[] = [
    ...(stage
      ? [{ ...stage, kind: "plan" as const, status: "TODO" as const }]
      : []),
    ...items.flatMap((item): (PlanItemView | TaskRow)[] => [
      item,
      ...(expandedTasks.has(item.id)
        ? store.tasks
            .filter(
              (t) =>
                t.planIds.includes(item.id) &&
                (!onlyRelated || taskHighlightIds.includes(t.id)),
            )
            .map((task) => ({
              kind: "linkedTask" as const,
              id: `task:${item.id}:${task.id}`,
              parentId: item.id,
              task,
            }))
        : []),
    ]),
  ];
  const toggleTasks = (id: string) =>
    setExpandedTasks((old) => {
      const next = new Set(old);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  function open(item: PlanStageView | PlanItemView) {
    // The synthetic stage row has a display-only kind; focus the real stage.
    if (stage && item.id === stage.id) {
      onOpen(stage);
      return;
    }
    onOpen(item);
    if ("kind" in item) onPlanFocus?.(item.id);
  }
  function down(e: ReactPointerEvent<HTMLDivElement>, item: PlanItemView) {
    if (e.button !== 0 || !store.project.canManage || !snapshot.available) {
      open(item);
      return;
    }
    const side = (e.target as HTMLElement).dataset.resize || "move";
    dragging.current = { item, side, startX: e.clientX, moved: false };
    e.currentTarget.setPointerCapture(e.pointerId);
  }
  function move(e: ReactPointerEvent<HTMLDivElement>) {
    const d = dragging.current;
    if (!d) return;
    const delta = Math.round((e.clientX - d.startX) / unit);
    if (delta) d.moved = true;
    const left = diff(d.item.start, base) * unit,
      w = (diff(d.item.end, d.item.start) + 1) * unit;
    setDraft({
      id: d.item.id,
      left: left + (d.side === "right" ? 0 : delta * unit),
      width: Math.max(
        unit,
        d.side === "move" ? w : w + delta * unit * (d.side === "left" ? -1 : 1),
      ),
    });
  }
  function up(e: ReactPointerEvent<HTMLDivElement>) {
    const d = dragging.current;
    dragging.current = null;
    setDraft(null);
    if (!d) return;
    if (!d.moved) {
      open(d.item);
      return;
    }
    const delta = Math.round((e.clientX - d.startX) / unit);
    let start = d.item.start,
      end = d.item.end;
    if (d.side === "move") {
      start = add(start, delta);
      end = add(end, delta);
    } else if (d.side === "left") {
      start = add(start, delta);
      if (start > end) start = end;
    } else {
      end = add(end, delta);
      if (end < start) end = start;
    }
    void store
      .write(`/plan-adapter/items/${encodeURIComponent(d.item.id)}`, "PATCH", {
        start,
        end,
        revision: d.item.revision,
      })
      .catch(store.onError);
  }
  const gantt = (
    <section className="gantt-v32">
      <div className="gv-toolbar">
        <div className="gv-summary">
          <b>阶段甘特图</b>
          <span>
            {items.filter((i) => i.kind === "item").length} 项计划项 ·{" "}
            {items.filter((i) => i.kind === "milestone").length} 个里程碑
          </span>
        </div>
        <div className="gv-controls">
          {showAi && (
            <AiEntry
              kind="PLAN"
              label="AI 风险与推演"
              scope={stage ? { stageId: stage.id } : {}}
            />
          )}
          <button
            className="gv-btn"
            onClick={() =>
              setExpandedTasks(
                new Set(
                  items.filter((i) => i.kind === "item").map((i) => i.id),
                ),
              )
            }
          >
            展开关联任务
          </button>
          <button
            className="gv-btn"
            onClick={() => setExpandedTasks(new Set())}
          >
            收起关联任务
          </button>
          <button className="gv-btn" onClick={() => onCollapse()}>
            {collapsed ? "显示" : "收起"}阶段栏
          </button>
          <button
            className="gv-btn"
            aria-expanded={!infoCollapsed}
            onClick={() => setInfoCollapsed((v) => !v)}
          >
            {infoCollapsed ? "展开" : "收起"}信息栏
          </button>
          <button
            className="gv-btn"
            onClick={() => {
              setAnchor(today);
              requestAnimationFrame(() => {
                if (scroller.current)
                  scroller.current.scrollLeft = Math.max(
                    0,
                    Math.min(24, Math.floor(count * 0.28)) * unit - 350,
                  );
              });
            }}
          >
            今天
          </button>
          <button
            className="gv-btn"
            title="缩小"
            onClick={() => setScale(scale === "day" ? "week" : "month")}
          >
            －
          </button>
          <select
            className="gv-select"
            aria-label="甘特图时间尺度"
            value={scale}
            onChange={(e) => setScale(e.target.value as typeof scale)}
          >
            <option value="day">日</option>
            <option value="week">周</option>
            <option value="month">月</option>
          </select>
          <button
            className="gv-btn"
            title="放大"
            onClick={() => setScale(scale === "month" ? "week" : "day")}
          >
            ＋
          </button>
        </div>
      </div>
      <div className="gv-legend">
        <span>
          <i className="gv-swatch gv-plan-swatch" />
          阶段计划
        </span>
        <span>
          <i className="gv-swatch gv-todo-swatch" />
          待处理
        </span>
        <span>
          <i className="gv-swatch gv-run-swatch" />
          进行中
        </span>
        <span>
          <i className="gv-swatch gv-paused-swatch" />
          暂缓
        </span>
        <span>
          <i className="gv-swatch gv-done-swatch" />
          已完成
        </span>
        <span>
          <i className="gv-diamond-legend" />
          里程碑
        </span>
      </div>
      <div
        className="gv-scroller"
        ref={scroller}
        onPointerDown={(e) => {
          if (
            e.button !== 0 ||
            !(e.target instanceof Element) ||
            !e.target.closest(".gv-timeline") ||
            e.target.closest(".gv-range,.gv-diamond,button")
          )
            return;
          pan.current = { x: e.clientX, scroll: e.currentTarget.scrollLeft };
          e.currentTarget.setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e) => {
          if (pan.current)
            e.currentTarget.scrollLeft =
              pan.current.scroll + pan.current.x - e.clientX;
        }}
        onPointerUp={() => {
          pan.current = null;
        }}
        onPointerCancel={() => {
          pan.current = null;
        }}
        onLostPointerCapture={() => {
          pan.current = null;
        }}
      >
        <div
          className="gv-grid-canvas"
          style={{ width: shownInfoWidth + width }}
        >
          <div
            className="gv-left-fixed"
            style={{
              width: infoWidth,
              display: infoCollapsed ? "none" : undefined,
            }}
          >
            <div
              className="gv-left-head"
              style={{ gridTemplateColumns: "minmax(0,1fr) 80px 70px 70px" }}
            >
              <div>计划 / 工作项</div>
              <div>负责人</div>
              <div>预计开始</div>
              <div>预计结束</div>
            </div>
            {rows.map((r) =>
              r.kind === "linkedTask" ? (
                <div
                  className={`gv-fixed-row wb-task-row ${taskHighlightIds.includes(r.task.id) ? "wb-task-selected" : ""}`}
                  data-focus-key={`task:${r.task.id}`}
                  key={r.id}
                >
                  <button
                    className="wb-task-name"
                    onClick={() => onTaskFocus?.(r.task.id)}
                    title={r.task.title}
                  >
                    └ T-{r.task.id} · {r.task.title}
                  </button>
                  <span>
                    {store.members.find(
                      (m) => m.userId === r.task.assigneeUserId,
                    )?.user.username || "未分配"}
                  </span>
                  <button
                    className="link"
                    aria-label={`查看任务 ${r.task.id} 详情`}
                    onClick={() => onOpenTask?.(r.task.id)}
                  >
                    详情
                  </button>
                  {onTaskLocate && (
                    <button
                      className="link"
                      aria-label={`定位任务 ${r.task.id} 负责人`}
                      onClick={() => onTaskLocate(r.task.id)}
                    >
                      定位 ↗
                    </button>
                  )}
                </div>
              ) : (
                <div
                  key={`${r.kind}-${r.id}`}
                  data-focus-key={`${r.kind === "plan" ? "stage" : "planItem"}:${r.id}`}
                  className={`gv-fixed-row ${r.kind === "plan" ? "gv-main-row" : ""}`}
                  style={{
                    gridTemplateColumns: "minmax(0,1fr) 80px 70px 70px",
                  }}
                >
                  <div
                    className="gv-fixed-name"
                    style={{ paddingLeft: r.kind === "plan" ? 13 : 27 }}
                  >
                    <span
                      className={`gv-icon ${r.kind === "milestone" ? "flag" : "task"}`}
                    >
                      {r.kind === "milestone"
                        ? "◆"
                        : r.kind === "plan"
                          ? "▣"
                          : "▤"}
                    </span>
                    {r.kind === "item" && (
                      <button
                        className="wb-task-expand"
                        aria-expanded={expandedTasks.has(r.id)}
                        aria-label={`${expandedTasks.has(r.id) ? "收起" : "展开"} ${r.title} 关联任务`}
                        onClick={() => toggleTasks(r.id)}
                      >
                        {expandedTasks.has(r.id) ? "⌄" : "›"}
                      </button>
                    )}
                    <button onClick={() => open(r)}>{r.title}</button>
                  </div>
                  <div className="gv-fixed-owner">{r.owner || "未指派"}</div>
                  <div>{r.start.slice(5)}</div>
                  <div>{r.end.slice(5)}</div>
                </div>
              ),
            )}
            <div
              className="gv-info-resizer"
              role="separator"
              aria-label="调整甘特图信息区宽度"
              aria-orientation="vertical"
              aria-valuemin={280}
              aria-valuemax={maxInfoWidth.current}
              aria-valuenow={infoWidth}
              tabIndex={0}
              onPointerDown={(e) => {
                if (e.button !== 0) return;
                e.preventDefault();
                resizeStart.current = { x: e.clientX, width: infoWidth };
                e.currentTarget.setPointerCapture(e.pointerId);
              }}
              onPointerMove={(e) => {
                const start = resizeStart.current;
                if (start) resizeInfo(start.width + e.clientX - start.x);
              }}
              onPointerUp={() => {
                resizeStart.current = null;
              }}
              onPointerCancel={() => {
                resizeStart.current = null;
              }}
              onLostPointerCapture={() => {
                resizeStart.current = null;
              }}
              onKeyDown={(e) => {
                if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
                  e.preventDefault();
                  resizeInfo(infoWidth + (e.key === "ArrowLeft" ? -20 : 20));
                }
              }}
            />
          </div>
          <div className="gv-timeline" style={{ width }}>
            <div className="gv-calendar">
              <div className="gv-monthrow" style={{ width }}>
                {groups.map((g) => (
                  <div key={g.key} style={{ width: g.width }}>
                    {g.label}
                  </div>
                ))}
              </div>
              <div className="gv-dayrow" style={{ width }}>
                {days.map((d, i) => {
                  const n = date(d).getUTCDate(),
                    dow = date(d).getUTCDay(),
                    mark =
                      scale === "month"
                        ? n === 1 || i === 0
                        : scale === "week"
                          ? dow === 1 || i === 0
                          : true;
                  return (
                    <div
                      key={d}
                      className={`gv-tick ${dow === 0 || dow === 6 ? "gv-weekend" : ""} ${d === today ? "gv-today-tick" : ""}`}
                      style={{ width: unit }}
                    >
                      {mark
                        ? scale === "month"
                          ? n
                          : scale === "week"
                            ? d.slice(5).replace("-", "/")
                            : n
                        : ""}
                    </div>
                  );
                })}
              </div>
            </div>
            {rows.map((r) => {
              if (r.kind === "linkedTask")
                return (
                  <div
                    className={`gv-time-row wb-task-timeline ${taskHighlightIds.includes(r.task.id) ? "wb-task-selected" : ""}`}
                    key={r.id}
                    style={{ width, backgroundSize: `${unit}px 100%` }}
                  >
                    <span>
                      {
                        {
                          TODO: "待处理",
                          IN_PROGRESS: "进行中",
                          DONE: "已完成",
                        }[r.task.status]
                      }{" "}
                      · {r.task.progress}%
                    </span>
                    <span className="wb-task-meter">
                      <i style={{ width: `${r.task.progress}%` }} />
                    </span>
                    <small>未设置独立排期</small>
                  </div>
                );
              const left = diff(r.start, base) * unit,
                w = Math.max(unit * 0.7, (diff(r.end, r.start) + 1) * unit),
                d = draft?.id === r.id ? draft : null;
              return (
                <div
                  className={`gv-time-row ${r.kind === "plan" ? "gv-planrow" : ""}`}
                  key={`${r.kind}-${r.id}`}
                  style={{ width, backgroundSize: `${unit}px 100%` }}
                >
                  {todayPos >= 0 && todayPos < width && (
                    <i className="gv-now" style={{ left: todayPos }} />
                  )}
                  {r.kind === "milestone" ? (
                    <>
                      <button
                        className="gv-diamond"
                        style={{ left }}
                        title={r.title}
                        onClick={() => open(r)}
                      />
                      <span
                        className="gv-external-label"
                        style={{ left: left + 15 }}
                      >
                        {r.title}
                      </span>
                    </>
                  ) : (
                    <div
                      className={`gv-range ${r.kind === "plan" ? "gv-stagebar" : "gv-itembar"} ${r.status === "DONE" ? "gv-done" : r.status === "IN_PROGRESS" ? "gv-progress" : r.status === "PAUSED" ? "gv-paused" : "gv-todo"} ${highlightIds.includes(r.id) ? "focus-halo" : ""}`}
                      role="button"
                      tabIndex={0}
                      aria-label={r.title}
                      style={{ left: d?.left ?? left, width: d?.width ?? w }}
                      onPointerDown={(e) =>
                        r.kind === "plan" ? open(r) : down(e, r)
                      }
                      onPointerMove={move}
                      onPointerUp={up}
                      onPointerCancel={() => {
                        dragging.current = null;
                        setDraft(null);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") open(r);
                      }}
                    >
                      <span className="gv-range-title">
                        {r.title} <AiHint compact entity={`planItem:${r.id}`} />
                      </span>
                      {r.kind === "item" &&
                        store.project.canManage &&
                        snapshot.available && (
                          <>
                            <i
                              className="gv-handle gv-left-resize"
                              data-resize="left"
                            />
                            <i
                              className="gv-handle gv-right-resize"
                              data-resize="right"
                            />
                          </>
                        )}
                    </div>
                  )}
                </div>
              );
            })}
            {!rows.length && (
              <div className="empty">
                {snapshot.available ? "暂无阶段计划与工作项" : snapshot.reason}
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  );

  return gantt;
}
