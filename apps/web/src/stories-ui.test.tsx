import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { LinkedRequirement, Project, StoryMapData, UserStory } from '@spm/shared';
import { api, RequestError } from './api';
import { Requirements } from './Requirements';

vi.mock('./api', async original => ({ ...await original<typeof import('./api')>(), api: vi.fn() }));
const mocked = vi.mocked(api);
const project: Project = { id: 1, name: 'Alpha', description: '', managerId: 1, manager: { id: 1, username: 'manager', active: true, role: 'MANAGER' }, canManage: true, canViewOwnTasks: false, projectRole: 'MANAGER' };
const story: UserStory = { id: 3, projectId: 1, title: '提交审批', description: '故事说明', acceptanceCriteria: '审批成功', epicId: 2, status: 'TODO', sortOrder: 0, revision: 4, requirementIds: [8] };
const requirement: LinkedRequirement = { id: 8, projectId: 1, title: '业务需求', description: '正式需求说明', storyIds: [3], createdAt: '', updatedAt: '' };
let snapshot: StoryMapData;
function transfer(id: number) { return { getData: (type: string) => type === 'application/x-spm-story' ? String(id) : '', setData: vi.fn(), effectAllowed: '' }; }
beforeEach(() => {
  mocked.mockReset();
  snapshot = { goals: [{ id: 1, projectId: 1, title: '提升协作效率', sortOrder: 0, revision: 0 }], epics: [{ id: 2, projectId: 1, goalId: 1, title: '审批流程', sortOrder: 0, revision: 0 }, { id: 4, projectId: 1, goalId: 1, title: '归档流程', sortOrder: 1, revision: 0 }], stories: [{ ...story }] };
  mocked.mockImplementation(async (path, method, body) => {
    if (method === 'PATCH' && path.endsWith('/status')) { snapshot = { ...snapshot, stories: [{ ...snapshot.stories[0], status: (body as UserStory).status, revision: 5 }] }; return snapshot.stories[0]; }
    if (method === 'PATCH' && path.endsWith('/move')) { snapshot = { ...snapshot, stories: [{ ...snapshot.stories[0], epicId: 4, revision: 5 }] }; return snapshot.stories[0]; }
    return path.endsWith('/story-map') ? snapshot : path.endsWith('/8') ? requirement : [requirement];
  });
});
afterEach(cleanup);
it('shares persisted status between board, drawer and map and supports story number search', async () => {
  render(<Requirements project={project} onError={vi.fn()} />);
  await userEvent.click(await screen.findByRole('tab', { name: '故事看板' }));
  await screen.findByRole('button', { name: '提交审批' });
  fireEvent.drop(screen.getByRole('region', { name: '进行中' }), { dataTransfer: transfer(3) });
  await waitFor(() => expect(mocked).toHaveBeenCalledWith('/projects/1/stories/3/status', 'PATCH', { status: 'IN_PROGRESS', revision: 4 }));
  await waitFor(() => expect(within(screen.getByRole('region', { name: '进行中' })).getByRole('button', { name: '提交审批' })).toBeInTheDocument());
  await userEvent.type(screen.getByLabelText('搜索故事'), 'US-999');
  expect(screen.queryByRole('button', { name: '提交审批' })).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole('tab', { name: '故事地图' }));
  await userEvent.click(screen.getByRole('button', { name: '提交审批' }));
  expect(await screen.findByText('故事说明')).toBeInTheDocument();
  expect(screen.getByRole('combobox', { name: '故事状态' })).toBeInTheDocument();
  expect(screen.getByText('审批成功')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'REQ-008 · 业务需求' })).toBeInTheDocument();
});
it('persists a cross-epic map drop', async () => {
  render(<Requirements project={project} onError={vi.fn()} />);
  await userEvent.click(await screen.findByRole('tab', { name: '故事地图' }));
  await screen.findByRole('button', { name: '提交审批' });
  fireEvent.drop(screen.getByRole('region', { name: 'Epic：归档流程' }), { dataTransfer: transfer(3) });
  await waitFor(() => expect(mocked).toHaveBeenCalledWith('/projects/1/stories/3/move', 'PATCH', { epicId: 4, position: 0, revision: 4 }));
  await waitFor(() => expect(within(screen.getByRole('region', { name: 'Epic：归档流程' })).getByRole('button', { name: '提交审批' })).toBeInTheDocument());
});
it('rolls back an optimistic status change when the server rejects it', async () => {
  const original = mocked.getMockImplementation()!;
  mocked.mockImplementation(async (...args) => { if (args[1] === 'PATCH') throw new RequestError(409, '内容已被修改'); return original(...args); });
  const onError = vi.fn();
  render(<Requirements project={project} onError={onError} />);
  await userEvent.click(await screen.findByRole('tab', { name: '故事看板' }));
  await screen.findByRole('button', { name: '提交审批' });
  fireEvent.drop(screen.getByRole('region', { name: '已完成' }), { dataTransfer: transfer(3) });
  expect(await screen.findByText('内容已被修改')).toBeInTheDocument();
  expect(within(screen.getByRole('region', { name: '待处理' })).getByRole('button', { name: '提交审批' })).toBeInTheDocument();
  expect(onError).toHaveBeenCalledOnce();
});
it.each(['DEVELOPER', 'TESTER'] as const)('keeps %s map, board and drawer read-only', async role => {
  render(<Requirements project={{ ...project, canManage: false, projectRole: role }} onError={vi.fn()} />);
  await userEvent.click(await screen.findByRole('tab', { name: '故事地图' }));
  await screen.findByRole('button', { name: '提交审批' });
  expect(screen.queryByRole('button', { name: '新建产品目标' })).not.toBeInTheDocument();
  expect(screen.getByRole('article', { name: 'US-003' })).toHaveAttribute('draggable', 'false');
  fireEvent.drop(screen.getByRole('region', { name: 'Epic：归档流程' }), { dataTransfer: transfer(3) });
  await userEvent.click(screen.getByRole('tab', { name: '故事看板' }));
  fireEvent.drop(screen.getByRole('region', { name: '已完成' }), { dataTransfer: transfer(3) });
  await userEvent.click(screen.getByRole('button', { name: '提交审批' }));
  expect(await screen.findByText('故事说明')).toBeInTheDocument();
  expect(screen.queryByRole('combobox', { name: '故事状态' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: '编辑用户故事' })).not.toBeInTheDocument();
  expect(mocked.mock.calls.some(call => call[1] === 'PATCH')).toBe(false);
});
it('discards the old project while its snapshot request is still pending', async () => {
  let release!: (value: StoryMapData) => void;
  mocked.mockImplementation(async path => path === '/projects/1/story-map' ? new Promise<StoryMapData>(resolve => { release = resolve; }) : path.endsWith('/story-map') ? { goals: [], epics: [], stories: [] } : []);
  const { rerender } = render(<Requirements project={project} onError={vi.fn()} />);
  rerender(<Requirements project={{ ...project, id: 7 }} onError={vi.fn()} />);
  await waitFor(() => expect(mocked).toHaveBeenCalledWith('/projects/7/story-map'));
  release(snapshot);
  await userEvent.click(screen.getByRole('tab', { name: '故事地图' }));
  expect(await screen.findByText('暂无产品目标')).toBeInTheDocument();
  expect(screen.queryByText('提升协作效率')).not.toBeInTheDocument();
});
