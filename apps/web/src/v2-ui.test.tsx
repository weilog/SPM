import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { api } from "./api";
import { Users } from "./Users";
import { Members } from "./Projects";
import { Requirements } from "./Requirements";
import { MyTasks } from "./MyTasks";
import { App } from "./App";
import type { Project, Requirement, User } from "@spm/shared";

vi.mock("./api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./api")>()),
  api: vi.fn(),
}));
const mocked = vi.mocked(api);
const manager: User = {
  id: 2,
  username: "manager",
  role: "MANAGER",
  active: true,
};
const member: User = {
  id: 3,
  username: "member",
  role: "MEMBER",
  active: true,
};
const project: Project = {
  id: 1,
  name: "Alpha",
  description: "",
  managerId: 2,
  manager,
  projectRole: "MANAGER",
  canManage: true,
  canViewOwnTasks: false,
};
const requirement: Requirement = {
  id: 8,
  projectId: 1,
  title: "正式需求",
  description: "业务说明",
  createdAt: "2026-10-13T12:00:00Z",
  updatedAt: "2026-10-13T12:00:00Z",
};
beforeEach(() => {
  mocked.mockReset();
  const implementation = mocked.mockImplementation.bind(mocked);
  vi.spyOn(mocked, "mockImplementation").mockImplementation((fn) =>
    implementation((async (...args: Parameters<typeof api>) => {
      const path = args[0];
      if (path.endsWith("/story-map"))
        return { goals: [], epics: [], stories: [] };
      if (path.endsWith("/tasks/graph")) return { tasks: [], members: [] };
      if (path.endsWith("/uml-diagrams") || path.endsWith("/history"))
        return [];
      if (
        path.endsWith("/requirements") &&
        args[1] !== "POST" &&
        args[1] !== "PATCH"
      )
        return [requirement];
      if (path.endsWith("/plan-adapter"))
        return { available: false, stages: [], items: [] };
      return fn!(...args);
    }) as typeof api),
  );
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("V2 US02 account-only maintenance", () => {
  it("creates an account without exposing or submitting global role assignment", async () => {
    mocked.mockImplementation(async (_path, method) =>
      _path.endsWith("/story-map")
        ? { goals: [], epics: [], stories: [] }
        : method === "POST"
          ? member
          : [],
    );
    render(<Users onError={vi.fn()} onChanged={async () => {}} />);
    await userEvent.click(screen.getByRole("button", { name: "创建用户" }));
    expect(screen.queryByLabelText("全局身份")).not.toBeInTheDocument();
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
    await userEvent.type(screen.getByLabelText("用户名"), "new_user");
    await userEvent.type(screen.getByLabelText("密码"), "test-password-strong");
    await userEvent.click(
      screen.getByRole("button", { name: /OK|确定|保\s*存/ }),
    );
    await waitFor(() =>
      expect(mocked).toHaveBeenCalledWith("/users", "POST", {
        username: "new_user",
        password: "test-password-strong",
      }),
    );
  });
});
describe("V2 US05 project roles", () => {
  it("changes a member role through a project-scoped request", async () => {
    mocked.mockImplementation(async (path, method) =>
      method === "PATCH"
        ? {}
        : path.endsWith("/member-candidates")
          ? []
          : [
              {
                id: 7,
                projectId: 1,
                userId: 3,
                user: member,
                role: "DEVELOPER",
              },
            ],
    );
    render(<Members project={project} onError={vi.fn()} onChanged={vi.fn()} />);
    await userEvent.click(
      await screen.findByRole("combobox", { name: "member的项目角色" }),
    );
    await userEvent.click(await screen.findByText("测试人员"));
    await waitFor(() =>
      expect(mocked).toHaveBeenCalledWith(
        "/projects/1/members/3/role",
        "PATCH",
        { role: "TESTER" },
      ),
    );
  });
});
describe("V2 US20/21 formal requirements", () => {
  it("lets a developer view details while hiding create/edit controls", async () => {
    mocked.mockImplementation(async (path) =>
      path.endsWith("/story-map")
        ? { goals: [], epics: [], stories: [] }
        : path.endsWith("/8")
          ? requirement
          : [requirement],
    );
    render(
      <Requirements
        project={{
          ...project,
          canManage: false,
          projectRole: "DEVELOPER",
          canViewOwnTasks: true,
        }}
        onError={vi.fn()}
      />,
    );
    await userEvent.click(await screen.findByRole("button", { name: "查看" }));
    expect(await screen.findByText("业务说明")).toBeInTheDocument();
    expect(mocked).toHaveBeenCalledWith("/projects/1/requirements/8");
    expect(
      screen.queryByRole("button", { name: "新建需求" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "编辑" }),
    ).not.toBeInTheDocument();
  });
  it("validates title and creates only a formal requirement, without task links", async () => {
    mocked.mockImplementation(async (_path, method) =>
      _path.endsWith("/story-map")
        ? { goals: [], epics: [], stories: [] }
        : method === "POST"
          ? requirement
          : [],
    );
    render(<Requirements project={project} onError={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: "新建需求" }));
    await userEvent.click(
      screen.getByRole("button", { name: /OK|确定|保\s*存/ }),
    );
    expect(mocked.mock.calls.some((call) => call[1] === "POST")).toBe(false);
    await userEvent.type(screen.getByLabelText("需求标题"), "新正式需求");
    await userEvent.type(screen.getByLabelText("需求描述"), "目标说明");
    await userEvent.click(
      screen.getByRole("button", { name: /OK|确定|保\s*存/ }),
    );
    await waitFor(() =>
      expect(mocked).toHaveBeenCalledWith("/projects/1/requirements", "POST", {
        title: "新正式需求",
        description: "目标说明",
        parentId: null,
      }),
    );
  });
  it("edits requirement content using the current project and requirement id", async () => {
    mocked.mockImplementation(async (_path, method) =>
      _path.endsWith("/story-map")
        ? { goals: [], epics: [], stories: [] }
        : method === "PATCH"
          ? requirement
          : [requirement],
    );
    render(<Requirements project={project} onError={vi.fn()} />);
    await userEvent.click(await screen.findByRole("button", { name: "编辑" }));
    await userEvent.clear(screen.getByLabelText("需求标题"));
    await userEvent.type(screen.getByLabelText("需求标题"), "修改后的需求");
    await userEvent.click(
      screen.getByRole("button", { name: /OK|确定|保\s*存/ }),
    );
    await waitFor(() =>
      expect(mocked).toHaveBeenCalledWith(
        "/projects/1/requirements/8",
        "PATCH",
        { title: "修改后的需求", description: "业务说明", parentId: null },
      ),
    );
  });
});
describe("V2 US10 personal task viewing", () => {
  it("uses the server-owned personal list/detail routes without an arbitrary user id", async () => {
    const task = {
      id: 9,
      projectId: 1,
      title: "我的开发任务",
      description: "任务说明",
      status: "TODO",
      assigneeUserId: 3,
      priority: "MEDIUM",
      progress: 0,
      revision: 0,
      storyIds: [],
      planIds: [],
      archivedAt: null,
    };
    mocked.mockImplementation(async (path) =>
      path.endsWith("/story-map")
        ? { goals: [], epics: [], stories: [] }
        : path.endsWith("/9")
          ? task
          : [task],
    );
    render(
      <MyTasks
        project={{
          ...project,
          canManage: false,
          projectRole: "DEVELOPER",
          canViewOwnTasks: true,
        }}
        onError={vi.fn()}
      />,
    );
    await userEvent.click(await screen.findByRole("button", { name: "查看" }));
    expect(await screen.findByText("任务说明")).toBeInTheDocument();
    expect(mocked).toHaveBeenCalledWith("/projects/1/tasks/mine");
    expect(mocked).toHaveBeenCalledWith("/projects/1/tasks/9");
    expect(
      screen.queryByRole("button", { name: "创建任务" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "指定负责人" }),
    ).not.toBeInTheDocument();
  });
  it("integrates formal requirements and personal tasks into an authorized developer project", async () => {
    const visible = {
      ...project,
      canManage: false,
      projectRole: "DEVELOPER",
      canViewOwnTasks: true,
    };
    mocked.mockImplementation(async (path) =>
      path.endsWith("/story-map")
        ? { goals: [], epics: [], stories: [] }
        : path === "/auth/me"
          ? member
          : path === "/projects"
            ? [visible]
            : path === "/projects/creation-options"
              ? { canCreate: false, managers: [] }
              : path === "/projects/1"
                ? visible
                : [],
    );
    render(<App />);
    await userEvent.click(
      await screen.findByRole("button", { name: /进入项目/ }),
    );
    expect(
      (await screen.findAllByRole("button", { name: "需求管理" }))[0],
    ).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "我的任务" }));
    await waitFor(() =>
      expect(mocked).toHaveBeenCalledWith("/projects/1/tasks/mine"),
    );
    expect(
      screen.queryByRole("tab", { name: "成员与项目角色" }),
    ).not.toBeInTheDocument();
  });
});
