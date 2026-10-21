import { Alert, Button, Drawer, Form, Input, InputNumber, Modal, Select, Space, Spin, Table, Tabs, Typography } from 'antd';
import { useEffect, useRef, useState } from 'react';
import { storyStatusLabels, type Epic, type LinkedRequirement, type ProductGoal, type Project, type StoryMapData, type StoryStatus, type UserStory } from '@spm/shared';
import { api } from './api';
import { requirementNumber, StoryBoard, StoryMap, storyNumber, StoryStatusTag } from './StoryViews';

const empty: StoryMapData = { goals: [], epics: [], stories: [] };
type Editor = { kind: 'requirement'; item?: LinkedRequirement } | { kind: 'story'; item?: UserStory; epicId?: number } | { kind: 'goal'; item?: ProductGoal } | { kind: 'epic'; item?: Epic; goalId?: number };
type Values = { title: string; description?: string; acceptanceCriteria?: string; storyIds?: number[]; requirementIds?: number[]; epicId?: number; goalId?: number; sortOrder?: number };

// Keyed context prevents stale drawers, filters and responses from crossing projects.
export function Requirements(props: { project: Project; onError: (error: unknown) => void }) { return <RequirementWorkspace key={props.project.id} {...props} />; }
function RequirementWorkspace({ project, onError }: { project: Project; onError: (error: unknown) => void }) {
  const [requirements, setRequirements] = useState<LinkedRequirement[]>([]);
  const [data, setData] = useState<StoryMapData>(empty);
  const [tab, setTab] = useState('list');
  const [search, setSearch] = useState('');
  const [epic, setEpic] = useState<number | undefined>();
  const [viewing, setViewing] = useState<{ kind: 'requirement' | 'story'; id: number } | null>(null);
  const [editor, setEditor] = useState<Editor | null>(null);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [failure, setFailure] = useState('');
  const [form] = Form.useForm<Values>();
  const alive = useRef(true);
  const busy = useRef(false);
  const readVersion = useRef(0);
  const path = `/projects/${project.id}`;
  async function reload() {
    const version = ++readVersion.current;
    const [nextRequirements, snapshot] = await Promise.all([api<LinkedRequirement[]>(`${path}/requirements`), api<StoryMapData>(`${path}/story-map`)]);
    if (alive.current && version === readVersion.current) { setRequirements(nextRequirements); setData(snapshot); }
  }
  function report(error: unknown) {
    if (!alive.current) return;
    setFailure((error as Error).message || '请求失败，请重试'); onError(error);
  }
  useEffect(() => {
    alive.current = true;
    void reload().catch(report).finally(() => { if (alive.current) setLoading(false); });
    return () => { alive.current = false; readVersion.current++; };
  }, []);
  useEffect(() => {
    const refresh = () => { if (!busy.current) void reload().catch(report); };
    window.addEventListener('focus', refresh);
    return () => window.removeEventListener('focus', refresh);
  }, []);
  const readOnly = !project.canManage;
  const story = viewing?.kind === 'story' ? data.stories.find(s => s.id === viewing.id) : undefined;
  const requirement = viewing?.kind === 'requirement' ? requirements.find(r => r.id === viewing.id) : undefined;
  function edit(next: Editor) {
    if (readOnly || busy.current) return;
    setEditor(next); form.resetFields();
    form.setFieldsValue(next.item ? { ...next.item } : { title: '', ...('epicId' in next ? { epicId: next.epicId } : {}), ...('goalId' in next ? { goalId: next.goalId } : {}) });
  }
  async function openRequirement(id: number) {
    try {
      const result = await api<LinkedRequirement>(`${path}/requirements/${id}`);
      if (alive.current) { setRequirements(current => current.map(r => r.id === id ? result : r)); setViewing({ kind: 'requirement', id }); }
    } catch (error) { report(error); }
  }
  async function mutate(action: () => Promise<unknown>, optimistic?: () => void) {
    if (readOnly || busy.current) return false;
    busy.current = true; setSaving(true); setFailure(''); readVersion.current++;
    const previous = data;
    optimistic?.();
    try {
      await action();
      if (alive.current) {
        try { await reload(); }
        catch (error) { report(new Error(`保存成功，但刷新失败，请刷新后继续：${(error as Error).message}`)); }
      }
      return true;
    }
    catch (error) { if (alive.current) { setData(previous); report(error); } return false; }
    finally { busy.current = false; if (alive.current) setSaving(false); }
  }
  async function status(id: number, next: StoryStatus) {
    const current = data.stories.find(s => s.id === id);
    if (!current || current.status === next) return;
    await mutate(() => api(`${path}/stories/${id}/status`, 'PATCH', { revision: current.revision, status: next }), () => setData({ ...data, stories: data.stories.map(s => s.id === id ? { ...s, status: next } : s) }));
  }
  async function move(id: number, epicId: number, position: number) {
    const current = data.stories.find(s => s.id === id);
    if (!current || position < 0) return;
    await mutate(() => api(`${path}/stories/${id}/move`, 'PATCH', { revision: current.revision, epicId, position }));
  }
  async function save() {
    if (!editor || readOnly || busy.current) return;
    let values: Values;
    try { values = await form.validateFields(); } catch { return; }
    const { kind, item } = editor;
    const resource = kind === 'requirement' ? 'requirements' : kind === 'story' ? 'stories' : kind === 'goal' ? 'goals' : 'epics';
    let body: object;
    if (kind === 'requirement') body = { title: values.title, description: values.description, ...(values.storyIds !== undefined ? { storyIds: values.storyIds } : {}) };
    else if (kind === 'story') body = { title: values.title, description: values.description, acceptanceCriteria: values.acceptanceCriteria, requirementIds: values.requirementIds ?? [], ...(item ? { revision: item.revision } : { epicId: values.epicId }) };
    else body = { title: values.title, ...(item ? { revision: item.revision, sortOrder: values.sortOrder } : kind === 'epic' ? { goalId: values.goalId } : {}) };
    const ok = await mutate(() => api(`${path}/${resource}${item ? `/${item.id}` : ''}`, item ? 'PATCH' : 'POST', body));
    if (ok && alive.current) setEditor(null);
  }
  const query = search.trim().toLocaleLowerCase();
  const filteredStories = data.stories.filter(s => (!epic || s.epicId === epic) && `${storyNumber(s.id)} ${s.title}`.toLocaleLowerCase().includes(query));
  const common = { data, readOnly, busy: saving, onOpen: (s: UserStory) => setViewing({ kind: 'story' as const, id: s.id }) };
  const title = editor?.kind === 'requirement' ? '正式需求' : editor?.kind === 'story' ? '用户故事' : editor?.kind === 'goal' ? '产品目标' : 'Epic';
  return <div className="requirements-workspace">
    <Space className="section-heading"><div><Typography.Title level={3}>正式项目需求</Typography.Title><p className="section-subtitle">梳理需求、组织故事，跟进交付状态</p></div>
      {!readOnly && <Button type="primary" disabled={saving} onClick={() => edit({ kind: 'requirement' })}>创建正式需求</Button>}
      <Button disabled={saving} onClick={() => void reload().then(() => setFailure('')).catch(report)}>刷新需求</Button></Space>
    {failure && <Alert type="error" title={failure} description="请刷新后重试。" closable onClose={() => setFailure('')} />}
    {readOnly && <Typography.Paragraph type="secondary">当前为只读模式，项目经理可维护需求和用户故事。</Typography.Paragraph>}
    <Spin spinning={loading}>
      <Tabs activeKey={tab} onChange={next => { setTab(next); setSearch(''); setEpic(undefined); }} items={[{ key: 'list', label: '需求列表' }, { key: 'map', label: '故事地图' }, { key: 'board', label: '故事看板' }]} />
      {tab !== 'map' && <Space wrap className="story-filters"><Input aria-label={tab === 'list' ? '搜索需求' : '搜索故事'} placeholder={tab === 'list' ? '搜索需求编号、标题' : '搜索故事编号、标题'} value={search} allowClear onChange={event => setSearch(event.target.value)} />
        {tab === 'board' && <Select aria-label="筛选 Epic" placeholder="全部 Epic" allowClear value={epic} onChange={setEpic} style={{ minWidth: 200 }} options={data.epics.map(e => ({ value: e.id, label: e.title }))} />}</Space>}
      {tab === 'list' ? <Table rowKey="id" dataSource={requirements.filter(r => `${requirementNumber(r.id)} ${r.title}`.toLocaleLowerCase().includes(query))} columns={[
        { title: '编号', render: (_, r) => requirementNumber(r.id), width: 120 }, { title: '需求标题', dataIndex: 'title' },
        { title: '关联故事', render: (_, r) => (r.storyIds ?? []).length },
        { title: '操作', render: (_, r) => <Space><Button onClick={() => void openRequirement(r.id)}>查看详情</Button>{!readOnly && <Button disabled={saving} onClick={() => edit({ kind: 'requirement', item: r })}>编辑需求</Button>}</Space> },
      ]} /> : tab === 'map' ? <StoryMap {...common} onMove={(...args) => void move(...args)} onNewGoal={() => edit({ kind: 'goal' })} onEditGoal={item => edit({ kind: 'goal', item })} onNewEpic={goal => edit({ kind: 'epic', goalId: goal.id })} onEditEpic={item => edit({ kind: 'epic', item })} onNewStory={e => edit({ kind: 'story', epicId: e.id })} />
        : <StoryBoard {...common} stories={filteredStories} onStatus={(...args) => void status(...args)} />}
    </Spin>
    <Drawer title={story ? `${storyNumber(story.id)} · ${story.title}` : requirement ? `${requirementNumber(requirement.id)} · ${requirement.title}` : '详情'} open={viewing !== null} onClose={() => setViewing(null)} size={480}>
      {story && <><Typography.Title level={5}>所属 Epic</Typography.Title><p>{data.epics.find(e => e.id === story.epicId)?.title}</p><Typography.Title level={5}>故事状态</Typography.Title>
        {readOnly ? <StoryStatusTag status={story.status} /> : <Select aria-label="故事状态" disabled={saving} value={story.status} options={Object.entries(storyStatusLabels).map(([value, label]) => ({ value, label }))} onChange={value => void status(story.id, value)} />}
        <Typography.Title level={5}>故事描述</Typography.Title><p className="detail-text">{story.description || '暂无说明'}</p><Typography.Title level={5}>验收标准</Typography.Title><p className="detail-text">{story.acceptanceCriteria || '暂无验收标准'}</p>
        <Typography.Title level={5}>关联正式需求</Typography.Title><Space wrap>{story.requirementIds.map(id => <Button key={id} onClick={() => void openRequirement(id)}>{requirementNumber(id)} · {requirements.find(r => r.id === id)?.title}</Button>)}{!story.requirementIds.length && '暂无关联'}</Space>
        {!readOnly && <p><Button disabled={saving} onClick={() => edit({ kind: 'story', item: story })}>编辑用户故事</Button></p>}</>}
      {requirement && <><Typography.Title level={5}>需求说明</Typography.Title><p className="detail-text">{requirement.description || '暂无说明'}</p><Typography.Title level={5}>关联用户故事</Typography.Title>
        <Space wrap>{(requirement.storyIds ?? []).map(id => <Button key={id} onClick={() => setViewing({ kind: 'story', id })}>{storyNumber(id)} · {data.stories.find(s => s.id === id)?.title}</Button>)}{!requirement.storyIds?.length && '暂无关联'}</Space>
        {!readOnly && <p><Button disabled={saving} onClick={() => edit({ kind: 'requirement', item: requirement })}>编辑需求</Button></p>}</>}
    </Drawer>
    <Modal centered title={`${editor?.item ? '编辑' : '创建'}${title}`} open={editor !== null} onCancel={() => { if (!saving) setEditor(null); }} onOk={() => void save()} confirmLoading={saving} cancelButtonProps={{ disabled: saving }} destroyOnHidden>
      <Form form={form} layout="vertical" preserve={false} disabled={saving}>
        <Form.Item name="title" label={editor?.kind === 'requirement' ? '需求标题' : `${title}标题`} rules={[{ required: true, whitespace: true }, { max: 200 }]}><Input maxLength={200} /></Form.Item>
        {editor?.kind === 'requirement' && <><Form.Item name="description" label="需求说明" rules={[{ max: 10000 }]}><Input.TextArea rows={5} /></Form.Item><Form.Item name="storyIds" label="关联用户故事"><Select mode="multiple" allowClear optionFilterProp="label" options={data.stories.map(s => ({ value: s.id, label: `${storyNumber(s.id)} · ${s.title}` }))} /></Form.Item></>}
        {editor?.kind === 'story' && <>{!editor.item && <Form.Item name="epicId" label="所属 Epic" rules={[{ required: true }]}><Select options={data.epics.map(e => ({ value: e.id, label: e.title }))} /></Form.Item>}
          <Form.Item name="description" label="故事描述" rules={[{ max: 10000 }]}><Input.TextArea rows={3} /></Form.Item><Form.Item name="acceptanceCriteria" label="验收标准" rules={[{ max: 10000 }]}><Input.TextArea rows={3} /></Form.Item>
          <Form.Item name="requirementIds" label="关联正式需求"><Select mode="multiple" allowClear optionFilterProp="label" options={requirements.map(r => ({ value: r.id, label: `${requirementNumber(r.id)} · ${r.title}` }))} /></Form.Item></>}
        {editor?.kind === 'epic' && !editor.item && <Form.Item name="goalId" label="产品目标" rules={[{ required: true }]}><Select options={data.goals.map(g => ({ value: g.id, label: g.title }))} /></Form.Item>}
        {(editor?.kind === 'goal' || editor?.kind === 'epic') && editor.item && <Form.Item name="sortOrder" label="排序位置（从 0 开始）" rules={[{ type: 'integer', min: 0, max: 1000000 }]}><InputNumber min={0} precision={0} /></Form.Item>}
      </Form>
    </Modal>
  </div>;
}
