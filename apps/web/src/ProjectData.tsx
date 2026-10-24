import { createContext, useContext, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import type {
  LinkedRequirement,
  ManagedTask,
  PlanSnapshot,
  Project,
  ProjectMember,
  StoryMapData,
  UmlDiagram,
  UmlSequence,
  User,
} from "@spm/shared";
import { api, RequestError } from "./api";
import { announceProject, useProjectRefresh } from "./ui";
interface Data {
  tasks: ManagedTask[];
  members: ProjectMember[];
  stories: StoryMapData;
  requirements: LinkedRequirement[];
  diagrams: UmlDiagram[];
  sequences: UmlSequence[];
  plans: PlanSnapshot;
}
const initial: Data = {
  tasks: [],
  members: [],
  stories: { goals: [], epics: [], stories: [] },
  requirements: [],
  diagrams: [],
  sequences: [],
  plans: { available: false, stages: [], items: [] },
};
interface Store extends Data {
  project: Project;
  user: User;
  loading: boolean;
  refresh(): Promise<void>;
  write<T>(path: string, method: string, body?: unknown): Promise<T>;
  onError(e: unknown): void;
}
const Context = createContext<Store | null>(null);
export function useOptionalProjectData() {
  return useContext(Context);
}
export function useProjectData() {
  const value = useContext(Context);
  if (!value) throw new Error("ProjectProvider required");
  return value;
}
export function ProjectProvider({
  project,
  user,
  onError,
  children,
  onProjectUpdate,
}: {
  project: Project;
  user: User;
  onError(e: unknown): void;
  children: ReactNode;
  onProjectUpdate?: (project: Project) => void;
}) {
  const [currentProject, setCurrentProject] = useState(project);
  const [data, setData] = useState(initial),
    [loading, setLoading] = useState(true);
  const live = useRef(true),
    version = useRef(0);
  const errorRef = useRef(onError);
  errorRef.current = onError;
  const base = `/projects/${project.id}`;
  async function refresh() {
    const v = ++version.current;
    const [graph, stories, requirements, diagrams, plans, sequences] =
      await Promise.all([
        api<{
          tasks: ManagedTask[];
          members: ProjectMember[];
          project?: Project;
        }>(base + "/tasks/graph"),
        api<StoryMapData>(base + "/story-map"),
        api<LinkedRequirement[]>(base + "/requirements"),
        api<UmlDiagram[]>(base + "/uml-diagrams"),
        api<PlanSnapshot>(base + "/plan-adapter"),
        api<UmlSequence[]>(base + "/uml-sequences"),
      ]);
    if (live.current && v === version.current) {
      setData({
        tasks: graph.tasks,
        members: graph.members,
        stories,
        requirements,
        diagrams,
        sequences: sequences ?? [],
        plans,
      });
      if (graph.project) {
        setCurrentProject(graph.project);
        if (graph.project.projectRole !== project.projectRole)
          onProjectUpdate?.(graph.project);
      }
    }
  }
  useEffect(() => {
    live.current = true;
    void refresh()
      .catch(errorRef.current)
      .finally(() => {
        if (live.current) setLoading(false);
      });
    return () => {
      live.current = false;
      version.current++;
    };
  }, [project.id]);
  useProjectRefresh(project.id, () => void refresh().catch(errorRef.current));
  useEffect(() => {
    // Revalidate after reconnect/tab activation even when a proxy interrupted SSE.
    const revalidate = () => {
      if (document.visibilityState === "visible") void refresh().catch(errorRef.current);
    };
    window.addEventListener("focus", revalidate);
    window.addEventListener("online", revalidate);
    document.addEventListener("visibilitychange", revalidate);
    return () => {
      window.removeEventListener("focus", revalidate);
      window.removeEventListener("online", revalidate);
      document.removeEventListener("visibilitychange", revalidate);
    };
  }, [project.id]);
  useEffect(() => {
    if (typeof EventSource === "undefined") return;
    const stream = new EventSource(`/api${base}/events`, {
      withCredentials: true,
    });
    stream.addEventListener("changed", () => announceProject(project.id));
    stream.addEventListener("revoked", () => {
      stream.close();
      setData(initial);
      errorRef.current(
        new RequestError(403, "项目访问权限已失效，请重新选择项目"),
      );
    });
    stream.onopen = () => announceProject(project.id);
    return () => stream.close();
  }, [project.id]);
  async function write<T>(path: string, method: string, body?: unknown) {
    const result = await api<T>(base + path, method, body);
    try {
      await refresh();
    } catch (e) {
      errorRef.current(
        new Error(
          `保存成功，但刷新失败，请刷新后继续：${(e as Error).message}`,
        ),
      );
    }
    announceProject(project.id);
    return result;
  }
  return (
    <Context.Provider
      value={{
        ...data,
        project: currentProject,
        user,
        loading,
        refresh,
        write,
        onError,
      }}
    >
      {children}
    </Context.Provider>
  );
}
