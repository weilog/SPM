import { useState } from "react";
import type { Priority, StoryStatus, ViewFocus } from "@spm/shared";
import { priorityLabels, storyStatusLabels } from "@spm/shared";
import { useProjectData } from "./ProjectData";
import { useTaskActions } from "./TaskActions";
import { taskNumber } from "./StoryViews";
export function MemberTaskGraph({
  highlightIds = [],
  onFocusChange,
}: {
  highlightIds?: number[];
  onFocusChange?: (f: ViewFocus) => void;
}) {
  const store = useProjectData(),
    actions = useTaskActions();
  const [selectedTask, setSelectedTask] = useState<number>(),
    [zoom, setZoom] = useState(1),
    [member, setMember] = useState("all"),
    [status, setStatus] = useState("all"),
    [priority, setPriority] = useState("all"),
    [search, setSearch] = useState("");
  const filtered = store.tasks.filter(
    (t) =>
      (member === "all" || String(t.assigneeUserId ?? "none") === member) &&
      (status === "all" || t.status === status) &&
      (priority === "all" || t.priority === priority) &&
      `${taskNumber(t.id)} ${t.title}`
        .toLowerCase()
        .includes(search.toLowerCase()),
  );
  const people = [
    ...store.members.map((m) => ({
      id: String(m.userId),
      name: m.user.username,
    })),
    ...(store.project.canManage ? [{ id: "none", name: "未分配" }] : []),
  ];
  let y = 55;
  const points = people
    .map((m) => {
      const tasks = filtered.filter(
          (t) => String(t.assigneeUserId ?? "none") === m.id,
        ),
        ys = tasks.map((_, i) => y + i * 78);
      if (!tasks.length) return null;
      const memberY = (ys[0] + ys[ys.length - 1]) / 2;
      y = ys[ys.length - 1] + 112;
      return { m, tasks, ys, memberY };
    })
    .filter((p) => p !== null);
  const height = Math.max(315, y + 10);
  return (
    <div>
      <div className="b-story-bar">
        <div className="b-story-stats">
          <strong>成员 → 任务关系</strong>
          <span>已展示 {filtered.length} 项任务 · 点击节点查看详情</span>
        </div>
        <div className="b-story-toolbar">
          <button
            className="btn small"
            aria-label="缩小成员任务图"
            onClick={() => setZoom((z) => Math.max(0.5, z - 0.1))}
          >
            －
          </button>
          <button className="btn small" onClick={() => setZoom(1)}>
            适应
          </button>
          <button
            className="btn small"
            aria-label="放大成员任务图"
            onClick={() => setZoom((z) => Math.min(2, z + 0.1))}
          >
            ＋
          </button>
        </div>
      </div>
      <div className="b-graph-summary">
        {people.map((m) => (
          <button
            key={m.id}
            className="b-person-summary"
            onClick={() => setMember(m.id)}
          >
            <span className="b-avatar">{m.name.slice(0, 1)}</span>
            <span>
              {m.name}
              <small>
                {
                  filtered.filter(
                    (t) => String(t.assigneeUserId ?? "none") === m.id,
                  ).length
                }{" "}
                项任务
              </small>
            </span>
          </button>
        ))}
      </div>
      <div className="filters">
        <select
          className="select"
          style={{ width: 132 }}
          aria-label="图成员筛选"
          value={member}
          onChange={(e) => setMember(e.target.value)}
        >
          <option value="all">全部成员</option>
          {people.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </select>
        <select
          className="select"
          style={{ width: 132 }}
          aria-label="图状态筛选"
          value={status}
          onChange={(e) => setStatus(e.target.value)}
        >
          <option value="all">全部状态</option>
          {Object.entries(storyStatusLabels).map(([v, label]) => (
            <option key={v} value={v}>
              {label}
            </option>
          ))}
        </select>
        <select
          className="select"
          style={{ width: 132 }}
          aria-label="图优先级筛选"
          value={priority}
          onChange={(e) => setPriority(e.target.value)}
        >
          <option value="all">全部优先级</option>
          {Object.entries(priorityLabels).map(([v, label]) => (
            <option key={v} value={v}>
              {label}
            </option>
          ))}
        </select>
        <button
          className="btn small"
          onClick={() => {
            setMember("all");
            setStatus("all");
            setPriority("all");
            setSearch("");
          }}
        >
          清除筛选
        </button>
      </div>
      <div className="graph-scroll">
        <svg
          className="graph-svg"
          style={{ width: 900 * zoom, maxWidth: "none" }}
          viewBox={`0 0 900 ${height}`}
          aria-label="成员任务关系图"
        >
          <rect width={900} height={height} fill="#fbfcff" rx={10} />
          {points.flatMap((p) =>
            p.tasks.map((t, i) => (
              <path
                key={`edge-${t.id}`}
                d={`M225 ${p.memberY} C310 ${p.memberY} 315 ${p.ys[i]} 376 ${p.ys[i]}`}
                fill="none"
                stroke={
                  highlightIds.includes(t.id) || selectedTask === t.id
                    ? "#2474e6"
                    : "#c2d0e1"
                }
                strokeWidth={
                  highlightIds.includes(t.id) || selectedTask === t.id
                    ? 2.8
                    : 1.6
                }
              />
            )),
          )}
          {points.map((p) => (
            <g key={p.m.id}>
              <g
                role="button"
                tabIndex={0}
                aria-label={`成员 ${p.m.name}`}
                onClick={() => setMember(p.m.id)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") setMember(p.m.id);
                }}
                className="svg-node"
              >
                <rect
                  className="node-border"
                  x={28}
                  y={p.memberY - 33}
                  width={198}
                  height={66}
                  rx={9}
                  fill="#ebf3ff"
                  stroke="#bfd6f6"
                />
                <circle cx={54} cy={p.memberY - 9} r={12} fill="#d4e5fc" />
                <text
                  x={54}
                  y={p.memberY - 5}
                  textAnchor="middle"
                  fontSize={11}
                  fill="#356cb5"
                >
                  {p.m.name.slice(0, 1)}
                </text>
                <text
                  x={78}
                  y={p.memberY - 7}
                  fontSize={14}
                  fontWeight={660}
                  fill="#37608f"
                >
                  {p.m.name}
                </text>
                <text x={78} y={p.memberY + 14} fontSize={11} fill="#8097b1">
                  {p.tasks.length} 项任务
                </text>
              </g>
              {p.tasks.map((t, i) => {
                const ty = p.ys[i];
                const open = () => {
                  setSelectedTask(t.id);
                  onFocusChange?.({
                    projectId: store.project.id,
                    entityType: "task",
                    entityId: t.id,
                  });
                  actions.open(t.id);
                };
                return (
                  <g
                    role="button"
                    tabIndex={0}
                    key={t.id}
                    aria-label={`${taskNumber(t.id)} ${t.title}`}
                    className={`svg-node ${highlightIds.includes(t.id) || selectedTask === t.id ? "selected" : ""}`}
                    onClick={open}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") open();
                    }}
                  >
                    <rect
                      className="node-border"
                      x={376}
                      y={ty - 34}
                      width={494}
                      height={69}
                      rx={8}
                      fill={
                        highlightIds.includes(t.id) || selectedTask === t.id
                          ? "#f7fbff"
                          : "white"
                      }
                      stroke="#dce6f2"
                    />
                    <text
                      x={392}
                      y={ty - 11}
                      fill="#384b63"
                      fontSize={13}
                      fontWeight={650}
                    >
                      {taskNumber(t.id)} ·{" "}
                      {t.title.length > 26
                        ? t.title.slice(0, 25) + "…"
                        : t.title}
                    </text>
                    <text
                      x={851}
                      y={ty - 11}
                      fill={
                        t.status === "DONE"
                          ? "#1b9d68"
                          : t.status === "IN_PROGRESS"
                            ? "#397acb"
                            : "#8695a8"
                      }
                      fontSize={11}
                      textAnchor="end"
                    >
                      {storyStatusLabels[t.status as StoryStatus]}
                    </text>
                    <text
                      x={392}
                      y={ty + 14}
                      fill={t.priority === "URGENT" ? "#db5d52" : "#8491a4"}
                      fontSize={11}
                    >
                      {priorityLabels[t.priority as Priority]}优先级
                    </text>
                    <rect
                      x={487}
                      y={ty + 6}
                      width={230}
                      height={7}
                      rx={3}
                      fill="#e8edf5"
                    />
                    <rect
                      x={487}
                      y={ty + 6}
                      width={(230 * t.progress) / 100}
                      height={7}
                      rx={3}
                      fill={t.status === "DONE" ? "#20aa75" : "#4b8de9"}
                    />
                    <text x={760} y={ty + 14} fontSize={11} fill="#738197">
                      {t.progress}%
                    </text>
                  </g>
                );
              })}
            </g>
          ))}
          {!points.length && (
            <text
              x={450}
              y={150}
              textAnchor="middle"
              fontSize={14}
              fill="#9ba8b9"
            >
              暂无符合条件的成员任务关系
            </text>
          )}
        </svg>
      </div>
    </div>
  );
}
