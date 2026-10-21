import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { api, RequestError } from './api';
import { Login } from './Login';
import { App } from './App';
import { ProjectList } from './Projects';
import { Tasks } from './Tasks';
import type { Project, User } from '@spm/shared';
vi.mock('./api', async importOriginal => ({ ...await importOriginal<typeof import('./api')>(), api: vi.fn() }));
const mocked = vi.mocked(api);
const member: User = { id: 3, username: 'member', role: 'MEMBER', active: true };
const manager: User = { id: 2, username: 'manager', role: 'MANAGER', active: true };
const project: Project = { id: 1, name: 'Alpha', description: 'Notes', managerId: 2, manager, canManage: true, projectRole: 'MANAGER', canViewOwnTasks: false };
beforeEach(() => { mocked.mockReset(); });
afterEach(cleanup);

describe('US01 login and session UI', () => {
  it('requires credentials before submitting', async () => {
    render(<Login onLogin={vi.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: /登\s*录/ }));
    expect(await screen.findByText('请输入用户名')).toBeInTheDocument();
    expect(mocked).not.toHaveBeenCalled();
  });
  it('shows the backend wrong-password error', async () => {
    mocked.mockRejectedValue(new RequestError(401, '用户名或密码错误'));
    render(<Login onLogin={vi.fn()} />);
    await userEvent.type(screen.getByLabelText('用户名'), 'member');
    await userEvent.type(screen.getByLabelText('密码'), 'wrong');
    await userEvent.click(screen.getByRole('button', { name: /登\s*录/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent('用户名或密码错误');
  });
  it('passes a successful user to the app', async () => {
    mocked.mockResolvedValue(member);
    const onLogin = vi.fn(); render(<Login onLogin={onLogin} />);
    await userEvent.type(screen.getByLabelText('用户名'), 'member');
    await userEvent.type(screen.getByLabelText('密码'), 'strong-password');
    await userEvent.click(screen.getByRole('button', { name: /登\s*录/ }));
    await waitFor(() => expect(onLogin).toHaveBeenCalledWith(member));
  });
  it('shows login when no server session exists', async () => {
    mocked.mockRejectedValue(new RequestError(401, '请先登录'));
    render(<App />);
    expect(await screen.findByRole('button', { name: /登\s*录/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '用户管理' })).not.toBeInTheDocument();
  });
  it('calls server logout then discards the user context', async () => {
    mocked.mockImplementation(async path => path.endsWith('/story-map') ? { goals: [], epics: [], stories: [] } : path === '/auth/me' ? member : path === '/projects' ? [] : path === '/projects/creation-options' ? { canCreate: false, managers: [] } : { ok: true });
    render(<App />);
    await userEvent.click(await screen.findByRole('button', { name: /退\s*出/ }));
    expect(await screen.findByRole('button', { name: /登\s*录/ })).toBeInTheDocument();
    expect(mocked).toHaveBeenCalledWith('/auth/logout', 'POST');
  });
});
describe('US02/03/06 project role boundaries', () => {
  it('ordinary users cannot see global management or creation controls', async () => {
    mocked.mockImplementation(async path => path.endsWith('/story-map') ? { goals: [], epics: [], stories: [] } : path === '/auth/me' ? member : path === '/projects/creation-options' ? { canCreate: false, managers: [] } : [project]);
    render(<App />);
    await screen.findByText('Alpha');
    expect(screen.queryByRole('button', { name: '用户管理' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '创建项目' })).not.toBeInTheDocument();
  });
  it('switches project by the selected id rather than a stale global project', async () => {
    mocked.mockImplementation(async path => path.endsWith('/story-map') ? { goals: [], epics: [], stories: [] } : path === '/projects/creation-options' ? { canCreate: false, managers: [] } : [project, { ...project, id: 7, name: 'Beta' }]);
    const select = vi.fn(); render(<ProjectList user={member} onSelect={select} onError={vi.fn()} />);
    const buttons = await screen.findAllByRole('button', { name: '进入项目' });
    await userEvent.click(buttons[1]); expect(select).toHaveBeenCalledWith(7);
  });
  it('view-only project members do not see member/task management tabs', async () => {
    mocked.mockImplementation(async path => path.endsWith('/story-map') ? { goals: [], epics: [], stories: [] } : path === '/auth/me' ? member : path === '/projects/creation-options' ? { canCreate: false, managers: [] } : path === '/projects' ? [{ ...project, canManage: false }] : path.endsWith('/requirements') ? [] : { ...project, canManage: false, projectRole: 'DEVELOPER', canViewOwnTasks: true });
    render(<App />);
    await userEvent.click(await screen.findByRole('button', { name: '进入项目' }));
    await screen.findByText('返回项目列表');
    expect(screen.queryByRole('tab', { name: '成员与项目角色' })).not.toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: '任务创建与指派' })).not.toBeInTheDocument();
  });
});
describe('US07/09 task creation UI', () => {
  it('validates title and sends only task creation contract fields', async () => {
    mocked.mockImplementation(async (path, method) => method === 'POST' ? { id: 1 } : path.endsWith('/members') ? [] : []);
    render(<Tasks project={project} revision={0} onError={vi.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: '创建任务' }));
    await userEvent.click(screen.getByRole('button', { name: /OK|确定/ }));
    expect(mocked.mock.calls.some(call => call[1] === 'POST')).toBe(false);
    await userEvent.type(screen.getByLabelText('任务标题'), 'Build feature');
    await userEvent.click(screen.getByRole('button', { name: /OK|确定/ }));
    await waitFor(() => expect(mocked).toHaveBeenCalledWith('/projects/1/tasks', 'POST', { title: 'Build feature', assigneeUserId: null }));
  });
  it('clears a task assignee using its project-scoped endpoint', async () => {
    mocked.mockImplementation(async (path, method) => method === 'PATCH' ? { id: 9 } : path.endsWith('/members') ? [{ id: 1, projectId: 1, userId: manager.id, user: manager }] : [{ id: 9, projectId: 1, title: 'Existing task', assigneeUserId: null, status: 'TODO' }]);
    render(<Tasks project={project} revision={0} onError={vi.fn()} />);
    await userEvent.click(await screen.findByRole('button', { name: '指定负责人' }));
    await userEvent.click(screen.getByRole('button', { name: /OK|确定/ }));
    await waitFor(() => expect(mocked).toHaveBeenCalledWith('/projects/1/tasks/9/assignee', 'PATCH', { assigneeUserId: null }));
  });
});
