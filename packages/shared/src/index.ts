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
export const roleLabels: Record<Role, string> = { ADMIN: '系统管理员', MANAGER: '项目创建身份', MEMBER: '系统用户' };
export const projectRoleLabels: Record<ProjectRole, string> = { MANAGER: '项目经理', DEVELOPER: '开发人员', TESTER: '测试人员' };
