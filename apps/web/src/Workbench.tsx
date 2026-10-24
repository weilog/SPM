import { useEffect, useState } from "react";
import type { ResolvedRelations, ViewFocus } from "@spm/shared";
import { api } from "./api";
import { useProjectData } from "./ProjectData";
import { useTaskActions } from "./TaskActions";
import { Icon, PageHeading } from "./ui";
import { Requirements } from "./Requirements";
import { MemberTaskGraph } from "./MemberTaskGraph";
import { UmlView } from "./UmlView";
import { PlanView } from "./PlanView";
import { StoryInspector } from "./StoryInspector";
import { storyNumber, taskNumber } from "./StoryViews";
import { AiEntry } from "./ai-events";
const views = [
  { id: "map", name: "故事地图", icon: "layers" },
  { id: "board", name: "故事看板", icon: "columns" },
  { id: "gantt", name: "甘特图", icon: "gantt" },
  { id: "members", name: "成员任务图", icon: "network" },
  { id: "uml", name: "UML 用例图", icon: "workflow" },
];
const empty: ResolvedRelations = {
  stories: [],
  tasks: [],
  planItems: [],
  umlUseCases: [],
};
export function Workbench({
  onNavigate,
}: { onNavigate?: (page: string) => void } = {}) {
  const store = useProjectData(),
    actions = useTaskActions();
  const [primary, setPrimary] = useState("map"),
    [secondary, setSecondary] = useState("board"),
    [dual, setDual] = useState(false),
    [focus, setFocus] = useState<ViewFocus | null>(null),
    [relations, setRelations] = useState(empty),
    [story, setStory] = useState<number | null>(null);
  useEffect(() => {
    const locate = (e: Event) => {
      const d = (e as CustomEvent<ViewFocus>).detail;
      if (d.projectId !== store.project.id) return;
      setDual(true);
      setFocus(d);
      if (d.entityType === "task") {
        setPrimary("members");
        setSecondary("gantt");
      } else if (d.entityType === "planItem") {
        setPrimary("gantt");
        setSecondary("members");
      } else if (d.entityType === "umlUseCase") {
        setPrimary("uml");
        setSecondary("map");
      } else {
        setPrimary("map");
        setSecondary("gantt");
      }
    };
    window.addEventListener("spm-ai-locate", locate);
    return () => window.removeEventListener("spm-ai-locate", locate);
  }, [store.project.id]);
  useEffect(() => {
    let live = true;
    if (!focus) {
      setRelations(empty);
      return;
    }
    void api<ResolvedRelations>(
      `/projects/${store.project.id}/relations/resolve?entityType=${focus.entityType}&entityId=${encodeURIComponent(focus.entityId)}`,
    )
      .then((r) => {
        if (live) setRelations(r);
      })
      .catch((e) => {
        if (live) {
          setRelations(empty);
          store.onError(e);
        }
      });
    return () => {
      live = false;
    };
  }, [focus, store.tasks, store.stories, store.diagrams]);
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
          <span className="pane-counter">{side}</span>
        </div>
        <div className="pane-body">
          {id === "map" || id === "board" ? (
            <Requirements
              project={store.project}
              onError={store.onError}
              embeddedView={id}
              focus={focus}
              highlightIds={relations.stories}
              onFocusChange={setFocus}
              onOpenTask={(id) => actions.open(id)}
            />
          ) : id === "gantt" ? (
            <PlanView
              embedded
              highlightIds={relations.planItems}
              onPlanFocus={(id) =>
                setFocus({
                  projectId: store.project.id,
                  entityType: "planItem",
                  entityId: id,
                })
              }
            />
          ) : id === "members" ? (
            <MemberTaskGraph
              highlightIds={relations.tasks}
              onFocusChange={setFocus}
            />
          ) : (
            <UmlView
              highlightIds={relations.umlUseCases}
              onFocusChange={setFocus}
              onStory={(id) => {
                setFocus({
                  projectId: store.project.id,
                  entityType: "story",
                  entityId: id,
                });
                setStory(id);
              }}
            />
          )}
        </div>
      </section>
    );
  }
  const name =
    focus?.entityType === "requirement"
      ? store.requirements.find((r) => r.id === focus.entityId)?.title
      : focus?.entityType === "story"
        ? store.stories.stories.find((s) => s.id === focus.entityId)?.title
        : focus?.entityType === "task"
          ? store.tasks.find((t) => t.id === focus.entityId)?.title
          : focus?.entityType === "umlUseCase"
            ? store.diagrams
                .flatMap((d) => d.nodes)
                .find((n) => n.id === focus.entityId)?.name
            : store.plans.items.find((p) => p.id === focus?.entityId)?.title;
  return (
    <>
      <PageHeading
        title="多视图工作台"
        description="五种视图统一查看与关联定位"
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
          <div className="tabs" role="tablist">
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
        <div className="work-toolbar">
          <div className="tool-left">
            <div className="view-mode">
              <button
                className={!dual ? "active" : ""}
                onClick={() => setDual(false)}
              >
                <Icon name="panel" size={14} />
                单视图
              </button>
              <button
                className={dual ? "active" : ""}
                onClick={() => setDual(true)}
              >
                <Icon name="split" size={14} />
                双视图联动
              </button>
            </div>
            {dual && (
              <>
                <span className="tool-divider" />
                <span className="muted">右侧视图</span>
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
              </>
            )}
          </div>
          <div className="tool-right">
            <span className="toolbar-summary">
              {dual ? "左右双向定位已启用" : "单视图浏览"}
            </span>
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
                  setDual(true);
                }}
              >
                {label}
              </button>
            ))}
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
            关联计划项 <b>{store.plans.items.length}</b>
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
              setFocus(
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
        </div>
        <div className="focusbar">
          <div style={{ minWidth: 0 }}>
            <div className="focus-title">
              <Icon name="target" size={14} />
              当前关联焦点{" "}
              {focus ? (
                <span className="chip white">
                  {focus.entityType === "story"
                    ? storyNumber(Number(focus.entityId))
                    : focus.entityType === "task"
                      ? taskNumber(Number(focus.entityId))
                      : focus.entityId}
                </span>
              ) : (
                <span className="muted">未选中</span>
              )}
            </div>
            <div className="focus-detail">
              {focus ? name : "点击任一视图中的故事、任务、计划项或 UML 用例"}
            </div>
            <div className="focus-related">
              {focus
                ? `关联故事 ${relations.stories.length} · 任务 ${relations.tasks.length} · 计划项 ${relations.planItems.length} · UML 用例 ${relations.umlUseCases.length} ｜ 其他视图将自动高亮对应对象`
                : "支持左右双向关联定位；切换视图后保留当前焦点"}
            </div>
          </div>
          {focus && (
            <button className="btn small" onClick={() => setFocus(null)}>
              清除焦点
            </button>
          )}
        </div>
        <div className={`panes ${dual ? "dual" : ""}`}>
          {pane(primary, "左侧视图")}
          {dual && pane(secondary, "右侧视图")}
        </div>
        {focus && (
          <div className="focusbar">
            正式需求直接关联：
            {(relations.requirements || []).map((id) => (
              <button
                className="link"
                key={id}
                onClick={() => {
                  onNavigate?.("requirements");
                  setTimeout(
                    () =>
                      window.dispatchEvent(
                        new CustomEvent("spm-ai-locate", {
                          detail: {
                            projectId: store.project.id,
                            entityType: "requirement",
                            entityId: id,
                          },
                        }),
                      ),
                    120,
                  );
                }}
              >
                REQ-{id}
              </button>
            ))}{" "}
            · 其余高亮为业务关系多跳可达，请按证据核实。
          </div>
        )}
      </section>
      <StoryInspector id={story} onClose={() => setStory(null)} />
    </>
  );
}
