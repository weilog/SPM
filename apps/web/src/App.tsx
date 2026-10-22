import { Alert, Dropdown, Spin } from "antd";
import { useEffect, useRef, useState } from "react";
import {
  projectRoleLabels,
  roleLabels,
  type Project,
  type User,
} from "@spm/shared";
import { api, RequestError } from "./api";
import { Login } from "./Login";
import { Users } from "./Users";
import { ProjectList } from "./Projects";
import { ProjectProvider, useProjectData } from "./ProjectData";
import { TaskActionsProvider, useTaskActions } from "./TaskActions";
import { TaskWorkspace } from "./TaskWorkspace";
import { Workbench } from "./Workbench";
import { UmlView } from "./UmlView";
import { PlanView } from "./PlanView";
import { Documents } from "./Documents";
import { ProjectMembers } from "./ProjectMembers";
import { ProjectOverview } from "./ProjectOverview";
import { StoryInspector } from "./StoryInspector";
import { Icon, PageHeading } from "./ui";
import "./v43.css";
import "./v43-react.css";
import "./a-integration.css";
import { Requirements } from "./Requirements";

export function App() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [project, setProject] = useState<Project | null>(null);
  const [page, setPage] = useState("projects");
  const [availableProjects, setAvailableProjects] = useState<Project[]>([]);
  const [collapsed, setCollapsed] = useState(false);
  const requestVersion = useRef(0);
  const workspaceRef = useRef<HTMLElement>(null);
  useEffect(() => {
    workspaceRef.current?.scrollTo?.({ top: 0, left: 0 });
  }, [page, project?.id, user?.id]);
  function resetContext() {
    requestVersion.current++;
    setProject(null);
    setPage("projects");
  }
  function onError(error: unknown) {
    setError((error as Error).message || "请求失败");
    if (error instanceof RequestError && error.status === 401) {
      setUser(null);
      resetContext();
    }
    if (error instanceof RequestError && [403, 404].includes(error.status))
      resetContext();
  }
  async function refreshUser() {
    try {
      const next = await api<User>("/auth/me");
      setUser(next);
      if (next.role !== "ADMIN") resetContext();
    } catch (error) {
      onError(error);
    }
  }
  useEffect(() => {
    api<User>("/auth/me")
      .then(setUser)
      .catch((error) => {
        if (!(error instanceof RequestError && error.status === 401))
          setError((error as Error).message);
      })
      .finally(() => setLoading(false));
  }, []);
  async function selectProject(id: number) {
    const version = ++requestVersion.current;
    setError("");
    setProject(null);
    try {
      const selected = await api<Project>(`/projects/${id}`);
      if (version === requestVersion.current) {
        setProject(selected);
        setPage("overview");
      }
    } catch (error) {
      if (version === requestVersion.current) onError(error);
    }
  }
  async function refreshProject(id: number) {
    const version = ++requestVersion.current;
    try {
      const selected = await api<Project>(`/projects/${id}`);
      if (version === requestVersion.current) setProject(selected);
    } catch (error) {
      if (version === requestVersion.current) onError(error);
    }
  }
  async function logout() {
    try {
      await api("/auth/logout", "POST");
      setUser(null);
      setError("");
      resetContext();
    } catch (error) {
      onError(error);
    }
  }
  useEffect(() => {
    if (user)
      void api<Project[]>("/projects")
        .then(setAvailableProjects)
        .catch(onError);
  }, [user?.id]);
  function nav(key: string, icon: string, label: string) {
    return (
      <button
        key={key}
        className={`nav-btn ${page === key ? "selected" : ""}`}
        title={label}
        onClick={() => {
          setError("");
          if (["projects", "users"].includes(key) || project) setPage(key);
          else if (availableProjects.length)
            void selectProject(availableProjects[0].id).then(() =>
              setPage(key),
            );
          else setPage("projects");
        }}
      >
        <span className="nav-icon">
          <Icon name={icon} />
        </span>
        <span className="nav-label">{label}</span>
      </button>
    );
  }
  if (loading)
    return (
      <div className="loading">
        <Spin description="正在连接爱管理" />
      </div>
    );
  if (!user)
    return (
      <>
        <Login
          onLogin={(next) => {
            setUser(next);
            setError("");
            resetContext();
          }}
        />
        {error && <Alert type="error" title={error} />}
      </>
    );
  return (
    <div id="app" className="v43-shell">
      <header className="topbar">
        <div className="logo">
          <span className="logo-mark">爱</span>
          <span>爱管理</span>
        </div>
        <span className="top-separator" />
        <Dropdown
          trigger={["click"]}
          menu={{
            items: [
              ...availableProjects.map((p) => ({
                key: String(p.id),
                label: p.name,
              })),
              { key: "all", label: "浏览所有项目" },
            ],
            onClick: ({ key }) => {
              if (key === "all") setPage("projects");
              else void selectProject(Number(key));
            },
          }}
        >
          <button className="project-select">
            <span className="dot" />
            <span style={{ flex: 1, textAlign: "left", fontWeight: 560 }}>
              {project?.name || "选择项目"}
            </span>
            <Icon name="chevron" size={13} />
          </button>
        </Dropdown>
        <div className="top-spacer" />
        <span className="select role-badge">
          {project
            ? projectRoleLabels[project.projectRole]
            : roleLabels[user.role]}
        </span>
        <div className="avatar">{user.username.slice(0, 1)}</div>
        <span className="account-name">{user.username}</span>
      </header>
      <div className="shell">
        <aside className={`sidebar ${collapsed ? "shrink" : ""}`}>
          <div className="sidebar-scroll">
            <div className="nav-section">工作空间</div>
            {nav("projects", "grid", "我的项目")}
            <div className="nav-section">当前项目</div>
            {nav("overview", "briefcase", "项目概览")}
            {nav("requirements", "layers", "需求管理")}
            {nav("plan", "calendar", "项目计划")}
            {project?.canManage
              ? nav("tasks", "list", "任务管理")
              : nav("mine", "check", "我的任务")}
            {nav("workspace", "split", "多视图工作台")}
            {nav("docs", "file", "项目文档")}
            {project?.canManage && nav("members", "users", "成员与角色")}
            {user.role === "ADMIN" && nav("users", "users", "用户管理")}
            <div className="sidebar-project-box">
              <span style={{ fontSize: 19 }}>◈</span>
              <div className="sidebar-project-text">
                <strong>{project?.name || "项目工作空间"}</strong>
                <div style={{ marginTop: 4, color: "#8da0ba" }}>
                  项目工作空间
                </div>
              </div>
            </div>
          </div>
          <div className="side-bottom">
            <button className="nav-btn" onClick={() => void logout()}>
              <span className="nav-icon">
                <Icon name="user" />
              </span>
              <span className="nav-label">退出登录</span>
            </button>
            <button
              className="nav-btn"
              aria-label={collapsed ? "展开侧栏" : "折叠侧栏"}
              onClick={() => setCollapsed((v) => !v)}
            >
              <span className="nav-icon">
                <Icon name="panel" />
              </span>
              <span className="side-bottom-label">折叠导航</span>
            </button>
          </div>
        </aside>
        <main
          ref={workspaceRef}
          className={`workspace ${page === "plan" ? "plan-workspace" : ""}`}
        >
          <div className="page-container">
            {error && (
              <Alert
                type="error"
                title={error}
                closable
                onClose={() => setError("")}
              />
            )}
            <div className="breadcrumb">
              {page === "projects" ? (
                "工作空间 / 我的项目"
              ) : (
                <>
                  我的项目 <span>›</span>
                  {project?.name}
                  <span>›</span>
                  {labels[page]}
                </>
              )}
            </div>
            {page === "projects" ? (
              <ProjectList
                key={user.role}
                user={user}
                onProjectsChanged={() =>
                  void api<Project[]>("/projects")
                    .then(setAvailableProjects)
                    .catch(onError)
                }
                onSelect={(id) => void selectProject(id)}
                onError={onError}
              />
            ) : page === "users" ? (
              <div className="card plain-content">
                <Users onError={onError} onChanged={refreshUser} />
              </div>
            ) : project ? (
              <ProjectProvider
                key={project.id}
                project={project}
                user={user}
                onError={onError}
                onProjectUpdate={setProject}
              >
                <ProjectSpace
                  page={page}
                  onNavigate={setPage}
                  onMembersChanged={() => void refreshProject(project.id)}
                />
              </ProjectProvider>
            ) : (
              <div className="card empty">
                请先从“我的项目”进入有权访问的项目。
              </div>
            )}
          </div>
        </main>
      </div>
    </div>
  );
}
const labels: Record<string, string> = {
  overview: "项目概览",
  requirements: "需求管理",
  plan: "项目计划",
  tasks: "任务管理",
  mine: "我的任务",
  workspace: "多视图工作台",
  docs: "项目文档",
  members: "成员与角色",
  users: "用户管理",
  projects: "我的项目",
};
function ProjectSpace({
  page,
  onNavigate,
  onMembersChanged,
}: {
  page: string;
  onNavigate(p: string): void;
  onMembersChanged(): void;
}) {
  const store = useProjectData();
  const [story, setStory] = useState<number | null>(null);
  return (
    <TaskActionsProvider onStory={setStory}>
      {page === "requirements" ? (
        <RequirementPage />
      ) : page === "tasks" || page === "mine" ? (
        <TaskWorkspace mine={page === "mine"} />
      ) : page === "workspace" ? (
        <Workbench />
      ) : page === "uml" ? (
        <UmlView onStory={setStory} />
      ) : page === "plan" ? (
        <PlanView />
      ) : page === "members" ? (
        <ProjectMembers onChanged={onMembersChanged} />
      ) : page === "docs" ? (
        <Documents />
      ) : (
        <ProjectOverview onNavigate={onNavigate} />
      )}
      <StoryInspector id={story} onClose={() => setStory(null)} />
    </TaskActionsProvider>
  );
}
function RequirementPage() {
  const store = useProjectData(),
    actions = useTaskActions();
  return (
    <Requirements
      project={store.project}
      onError={store.onError}
      onOpenTask={(id) => actions.open(id)}
    />
  );
}
