import { Button, Form, Input, Modal, Select, Space, Table, Typography } from 'antd';
import { useEffect, useState } from 'react';
import type { Project, ProjectMember, Task } from '@spm/shared';
import { api } from './api';
export function Tasks({ project, revision, onError }: { project: Project; revision: number; onError: (error: unknown) => void }) {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [members, setMembers] = useState<ProjectMember[]>([]);
  const [editing, setEditing] = useState<Task | 'new' | null>(null);
  const [saving, setSaving] = useState(false);
  const [form] = Form.useForm();
  const path = `/projects/${project.id}`;
  async function reload() {
    try {
      const [nextTasks, nextMembers] = await Promise.all([api<Task[]>(path + '/tasks'), api<ProjectMember[]>(path + '/members')]);
      setTasks(nextTasks); setMembers(nextMembers.filter(member => member.user.active));
    } catch (error) { onError(error); }
  }
  useEffect(() => { void reload(); }, [project.id, revision]);
  const options = members.map(member => ({ value: member.userId, label: member.user.username }));
  function edit(task: Task | 'new') {
    setEditing(task); form.resetFields();
    form.setFieldsValue(task === 'new' ? {} : { assigneeUserId: task.assigneeUserId });
  }
  async function save() {
    let values: { title?: string; description?: string; assigneeUserId?: number | null };
    try { values = await form.validateFields(); } catch { return; }
    values.assigneeUserId ??= null;
    setSaving(true);
    try {
      await api(editing === 'new' ? path + '/tasks' : path + `/tasks/${(editing as Task).id}/assignee`, editing === 'new' ? 'POST' : 'PATCH', values);
      setEditing(null); await reload();
    } catch (error) { onError(error); } finally { setSaving(false); }
  }
  return <><Space className="section-heading"><Typography.Title level={3}>任务负责人</Typography.Title><Button type="primary" onClick={() => edit('new')}>创建任务</Button><Button onClick={() => void reload()}>刷新</Button></Space>
    <Table rowKey="id" dataSource={tasks} columns={[
      { title: '任务标题', dataIndex: 'title' },
      { title: '负责人', render: (_, task) => members.find(member => member.userId === task.assigneeUserId)?.user.username || '未指派' },
      { title: '操作', render: (_, task) => <Button onClick={() => edit(task)}>指定负责人</Button> },
    ]} />
    <Modal title={editing === 'new' ? '创建任务' : `指定负责人 · ${(editing as Task | null)?.title || ''}`} open={editing !== null} onCancel={() => setEditing(null)} onOk={() => void save()} confirmLoading={saving} destroyOnHidden>
      <Form form={form} layout="vertical">
        {editing === 'new' && <><Form.Item name="title" label="任务标题" rules={[{ required: true, whitespace: true }, { max: 200 }]}><Input /></Form.Item><Form.Item name="description" label="任务说明" rules={[{ max: 10000 }]}><Input.TextArea rows={3} /></Form.Item></>}
        <Form.Item name="assigneeUserId" label="负责人"><Select allowClear placeholder="留空则暂不指派" options={options} /></Form.Item>
      </Form>
    </Modal></>;
}
