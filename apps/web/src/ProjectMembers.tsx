import { useEffect, useState } from "react";
import type { ProjectMember, ProjectRole, User } from "@spm/shared";
import { projectRoleLabels } from "@spm/shared";
import { useProjectData } from "./ProjectData";
import { useTaskActions } from "./TaskActions";
import { api } from "./api";
import { Status } from "./ui";
import "./a-members.css";
export function ProjectMembers({ onChanged }: { onChanged(): void }) {
  const store = useProjectData(),
    actions = useTaskActions(),
    p = store.project;
  const [search, setSearch] = useState(""),
    [role, setRole] = useState("all"),
    [detailId, setDetail] = useState<number | null>(null),
    [modal, setModal] = useState<{
      kind: "add" | "role" | "remove" | "info";
      member?: ProjectMember;
    } | null>(null),
    [candidates, setCandidates] = useState<User[]>([]),
    [candidate, setCandidate] = useState(""),
    [nextRole, setNextRole] = useState<ProjectRole>("DEVELOPER"),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const all = store.members,
    shown = all.filter(
      (m) =>
        m.user.username.toLowerCase().includes(search.toLowerCase()) &&
        (role === "all" || role === m.role),
    ),
    detail = all.find((m) => m.userId === detailId);
  const tasks = (id: number) =>
    store.tasks.filter((t) => t.assigneeUserId === id);
  useEffect(() => {
    const close = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) {
        setModal(null);
        setDetail(null);
      }
    };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [busy]);
  async function open(
    kind: "add" | "role" | "remove" | "info",
    member?: ProjectMember,
  ) {
    setError("");
    setCandidate("");
    setNextRole(member?.role || "DEVELOPER");
    setModal({ kind, member });
    if (kind === "add")
      try {
        setCandidates(await api<User[]>(`/projects/${p.id}/member-candidates`));
      } catch (e) {
        setError((e as Error).message);
      }
  }
  async function save() {
    if (!modal || busy) return;
    setBusy(true);
    setError("");
    try {
      if (modal.kind === "add") {
        if (!candidate) throw new Error("请先选择用户");
        await store.write("/members", "POST", {
          userId: Number(candidate),
          role: nextRole,
        });
      } else if (modal.kind === "role")
        await store.write(`/members/${modal.member!.userId}/role`, "PATCH", {
          role: nextRole,
        });
      else if (modal.kind === "remove")
        await store.write(`/members/${modal.member!.userId}`, "DELETE");
      setModal(null);
      onChanged();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  if (!p.canManage)
    return (
      <div className="a-members">
        <div className="denied">只有项目经理可以管理项目成员与角色。</div>
      </div>
    );
  return (
    <div className="a-members">
      <div className="content">
        <div className="head">
          <div>
            <h1>成员与角色</h1>
          </div>
          <div className="buttons">
            <button className="btn" onClick={() => void open("info")}>
              项目角色说明
            </button>
            <button className="btn blue" onClick={() => void open("add")}>
              ＋ 添加成员
            </button>
          </div>
        </div>
        <div className="summary">
          {[
            ["项目成员", all.length, "♧"],
            ["开发人员", all.filter((m) => m.role === "DEVELOPER").length, "⌘"],
            ["测试人员", all.filter((m) => m.role === "TESTER").length, "✓"],
          ].map(([t, n, icon]) => (
            <div className="stat" key={t}>
              <div>
                <div className="label">{t}</div>
                <div className="value">{n}</div>
              </div>
              <span className="icon">{icon}</span>
            </div>
          ))}
        </div>
        <section className="panel">
          <div className="toolbar">
            <div className="search">
              <span>⌕</span>
              <input
                placeholder="搜索成员姓名或用户名"
                aria-label="搜索成员姓名或用户名"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <select
              className="filter"
              aria-label="全部项目角色"
              value={role}
              onChange={(e) => setRole(e.target.value)}
            >
              <option value="all">全部项目角色</option>
              {Object.entries(projectRoleLabels).map(([v, t]) => (
                <option key={v} value={v}>
                  {t}
                </option>
              ))}
            </select>
            <button
              className="btn"
              disabled={!search && role === "all"}
              onClick={() => {
                setSearch("");
                setRole("all");
              }}
            >
              清空筛选
            </button>
            <div className="spacer" />
            <span className="count">共 {shown.length} 名成员</span>
          </div>
          <div className="tablewrap">
            <table className="table">
              <thead>
                <tr>
                  {["成员", "项目角色", "本项目任务数", "账户状态", "操作"].map(
                    (t) => (
                      <th key={t}>{t}</th>
                    ),
                  )}
                </tr>
              </thead>
              <tbody>
                {shown.map((m) => (
                  <tr key={m.userId}>
                    <td>
                      <div className="userbox">
                        <span
                          className={`user-avatar ${["", "green", "orange", "purple"][m.userId % 4]}`}
                        >
                          {m.user.username[0]}
                        </span>
                        <div>
                          <button
                            className="user-name"
                            onClick={() => setDetail(m.userId)}
                          >
                            {m.user.username}
                          </button>
                          <div className="username">@{m.user.username}</div>
                        </div>
                      </div>
                    </td>
                    <td>
                      <span
                        className={`role ${m.role === "MANAGER" ? "manager" : m.role === "TESTER" ? "tester" : ""}`}
                      >
                        {projectRoleLabels[m.role]}
                      </span>
                    </td>
                    <td>
                      <span className="role-count">
                        {tasks(m.userId).length} 项
                      </span>
                    </td>
                    <td>
                      <span
                        style={{ color: m.user.active ? "#409b73" : "#a0a8b5" }}
                      >
                        ● {m.user.active ? "正常" : "停用"}
                      </span>
                    </td>
                    <td>
                      <div className="rowops">
                        <button
                          className="btn text"
                          onClick={() => setDetail(m.userId)}
                        >
                          查看
                        </button>
                        {m.role !== "MANAGER" && (
                          <>
                            <button
                              className="btn text"
                              onClick={() => void open("role", m)}
                            >
                              调整角色
                            </button>
                            <button
                              className="btn text red"
                              onClick={() => void open("remove", m)}
                            >
                              移除
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!shown.length && <div className="empty">没有匹配的项目成员</div>}
          </div>
          <div className="foot">
            <span>共 {shown.length} 条</span>
            <span>预设项目角色 · 权限随项目授权生效</span>
          </div>
        </section>
        <div className="note">
          项目成员使用同一套系统账户。移除项目成员不会删除用户账号和任务，原负责人分配将解除；系统管理员身份不自动获得项目访问权限。
        </div>
      </div>
      {detail && (
        <div
          className="drawermask"
          onClick={(e) => {
            if (e.target === e.currentTarget) setDetail(null);
          }}
        >
          <div
            className="drawer"
            role="dialog"
            aria-modal="true"
            aria-label="项目成员详情"
          >
            <div className="drawer-top">
              <div>
                <span className="subtle">项目成员详情</span>
                <h2>{detail.user.username}</h2>
                <div className="subtle">@{detail.user.username}</div>
              </div>
              <button
                className="close"
                aria-label="关闭成员详情"
                onClick={() => setDetail(null)}
              >
                ×
              </button>
            </div>
            <div className="drawer-body">
              <div className="detail-row">
                <span>项目角色</span>
                <span
                  className={`role ${detail.role === "MANAGER" ? "manager" : detail.role === "TESTER" ? "tester" : ""}`}
                >
                  {projectRoleLabels[detail.role]}
                </span>
              </div>
              <div className="detail-row">
                <span>账户状态</span>
                <span>{detail.user.active ? "正常" : "停用"}</span>
              </div>
              <div className="detail-row">
                <span>本项目任务数</span>
                <strong>{tasks(detail.userId).length} 项</strong>
              </div>
              <div className="detail-section">
                <b>关联任务</b>
                {tasks(detail.userId).length ? (
                  tasks(detail.userId).map((t) => (
                    <button
                      className="task-chip"
                      key={t.id}
                      onClick={() => {
                        setDetail(null);
                        actions.open(t.id);
                      }}
                    >
                      <span>
                        {t.title}{" "}
                        <small>T-{String(t.id).padStart(3, "0")}</small>
                      </span>
                      <Status value={t.status} />
                    </button>
                  ))
                ) : (
                  <p className="subtle">暂无分配的任务</p>
                )}
              </div>
              <div className="detail-section role-note">
                项目角色与系统全局身份分别维护；当前页面只管理项目内权限。
              </div>
            </div>
            <div className="drawer-foot">
              <button className="btn" onClick={() => setDetail(null)}>
                关闭
              </button>
              {detail.role !== "MANAGER" && (
                <button
                  className="btn blue"
                  onClick={() => {
                    setDetail(null);
                    void open("role", detail);
                  }}
                >
                  调整角色
                </button>
              )}
            </div>
          </div>
        </div>
      )}
      {modal && (
        <div
          className="mask"
          onClick={(e) => {
            if (e.target === e.currentTarget && !busy) setModal(null);
          }}
        >
          <div
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-label={
              {
                add: "添加项目成员",
                role: "调整项目角色",
                remove: "移除项目成员",
                info: "项目角色说明",
              }[modal.kind]
            }
          >
            <div className="modal-head">
              <h2>
                {
                  {
                    add: "添加项目成员",
                    role: "调整项目角色",
                    remove: "移除项目成员",
                    info: "项目角色说明",
                  }[modal.kind]
                }
              </h2>
              <button
                className="close"
                disabled={busy}
                onClick={() => setModal(null)}
                aria-label="关闭"
              >
                ×
              </button>
            </div>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void save();
              }}
            >
              <div className="modal-body">
                {modal.kind === "info" ? (
                  <div style={{ lineHeight: 2, color: "#58708d" }}>
                    <b>项目经理</b>：管理项目成员、预设角色与任务指派；
                    <br />
                    <b>开发人员</b>：根据授权查看正式需求与本人任务；
                    <br />
                    <b>测试人员</b>：根据授权查看正式需求与本人任务。
                    <div className="warning">
                      系统管理员是全局身份，不自动拥有全部项目访问权。此处不提供自定义权限组或系统身份调整。
                    </div>
                  </div>
                ) : modal.kind === "remove" ? (
                  <>
                    <p>
                      确定将 <b>{modal.member!.user.username}</b>{" "}
                      从当前项目中移除吗？
                    </p>
                    <div className="warning">
                      移除后，此成员将无法访问当前项目。其在本项目的{" "}
                      <b>{tasks(modal.member!.userId).length}</b>{" "}
                      项关联任务将解除负责人分配；不会删除任务或系统用户账号。
                    </div>
                  </>
                ) : (
                  <>
                    {modal.kind === "add" ? (
                      <div className="field">
                        <label htmlFor="a-member-candidate">选择系统用户</label>
                        <select
                          id="a-member-candidate"
                          required
                          value={candidate}
                          onChange={(e) => setCandidate(e.target.value)}
                        >
                          <option value="">请选择有效用户</option>
                          {candidates.map((u) => (
                            <option key={u.id} value={u.id}>
                              {u.username}
                            </option>
                          ))}
                        </select>
                        <div className="help">
                          仅显示有效且尚未加入当前项目的用户。
                        </div>
                      </div>
                    ) : (
                      <p>
                        成员：<b>{modal.member!.user.username}</b>
                      </p>
                    )}
                    <div className="field">
                      <label htmlFor="a-member-role">项目角色</label>
                      <select
                        id="a-member-role"
                        value={nextRole}
                        onChange={(e) =>
                          setNextRole(e.target.value as ProjectRole)
                        }
                      >
                        <option value="DEVELOPER">开发人员</option>
                        <option value="TESTER">测试人员</option>
                      </select>
                      <div className="help">
                        此调整仅对当前项目生效，不修改系统账户身份。
                      </div>
                    </div>
                  </>
                )}
                {error && (
                  <div className="a-form-error" role="alert">
                    {error}
                  </div>
                )}
              </div>
              <div className="modal-foot">
                {modal.kind === "info" ? (
                  <button
                    type="button"
                    className="btn blue"
                    onClick={() => setModal(null)}
                  >
                    知道了
                  </button>
                ) : (
                  <>
                    <button
                      type="button"
                      className="btn"
                      disabled={busy}
                      onClick={() => setModal(null)}
                    >
                      取消
                    </button>
                    <button
                      type="submit"
                      className={`btn ${modal.kind === "remove" ? "danger" : "blue"}`}
                      disabled={busy}
                    >
                      {busy
                        ? "保存中…"
                        : modal.kind === "add"
                          ? "添加成员"
                          : modal.kind === "role"
                            ? "确认调整"
                            : "确认移除"}
                    </button>
                  </>
                )}
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
