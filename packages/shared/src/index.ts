export type Role = 'ADMIN' | 'MANAGER' | 'MEMBER';
export interface User { id: number; username: string; role: Role; active: boolean }
export interface Project { id: number; name: string; description: string; managerId: number; manager: User; canManage: boolean }
export interface ProjectMember { id: number; projectId: number; userId: number; user: User }
export interface Task { id: number; projectId: number; title: string; description: string; assigneeUserId: number | null; status: 'TODO' }
export interface ApiError { statusCode: number; code: string; message: string | string[] }
export interface CreateProject { name: string; description?: string; managerId?: number }
export interface CreateTask { title: string; description?: string; assigneeUserId?: number | null }
export const roleLabels: Record<Role, string> = { ADMIN: '系统管理员', MANAGER: '项目经理', MEMBER: '普通成员' };
