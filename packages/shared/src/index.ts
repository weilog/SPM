export type Role = 'ADMIN' | 'MANAGER' | 'MEMBER';
export type ProjectRole = 'MANAGER' | 'DEVELOPER' | 'TESTER';
export interface User { id: number; username: string; role: Role; active: boolean }
export interface Project { id: number; name: string; description: string; managerId: number; manager: User; canManage: boolean; projectRole: ProjectRole; canViewOwnTasks: boolean }
export interface ProjectMember { id: number; projectId: number; userId: number; user: User; role: ProjectRole }
export interface Task { id: number; projectId: number; title: string; description: string; assigneeUserId: number | null; status: 'TODO' }
export interface ApiError { statusCode: number; code: string; message: string | string[] }
export interface CreateProject { name: string; description?: string; managerId?: number }
export interface CreateTask { title: string; description?: string; assigneeUserId?: number | null }
export interface CreationOptions { canCreate: boolean; managers: User[] }
export interface Requirement { id: number; projectId: number; title: string; description: string; createdAt: string; updatedAt: string }
export interface LinkedRequirement extends Requirement { storyIds: number[] }
export type StoryStatus = 'TODO' | 'IN_PROGRESS' | 'DONE';
export interface ProductGoal { id: number; projectId: number; title: string; sortOrder: number; revision: number }
export interface Epic extends ProductGoal { goalId: number }
export interface UserStory extends ProductGoal { epicId: number; description: string; acceptanceCriteria: string; status: StoryStatus; requirementIds: number[] }
export interface StoryMapData { goals: ProductGoal[]; epics: Epic[]; stories: UserStory[] }
export const storyStatusLabels: Record<StoryStatus, string> = { TODO: '待处理', IN_PROGRESS: '进行中', DONE: '已完成' };
// A/B integration extension point; no PlanItem persistence or realtime transport is frozen here.
export interface ViewFocus { projectId: number; entityType: 'story' | 'task' | 'planItem' | 'umlUseCase'; entityId: number }
export interface WorkbenchViewProps { projectId: number; focus: ViewFocus | null; onFocusChange(next: ViewFocus): void; embedded: boolean; readOnly: boolean }
export const roleLabels: Record<Role, string> = { ADMIN: '系统管理员', MANAGER: '项目创建身份', MEMBER: '系统用户' };
export const projectRoleLabels: Record<ProjectRole, string> = { MANAGER: '项目经理', DEVELOPER: '开发人员', TESTER: '测试人员' };
