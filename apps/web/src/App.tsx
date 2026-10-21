import { Alert, Button, Card, Layout, Menu, Space, Spin, Tabs, Tag, Typography } from 'antd';
import { useEffect, useRef, useState } from 'react';
import { projectRoleLabels, roleLabels, type Project, type User } from '@spm/shared';
import { api, RequestError } from './api';
import { Login } from './Login';
import { Users } from './Users';
import { Members, ProjectList } from './Projects';
import { Tasks } from './Tasks';
import { Requirements } from './Requirements';
import { MyTasks } from './MyTasks';

export function App() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [view, setView] = useState<'projects' | 'users'>('projects');
  const [project, setProject] = useState<Project | null>(null);
  const [revision, setRevision] = useState(0);
  const [collapsed, setCollapsed] = useState(false);
  const [projectTab, setProjectTab] = useState('requirements');
  const requestVersion = useRef(0);
  function resetContext() { requestVersion.current++; setProject(null); setView('projects'); setProjectTab('requirements'); }
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
    setError(''); setProject(null); setProjectTab('requirements');
    try { const selected = await api<Project>(`/projects/${id}`); if (version === requestVersion.current) setProject(selected); }
    catch (error) { if (version === requestVersion.current) onError(error); }
  }
  async function refreshProject(id: number) {
    const version = ++requestVersion.current;
    try {
      const selected = await api<Project>(`/projects/${id}`);
      if (version === requestVersion.current) setProject(selected);
    } catch (error) { if (version === requestVersion.current) onError(error); }
  }
  async function logout() {
    try { await api('/auth/logout', 'POST'); setUser(null); setError(''); resetContext(); }
    catch (error) { onError(error); }
  }
  if (loading) return <div className="loading"><Spin description="正在连接爱管理" /></div>;
  if (!user) return <><Login onLogin={next => { setUser(next); setError(''); resetContext(); }} />{error && <Alert type="error" title={error} />}</>;
  return <Layout className="app-shell"><Layout.Header className="header"><div className="brand"><span className="brand-mark" aria-hidden="true">爱</span><span>爱管理<small>项目协作工作台</small></span></div>
    <nav className="main-nav" aria-label="主导航"><Button type="text" className={view === 'projects' ? 'nav-active' : ''} onClick={() => { resetContext(); setError(''); }}>我的项目 / 切换项目</Button>
    {user.role === 'ADMIN' && <Button type="text" className={view === 'users' ? 'nav-active' : ''} onClick={() => { resetContext(); setView('users'); setError(''); }}>用户管理</Button>}</nav>
    <Space className="account-menu" wrap><span className="user-avatar" aria-hidden="true">{user.username.slice(0, 1).toUpperCase()}</span><div className="account-info"><strong>{user.username}</strong><span>{roleLabels[user.role]}</span></div><Button type="text" onClick={() => void logout()}>退出</Button></Space>
  </Layout.Header><Layout className="workspace-layout">
  <Layout.Sider theme="light" className="workspace-sidebar" width={224} collapsedWidth={64} collapsed={collapsed} trigger={null}>
    <Button type="text" className="sidebar-toggle" aria-label={collapsed ? '展开导航' : '折叠导航'} onClick={() => setCollapsed(value => !value)}>{collapsed ? '☰' : '☰　项目导航'}</Button>
    <Menu mode="inline" selectedKeys={[project ? projectTab : view]} onClick={({ key }) => { if (key === 'projects') { resetContext(); setError(''); } else if (key === 'users') { resetContext(); setView('users'); } else setProjectTab(key); }} items={[
      { key: 'projects', icon: <span aria-hidden>◫</span>, label: '我的项目' },
      ...(project ? [
        { key: 'requirements', icon: <span aria-hidden>▤</span>, label: '正式需求' },
        ...(project.canViewOwnTasks ? [{ key: 'mine', icon: <span aria-hidden>✓</span>, label: '我的任务' }] : []),
        ...(project.canManage ? [{ key: 'members', icon: <span aria-hidden>♙</span>, label: '成员与项目角色' }, { key: 'tasks', icon: <span aria-hidden>☷</span>, label: '任务创建与指派' }] : []),
      ] : []),
      ...(user.role === 'ADMIN' ? [{ key: 'users', icon: <span aria-hidden>♙</span>, label: '用户管理' }] : []),
    ]} />
  </Layout.Sider><Layout.Content className="content">
    {error && <Alert type="error" title={error} closable onClose={() => setError('')} />}
    {view === 'users' ? <div className="workspace-panel"><Users onError={onError} onChanged={refreshUser} /></div> : project ? <>
      <Button className="back-button" type="text" onClick={resetContext}>返回项目列表</Button><Card className="project-detail"><span className="eyebrow">项目空间</span><Typography.Title level={2}>{project.name}</Typography.Title><p className="project-description">{project.description || '暂无说明'}</p><Space wrap><span className="project-manager">项目经理：{project.manager.username}</span><Tag color="cyan">{projectRoleLabels[project.projectRole]}</Tag></Space></Card>
      <Tabs activeKey={projectTab} onChange={setProjectTab} className="workspace-panel project-tabs" items={[
        { key: 'requirements', label: '正式需求', children: <Requirements project={project} onError={onError} /> },
        ...(project.canViewOwnTasks ? [{ key: 'mine', label: '我的任务', children: <MyTasks project={project} onError={onError} /> }] : []),
        ...(project.canManage ? [
        { key: 'members', label: '成员与项目角色', children: <Members project={project} onError={onError} onChanged={() => { setRevision(value => value + 1); void refreshProject(project.id); }} /> },
        { key: 'tasks', label: '任务创建与指派', children: <Tasks project={project} revision={revision} onError={onError} /> },
        ] : []),
      ]} />
    </> : <ProjectList key={user.role} user={user} onSelect={id => void selectProject(id)} onError={onError} />}
  </Layout.Content></Layout></Layout>;
}
