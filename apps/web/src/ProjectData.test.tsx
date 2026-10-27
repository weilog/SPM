import { afterEach, expect, it, vi } from "vitest";
import { act, cleanup, render } from "@testing-library/react";
import type { Project, User } from "@spm/shared";
import { ProjectProvider, useProjectData } from "./ProjectData";
import { api } from "./api";

vi.mock("./api", async (original) => ({
  ...(await original<typeof import("./api")>()), api: vi.fn(),
}));
const user: User = { id: 1, username: "manager", role: "MANAGER", active: true };
const project = { id: 1, name: "刷新验证", manager: user, managerId: 1,
  canManage: true, projectRole: "MANAGER" } as Project;
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.mocked(api).mockReset(); });

it.each(["visibility-first", "focus-first"])(
  "refreshes once per activation (%s), even after the first request completes",
  async (order) => {
    const visible = vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
    const focused = vi.spyOn(document, "hasFocus").mockReturnValue(true);
    vi.mocked(api).mockImplementation(async (path) => {
      if (path.endsWith("/tasks/graph")) return { tasks: [], members: [] } as never;
      if (path.endsWith("/story-map")) return { goals: [], epics: [], stories: [] } as never;
      if (path.endsWith("/plan-adapter")) return { available: true, stages: [], items: [] } as never;
      return [] as never;
    });
    let store!: ReturnType<typeof useProjectData>;
    function Probe() { store = useProjectData(); return null; }
    let unmount!: () => void;
    await act(async () => {
      ({ unmount } = render(<ProjectProvider project={project} user={user} onError={vi.fn()}><Probe /></ProjectProvider>));
    });
    expect(api).toHaveBeenCalledTimes(6);
    visible.mockReturnValue("hidden");
    focused.mockReturnValue(false);
    await act(async () => { document.dispatchEvent(new Event("visibilitychange")); window.dispatchEvent(new Event("blur")); });
    expect(api).toHaveBeenCalledTimes(6);
    if (order === "visibility-first") {
      visible.mockReturnValue("visible");
      await act(async () => { document.dispatchEvent(new Event("visibilitychange")); });
      focused.mockReturnValue(true);
      await act(async () => { window.dispatchEvent(new Event("focus")); });
    } else {
      focused.mockReturnValue(true);
      await act(async () => { window.dispatchEvent(new Event("focus")); });
      visible.mockReturnValue("visible");
      await act(async () => { document.dispatchEvent(new Event("visibilitychange")); });
    }
    expect(api).toHaveBeenCalledTimes(12);
    // Both signals can arrive after the request already completed.
    await act(async () => { window.dispatchEvent(new Event("focus")); document.dispatchEvent(new Event("visibilitychange")); });
    expect(api).toHaveBeenCalledTimes(12);
    // A later real window activation and network reconnect still revalidate.
    await act(async () => { window.dispatchEvent(new Event("blur")); window.dispatchEvent(new Event("focus")); });
    expect(api).toHaveBeenCalledTimes(18);
    await act(async () => { window.dispatchEvent(new Event("online")); });
    expect(api).toHaveBeenCalledTimes(24);
    // Explicit refreshes remain independent (e.g. a completed write invalidates data).
    await act(async () => { await store.refresh(); });
    expect(api).toHaveBeenCalledTimes(30);
    unmount();
    window.dispatchEvent(new Event("blur")); window.dispatchEvent(new Event("focus")); window.dispatchEvent(new Event("online"));
    document.dispatchEvent(new Event("visibilitychange"));
    expect(api).toHaveBeenCalledTimes(30);
  },
);
