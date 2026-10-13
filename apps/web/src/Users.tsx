import { Button, Form, Input, Modal, Popconfirm, Space, Switch, Table, Tag, Typography } from 'antd';
import { useEffect, useState } from 'react';
import { roleLabels, type Role, type User } from '@spm/shared';
import { api } from './api';
export function Users({ onError, onChanged }: { onError: (error: unknown) => void; onChanged: () => Promise<void> }) {
  const [users, setUsers] = useState<User[]>([]);
  const [editing, setEditing] = useState<User | 'new' | null>(null);
  const [saving, setSaving] = useState(false);
  const [form] = Form.useForm();
  const reload = () => api<User[]>('/users').then(setUsers).catch(onError);
  useEffect(() => { void reload(); }, []);
  function edit(user: User | 'new') { setEditing(user); form.resetFields(); form.setFieldsValue(user === 'new' ? { active: true } : { username: user.username, active: user.active }); }
  async function save() {
    let values: { username: string; password?: string; active?: boolean };
    try { values = await form.validateFields(); } catch { return; }
    if (!values.password) delete values.password;
    if (editing === 'new') delete values.active;
    setSaving(true);
    try {
      await api(editing === 'new' ? '/users' : `/users/${(editing as User).id}`, editing === 'new' ? 'POST' : 'PATCH', values);
      setEditing(null); await reload(); await onChanged();
    } catch (error) { onError(error); } finally { setSaving(false); }
  }
  async function remove(id: number) { try { await api(`/users/${id}`, 'DELETE'); await reload(); } catch (error) { onError(error); } }
  return <><Space className="section-heading"><Typography.Title level={2}>系统用户账户</Typography.Title><Button type="primary" onClick={() => edit('new')}>创建用户</Button></Space>
    <Table rowKey="id" dataSource={users} columns={[
      { title: '用户名', dataIndex: 'username' }, { title: '全局身份', dataIndex: 'role', render: (role: Role) => roleLabels[role] },
      { title: '状态', dataIndex: 'active', render: (active: boolean) => <Tag color={active ? 'green' : 'default'}>{active ? '有效' : '停用'}</Tag> },
      { title: '操作', render: (_, user) => <Space><Button onClick={() => edit(user)}>维护账户</Button><Popconfirm title="确认删除用户？" onConfirm={() => remove(user.id)}><Button danger>删除</Button></Popconfirm></Space> },
    ]} />
    <Modal title={editing === 'new' ? '创建用户' : '维护用户账户'} open={editing !== null} onCancel={() => setEditing(null)} onOk={() => void save()} confirmLoading={saving} destroyOnHidden>
      <Form form={form} layout="vertical">
        <Form.Item label="用户名" name="username" rules={[{ required: true }, { pattern: /^[a-zA-Z0-9_.-]+$/, message: '使用字母、数字、下划线、点或短横线' }, { max: 80 }]}><Input /></Form.Item>
        <Form.Item label={editing === 'new' ? '密码' : '新密码（留空保留原密码）'} name="password" rules={[{ required: editing === 'new' }, { min: 12, max: 128 }]}><Input.Password autoComplete="new-password" /></Form.Item>
        {editing !== 'new' && <Form.Item label="有效账户" name="active" valuePropName="checked"><Switch /></Form.Item>}
      </Form>
    </Modal></>;
}
