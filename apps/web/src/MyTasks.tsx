import { Button, Modal, Space, Table, Typography } from 'antd';
import { useEffect, useState } from 'react';
import type { Project, Task } from '@spm/shared';
import { api } from './api';

export function MyTasks({ project, onError }: { project: Project; onError: (error: unknown) => void }) {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [viewing, setViewing] = useState<Task | null>(null);
  const path = `/projects/${project.id}/tasks/mine`;
  const reload = () => api<Task[]>(path).then(setTasks).catch(onError);
  useEffect(() => { void reload(); }, [project.id]);
  async function detail(id: number) {
    try { setViewing(await api<Task>(`${path}/${id}`)); } catch (error) { onError(error); }
  }
  return <><Space className="section-heading"><Typography.Title level={3}>我的任务</Typography.Title><Button onClick={() => void reload()}>刷新我的任务</Button></Space>
    <Table rowKey="id" dataSource={tasks} columns={[
      { title: '任务标题', dataIndex: 'title' },
      { title: '初始状态', render: () => '待办' },
      { title: '操作', render: (_, task) => <Button onClick={() => void detail(task.id)}>查看任务</Button> },
    ]} />
    <Modal title={viewing?.title || '个人任务详情'} open={viewing !== null} onCancel={() => setViewing(null)} footer={<Button onClick={() => setViewing(null)}>关闭</Button>}>
      <Typography.Paragraph style={{ whiteSpace: 'pre-wrap' }}>{viewing?.description || '暂无说明'}</Typography.Paragraph>
    </Modal>
  </>;
}
