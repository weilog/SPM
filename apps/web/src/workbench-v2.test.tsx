import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  cleanup,
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Modal } from "antd";
import { Workbench } from "./Workbench";
import { ProjectProvider } from "./ProjectData";
import { api } from "./api";
import type {
  ManagedTask,
  Project,
  RelationTarget,
  UmlSequence,
  ViewFocus,
} from "@spm/shared";
vi.mock("./api", async (original) => ({
  ...(await original<typeof import("./api")>()),
  api: vi.fn(),
}));
const openTask = vi.fn();
vi.mock("./TaskActions", () => ({
  useTaskActions: () => ({ open: openTask }),
}));
const user = {
  id: 9,
  username: "经理",
  role: "MANAGER" as const,
  active: true,
};
const project: Project = {
  id: 1,
  name: "融合测试",
  description: "",
  managerId: 9,
  manager: user,
  projectRole: "MANAGER",
  canManage: true,
  canViewOwnTasks: false,
};
const task = {
  id: 7,
  projectId: 1,
  title: "实现权限校验",
  assigneeUserId: 9,
  status: "TODO",
  priority: "MEDIUM",
  progress: 0,
  revision: 0,
  archivedAt: null,
  storyIds: [3],
  planIds: ["p1", "p2"],
  description: "",
  createdAt: "",
  updatedAt: "",
} as ManagedTask;
const story = {
  id: 3,
  projectId: 1,
  epicId: 2,
  title: "负责人分配",
  status: "TODO",
  description: "",
  acceptanceCriteria: "",
  requirementIds: [],
  revision: 0,
  sortOrder: 0,
};
const stories = {
  goals: [
    { id: 1, projectId: 1, title: "团队协作", sortOrder: 0, revision: 0 },
  ],
  epics: [
    {
      id: 2,
      projectId: 1,
      title: "权限管理",
      goalId: 1,
      sortOrder: 0,
      revision: 0,
    },
  ],
  stories: [story, { ...story, id: 4, title: "无关故事" }],
};
const plans = {
  available: true,
  stages: [
    {
      id: "stage1",
      title: "实施阶段",
      description: "",
      start: "2026-10-01",
      end: "2026-11-01",
      owner: "经理",
      revision: 0,
      goals: [],
    },
  ],
  items: ["p1", "p2"].map((id, i) => ({
    id,
    number: i + 1,
    stageId: "stage1",
    title: `计划${i + 1}`,
    description: "",
    kind: "item",
    start: "2026-10-02",
    end: "2026-10-20",
    owner: "经理",
    revision: 0,
    status: "TODO",
    tasks: [task],
    taskIds: [7],
  })),
};
let activeProject = project;
let sequences: UmlSequence[], writes: { path: string; body: any }[];
const trace = (type: ViewFocus["entityType"], id: number | string) => {
  const targets: RelationTarget[] = [
    {
      entityType: type,
      entityId: id,
      label:
        type === "task"
          ? task.title
          : type === "sequence"
            ? sequences[0]?.name || "场景"
            : story.title,
      distance: 0,
      path: ["当前对象"],
    },
  ];
  for (const [entityType, entityId, label, distance] of [
    ["story", 3, story.title, 1],
    ["task", 7, task.title, 1],
    ["planItem", "p1", "计划1", type === "task" ? 1 : 2],
    ["planItem", "p2", "计划2", type === "task" ? 1 : 2],
    ["member", 9, "经理", 2],
  ] as const)
    if (type !== entityType || id !== entityId)
      targets.push({
        entityType,
        entityId,
        label,
        distance,
        path: ["当前对象", "关联故事", label].slice(0, distance + 1),
      });
  return {
    stories: [3],
    tasks: [7],
    planItems: ["p1", "p2"],
    umlUseCases: [],
    members: [9],
    stages: ["stage1"],
    sequences: sequences.map((s) => s.id),
    trace: targets,
  };
};
beforeEach(() => {
  vi.mocked(api).mockReset();
  openTask.mockReset();
  activeProject = project;
  writes = [];
  sequences = [];
  vi.mocked(api).mockImplementation(async (path, method = "GET", body) => {
    if (method !== "GET") {
      writes.push({ path, body });
      if (path.includes("/uml-sequences")) {
        if ("projectId" in (body as object))
          throw new Error("projectId must not be submitted");
        const row = {
          ...(body as object),
          id: 11,
          projectId: 1,
        } as UmlSequence;
        sequences = [row];
        return row as never;
      }
      return {} as never;
    }
    if (path.endsWith("/tasks/graph"))
      return {
        tasks: [task],
        members: [{ id: 100, userId: 9, projectId: 1, role: "MANAGER", user }],
        project: activeProject,
      } as never;
    if (path.endsWith("/story-map")) return structuredClone(stories) as never;
    if (path.endsWith("/requirements") || path.endsWith("/uml-diagrams"))
      return [] as never;
    if (path.endsWith("/plan-adapter")) return structuredClone(plans) as never;
    if (path.endsWith("/uml-sequences"))
      return structuredClone(sequences) as never;
    if (path.includes("/relations/resolve")) {
      const params = new URLSearchParams(path.split("?")[1]),
        raw = params.get("entityId")!;
      return trace(
        params.get("entityType") as ViewFocus["entityType"],
        /^\d+$/.test(raw) ? Number(raw) : raw,
      ) as never;
    }
    throw new Error(`Unexpected read: ${path}`);
  });
});
afterEach(cleanup);
function mount(p = project) {
  activeProject = p;
  return render(
    <ProjectProvider
      project={p}
      user={user}
      onError={(e) => {
        throw e;
      }}
    >
      <Workbench />
    </ProjectProvider>,
  );
}
it("single click focuses without opening details, tracks paths and manually filters both story views", async () => {
  mount();
  const u = userEvent.setup();
  await u.click(screen.getByRole("tab", { name: "故事地图" }));
  await u.click(await screen.findByRole("button", { name: story.title }));
  const panel = await screen.findByRole("complementary", {
    name: "关联追踪面板",
  });
  await waitFor(() =>
    expect(within(panel).getByText("计划1")).toBeInTheDocument(),
  );
  expect(within(panel).getAllByText(/间接关联/).length).toBeGreaterThan(0);
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(
    screen.getByRole("button", { name: "查看 US-003 详情" }),
  ).toBeInTheDocument();
  await u.click(screen.getByRole("button", { name: "仅看关联项" }));
  expect(
    screen.queryByRole("button", { name: "无关故事" }),
  ).not.toBeInTheDocument();
  await u.click(screen.getByRole("button", { name: "清除焦点" }));
  expect(
    await screen.findByRole("button", { name: "无关故事" }),
  ).toBeInTheDocument();
  expect(writes).toHaveLength(0);
});
it("opens dual on demand at 55/45, keyboard resizes and overlays tracking", async () => {
  const { container } = mount();
  const u = userEvent.setup();
  await u.click(screen.getByRole("button", { name: "双视图联动" }));
  const splitter = screen.getByRole("separator", { name: "调整双视图比例" });
  expect(splitter).toHaveAttribute("aria-valuenow", "55");
  fireEvent.keyDown(splitter, { key: "ArrowRight" });
  expect(splitter).toHaveAttribute("aria-valuenow", "57");
  fireEvent.keyDown(splitter, { key: "End" });
  expect(splitter).toHaveAttribute("aria-valuenow", "70");
  await u.click(screen.getByRole("button", { name: "关联追踪" }));
  expect(container.querySelector(".wb-track.wb-overlay")).toBeInTheDocument();
  expect(container.querySelectorAll(".panes .viewpane")).toHaveLength(2);
  await u.click(screen.getByRole("button", { name: "单视图" }));
  expect(
    screen.queryByRole("separator", { name: "调整双视图比例" }),
  ).not.toBeInTheDocument();
});
it("retains the real Gantt and expands the same task under both associated plans without invented task dates", async () => {
  const { container } = mount();
  const u = userEvent.setup();
  await u.click(screen.getByRole("button", { name: "甘特 + 成员" }));
  await u.click(await screen.findByRole("button", { name: "展开关联任务" }));
  expect(container.querySelectorAll(".wb-task-row")).toHaveLength(2);
  expect(screen.getAllByText("未设置独立排期")).toHaveLength(2);
  expect(
    screen.getByRole("combobox", { name: "甘特图时间尺度" }),
  ).toBeInTheDocument();
  const node = screen.getByRole("button", { name: /T-007 实现权限校验/ });
  await u.click(node);
  expect(openTask).not.toHaveBeenCalled();
  await waitFor(() => expect(node).toHaveClass("selected"));
  await u.click(screen.getByRole("button", { name: "查看选中任务详情" }));
  expect(openTask).toHaveBeenCalledWith(7);
  expect(writes).toHaveLength(0);
});
it("keeps the Gantt mounted with its chosen scale, info width and expansion while focus relations load", async () => {
  const { container } = mount();
  await screen.findByRole("button", { name: "展开关联任务" });
  fireEvent.click(screen.getAllByRole("button", { name: "计划1" })[0]);
  await screen.findByRole("complementary", { name: "关联追踪面板" });
  await waitFor(() => expect(screen.getByRole("button", { name: "仅看关联项" })).toBeEnabled());
  fireEvent.click(screen.getByRole("button", { name: "仅看关联项" }));
  const scale = screen.getByRole("combobox", { name: "甘特图时间尺度" });
  fireEvent.change(scale, { target: { value: "day" } });
  const resizer = screen.getByRole("separator", { name: "调整甘特图信息区宽度" });
  fireEvent.keyDown(resizer, { key: "ArrowRight" });
  const width = resizer.getAttribute("aria-valuenow");
  fireEvent.click(screen.getByRole("button", { name: "展开关联任务" }));
  expect(container.querySelectorAll(".wb-task-row")).toHaveLength(2);

  const original = vi.mocked(api).getMockImplementation()!;
  let finish!: (result: ReturnType<typeof trace>) => void;
  vi.mocked(api).mockImplementation((path, ...args) =>
    path.includes("/relations/resolve")
      ? new Promise((resolve) => { finish = resolve as typeof finish; }) as never
      : original(path, ...args),
  );
  fireEvent.click(screen.getAllByRole("button", { name: "计划2" })[0]);
  await screen.findByText("正在读取关联计划…");
  expect(screen.getByRole("combobox", { name: "甘特图时间尺度" })).toBe(scale);
  expect(scale).toHaveValue("day");
  expect(resizer).toHaveAttribute("aria-valuenow", width);
  await act(async () => finish(trace("planItem", "p2")));
  expect(screen.getByRole("combobox", { name: "甘特图时间尺度" })).toBe(scale);
  expect(scale).toHaveValue("day");
  expect(resizer).toHaveAttribute("aria-valuenow", width);
  expect(container.querySelectorAll(".wb-task-row")).toHaveLength(2);

  fireEvent.click(screen.getAllByRole("button", { name: "计划1" })[0]);
  await screen.findByText("正在读取关联计划…");
  await act(async () => finish({ ...trace("planItem", "p1"), planItems: [], stages: [] }));
  expect(screen.getByText("当前焦点没有关联计划项")).toBeVisible();
  expect(scale).toBeInTheDocument();
  expect(scale).not.toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "清除焦点" }));
  expect(screen.getByRole("combobox", { name: "甘特图时间尺度" })).toBe(scale);
  expect(scale).toHaveValue("day");
  expect(container.querySelectorAll(".wb-task-row")).toHaveLength(2);
});
it("focuses the actual stage rather than treating the stage display row as a plan item", async () => {
  mount();
  const u = userEvent.setup();
  await u.click(screen.getByRole("tab", { name: "甘特图" }));
  await u.click(
    (await screen.findAllByRole("button", { name: "实施阶段" }))[0],
  );
  await waitFor(() =>
    expect(
      vi
        .mocked(api)
        .mock.calls.some(([path]) =>
          path.includes("entityType=stage&entityId=stage1"),
        ),
    ).toBe(true),
  );
  expect(
    vi
      .mocked(api)
      .mock.calls.some(([path]) =>
        path.includes("entityType=planItem&entityId=stage1"),
      ),
  ).toBe(false);
  await u.click(screen.getByRole("button", { name: "详情" }));
  expect(
    await screen.findByRole("dialog", { name: "计划详情" }),
  ).toBeInTheDocument();
});
it("creates and reloads a real sequence through the canonical service without writing task or plan endpoints", async () => {
  mount();
  const u = userEvent.setup();
  await u.click(screen.getByRole("tab", { name: "UML 建模" }));
  await u.click(screen.getByRole("tab", { name: "时序图" }));
  await u.click(screen.getByRole("button", { name: "新建时序场景" }));
  await u.type(
    screen.getByRole("textbox", { name: "场景名称" }),
    "任务授权交互",
  );
  await u.click(screen.getByRole("button", { name: "添加消息" }));
  await u.type(
    screen.getByRole("textbox", { name: "消息 1 内容" }),
    "提交授权检查",
  );
  await u.click(screen.getByRole("button", { name: "保存场景" }));
  expect(
    await screen.findByRole("img", { name: "任务授权交互时序图" }),
  ).toBeInTheDocument();
  expect(writes).toHaveLength(1);
  expect(writes[0].path).toBe("/projects/1/uml-sequences");
  expect(writes[0].body.messages[0].label).toBe("提交授权检查");
  await u.click(screen.getByRole("button", { name: "编辑场景" }));
  await u.clear(screen.getByRole("textbox", { name: "场景名称" }));
  await u.type(
    screen.getByRole("textbox", { name: "场景名称" }),
    "更新的授权交互",
  );
  await u.click(screen.getByRole("button", { name: "保存场景" }));
  expect(
    await screen.findByRole("img", { name: "更新的授权交互时序图" }),
  ).toBeInTheDocument();
  expect(writes[1].path).toBe("/projects/1/uml-sequences/11");
  expect(writes[1].body).not.toHaveProperty("projectId");
});
it("keeps sequence creation and editing unavailable to ordinary members", async () => {
  mount({
    ...project,
    projectRole: "DEVELOPER",
    canManage: false,
    canViewOwnTasks: true,
  });
  const u = userEvent.setup();
  await u.click(screen.getByRole("tab", { name: "UML 建模" }));
  await u.click(screen.getByRole("tab", { name: "时序图" }));
  expect(
    screen.queryByRole("button", { name: "新建时序场景" }),
  ).not.toBeInTheDocument();
});

it("reverse-focuses a member without changing the chosen view combination", async () => {
  mount();
  const u = userEvent.setup();
  await u.click(screen.getByRole("button", {name:"双视图联动"}));
  await u.click(await screen.findByRole("button", {name:"成员 经理"}));
  await waitFor(() => expect(vi.mocked(api).mock.calls.some(([path]) => path.includes("entityType=member&entityId=9"))).toBe(true));
  expect(screen.getByRole("combobox", {name:"左侧视图"})).toHaveValue("gantt");
  expect(screen.getByRole("combobox", {name:"右侧视图"})).toHaveValue("members");
  expect(writes).toHaveLength(0);
});

it("previews a plan date change before writing only that plan with its revision", async () => {
  const previews: any[] = [];
  const confirm = vi.spyOn(Modal, "confirm").mockImplementation((options) => {
    previews.push(options);
    return {destroy: vi.fn(), update: vi.fn()};
  });
  try {
    mount();
    const u = userEvent.setup();
    await u.click((await screen.findAllByRole("button", {name:"计划1"}))[0]);
    await u.click(await screen.findByRole("button", {name:"查看完整详情"}));
    const detail = await screen.findByRole("dialog", {name:"计划详情"});
    await u.click(within(detail).getByRole("button", {name:"编辑"}));
    fireEvent.change(await screen.findByLabelText(/开始日期/), {target:{value:"2026-10-03"}});
    await u.click(screen.getByRole("button", {name:"保存"}));
    expect(previews).toHaveLength(1);
    expect(previews[0].title).toBe("确认调整计划日期");
    expect(writes).toHaveLength(0);
    await previews[0].onOk();
    expect(writes).toHaveLength(1);
    expect(writes[0].path).toBe("/projects/1/plan-adapter/items/p1");
    expect(writes[0].body).toMatchObject({start:"2026-10-03", revision:0});
    expect(writes[0].body).not.toHaveProperty("assigneeUserId");
  } finally { confirm.mockRestore(); }
});
