// Run against the live Vite proxy + NestJS server after seeding local demo users.
import { createRequire } from 'node:module';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
const require = createRequire(new URL('../apps/api/package.json', import.meta.url));
require('dotenv').config({ path: fileURLToPath(new URL('../.env', import.meta.url)), quiet: true });
const origin = process.env.WEB_ORIGIN || 'http://127.0.0.1:5173';
const cookies = {};
async function call(path, status, who, method = 'GET', data) {
  const headers = { 'Content-Type': 'application/json', 'X-SPM-Request': '1', Origin: origin };
  if (who) headers.Cookie = cookies[who];
  const response = await fetch(origin + '/api' + path, { method, headers, ...(data !== undefined ? { body: JSON.stringify(data) } : {}) });
  const body = await response.json();
  if (response.status !== status) throw new Error(`${method} ${path}: expected ${status}, got ${response.status} ${JSON.stringify(body)}`);
  console.log(`${method} ${path}: ${response.status}`);
  return { body, response };
}
async function login(username) {
  const { response } = await call('/auth/login', 201, undefined, 'POST', { username, password: process.env.SEED_PASSWORD });
  cookies[username] = response.headers.getSetCookie()[0].split(';')[0];
}
function ensure(condition, message) { if (!condition) throw new Error(message); }
let ready = false;
for (let attempt = 0; attempt < 40; attempt++) {
  try {
    const response = await fetch(origin + '/api/health');
    if (response.ok && (await response.json()).ok === true) { ready = true; break; }
  } catch { /* Wait for both Vite and NestJS startup. */ }
  await new Promise(resolve => setTimeout(resolve, 250));
}
ensure(ready, 'Vite proxy/API readiness check timed out');
await call('/health', 200);
await call('/projects', 401);
await call('/auth/login', 401, undefined, 'POST', { username: 'admin', password: 'wrong' });
for (const username of ['admin', 'manager', 'manager_b', 'member', 'tester']) await login(username);
const users = (await call('/users', 200, 'admin')).body;
const member = users.find(user => user.username === 'member');
const other = users.find(user => user.username === 'manager_b');
const tester = users.find(user => user.username === 'tester');
await call(`/users/${member.id}`, 400, 'admin', 'PATCH', { role: 'MANAGER' });
const suffix = randomBytes(4).toString('hex');
const project = (await call('/projects', 201, 'manager', 'POST', { name: `演示项目 A ${suffix}` })).body;
const second = (await call('/projects', 201, 'manager_b', 'POST', { name: `演示项目 B ${suffix}` })).body;
await call(`/projects/${project.id}`, 404, 'admin');
await call(`/projects/${project.id}/members`, 201, 'manager', 'POST', { userId: member.id, role: 'DEVELOPER' });
await call(`/projects/${project.id}/members`, 201, 'manager', 'POST', { userId: tester.id, role: 'TESTER' });
const requirement = (await call(`/projects/${project.id}/requirements`, 201, 'manager', 'POST', { title: '演示正式需求', description: 'V2 项目业务目标' })).body;
await call(`/projects/${project.id}/requirements`, 200, 'member');
await call(`/projects/${project.id}/requirements/${requirement.id}`, 200, 'tester');
await call(`/projects/${second.id}/requirements/${requirement.id}`, 404, 'manager_b');
await call(`/projects/${project.id}/requirements/${requirement.id}`, 403, 'member', 'PATCH', { title: '无权修改' });
await call(`/projects/${project.id}/members/${member.id}/role`, 200, 'manager', 'PATCH', { role: 'MANAGER' });
await call(`/projects/${project.id}/requirements/${requirement.id}`, 200, 'member', 'PATCH', { description: '经明确项目经理授权编辑的正式需求' });
await call(`/projects/${project.id}/members/${member.id}/role`, 200, 'manager', 'PATCH', { role: 'DEVELOPER' });
await call(`/projects/${project.id}/requirements/${requirement.id}`, 403, 'member', 'PATCH', { title: '撤权后拒绝' });
const task = (await call(`/projects/${project.id}/tasks`, 201, 'manager', 'POST', { title: '演示任务：检查负责人指派' })).body;
ensure(task.status === 'TODO', 'Task not initialized as TODO');
await call(`/projects/${project.id}/tasks/${task.id}/assignee`, 200, 'manager', 'PATCH', { assigneeUserId: member.id });
const testerTask = (await call(`/projects/${project.id}/tasks`, 201, 'manager', 'POST', { title: '测试人员的个人任务', assigneeUserId: tester.id })).body;
const personal = (await call(`/projects/${project.id}/tasks/mine`, 200, 'member')).body;
ensure(personal.some(item => item.id === task.id) && !personal.some(item => item.id === testerTask.id), 'Personal task privacy failed');
await call(`/projects/${project.id}/tasks/mine/${testerTask.id}`, 404, 'member');
await call(`/projects/${project.id}/tasks/mine/${testerTask.id}`, 200, 'tester');
await call(`/projects/${project.id}/tasks/${task.id}/assignee`, 400, 'manager', 'PATCH', { assigneeUserId: other.id });
await call(`/projects/${second.id}/tasks/${task.id}/assignee`, 404, 'manager_b', 'PATCH', { assigneeUserId: other.id });
const list = (await call('/projects', 200, 'member')).body;
ensure(list.some(item => item.id === project.id) && !list.some(item => item.id === second.id), 'Project isolation failed');
await call(`/projects/${second.id}`, 404, 'member');
await call(`/projects/${project.id}/members`, 403, 'member');
await call('/users', 403, 'member');
await call(`/projects/${project.id}/members/${member.id}`, 200, 'manager', 'DELETE');
await call(`/projects/${project.id}`, 404, 'member');
const tasks = (await call(`/projects/${project.id}/tasks`, 200, 'manager')).body;
ensure(tasks.find(item => item.id === task.id).assigneeUserId === null, 'Removed member assignment not cleared');
// Restore an illustrative valid membership and assignment for manual review.
await call(`/projects/${project.id}/members`, 201, 'manager', 'POST', { userId: member.id });
await call(`/projects/${project.id}/tasks/${task.id}/assignee`, 200, 'manager', 'PATCH', { assigneeUserId: member.id });
await call('/auth/logout', 201, 'member', 'POST');
await call('/auth/me', 401, 'member');
console.log(`V2 Sprint 1 live HTTP via Vite proxy: PASS. Demo projects ${project.id}/${second.id}; requirement ${requirement.id}.`);
