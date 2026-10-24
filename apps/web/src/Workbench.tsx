import { useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import type { ResolvedRelations, ViewFocus } from "@spm/shared";
import { api, RequestError } from "./api";
import { useProjectData } from "./ProjectData";
import { useTaskActions } from "./TaskActions";
import { Icon, PageHeading } from "./ui";
import { Requirements } from "./Requirements";
import { MemberTaskGraph } from "./MemberTaskGraph";
import { UmlView } from "./UmlView";
import { SequenceView } from "./SequenceView";
import { PlanView } from "./PlanView";
import { StoryInspector } from "./StoryInspector";
import { storyNumber } from "./StoryViews";
import { AiEntry } from "./ai-events";
import "./workbench-v2.css";
const views = [
  { id: "map", name: "故事地图", icon: "layers" },
  { id: "board", name: "故事看板", icon: "columns" },
  { id: "gantt", name: "甘特图", icon: "gantt" },
  { id: "members", name: "成员任务图", icon: "network" },
  { id: "uml", name: "UML 图", icon: "workflow" },
];
const labels: Record<ViewFocus["entityType"], string> = {
  requirement: "正式需求",
  story: "用户故事",
  task: "任务",
  planItem: "计划项",
  stage: "阶段",
  member: "负责人",
  umlUseCase: "UML 用例",
  sequence: "时序场景",
};
const empty: ResolvedRelations = {
  stories: [],
  tasks: [],
  planItems: [],
  umlUseCases: [],
  trace: [],
};
const keyOf = (f: Pick<ViewFocus, "entityType" | "entityId"> | null) =>
  f ? `${f.entityType}:${f.entityId}` : "";
export function Workbench({
  onNavigate,
}: { onNavigate?: (page: string) => void } = {}) {
  const store = useProjectData(),
    actions = useTaskActions();
  const [primary, setPrimary] = useState("map"),
    [secondary, setSecondary] = useState("board"),
    [dual, setDual] = useState(false);
  const [focus, setFocus] = useState<ViewFocus | null>(null),
    [resolved, setResolved] = useState({ key: "", data: empty });
  const [track, setTrack] = useState(false),
    [onlyRelated, setOnlyRelated] = useState(false),
    [ratio, setRatio] = useState(55);
  const [umlTab, setUmlTab] = useState("usecase"),
    [story, setStory] = useState<number | null>(null),
    [relationError, setRelationError] = useState("");
  const [retry, setRetry] = useState(0);
  const layout = useRef<HTMLDivElement>(null),
    drag = useRef<{ x: number; ratio: number } | null>(null);
  const focusKey = keyOf(focus),
    relations = resolved.key === focusKey ? resolved.data : empty;
  const loadingRelations =
    !!focus && resolved.key !== focusKey && !relationError;
  function selectFocus(next: ViewFocus | null) {
    setRelationError("");
    setFocus(next);
    if (!next) {
      setOnlyRelated(false);
      setTrack(false);
    } else if (!dual) setTrack(true);
  }
  function mode(value: boolean) {
    setDual(value);
    setTrack(false);
  }
  useEffect(() => {
    const locate = (e: Event) => {
      const d = (e as CustomEvent<ViewFocus>).detail;
      if (d.projectId !== store.project.id) return;
      setDual(true);
      setTrack(false);
      setRelationError("");
      setFocus(d);
      if (d.entityType === "task" || d.entityType === "member") {
        setPrimary("members");
        setSecondary("gantt");
      } else if (d.entityType === "planItem" || d.entityType === "stage") {
        setPrimary("gantt");
        setSecondary("members");
      } else if (d.entityType === "umlUseCase" || d.entityType === "sequence") {
        setPrimary("uml");
        setSecondary("map");
        setUmlTab(d.entityType === "sequence" ? "sequence" : "usecase");
      } else {
        setPrimary("map");
        setSecondary("gantt");
      }
    };
    window.addEventListener("spm-workbench-task-members", locate);
    window.addEventListener("spm-ai-locate", locate);
    return () => {
      window.removeEventListener("spm-workbench-task-members", locate);
      window.removeEventListener("spm-ai-locate", locate);
    };
  }, [store.project.id]);
  useEffect(() => {
    let live = true;
    if (!focus) {
      setResolved({ key: "", data: empty });
      return;
    }
    setRelationError("");
    void api<ResolvedRelations>(
      `/projects/${store.project.id}/relations/resolve?mode=trace&entityType=${focus.entityType}&entityId=${encodeURIComponent(focus.entityId)}`,
    )
      .then((data) => {
        if (live) setResolved({ key: focusKey, data });
      })
      .catch((e) => {
        if (live) {
          setResolved({ key: focusKey, data: empty });
          if (e instanceof RequestError && [403, 404].includes(e.status))
            selectFocus(null);
          else setRelationError((e as Error).message || "关联读取失败");
        }
      });
    return () => {
      live = false;
    };
  }, [
    focusKey,
    store.project.id,
    store.tasks,
    store.stories,
    store.diagrams,
    store.plans,
    store.requirements,
    store.members,
    store.sequences,
    retry,
  ]);
  useEffect(() => {
    if (!focus) return;
    const close = (e: KeyboardEvent) => {
      if (e.key === "Escape") setTrack(false);
    };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [focusKey]);
  function locateVisible() {
    for (const pane of layout.current?.querySelectorAll(".viewpane") || []) {
      const elements = [
        ...pane.querySelectorAll<HTMLElement>("[data-focus-key]"),
      ];
      const best =
        elements.find((el) => el.dataset.focusKey === focusKey) ||
        elements.find((el) =>
          relations.trace?.some((t) => keyOf(t) === el.dataset.focusKey),
        );
      if (!best) continue;
      // Scroll only the pane's own containers, keeping the workspace toolbar in place.
      for (
        let parent = best.parentElement;
        parent && parent !== pane.parentElement;
        parent = parent.parentElement
      ) {
        const style = getComputedStyle(parent),
          box = parent.getBoundingClientRect(),
          target = best.getBoundingClientRect();
        if (
          /(auto|scroll)/.test(style.overflowX) &&
          parent.scrollWidth > parent.clientWidth
        ) {
          if (target.left < box.left)
            parent.scrollLeft -= box.left - target.left;
          else if (target.right > box.right)
            parent.scrollLeft += Math.min(
              target.left - box.left,
              target.right - box.right,
            );
        }
        if (
          /(auto|scroll)/.test(style.overflowY) &&
          parent.scrollHeight > parent.clientHeight
        ) {
          if (target.top < box.top) parent.scrollTop -= box.top - target.top;
          else if (target.bottom > box.bottom)
            parent.scrollTop += Math.min(
              target.top - box.top,
              target.bottom - box.bottom,
            );
        }
      }
    }
  }
  useEffect(() => {
    const id = requestAnimationFrame(locateVisible);
    return () => cancelAnimationFrame(id);
  }, [resolved, primary, secondary, dual, umlTab]);
  function navigate(target: Pick<ViewFocus, "entityType" | "entityId">) {
    const next = { ...target, projectId: store.project.id };
    if (target.entityType === "requirement") {
      onNavigate?.("requirements");
      setTimeout(
        () =>
          window.dispatchEvent(
            new CustomEvent("spm-ai-locate", { detail: next }),
          ),
        120,
      );
      return;
    }
    const view =
      target.entityType === "task" || target.entityType === "member"
        ? "members"
        : target.entityType === "planItem" || target.entityType === "stage"
          ? "gantt"
          : target.entityType === "umlUseCase" ||
              target.entityType === "sequence"
            ? "uml"
            : "map";
    if (view === "uml")
      setUmlTab(target.entityType === "sequence" ? "sequence" : "usecase");
    if (view !== primary && (!dual || view !== secondary)) {
      if (dual) setSecondary(view);
      else setPrimary(view);
    }
    selectFocus(next);
  }
  function inspect() {
    if (!focus) return;
    if (focus.entityType === "task") actions.open(Number(focus.entityId));
    else if (focus.entityType === "story") setStory(Number(focus.entityId));
    else if (["planItem", "stage", "umlUseCase"].includes(focus.entityType)) {
      navigate(focus);
      setTimeout(
        () =>
          window.dispatchEvent(
            new CustomEvent("spm-workbench-details", { detail: focus }),
          ),
        80,
      );
    } else navigate(focus);
  }
  const focused = relations.trace?.find((t) => t.distance === 0);
  function pane(id: string, side: string) {
    const v = views.find((v) => v.id === id)!;
    return (
      <section
        className={`viewpane ${id === "gantt" ? "viewpane-gantt" : ""}`}
        aria-label={side}
        key={side + id}
      >
        <div className="pane-header">
          <span className="pane-title">
            <Icon name={v.icon} size={15} />
            {v.name}
          </span>
          <button
            className="btn small light"
            onClick={() => setTrack((v) => !v)}
            aria-label={`${side}关联追踪`}
          >
            关联追踪
          </button>
        </div>
        <div className="pane-body">
          {id === "map" || id === "board" ? (
            <Requirements
              project={store.project}
              onError={store.onError}
              embeddedView={id}
              focus={focus}
              highlightIds={relations.stories}
              onlyRelated={onlyRelated && !!focus}
              focusOnly
              onFocusChange={selectFocus}
              onOpenTask={(id) => actions.open(id)}
            />
          ) : id === "gantt" ? (
            <PlanView
              embedded
              focusOnly
              focus={focus}
              onlyRelated={onlyRelated && !!focus}
              highlightIds={relations.planItems}
              taskHighlightIds={relations.tasks}
              stageHighlightIds={relations.stages}
              onFocusChange={selectFocus}
              onPlanFocus={(id) =>
                selectFocus({
                  projectId: store.project.id,
                  entityType: "planItem",
                  entityId: id,
                })
              }
            />
          ) : id === "members" ? (
            <MemberTaskGraph
              focus={focus}
              focusOnly
              onlyRelated={onlyRelated && !!focus}
              highlightIds={relations.tasks}
              memberHighlightIds={relations.members}
              onFocusChange={selectFocus}
            />
          ) : (
            <>
              <div
                className="wb-uml-tabs"
                role="tablist"
                aria-label="UML 子视图"
              >
                <button
                  role="tab"
                  aria-selected={umlTab === "usecase"}
                  onClick={() => setUmlTab("usecase")}
                >
                  用例图
                </button>
                <button
                  role="tab"
                  aria-selected={umlTab === "sequence"}
                  onClick={() => setUmlTab("sequence")}
                >
                  时序图
                </button>
              </div>
              {umlTab === "usecase" ? (
                <UmlView
                  focusOnly
                  onlyRelated={onlyRelated && !!focus}
                  highlightIds={relations.umlUseCases}
                  onFocusChange={selectFocus}
                  onStory={(id) => {
                    selectFocus({
                      projectId: store.project.id,
                      entityType: "story",
                      entityId: id,
                    });
                    setStory(id);
                  }}
                />
              ) : (
                <SequenceView
                  focus={focus}
                  onlyRelated={onlyRelated && !!focus}
                  highlightIds={relations.sequences || []}
                  onFocusChange={selectFocus}
                  onNavigate={navigate}
                />
              )}
            </>
          )}
        </div>
      </section>
    );
  }
  const grouped = (Object.keys(labels) as ViewFocus["entityType"][]).map(
    (type) => ({
      type,
      items: (relations.trace || []).filter(
        (t) => t.entityType === type && t.distance > 0,
      ),
    }),
  );
  return (
    <>
      <PageHeading
        title="多视图工作台"
        description="在同一份业务数据上追踪、对照与定位"
        actions={
          <>
            <AiEntry kind="CROSS_VIEW" label="AI 跨视图分析" />
            <button
              className="btn"
              onClick={() => void store.refresh().catch(store.onError)}
            >
              <Icon name="refresh" size={14} />
              刷新视图
            </button>
          </>
        }
      />
      <section className="card workbench">
        <div className="view-tabbar">
          <div className="tabs" role="tablist" aria-label="工作台视图">
            {views.map((v) => (
              <button
                role="tab"
                aria-selected={primary === v.id}
                className={`tab ${primary === v.id ? "active" : ""}`}
                key={v.id}
                onClick={() => {
                  setPrimary(v.id);
                  if (v.id === secondary) setSecondary(primary);
                }}
              >
                <Icon name={v.icon} size={15} />
                {v.name}
              </button>
            ))}
          </div>
        </div>
        <div className="work-toolbar wb-toolbar">
          <div className="tool-left">
            <div className="view-mode">
              <button
                className={!dual ? "active" : ""}
                onClick={() => mode(false)}
              >
                单视图
              </button>
              <button
                className={dual ? "active" : ""}
                onClick={() => mode(true)}
              >
                双视图联动
              </button>
            </div>
            {dual && (
              <label className="wb-inline-label">
                对照视图
                <select
                  className="select"
                  aria-label="右侧视图"
                  value={secondary}
                  onChange={(e) => setSecondary(e.target.value)}
                >
                  {views
                    .filter((v) => v.id !== primary)
                    .map((v) => (
                      <option key={v.id} value={v.id}>
                        {v.name}
                      </option>
                    ))}
                </select>
              </label>
            )}
          </div>
          <div className="tool-right">
            <button
              className={`btn small ${onlyRelated ? "primary" : ""}`}
              disabled={!focus}
              aria-pressed={onlyRelated}
              onClick={() => setOnlyRelated((v) => !v)}
            >
              仅看关联项
            </button>
            <button
              className="btn small"
              disabled={!focus}
              onClick={locateVisible}
            >
              定位关联
            </button>
            <button
              className="btn small"
              aria-expanded={track}
              onClick={() => setTrack((v) => !v)}
            >
              关联追踪
            </button>
          </div>
        </div>
        <div className="b-workintro">
          <span>
            需求与故事{" "}
            <b>
              {store.requirements.length} / {store.stories.stories.length}
            </b>
          </span>
          <span>
            未归档任务 <b>{store.tasks.length}</b>
          </span>
          <span>
            计划项 <b>{store.plans.items.length}</b>
          </span>
          <span>
            UML 用例{" "}
            <b>
              {
                store.diagrams
                  .flatMap((d) => d.nodes)
                  .filter((n) => n.kind === "USE_CASE").length
              }
            </b>
          </span>
          <select
            className="select b-focus-pick"
            aria-label="按故事快速定位"
            value={focus?.entityType === "story" ? focus.entityId : ""}
            onChange={(e) =>
              selectFocus(
                e.target.value
                  ? {
                      projectId: store.project.id,
                      entityType: "story",
                      entityId: Number(e.target.value),
                    }
                  : null,
              )
            }
          >
            <option value="">按故事快速定位</option>
            {store.stories.stories.map((s) => (
              <option key={s.id} value={s.id}>
                {storyNumber(s.id)} · {s.title}
              </option>
            ))}
          </select>
          <div className="wb-presets">
            {[
              ["map", "board", "地图 + 看板"],
              ["gantt", "members", "甘特 + 成员"],
              ["map", "uml", "地图 + UML"],
            ].map(([a, b, label]) => (
              <button
                className="btn small light"
                key={label}
                onClick={() => {
                  setPrimary(a);
                  setSecondary(b);
                  mode(true);
                }}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
        <div className="focusbar">
          <div>
            <div className="focus-title">
              <Icon name="target" size={14} />
              {focus
                ? `${labels[focus.entityType]} · ${focused?.label || "正在读取对象…"}`
                : "单击工作项聚焦，关联对象将同步高亮"}
            </div>
            <div className="focus-related">
              {focus
                ? `直接关联 ${(relations.trace || []).filter((t) => t.distance === 1).length} · 间接关联 ${(relations.trace || []).filter((t) => t.distance > 1).length} · ${onlyRelated ? "仅看关联项" : "保留全部对象"}`
                : "双向定位 · 按需对照 · 各对象状态独立维护"}
            </div>
          </div>
          {focus && (
            <button className="btn small" onClick={() => selectFocus(null)}>
              清除焦点
            </button>
          )}
        </div>
        <div className={`wb-workarea ${track && !dual ? "wb-docked" : ""}`}>
          <div
            ref={layout}
            className={`panes wb-panes ${dual ? "dual" : ""}`}
            style={
              {
                "--wb-left": `${ratio}fr`,
                "--wb-right": `${100 - ratio}fr`,
              } as CSSProperties
            }
          >
            {pane(primary, "左侧视图")}
            {dual && (
              <>
                <div
                  className="wb-splitter"
                  role="separator"
                  tabIndex={0}
                  aria-label="调整双视图比例"
                  aria-orientation="vertical"
                  aria-valuemin={30}
                  aria-valuemax={70}
                  aria-valuenow={ratio}
                  onPointerDown={(e) => {
                    drag.current = { x: e.clientX, ratio };
                    e.currentTarget.setPointerCapture(e.pointerId);
                    e.preventDefault();
                  }}
                  onPointerMove={(e) => {
                    if (drag.current && layout.current) {
                      const width = layout.current.clientWidth - 8;
                      setRatio(
                        Math.max(
                          30,
                          Math.min(
                            70,
                            Math.round(
                              drag.current.ratio +
                                ((e.clientX - drag.current.x) / width) * 100,
                            ),
                          ),
                        ),
                      );
                    }
                  }}
                  onPointerUp={() => {
                    drag.current = null;
                  }}
                  onPointerCancel={() => {
                    drag.current = null;
                  }}
                  onLostPointerCapture={() => {
                    drag.current = null;
                  }}
                  onKeyDown={(e) => {
                    if (
                      ["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)
                    ) {
                      e.preventDefault();
                      setRatio((r) =>
                        e.key === "Home"
                          ? 30
                          : e.key === "End"
                            ? 70
                            : Math.max(
                                30,
                                Math.min(
                                  70,
                                  r + (e.key === "ArrowRight" ? 2 : -2),
                                ),
                              ),
                      );
                    }
                  }}
                >
                  <span />
                </div>
                {pane(secondary, "右侧视图")}
              </>
            )}
          </div>
          {track && (
            <aside
              className={`wb-track ${dual ? "wb-overlay" : ""}`}
              aria-label="关联追踪面板"
            >
              <div className="wb-track-head">
                <div>
                  <small>RELATION TRACKING</small>
                  <h3>关联追踪</h3>
                </div>
                <button
                  className="btn small light"
                  aria-label="收起关联追踪"
                  onClick={() => setTrack(false)}
                >
                  收起
                </button>
              </div>
              <div className="wb-track-body">
                {!focus ? (
                  <div className="wb-empty">
                    选择故事、计划项、任务、负责人或 UML 场景，查看真实关联。
                  </div>
                ) : (
                  <>
                    <div className="wb-track-object">
                      <span className="chip">{labels[focus.entityType]}</span>
                      <h3>{focused?.label || "读取中…"}</h3>
                      <button
                        className="btn small"
                        disabled={!focused}
                        onClick={inspect}
                      >
                        查看详情
                      </button>
                    </div>
                    {loadingRelations && <p role="status">正在读取关联…</p>}
                    {relationError && (
                      <div role="alert">
                        {relationError}
                        <button
                          className="btn small"
                          onClick={() => setRetry((r) => r + 1)}
                        >
                          重试
                        </button>
                      </div>
                    )}
                    {grouped.map(
                      ({ type, items }) =>
                        items.length > 0 && (
                          <section className="wb-track-group" key={type}>
                            <h4>
                              {labels[type]} <span>{items.length}</span>
                            </h4>
                            {items.map((t) => (
                              <button
                                className="wb-track-item"
                                aria-label={`${labels[t.entityType]} ${t.label}，${t.distance === 1 ? "直接关联" : "间接关联"}，定位`}
                                key={keyOf(t)}
                                title={t.path.join(" → ")}
                                onClick={() => navigate(t)}
                              >
                                <span>
                                  <b>{t.label}</b>
                                  <small>
                                    {t.distance === 1
                                      ? "直接关联"
                                      : `间接关联 · ${t.distance} 跳`}
                                  </small>
                                  {t.distance > 1 && (
                                    <small className="wb-path">
                                      经 {t.path.slice(1, -1).join(" → ")}
                                    </small>
                                  )}
                                </span>
                                <span>定位 ↗</span>
                              </button>
                            ))}
                          </section>
                        ),
                    )}
                    {!loadingRelations &&
                      !relationError &&
                      !(relations.trace || []).some((t) => t.distance > 0) && (
                        <p className="wb-empty">尚未建立可访问的关联。</p>
                      )}
                    <p className="wb-track-note">
                      关联表示业务联系。修改任务、故事或计划时，其他对象的状态不会自动改变。
                    </p>
                  </>
                )}
              </div>
            </aside>
          )}
        </div>
      </section>
      <StoryInspector id={story} onClose={() => setStory(null)} />
    </>
  );
}
