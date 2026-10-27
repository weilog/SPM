import { Dropdown, type MenuProps } from "antd";
import { useEffect, useState } from "react";
import {
  priorityLabels,
  storyStatusLabels,
  type ManagedTask,
  type Priority,
  type StoryStatus,
} from "@spm/shared";
import { api } from "./api";
import { useProjectData } from "./ProjectData";
import { useTaskActions } from "./TaskActions";
import {
  Icon,
  PageHeading,
  PriorityTag,
  ProgressBar,
  Status,
  useProjectRefresh,
} from "./ui";
import { storyNumber, taskNumber } from "./StoryViews";
import { MemberTaskGraph } from "./MemberTaskGraph";
import { AiEntry } from "./ai-events";
export function TaskWorkspace({ mine = false }: { mine?: boolean }) {
  const store = useProjectData(),
    actions = useTaskActions();
  const [tab, setTab] = useState("list"),
    [archived, setArchived] = useState(false),
    [extra, setExtra] = useState<ManagedTask[]>([]),
    [personal, setPersonal] = useState<ManagedTask[]>([]),
    [search, setSearch] = useState(""),
    [status, setStatus] = useState("all"),
    [priority, setPriority] = useState("all"),
    [member, setMember] = useState("all"),
    [menu, setMenu] = useState<number | null>(null);
  const path = `/projects/${store.project.id}/tasks`;
  const reload = () => {
    if (mine)
      void api<ManagedTask[]>(path + "/mine")
        .then(setPersonal)
        .catch(store.onError);
    else if (archived)
      void api<ManagedTask[]>(path + "?archived=true")
        .then(setExtra)
        .catch(store.onError);
    else void store.refresh().catch(store.onError);
  };
  useEffect(reload, [mine, archived, store.project.id]);
  useProjectRefresh(store.project.id, reload);
  const all = mine ? personal : store.tasks;
  const shown = (archived && !mine ? extra : all)
    .filter(
      (t) =>
        (status === "all" || t.status === status) &&
        (priority === "all" || t.priority === priority) &&
        (member === "all" || String(t.assigneeUserId ?? "none") === member) &&
        `${taskNumber(t.id)} ${t.title}`
          .toLowerCase()
          .includes(search.toLowerCase()),
    )
    .sort(
      (a, b) =>
        ["URGENT", "HIGH", "MEDIUM", "LOW"].indexOf(a.priority) -
          ["URGENT", "HIGH", "MEDIUM", "LOW"].indexOf(b.priority) ||
        a.id - b.id,
    );
  function menuItems(t: ManagedTask) {
    const manager = store.project.canManage;
    const items: NonNullable<MenuProps["items"]> = [
      { key: "title", label: `${taskNumber(t.id)} · 任务操作`, disabled: true },
    ];
    if (t.status === "TODO") {
      if (manager) items.push({ key: "start", label: "开始任务" });
      items.push({ key: "done", label: "直接完成" });
    } else if (t.status === "IN_PROGRESS") {
      if (manager) items.push({ key: "done", label: "标记完成" });
      items.push(
        { key: "todo", label: "退回待处理" },
        { key: "progress", label: "更新完成进度" },
      );
    } else if (manager) items.push({ key: "start", label: "重新打开" });
    if (manager)
      items.push(
        { key: "separator1", type: "divider" },
        { key: "assign", label: "调整负责人" },
        { key: "links", label: "管理故事 / 计划关联" },
      );
    items.push({ key: "history", label: "查看操作记录" });
    if (manager)
      items.push(
        { key: "separator2", type: "divider" },
        { key: "archive", label: "归档任务", danger: true },
      );
    return items;
  }
  function execute(t: ManagedTask, key: string) {
    setMenu(null);
    if (key === "start" || key === "done" || key === "todo")
      void actions.status(
        t,
        (
          { start: "IN_PROGRESS", done: "DONE", todo: "TODO" } as Record<
            string,
            StoryStatus
          >
        )[key],
      );
    else if (key === "progress") actions.progress(t);
    else if (key === "assign") actions.assign(t);
    else if (key === "links") actions.edit(t);
    else if (key === "history") actions.open(t.id, true);
    else if (key === "archive") actions.archive(t);
  }
  const clear = () => {
    setSearch("");
    setStatus("all");
    setPriority("all");
    setMember("all");
  };
  return (
    <div className="b-suite">
      <PageHeading
        title={mine ? "我的任务" : "任务管理"}
        description={
          mine
            ? "查看、执行、汇报当前项目中分配给自己的任务"
            : "创建、分配和跟踪项目任务"
        }
        actions={
          !mine &&
          store.project.canManage && (
            <>
              <AiEntry kind="TASK" label="AI 任务建议" />
              <button
                className="btn primary"
                onClick={() => actions.edit("new")}
              >
                <Icon name="plus" size={14} />
                新建任务
              </button>
            </>
          )
        }
      />
      <div className="b-overview">
        {[
          [mine ? "我的任务" : "项目任务", all.length, "blue"],
          ["待处理", all.filter((t) => t.status === "TODO").length, "gray"],
          [
            "进行中",
            all.filter((t) => t.status === "IN_PROGRESS").length,
            "blue",
          ],
          ["已完成", all.filter((t) => t.status === "DONE").length, "green"],
        ].map(([label, count, accent]) => (
          <div className="b-stat" data-accent={accent} key={label}>
            <div className="b-kicker">{label}</div>
            <div className="b-stat-number">{count}</div>
          </div>
        ))}
      </div>
      <div className="card">
        {!mine && (
          <div className="view-tabbar">
            <div className="tabs" role="tablist">
              <button
                className={`tab ${tab === "list" ? "active" : ""}`}
                role="tab"
                aria-selected={tab === "list"}
                onClick={() => setTab("list")}
              >
                任务列表<span className="chip">{all.length}</span>
              </button>
              <button
                className={`tab ${tab === "graph" ? "active" : ""}`}
                role="tab"
                aria-selected={tab === "graph"}
                onClick={() => setTab("graph")}
              >
                成员任务图
              </button>
            </div>
          </div>
        )}
        {tab === "graph" ? (
          <div style={{ padding: 15 }}>
            <MemberTaskGraph />
          </div>
        ) : (
          <>
            <div className="b-info-toolbar">
              <div className="b-info-left">
                <div className="searchbox">
                  <Icon name="search" size={15} />
                  <input
                    className="input"
                    aria-label="搜索任务"
                    placeholder="搜索任务编号或标题"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                </div>
                <select
                  className="select"
                  aria-label="任务状态筛选"
                  style={{ width: 119 }}
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
                  aria-label="任务优先级筛选"
                  style={{ width: 132 }}
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
                {!mine && (
                  <select
                    className="select"
                    aria-label="任务负责人筛选"
                    style={{ width: 126 }}
                    value={member}
                    onChange={(e) => setMember(e.target.value)}
                  >
                    <option value="all">全部负责人</option>
                    {store.members.map((m) => (
                      <option key={m.id} value={m.userId}>
                        {m.user.username}
                      </option>
                    ))}
                    <option value="none">未分配</option>
                  </select>
                )}
              </div>
              <div className="b-info-right">
                {!mine && (
                  <button
                    className="btn small"
                    onClick={() => setArchived((v) => !v)}
                  >
                    {archived ? "返回任务列表" : "归档管理"}
                  </button>
                )}
                {(search ||
                  status !== "all" ||
                  priority !== "all" ||
                  member !== "all") && (
                  <button className="btn small" onClick={clear}>
                    清空筛选
                  </button>
                )}
                <button className="btn" onClick={reload}>
                  <Icon name="refresh" size={13} />
                  刷新数据
                </button>
              </div>
            </div>
            <div className="b-section-sub">
              <span>
                {archived ? "已归档" : "任务"} · {shown.length} 项
              </span>
            </div>
            <div className="data-table-wrap b-tasks-flat-wrap">
              <table className="b-task-table">
                <thead>
                  <tr>
                    <th style={{ width: 90 }}>ID</th>
                    <th>任务标题 / 关联故事</th>
                    {!mine && <th style={{ width: 104 }}>负责人</th>}
                    <th style={{ width: 72 }}>优先级</th>
                    <th style={{ width: 126 }}>完成进度</th>
                    <th style={{ width: 83 }}>状态</th>
                    <th style={{ width: mine ? 144 : 153 }}>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {shown.map((t) => (
                    <tr key={t.id} data-task-row={t.id}>
                      <td>
                        <span className="b-req-id">{taskNumber(t.id)}</span>
                      </td>
                      <td>
                        <button
                          className="b-task-name"
                          onClick={() => actions.open(t.id)}
                        >
                          {t.title}
                        </button>
                        <div className="b-task-extra">
                          {t.storyIds?.length
                            ? `关联 ${t.storyIds.map(storyNumber).join("、")}`
                            : "未关联故事"}
                          {t.planIds?.length
                            ? ` · 计划 ${t.planIds.join("、")}`
                            : ""}
                        </div>
                      </td>
                      {!mine && (
                        <td>
                          {t.assigneeUserId ? (
                            <span className="b-assignee">
                              <span className="b-avatar">
                                {store.members
                                  .find((m) => m.userId === t.assigneeUserId)
                                  ?.user.username.slice(0, 1)}
                              </span>
                              {store.members.find(
                                (m) => m.userId === t.assigneeUserId,
                              )?.user.username || "未指派"}
                            </span>
                          ) : (
                            <span className="muted">未指派</span>
                          )}
                        </td>
                      )}
                      <td>
                        <PriorityTag
                          value={t.priority ?? ("MEDIUM" as Priority)}
                        />
                      </td>
                      <td className="b-progress-cell">
                        <ProgressBar
                          value={t.progress ?? 0}
                          status={t.status}
                        />
                      </td>
                      <td>
                        <Status value={t.status} />
                      </td>
                      <td>
                        <div className="b-row-ops b-task-actions">
                          <button
                            className="b-action-link"
                            onClick={() => actions.open(t.id)}
                          >
                            查看
                          </button>
                          {archived ? (
                            <button
                              className="b-action-link"
                              onClick={() => actions.archive(t, true)}
                            >
                              恢复
                            </button>
                          ) : mine ? (
                            t.status === "TODO" ? (
                              <button
                                className="b-action-link"
                                disabled={actions.busy}
                                onClick={() =>
                                  void actions.status(t, "IN_PROGRESS")
                                }
                              >
                                开始
                              </button>
                            ) : (
                              t.status === "IN_PROGRESS" && (
                                <button
                                  className="b-action-link"
                                  disabled={actions.busy}
                                  onClick={() => void actions.status(t, "DONE")}
                                >
                                  完成
                                </button>
                              )
                            )
                          ) : (
                            <button
                              className="b-action-link"
                              disabled={actions.busy}
                              onClick={() => actions.edit(t)}
                            >
                              编辑
                            </button>
                          )}
                          {!archived && (
                            <Dropdown
                              trigger={["click"]}
                              placement="bottomRight"
                              open={menu === t.id}
                              onOpenChange={(open) =>
                                setMenu(open ? t.id : null)
                              }
                              menu={{
                                items: menuItems(t),
                                onClick: ({ key }) => execute(t, key),
                              }}
                              classNames={{ root: "v43-task-menu" }}
                            >
                              <button
                                className={`b-more-trigger ${menu === t.id ? "active" : ""}`}
                                aria-label={`${taskNumber(t.id)}更多操作`}
                                aria-expanded={menu === t.id}
                                disabled={actions.busy}
                              >
                                <Icon name="more" size={17} />
                              </button>
                            </Dropdown>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                  {!shown.length && (
                    <tr>
                      <td colSpan={mine ? 6 : 7}>
                        <div className="empty">
                          {archived ? "暂无已归档任务" : "没有符合条件的任务"}
                        </div>
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
