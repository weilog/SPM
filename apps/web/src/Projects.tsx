import { Alert, Button, Card, Empty, Form, Input, Modal, Popconfirm, Select, Space, Table, Tag, Typography } from 'antd';
import { useEffect, useState } from 'react';
import { projectRoleLabels, type CreationOptions, type Project, type ProjectMember, type ProjectRole, type User } from '@spm/shared';
import { api } from './api';

export function ProjectList({ user, onSelect, onError }: { user: User; onSelect: (id: number) => void; onError: (error: unknown) => void }) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [managers, setManagers] = useState<User[]>([]);
  const [canCreate, setCanCreate] = useState(false);
  const [notice, setNotice] = useState('');
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form] = Form.useForm();
  const reload = () => api<Project[]>('/projects').then(setProjects).catch(onError);
  useEffect(() => { void reload(); void api<CreationOptions>('/projects/creation-options').then(options => { setCanCreate(options.canCreate); setManagers(options.managers); }).catch(onError); }, []);
  async function create() {
    let values: { name: string; description?: string; managerId?: number };
    try { values = await form.validateFields(); } catch { return; }
    setSaving(true);
    try {
      const created = await api<{ id: number; canManage: boolean }>('/projects', 'POST', values);
      setOpen(false);
      if (created.canManage) onSelect(created.id);
      else { setNotice('项目已创建，已授权给指定经理；创建操作不会自动授予项目访问权。'); await reload(); }
    }
    catch (error) { onError(error); } finally { setSaving(false); }
  }
  async function showCreate() {
    try {
      const options = await api<CreationOptions>('/projects/creation-options');
      setCanCreate(options.canCreate); setManagers(options.managers);
      form.resetFields(); setOpen(true);
    } catch (error) { onError(error); }
  }
  return <><div className="workspace-intro"><div><span className="eyebrow">项目工作台</span><Typography.Title level={2}>让协作，从这里开始。</Typography.Title><p>进入你的项目，查看需求、组织成员与安排任务。</p></div><div className="workspace-symbol" aria-hidden="true"><span /> <span /> <span /></div></div><div className="section-heading"><div><Typography.Title level={2}>我的项目</Typography.Title><p className="section-subtitle">你参与的项目，集中在这里。</p></div><Space wrap>
    {canCreate && <Button type="primary" onClick={() => void showCreate()}>创建项目</Button>}
    <Button onClick={() => void reload()}>刷新项目</Button></Space></div>
    {notice && <Alert type="success" title={notice} />}
    {projects.length ? <div className="project-grid">{projects.map(project => <Card className="project-card" key={project.id}>
      <div className="project-card-top"><span className="project-monogram" aria-hidden="true">{project.name.slice(0, 1)}</span><Tag color={project.canManage ? 'cyan' : 'default'}>{projectRoleLabels[project.projectRole]}</Tag></div>
      <Typography.Title level={3}>{project.name}</Typography.Title><Typography.Paragraph className="project-card-description" ellipsis={{ rows: 2 }}>{project.description || '暂无说明'}</Typography.Paragraph>
      <div className="project-card-footer"><span className="project-manager">项目经理：{project.manager.username}</span><Button type="text" onClick={() => onSelect(project.id)}>进入项目<span aria-hidden="true"> →</span></Button></div>
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
  async function add(values: { userId: number; role: ProjectRole }) {
    setBusy(true);
    try { await api(path + '/members', 'POST', values); form.resetFields(); await reload(); onChanged(); }
    catch (error) { onError(error); } finally { setBusy(false); }
  }
  async function remove(userId: number) {
    try { await api(path + `/members/${userId}`, 'DELETE'); await reload(); onChanged(); } catch (error) { onError(error); }
  }
  async function changeRole(userId: number, role: ProjectRole) {
    try { await api(path + `/members/${userId}/role`, 'PATCH', { role }); await reload(); onChanged(); }
    catch (error) { onError(error); }
  }
  return <><Typography.Title level={3}>项目成员</Typography.Title>
    <Form form={form} layout="inline" onFinish={add} initialValues={{ role: 'DEVELOPER' }} className="member-form">
      <Form.Item name="userId" label="添加成员" rules={[{ required: true }]}><Select style={{ width: 220 }} showSearch optionFilterProp="label" options={candidates.map(user => ({ value: user.id, label: user.username }))} /></Form.Item>
      <Form.Item name="role" label="项目角色" rules={[{ required: true }]}><Select style={{ width: 160 }} options={Object.entries(projectRoleLabels).map(([value, label]) => ({ value, label }))} /></Form.Item>
      <Button htmlType="submit" type="primary" loading={busy}>添加</Button>
    </Form>
    <Table rowKey="id" dataSource={members} columns={[
      { title: '用户名', render: (_, member) => member.user.username },
      { title: '状态', render: (_, member) => member.user.active ? '有效' : '已停用' },
      { title: '预设项目角色', render: (_, member) => <Select aria-label={`${member.user.username}的项目角色`} value={member.role} style={{ width: 160 }} options={Object.entries(projectRoleLabels).map(([value, label]) => ({ value, label }))} onChange={role => void changeRole(member.userId, role)} /> },
      { title: '操作', render: (_, member) => <Popconfirm title="移除成员将清空其本项目任务指派；项目须保留有效经理，确认？" onConfirm={() => remove(member.userId)}><Button danger>移除</Button></Popconfirm> },
    ]} />
  </>;
}
