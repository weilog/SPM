import { Button, Card, Empty, Form, Input, Modal, Popconfirm, Select, Space, Table, Tag, Typography } from 'antd';
import { useEffect, useState } from 'react';
import type { Project, ProjectMember, User } from '@spm/shared';
import { api } from './api';

export function ProjectList({ user, onSelect, onError }: { user: User; onSelect: (id: number) => void; onError: (error: unknown) => void }) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [managers, setManagers] = useState<User[]>([]);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form] = Form.useForm();
  const reload = () => api<Project[]>('/projects').then(setProjects).catch(onError);
  useEffect(() => { void reload(); }, []);
  async function create() {
    let values: { name: string; description?: string; managerId?: number };
    try { values = await form.validateFields(); } catch { return; }
    setSaving(true);
    try { const project = await api<Project>('/projects', 'POST', values); setOpen(false); onSelect(project.id); }
    catch (error) { onError(error); } finally { setSaving(false); }
  }
  async function showCreate() {
    try {
      if (user.role === 'ADMIN') setManagers(await api<User[]>('/projects/managers'));
      form.resetFields(); setOpen(true);
    } catch (error) { onError(error); }
  }
  return <><Space className="section-heading"><Typography.Title level={2}>我的项目</Typography.Title>
    {user.role !== 'MEMBER' && <Button type="primary" onClick={() => void showCreate()}>创建项目</Button>}
    <Button onClick={() => void reload()}>刷新项目</Button></Space>
    {projects.length ? <div className="project-grid">{projects.map(project => <Card key={project.id} title={project.name} extra={<Tag>{project.canManage ? '可管理' : '可查看'}</Tag>}>
      <Typography.Paragraph ellipsis={{ rows: 2 }}>{project.description || '暂无说明'}</Typography.Paragraph>
      <p>项目经理：{project.manager.username}</p><Button onClick={() => onSelect(project.id)}>进入项目</Button>
    </Card>)}</div> : <Empty description="暂无有权访问的项目" />}
    <Modal title="创建项目" open={open} onCancel={() => setOpen(false)} onOk={() => void create()} confirmLoading={saving} destroyOnHidden>
      <Form form={form} layout="vertical">
        <Form.Item label="项目名称" name="name" rules={[{ required: true, whitespace: true }, { max: 200 }]}><Input /></Form.Item>
        <Form.Item label="项目说明" name="description" rules={[{ max: 10000 }]}><Input.TextArea rows={3} /></Form.Item>
        {user.role === 'ADMIN' && <Form.Item label="项目经理" name="managerId" rules={[{ required: true }]}><Select options={managers.map(manager => ({ value: manager.id, label: manager.username }))} /></Form.Item>}
      </Form>
    </Modal></>;
}

export function Members({ project, onError, onChanged }: { project: Project; onError: (error: unknown) => void; onChanged: () => void }) {
  const [members, setMembers] = useState<ProjectMember[]>([]);
  const [candidates, setCandidates] = useState<User[]>([]);
  const [busy, setBusy] = useState(false);
  const [form] = Form.useForm();
  const path = `/projects/${project.id}`;
  async function reload() {
    try {
      const [nextMembers, nextCandidates] = await Promise.all([api<ProjectMember[]>(path + '/members'), api<User[]>(path + '/member-candidates')]);
      setMembers(nextMembers); setCandidates(nextCandidates);
    } catch (error) { onError(error); }
  }
  useEffect(() => { void reload(); }, [project.id]);
  async function add(values: { userId: number }) {
    setBusy(true);
    try { await api(path + '/members', 'POST', values); form.resetFields(); await reload(); onChanged(); }
    catch (error) { onError(error); } finally { setBusy(false); }
  }
  async function remove(userId: number) {
    try { await api(path + `/members/${userId}`, 'DELETE'); await reload(); onChanged(); } catch (error) { onError(error); }
  }
  return <><Typography.Title level={3}>项目成员</Typography.Title>
    <Form form={form} layout="inline" onFinish={add} className="member-form">
      <Form.Item name="userId" label="添加成员" rules={[{ required: true }]}><Select style={{ width: 220 }} showSearch optionFilterProp="label" options={candidates.map(user => ({ value: user.id, label: user.username }))} /></Form.Item>
      <Button htmlType="submit" type="primary" loading={busy}>添加</Button>
    </Form>
    <Table rowKey="id" dataSource={members} columns={[
      { title: '用户名', render: (_, member) => member.user.username },
      { title: '状态', render: (_, member) => member.user.active ? '有效' : '已停用' },
      { title: '操作', render: (_, member) => member.userId === project.managerId ? <Tag>项目经理</Tag> : <Popconfirm title="移除成员将清空其本项目任务指派，确认？" onConfirm={() => remove(member.userId)}><Button danger>移除</Button></Popconfirm> },
    ]} />
  </>;
}
