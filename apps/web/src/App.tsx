import { Alert, Button, Card, Layout, Space, Spin, Tabs, Tag, Typography } from 'antd';
import { useEffect, useRef, useState } from 'react';
import { roleLabels, type Project, type User } from '@spm/shared';
import { api, RequestError } from './api';
import { Login } from './Login';
import { Users } from './Users';
import { Members, ProjectList } from './Projects';
import { Tasks } from './Tasks';

export function App() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [view, setView] = useState<'projects' | 'users'>('projects');
  const [project, setProject] = useState<Project | null>(null);
  const [revision, setRevision] = useState(0);
  const requestVersion = useRef(0);
  function resetContext() { requestVersion.current++; setProject(null); setView('projects'); }
  function onError(error: unknown) {
    setError((error as Error).message || '请求失败');
    if (error instanceof RequestError && error.status === 401) { setUser(null); resetContext(); }
    if (error instanceof RequestError && [403, 404].includes(error.status)) resetContext();
  }
  async function refreshUser() {
    try {
      const next = await api<User>('/auth/me'); setUser(next);
      if (next.role !== 'ADMIN') resetContext();
    } catch (error) { onError(error); }
  }
  useEffect(() => { api<User>('/auth/me').then(setUser).catch(error => {
    if (!(error instanceof RequestError && error.status === 401)) setError((error as Error).message);
  }).finally(() => setLoading(false)); }, []);
  async function selectProject(id: number) {
    const version = ++requestVersion.current;
    setError(''); setProject(null);
    try { const selected = await api<Project>(`/projects/${id}`); if (version === requestVersion.current) setProject(selected); }
    catch (error) { if (version === requestVersion.current) onError(error); }
  }
  async function logout() {
    try { await api('/auth/logout', 'POST'); setUser(null); setError(''); resetContext(); }
    catch (error) { onError(error); }
  }
  if (loading) return <div className="loading"><Spin description="正在连接爱管理" /></div>;
  if (!user) return <><Login onLogin={next => { setUser(next); setError(''); resetContext(); }} />{error && <Alert type="error" title={error} />}</>;
  return <Layout className="app-shell"><Layout.Header className="header"><Typography.Title level={3}>爱管理</Typography.Title><Space wrap>
    <span>{user.username}</span><Tag>{roleLabels[user.role]}</Tag><Button onClick={() => { resetContext(); setError(''); }}>我的项目 / 切换项目</Button>
    {user.role === 'ADMIN' && <Button onClick={() => { resetContext(); setView('users'); setError(''); }}>用户管理</Button>}
    <Button onClick={() => void logout()}>退出</Button>
  </Space></Layout.Header><Layout.Content className="content">
    {error && <Alert type="error" title={error} closable onClose={() => setError('')} />}
    {view === 'users' ? <Users onError={onError} onChanged={refreshUser} /> : project ? <>
      <Button onClick={resetContext}>返回项目列表</Button><Card className="project-detail"><Typography.Title level={2}>{project.name}</Typography.Title><p>{project.description || '暂无说明'}</p><p>项目经理：{project.manager.username}</p></Card>
      {project.canManage && <Tabs items={[
        { key: 'members', label: '成员管理', children: <Members project={project} onError={onError} onChanged={() => setRevision(value => value + 1)} /> },
        { key: 'tasks', label: '任务创建与指派', children: <Tasks project={project} revision={revision} onError={onError} /> },
      ]} />}
    </> : <ProjectList key={user.role} user={user} onSelect={id => void selectProject(id)} onError={onError} />}
  </Layout.Content></Layout>;
}
