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
  return <div className="login"><Card><Typography.Title level={2}>登录爱管理</Typography.Title><Typography.Paragraph>项目与成员，清晰协作。</Typography.Paragraph>
    {error && <Alert type="error" title={error} role="alert" />}
    <Form layout="vertical" onFinish={submit}>
      <Form.Item label="用户名" name="username" rules={[{ required: true, message: '请输入用户名' }]}><Input autoComplete="username" /></Form.Item>
      <Form.Item label="密码" name="password" rules={[{ required: true, message: '请输入密码' }]}><Input.Password autoComplete="current-password" /></Form.Item>
      <Button type="primary" htmlType="submit" loading={busy} block>登录</Button>
    </Form></Card></div>;
}
