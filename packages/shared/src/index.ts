export type Role = "ADMIN" | "MANAGER" | "MEMBER";
export type ProjectRole = "MANAGER" | "DEVELOPER" | "TESTER";
export interface User {
  id: number;
  username: string;
  role: Role;
  active: boolean;
}
export interface Project {
  id: number;
  name: string;
  description: string;
  managerId: number;
  manager: User;
  canManage: boolean;
  projectRole: ProjectRole;
  canViewOwnTasks: boolean;
}
export interface ProjectMember {
  id: number;
  projectId: number;
  userId: number;
  user: User;
  role: ProjectRole;
}
export interface Task {
  id: number;
  projectId: number;
  title: string;
  description: string;
  assigneeUserId: number | null;
  status: StoryStatus;
}
export interface ApiError {
  statusCode: number;
  code: string;
  message: string | string[];
}
export interface CreateProject {
  name: string;
  description?: string;
  managerId?: number;
}
export interface CreateTask {
  title: string;
  description?: string;
  assigneeUserId?: number | null;
}
export interface CreationOptions {
  canCreate: boolean;
  managers: User[];
}
export interface Requirement {
  id: number;
  projectId: number;
  title: string;
  description: string;
  createdAt: string;
  updatedAt: string;
}
export interface LinkedRequirement extends Requirement {
  storyIds: number[];
  parentId?: number | null;
}
export type StoryStatus = "TODO" | "IN_PROGRESS" | "DONE";
export interface ProductGoal {
  id: number;
  projectId: number;
  title: string;
  sortOrder: number;
  revision: number;
}
export interface Epic extends ProductGoal {
  goalId: number;
}
export interface UserStory extends ProductGoal {
  epicId: number;
  description: string;
  acceptanceCriteria: string;
  status: StoryStatus;
  requirementIds: number[];
}
export interface StoryMapData {
  goals: ProductGoal[];
  epics: Epic[];
  stories: UserStory[];
}
export const storyStatusLabels: Record<StoryStatus, string> = {
  TODO: "待处理",
  IN_PROGRESS: "进行中",
  DONE: "已完成",
};
// A/B integration extension point; no PlanItem persistence or realtime transport is frozen here.
export interface ViewFocus {
  projectId: number;
  entityType: "story" | "task" | "planItem" | "umlUseCase";
  entityId: number | string;
}
export interface WorkbenchViewProps {
  projectId: number;
  focus: ViewFocus | null;
  onFocusChange(next: ViewFocus): void;
  embedded: boolean;
  readOnly: boolean;
}
export type Priority = "URGENT" | "HIGH" | "MEDIUM" | "LOW";
export const priorityLabels: Record<Priority, string> = {
  URGENT: "紧急",
  HIGH: "高",
  MEDIUM: "中",
  LOW: "低",
};
export interface ManagedTask extends Task {
  priority: Priority;
  progress: number;
  archivedAt: string | null;
  revision: number;
  updatedAt: string;
  storyIds: number[];
  planIds: string[];
}
export interface TaskActivity {
  id: number;
  taskId: number;
  actorName: string;
  actorUserId: number;
  action: string;
  before: Record<string, unknown>;
  after: Record<string, unknown>;
  createdAt: string;
}
export interface UmlBoundary {
  x: number;
  y: number;
  width: number;
  height: number;
  name: string;
}
export interface UmlNode {
  id: number;
  projectId: number;
  diagramId: number;
  kind: "ACTOR" | "USE_CASE";
  name: string;
  description: string;
  x: number;
  y: number;
  revision: number;
  storyIds: number[];
}
export interface UmlEdge {
  id: number;
  fromId: number;
  toId: number;
  kind: "association" | "include" | "extend";
}
export interface UmlDiagram {
  id: number;
  projectId: number;
  name: string;
  boundary: UmlBoundary;
  revision: number;
  nodes: UmlNode[];
  edges: UmlEdge[];
}
export interface ResolvedRelations {
  stories: number[];
  tasks: number[];
  planItems: string[];
  umlUseCases: number[];
}
// A-facing DTOs describe transport only; persistence remains owned by A.
export interface PlanItemView {
  id: string;
  stageId: string;
  kind: "item" | "milestone";
  title: string;
  description: string;
  start: string;
  end: string;
  owner: string;
  status: StoryStatus;
  revision: number;
}
export interface PlanStageView {
  id: string;
  title: string;
  description: string;
  start: string;
  end: string;
  owner: string;
  goals: { id: string; title: string; done: boolean }[];
  revision: number;
}
export interface PlanSnapshot {
  available: boolean;
  reason?: string;
  stages: PlanStageView[];
  items: PlanItemView[];
}
export const roleLabels: Record<Role, string> = {
  ADMIN: "系统管理员",
  MANAGER: "项目创建身份",
  MEMBER: "系统用户",
};
export const projectRoleLabels: Record<ProjectRole, string> = {
  MANAGER: "项目经理",
  DEVELOPER: "开发人员",
  TESTER: "测试人员",
};
