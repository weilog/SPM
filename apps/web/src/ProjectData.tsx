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
  plans: PlanSnapshot;
}
const initial: Data = {
  tasks: [],
  members: [],
  stories: { goals: [], epics: [], stories: [] },
  requirements: [],
  diagrams: [],
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
    const [graph, stories, requirements, diagrams, plans] = await Promise.all([
      api<{
        tasks: ManagedTask[];
        members: ProjectMember[];
        project?: Project;
      }>(base + "/tasks/graph"),
      api<StoryMapData>(base + "/story-map"),
      api<LinkedRequirement[]>(base + "/requirements"),
      api<UmlDiagram[]>(base + "/uml-diagrams"),
      api<PlanSnapshot>(base + "/plan-adapter"),
    ]);
    if (live.current && v === version.current) {
      setData({
        tasks: graph.tasks,
        members: graph.members,
        stories,
        requirements,
        diagrams,
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
    await refresh();
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
