import { useEffect, useState } from "react";
import type { DragEvent } from "react";
import type {
  Epic,
  ProductGoal,
  StoryMapData,
  StoryStatus,
  UserStory,
  ViewFocus,
} from "@spm/shared";
import { storyStatusLabels } from "@spm/shared";
import { Icon, Status } from "./ui";
import { AiHint } from "./ai-hints";
export const storyNumber = (id: number) => `US-${String(id).padStart(3, "0")}`;
export const requirementNumber = (id: number) =>
  `REQ-${String(id).padStart(3, "0")}`;
export const taskNumber = (id: number) => `T-${String(id).padStart(3, "0")}`;
export function StoryStatusTag({ status }: { status: StoryStatus }) {
  return <Status value={status} />;
}
interface CommonProps {
  data: StoryMapData;
  readOnly: boolean;
  busy: boolean;
  focus?: ViewFocus | null;
  highlightIds?: number[];
  onFocusChange?: (focus: ViewFocus) => void;
  embedded?: boolean;
  focusOnly?: boolean;
  onOpen(story: UserStory): void;
  taskCounts?: Record<number, number>;
}
function StoryCard(props: CommonProps & { story: UserStory; board?: boolean }) {
  const { story: s, readOnly, busy, taskCounts = {}, board } = props;
  const highlighted =
    props.highlightIds?.includes(s.id) ||
    (props.focus?.entityType === "story" && props.focus.entityId === s.id);
  return (
    <article
      className={`story-card ${highlighted ? "highlight" : ""}`}
      aria-label={storyNumber(s.id)}
      data-story-id={s.id}
      data-focus-key={`story:${s.id}`}
      draggable={!readOnly && !busy}
      onDragStart={(e) => {
        if (readOnly || busy) {
          e.preventDefault();
          return;
        }
        e.dataTransfer.setData("application/x-spm-story", String(s.id));
        e.dataTransfer.effectAllowed = "move";
      }}
    >
      <AiHint entity={`story:${s.id}`} />
      <button
        className="story-card-main"
        aria-label={s.title}
        onClick={() => {
          props.onFocusChange?.({
            projectId: s.projectId,
            entityType: "story",
            entityId: s.id,
          });
          if (!props.focusOnly) props.onOpen(s);
        }}
      >
        <div className="story-id">
          {storyNumber(s.id)}{" "}
          {!board && (
            <span className="b-story-card-count">
              · {props.data.epics.find((e) => e.id === s.epicId)?.title}
            </span>
          )}
        </div>
        <div className="story-name">{s.title}</div>
        <div className="b-story-desc">{s.description || "暂无描述"}</div>
      </button>
      {props.focusOnly && (
        <button
          className="b-inline-link wb-story-details"
          onClick={() => props.onOpen(s)}
          aria-label={`查看 ${storyNumber(s.id)} 详情`}
        >
          查看详情 ↗
        </button>
      )}
      {board ? (
        <div className="b-story-footer">
          <span>{props.data.epics.find((e) => e.id === s.epicId)?.title}</span>
          <span>{taskCounts[s.id] ?? 0} 项关联任务</span>
        </div>
      ) : (
        <div className="b-story-meta">
          <Status value={s.status} />
          <span>
            需求 {s.requirementIds.length} · 任务 {taskCounts[s.id] ?? 0}
          </span>
        </div>
      )}
    </article>
  );
}
function drop(e: DragEvent, allowed: boolean, action: (id: number) => void) {
  e.preventDefault();
  e.stopPropagation();
  if (!allowed) return;
  const id = Number(e.dataTransfer.getData("application/x-spm-story"));
  if (Number.isSafeInteger(id) && id > 0) action(id);
}
const sorted = <T extends { sortOrder: number; id: number }>(a: T[]) =>
  [...a].sort((x, y) => x.sortOrder - y.sortOrder || x.id - y.id);
export interface StoryMapProps extends CommonProps {
  onMove(id: number, epicId: number, position: number): void;
  onNewGoal(): void;
  onNewEpic(goal: ProductGoal): void;
  onNewStory(epic: Epic): void;
  onEditGoal(goal: ProductGoal): void;
  onEditEpic(epic: Epic): void;
}
export function StoryMap(props: StoryMapProps) {
  const { data, readOnly, busy } = props;
  const [selected, setSelected] = useState<number>();
  const goal =
    data.goals.find((g) => g.id === selected) || sorted(data.goals)[0];
  const epics = sorted(data.epics.filter((e) => e.goalId === goal?.id));
  const writable = !readOnly && !busy;
  useEffect(() => {
    const story = data.stories.find(
      (s) =>
        props.highlightIds?.includes(s.id) ||
        (props.focus?.entityType === "story" && s.id === props.focus.entityId),
    );
    const epic = data.epics.find((e) => e.id === story?.epicId);
    if (epic) setSelected(epic.goalId);
  }, [props.focus, props.highlightIds?.join(",")]);
  return (
    <div className="story-map" aria-label="用户故事地图" aria-busy={busy}>
      <div className="b-story-bar">
        <div className="b-story-stats">
          <Icon name="layers" size={15} />
          <strong>产品目标 → Epic → 用户故事</strong>
          <span>
            当前 {epics.length} 个 Epic ·{" "}
            {
              data.stories.filter((s) => epics.some((e) => e.id === s.epicId))
                .length
            }{" "}
            条故事
          </span>
        </div>
        {!readOnly && (
          <div className="b-story-toolbar">
            <button
              className="btn small"
              disabled={busy}
              onClick={props.onNewGoal}
            >
              <Icon name="plus" size={13} />
              产品目标
            </button>
            <button
              className="btn small"
              disabled={busy || !goal}
              onClick={() => props.onNewEpic(goal)}
            >
              <Icon name="plus" size={13} />
              Epic
            </button>
          </div>
        )}
      </div>
      <div className="b-goals">
        {sorted(data.goals).map((g) => (
          <button
            key={g.id}
            className={`b-goal-card ${g.id === goal?.id ? "active" : ""}`}
            onClick={() => setSelected(g.id)}
            onDoubleClick={() => {
              if (!readOnly) props.onEditGoal(g);
            }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                gap: 9,
              }}
            >
              <strong>
                <Icon name="target" size={14} />
                {g.title}
              </strong>
              <Icon name="arrow" size={14} />
            </div>
            <small>
              G-{String(g.id).padStart(3, "0")} ·{" "}
              {data.epics.filter((e) => e.goalId === g.id).length} 个 Epic
            </small>
          </button>
        ))}
      </div>
      <div className="b-context">
        <span>
          <Icon name="layers" size={14} />{" "}
          <strong>{goal?.title || "暂无产品目标"}</strong> 下的故事地图
        </span>
      </div>
      <div className="epic-wrap">
        <div className="epic-grid">
          {epics.map((epic) => {
            const stories = sorted(
              data.stories.filter((s) => s.epicId === epic.id),
            );
            return (
              <section
                key={epic.id}
                className="epic-col"
                aria-label={`Epic：${epic.title}`}
                onDragOver={(e) => {
                  if (writable) e.preventDefault();
                }}
                onDrop={(e) =>
                  drop(e, writable, (id) =>
                    props.onMove(
                      id,
                      epic.id,
                      stories.filter((s) => s.id !== id).length,
                    ),
                  )
                }
              >
                <div className="b-epic-col-top">
                  <div className="b-epic-title">
                    <span className="b-epic-label">
                      <Icon name="layers" size={13} />
                      {epic.title}
                    </span>
                    <span className="count">{stories.length}</span>
                  </div>
                  <div className="b-story-meta" style={{ marginTop: 7 }}>
                    E-{String(epic.id).padStart(3, "0")}{" "}
                    {!readOnly && (
                      <button
                        className="b-inline-link"
                        disabled={busy}
                        onClick={() => props.onEditEpic(epic)}
                      >
                        编辑 Epic
                      </button>
                    )}
                  </div>
                </div>
                {stories.map((s) => (
                  <div
                    key={s.id}
                    onDragOver={(e) => {
                      if (writable) e.preventDefault();
                    }}
                    onDrop={(e) =>
                      drop(e, writable, (id) => {
                        if (id !== s.id)
                          props.onMove(
                            id,
                            epic.id,
                            stories
                              .filter((x) => x.id !== id)
                              .findIndex((x) => x.id === s.id),
                          );
                      })
                    }
                  >
                    <StoryCard {...props} story={s} />
                  </div>
                ))}
                {!readOnly && (
                  <button
                    className="btn small flat"
                    disabled={busy}
                    onClick={() => props.onNewStory(epic)}
                  >
                    <Icon name="plus" size={13} />
                    新建故事
                  </button>
                )}
              </section>
            );
          })}
          {!epics.length && (
            <div className="empty">暂无 Epic，项目经理可以新建。</div>
          )}
        </div>
      </div>
    </div>
  );
}
export interface StoryBoardProps extends CommonProps {
  stories: UserStory[];
  onStatus(id: number, status: StoryStatus): void;
}
export function StoryBoard(props: StoryBoardProps) {
  const { stories, readOnly, busy } = props;
  return (
    <div className="story-board" aria-label="用户故事看板" aria-busy={busy}>
      <div className="b-story-stats" style={{ marginBottom: 11 }}>
        <span>共 {stories.length} 条用户故事</span>
        {Object.entries(storyStatusLabels).map(([id, label]) => (
          <span key={id}>
            {label} {stories.filter((s) => s.status === id).length}
          </span>
        ))}
      </div>
      <div className="epic-wrap">
        <div className="board-columns">
          {(Object.keys(storyStatusLabels) as StoryStatus[]).map((status) => (
            <section
              key={status}
              className="board-column"
              aria-label={storyStatusLabels[status]}
              onDragOver={(e) => {
                if (!readOnly && !busy) e.preventDefault();
              }}
              onDrop={(e) =>
                drop(e, !readOnly && !busy, (id) => props.onStatus(id, status))
              }
            >
              <div className="board-head">
                <span className="left">
                  <i className={`status-dot ${status}`} />
                  {storyStatusLabels[status]}
                </span>
                <span className="count">
                  {stories.filter((s) => s.status === status).length}
                </span>
              </div>
              {sorted(stories.filter((s) => s.status === status)).map((s) => (
                <StoryCard {...props} key={s.id} story={s} board />
              ))}
              {!stories.some((s) => s.status === status) && (
                <p className="board-empty">
                  暂无故事
                  <br />
                  <small>拖入卡片即可修改状态</small>
                </p>
              )}
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
