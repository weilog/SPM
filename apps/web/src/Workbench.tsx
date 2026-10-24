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
  { id: "uml", name: "UML 建模", icon: "workflow" },
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
  const [primary, setPrimary] = useState("gantt"),
    [secondary, setSecondary] = useState("members"),
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
  const [search, setSearch] = useState("");
  const layout = useRef<HTMLDivElement>(null),
    drag = useRef<{ x: number; ratio: number } | null>(null);
  const focusKey = keyOf(focus),
    relations = resolved.key === focusKey ? resolved.data : empty;
  const loadingRelations =
    !!focus && resolved.key !== focusKey && !relationError;
  const relationKeys = (relations.trace || []).map(keyOf).sort().join("|");
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
      if (e.type === "spm-workbench-task-members") {
        if (primary !== "members" && secondary !== "members") setSecondary("members");
        return;
      }
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
  }, [store.project.id, primary, secondary]);
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
        (pane.getAttribute("data-view") === "members"
          ? elements.find((el) => el.dataset.focusKey?.startsWith("task:") && relations.tasks.includes(Number(el.dataset.focusKey.slice(5))))
          : undefined) ||
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
          if (target.top < box.top + 12) parent.scrollTop -= box.top + 12 - target.top;
          else if (target.bottom > box.bottom - 12)
            parent.scrollTop += Math.min(
              target.top - box.top,
              target.bottom - box.bottom + 12,
            );
        }
      }
    }
  }
  useEffect(() => {
    const id = requestAnimationFrame(locateVisible);
    return () => cancelAnimationFrame(id);
  }, [focusKey, relationKeys, primary, secondary, dual, umlTab]);
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
  const searchable = [
    ...store.stories.stories.map((s) => ({ entityType: "story" as const, entityId: s.id, label: `${storyNumber(s.id)} · ${s.title}` })),
    ...store.tasks.map((t) => ({ entityType: "task" as const, entityId: t.id, label: `T-${t.id} · ${t.title}` })),
    ...store.plans.items.map((i) => ({ entityType: "planItem" as const, entityId: i.id, label: `计划 · ${i.title}` })),
  ].filter((x) => x.label.toLowerCase().includes(search.trim().toLowerCase())).slice(0, 12);
  function pane(id: string, side: string) {
    const v = views.find((v) => v.id === id)!;
    return (
      <section
        className={`viewpane ${id === "gantt" ? "viewpane-gantt" : ""}`}
        aria-label={side}
        data-view={id}
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
        <div className="wb-pane-foot" aria-live="polite">
          <span>{id === "gantt" ? "阶段计划 · 任务独立维护" : "单击工作项追踪关联"}</span>
          <span>{!focus ? "请选择工作项" : loadingRelations ? "读取关联中…" : `${(id === "members" ? relations.tasks : id === "gantt" ? relations.planItems : id === "uml" ? [...relations.umlUseCases, ...(relations.sequences || [])] : relations.stories).length || "暂无"}关联`}</span>
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
    <div className={`wb-page ${focus ? "wb-has-focus" : ""}`}>
      <PageHeading
        title="多视图工作台"
        description="围绕工作项追踪需求、计划与成员协作"
        actions={
          <>
            <AiEntry kind="CROSS_VIEW" label="AI 跨视图分析" />
          </>
        }
      />
      <section className="card workbench">
        <div className="view-tabbar">
          <div className="tabs" role="tablist" aria-label="工作台视图">
            {views.map((v) => (
              <button role="tab" aria-selected={primary === v.id}
                className={`tab ${primary === v.id ? "active" : ""}`} key={v.id}
                onClick={() => { setPrimary(v.id); if (v.id === secondary) setSecondary(primary); }}>
                {v.name}
              </button>
            ))}
          </div>
          <div className="view-mode">
            <button className={!dual ? "active" : ""} onClick={() => mode(false)}>单视图</button>
            <button aria-label="双视图联动" className={dual ? "active" : ""} onClick={() => mode(true)}>双视图</button>
          </div>
        </div>
        <div className="work-toolbar wb-toolbar">
          <div className="tool-left">
            {dual ? <>
              <span className="wb-label">对照组合</span>
              <select className="select" aria-label="左侧视图" value={primary}
                onChange={(e) => { const next = e.target.value; setPrimary(next); if (next === secondary) setSecondary(primary); }}>
                {views.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
              </select>
              <span className="wb-label">↔</span>
              <select className="select" aria-label="右侧视图" value={secondary} onChange={(e) => setSecondary(e.target.value)}>
                {views.filter((v) => v.id !== primary).map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
              </select>
            </> : <span className="wb-label">当前视图　<strong>{views.find((v) => v.id === primary)?.name}</strong></span>}
          </div>
          <div className="wb-search">
            <input className="input" aria-label="搜索工作项" placeholder="搜索故事、任务或计划项" value={search}
              onChange={(e) => setSearch(e.target.value)} onKeyDown={(e) => { if (e.key === "Escape") setSearch(""); }} />
            {search.trim() && <div className="wb-search-results" aria-label="工作项搜索结果">
              {searchable.map((x) => <button key={keyOf(x)} onClick={() => { navigate(x); setSearch(""); }}>{x.label}</button>)}
              {!searchable.length && <p>没有匹配的工作项</p>}
            </div>}
          </div>
          <button className={`btn small ${onlyRelated ? "primary" : ""}`} disabled={!focus} aria-pressed={onlyRelated} onClick={() => setOnlyRelated((v) => !v)}>仅看关联项</button>
          <button className="btn small" disabled={!focus} onClick={locateVisible}><Icon name="target" size={13} />定位关联</button>
          <div className="wb-toolbar-end">
            <details className="wb-more">
              <summary>更多</summary>
              <div className="wb-more-menu">
                <p>需求 {store.requirements.length} · 故事 {store.stories.stories.length} · 任务 {store.tasks.length} · 计划 {store.plans.items.length}</p>
                <select className="select" aria-label="按故事快速定位" value={focus?.entityType === "story" ? focus.entityId : ""}
                  onChange={(e) => selectFocus(e.target.value ? { projectId: store.project.id, entityType: "story", entityId: Number(e.target.value) } : null)}>
                  <option value="">按故事快速定位</option>
                  {store.stories.stories.map((s) => <option key={s.id} value={s.id}>{storyNumber(s.id)} · {s.title}</option>)}
                </select>
                <div className="wb-presets">{[["map", "board", "地图 + 看板"], ["gantt", "members", "甘特 + 成员"], ["map", "uml", "地图 + UML"]].map(([a,b,label]) =>
                  <button className="btn small" key={label} onClick={(e) => { setPrimary(a); setSecondary(b); mode(true); e.currentTarget.closest("details")?.removeAttribute("open"); }}>{label}</button>)}</div>
                <button className="btn small" onClick={() => void store.refresh().catch(store.onError)}>刷新视图</button>
              </div>
            </details>
            <button className="btn small" aria-label="关联追踪" aria-expanded={track} onClick={() => setTrack((v) => !v)}><Icon name="link" size={13} />关联信息</button>
          </div>
        </div>
        <div className="focusbar">
          <div className="focus-title"><span className="wb-focus-dot" />{focus ? `当前聚焦：${focused?.label || "正在读取对象…"}` : "单击任一工作项，即可追踪它在其他视图中的关联。"}
            {focus && <span className="focus-related">关联 {Math.max(0, (relations.trace?.length || 1) - 1)} 个对象</span>}
            {focus && <button className="btn-text" onClick={() => selectFocus(null)}>清除焦点</button>}
          </div>
          <span className="wb-label">{dual ? "双视图 · 联动对照" : "单视图 · 专注浏览"}</span>
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
                        查看完整详情
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
    </div>
  );
}
