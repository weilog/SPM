import type { Project } from "@spm/shared";
import { ProjectProvider, useOptionalProjectData } from "./ProjectData";
import { TaskActionsProvider } from "./TaskActions";
import { TaskWorkspace } from "./TaskWorkspace";
export function Tasks({
  project,
  onError,
}: {
  project: Project;
  revision?: number;
  onError: (error: unknown) => void;
}) {
  const store = useOptionalProjectData();
  const view = <TaskWorkspace mine={false} />;
  return store ? (
    view
  ) : (
    <ProjectProvider project={project} user={project.manager} onError={onError}>
      <TaskActionsProvider>{view}</TaskActionsProvider>
    </ProjectProvider>
  );
}
