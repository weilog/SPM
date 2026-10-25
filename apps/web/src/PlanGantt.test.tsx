import { afterEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ComponentProps } from "react";
import type { ManagedTask } from "@spm/shared";
import { PlanGantt } from "./PlanGantt";

const data = vi.hoisted(() => ({ tasks: [] as ManagedTask[] }));
vi.mock("./ProjectData", () => ({
  useProjectData: () => ({
    tasks: data.tasks,
    members: [],
    plans: { available: true },
    project: { canManage: true },
  }),
}));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it("retains the information width when a mounted pane becomes hidden", () => {
  let resize!: () => void;
  vi.stubGlobal("ResizeObserver", class {
    constructor(callback: () => void) { resize = callback; }
    observe() {}
    disconnect() {}
  });
  data.tasks = [];
  const { container } = render(<PlanGantt items={[]} onOpen={vi.fn()}
    collapsed={false} onCollapse={vi.fn()} showAi={false} />);
  const scroller = container.querySelector(".gv-scroller")!;
  Object.defineProperty(scroller, "clientWidth", { value: 600, configurable: true });
  act(() => resize());
  const resizer = screen.getByRole("separator", { name: "调整甘特图信息区宽度" });
  fireEvent.keyDown(resizer, { key: "ArrowRight" });
  fireEvent.keyDown(resizer, { key: "ArrowRight" });
  const width = resizer.getAttribute("aria-valuenow");
  expect(Number(width)).toBeGreaterThan(280);
  Object.defineProperty(scroller, "clientWidth", { value: 0, configurable: true });
  act(() => resize());
  expect(resizer).toHaveAttribute("aria-valuenow", width);
});

it.each(["parent", "all"])(
  "preserves %s collapse across fresh task snapshots but expands on focus or relation changes",
  (collapse) => {
    const task = {
      id: 7, title: "关联任务", planIds: ["p1", "p2"],
      status: "TODO", progress: 0,
    } as ManagedTask;
    data.tasks = [task];
    const props: ComponentProps<typeof PlanGantt> = {
      items: ["p1", "p2"].map((id) => ({
        id, title: id, kind: "item", status: "TODO", owner: "",
        start: "2026-10-01", end: "2026-10-05", stageId: "s1",
        number: 1, description: "", revision: 0, tasks: [], taskIds: [7],
      })),
      focus: { projectId: 1, entityType: "task", entityId: 7 },
      onOpen: vi.fn(), collapsed: false, onCollapse: vi.fn(), showAi: false,
    };
    const { container, rerender } = render(<PlanGantt {...props} />);
    const rows = () => container.querySelectorAll(".wb-task-row").length;
    expect(rows()).toBe(2);
    fireEvent.click(screen.getByRole("button", {
      name: collapse === "all" ? "收起关联任务" : "收起 p1 关联任务",
    }));
    const collapsedRows = collapse === "all" ? 0 : 1;
    expect(rows()).toBe(collapsedRows);

    // SSE/window-focus refresh: fresh objects, changed status, reordered IDs.
    data.tasks = [{ ...task, progress: 50, planIds: ["p2", "p1"] }];
    rerender(<PlanGantt {...props} focus={{ projectId: 1, entityType: "task", entityId: 7 }} />);
    expect(rows()).toBe(collapsedRows);

    data.tasks = [{ ...task, planIds: [] }];
    rerender(<PlanGantt {...props} />);
    data.tasks = [{ ...task, planIds: ["p1", "p2"] }];
    rerender(<PlanGantt {...props} />);
    expect(rows()).toBe(2);

    fireEvent.click(screen.getByRole("button", { name: "收起关联任务" }));
    rerender(<PlanGantt {...props} focus={null} />);
    rerender(<PlanGantt {...props} />);
    expect(rows()).toBe(2);
  },
);
