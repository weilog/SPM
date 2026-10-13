import { Button, Form, Input, Modal, Space, Table, Typography } from 'antd';
import { useEffect, useState } from 'react';
import type { Project, Requirement } from '@spm/shared';
import { api } from './api';

export function Requirements({ project, onError }: { project: Project; onError: (error: unknown) => void }) {
  const [requirements, setRequirements] = useState<Requirement[]>([]);
  const [viewing, setViewing] = useState<Requirement | null>(null);
  const [editing, setEditing] = useState<Requirement | 'new' | null>(null);
  const [saving, setSaving] = useState(false);
  const [form] = Form.useForm();
  const path = `/projects/${project.id}/requirements`;
  const reload = () => api<Requirement[]>(path).then(setRequirements).catch(onError);
  useEffect(() => { void reload(); }, [project.id]);
  async function detail(id: number) {
    try { setViewing(await api<Requirement>(`${path}/${id}`)); } catch (error) { onError(error); }
  }
  function edit(requirement: Requirement | 'new') {
    setViewing(null); setEditing(requirement); form.resetFields();
    if (requirement !== 'new') form.setFieldsValue({ title: requirement.title, description: requirement.description });
  }
  async function save() {
    let values: { title: string; description?: string };
    try { values = await form.validateFields(); } catch { return; }
    setSaving(true);
    try {
      await api(editing === 'new' ? path : `${path}/${(editing as Requirement).id}`, editing === 'new' ? 'POST' : 'PATCH', values);
      setEditing(null); await reload();
    } catch (error) { onError(error); } finally { setSaving(false); }
  }
  return <><Space className="section-heading"><Typography.Title level={3}>正式项目需求</Typography.Title>
    {project.canManage && <Button type="primary" onClick={() => edit('new')}>创建正式需求</Button>}
    <Button onClick={() => void reload()}>刷新需求</Button></Space>
    <Table rowKey="id" dataSource={requirements} columns={[
      { title: '需求标题', dataIndex: 'title' },
      { title: '操作', render: (_, requirement) => <Space><Button onClick={() => void detail(requirement.id)}>查看详情</Button>{project.canManage && <Button onClick={() => edit(requirement)}>编辑需求</Button>}</Space> },
    ]} />
    <Modal title={viewing?.title || '正式需求详情'} open={viewing !== null} onCancel={() => setViewing(null)} footer={<Button onClick={() => setViewing(null)}>关闭</Button>}>
      <Typography.Paragraph style={{ whiteSpace: 'pre-wrap' }}>{viewing?.description || '暂无说明'}</Typography.Paragraph>
    </Modal>
    <Modal title={editing === 'new' ? '创建正式需求' : '编辑正式需求'} open={editing !== null} onCancel={() => setEditing(null)} onOk={() => void save()} confirmLoading={saving} destroyOnHidden>
      <Form form={form} layout="vertical">
        <Form.Item name="title" label="需求标题" rules={[{ required: true, whitespace: true }, { max: 200 }]}><Input /></Form.Item>
        <Form.Item name="description" label="需求说明" rules={[{ max: 10000 }]}><Input.TextArea rows={5} /></Form.Item>
      </Form>
    </Modal>
  </>;
}
