import { Alert, Button, Card, Form, Input, Typography } from 'antd';
import { useState } from 'react';
import type { User } from '@spm/shared';
import { api } from './api';
export function Login({ onLogin }: { onLogin: (user: User) => void }) {
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function submit(values: { username: string; password: string }) {
    setError(''); setBusy(true);
    try { onLogin(await api<User>('/auth/login', 'POST', values)); }
    catch (error) { setError((error as Error).message); }
    finally { setBusy(false); }
  }
  return <div className="login"><section className="login-story">
    <div className="brand"><span className="brand-mark" aria-hidden="true">爱</span><span>爱管理<small>团队项目协作空间</small></span></div>
    <div className="login-intro"><span className="eyebrow">从计划到协作</span><h1>项目有条理，<br />协作更从容。</h1><p>将项目、成员、需求与任务放在一起，<br />让团队的每一步都有清晰的方向。</p></div>
    <div className="collaboration-art" aria-hidden="true"><div className="art-orbit" /><div className="art-card"><span className="art-label">团队协作</span><strong>连接每一份工作</strong><div className="art-line" /><div className="art-line short" /><div className="art-people"><span>项</span><span>需</span><span>任</span><small>共同推进项目</small></div></div><div className="art-note"><span>✓</span>清晰分工 · 有序协作</div></div>
    <p className="login-footnote">爱管理 · 项目协作工作台</p>
  </section><section className="login-form-area"><Card><span className="eyebrow">欢迎回来</span><Typography.Title level={2}>登录爱管理</Typography.Title><Typography.Paragraph>使用你的账户，进入团队协作空间。</Typography.Paragraph>
    {error && <Alert type="error" title={error} role="alert" />}
    <Form layout="vertical" onFinish={submit}>
      <Form.Item label="用户名" name="username" rules={[{ required: true, message: '请输入用户名' }]}><Input autoComplete="username" /></Form.Item>
      <Form.Item label="密码" name="password" rules={[{ required: true, message: '请输入密码' }]}><Input.Password autoComplete="current-password" /></Form.Item>
      <Button type="primary" htmlType="submit" loading={busy} block>登录</Button>
    </Form><p className="login-help">需要账户？请联系系统管理员。</p></Card></section></div>;
}
