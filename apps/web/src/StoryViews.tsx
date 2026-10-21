import { Button, Empty, Space, Tag, Typography } from 'antd';
import type { DragEvent } from 'react';
import { storyStatusLabels, type Epic, type ProductGoal, type StoryMapData, type StoryStatus, type UserStory, type ViewFocus } from '@spm/shared';

export const storyNumber = (id: number) => `US-${String(id).padStart(3, '0')}`;
export const requirementNumber = (id: number) => `REQ-${String(id).padStart(3, '0')}`;
const colors: Record<StoryStatus, string> = { TODO: 'default', IN_PROGRESS: 'blue', DONE: 'green' };
export function StoryStatusTag({ status }: { status: StoryStatus }) { return <Tag color={colors[status]}>{storyStatusLabels[status]}</Tag>; }
interface CommonProps {
  data: StoryMapData;
  readOnly: boolean;
  busy: boolean;
  focus?: ViewFocus | null;
  onFocusChange?: (focus: ViewFocus) => void;
  embedded?: boolean;
  onOpen(story: UserStory): void;
}
function StoryCard({ story, readOnly, busy, focus, onOpen, onFocusChange }: CommonProps & { story: UserStory }) {
  return <article className={`story-card${focus?.entityType === 'story' && focus.entityId === story.id ? ' focused' : ''}`} aria-label={storyNumber(story.id)} draggable={!readOnly && !busy}
    onDragStart={event => { if (readOnly || busy) { event.preventDefault(); return; } event.dataTransfer.setData('application/x-spm-story', String(story.id)); event.dataTransfer.effectAllowed = 'move'; }}>
    <Space className="story-card-meta"><Typography.Text type="secondary">{storyNumber(story.id)}</Typography.Text><StoryStatusTag status={story.status} /></Space>
    <button className="story-title" onClick={() => { onFocusChange?.({ projectId: story.projectId, entityType: 'story', entityId: story.id }); onOpen(story); }}>{story.title}</button>
    <Typography.Text type="secondary">{story.requirementIds.length ? `${story.requirementIds.length} 项关联需求` : '暂无关联需求'}</Typography.Text>
  </article>;
}
function dropped(event: DragEvent, allowed: boolean, action: (id: number) => void) {
  event.preventDefault(); event.stopPropagation();
  if (!allowed) return;
  const id = Number(event.dataTransfer.getData('application/x-spm-story'));
  if (Number.isSafeInteger(id) && id > 0) action(id);
}
const sorted = <T extends { sortOrder: number; id: number }>(items: T[]) => [...items].sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id);
export interface StoryMapProps extends CommonProps {
  onMove(id: number, epicId: number, position: number): void;
  onNewGoal(): void;
  onNewEpic(goal: ProductGoal): void;
  onNewStory(epic: Epic): void;
  onEditGoal(goal: ProductGoal): void;
  onEditEpic(epic: Epic): void;
}
export function StoryMap(props: StoryMapProps) {
  const { data, readOnly, busy } = props;
  const writable = !readOnly && !busy;
  return <div className="story-map" aria-label="用户故事地图" aria-busy={busy}>
    {!readOnly && <Button disabled={busy} onClick={props.onNewGoal}>新建产品目标</Button>}
    {!data.goals.length && <Empty description="暂无产品目标" />}
    {sorted(data.goals).map(goal => <section className="goal-group" key={goal.id}>
      <div className="goal-heading"><Typography.Title level={4}>{goal.title}</Typography.Title>{!readOnly && <Space><Button size="small" disabled={busy} onClick={() => props.onEditGoal(goal)}>编辑目标</Button><Button size="small" disabled={busy} onClick={() => props.onNewEpic(goal)}>新建 Epic</Button></Space>}</div>
      <div className="epic-row">{sorted(data.epics.filter(e => e.goalId === goal.id)).map(epic => {
        const stories = sorted(data.stories.filter(s => s.epicId === epic.id));
        return <section key={epic.id} className="epic-column" aria-label={`Epic：${epic.title}`} onDragOver={event => { if (writable) event.preventDefault(); }}
          onDrop={event => dropped(event, writable, id => props.onMove(id, epic.id, stories.filter(s => s.id !== id).length))}>
          <div className="epic-heading"><strong>{epic.title}</strong><Tag>{stories.length}</Tag>{!readOnly && <Button size="small" disabled={busy} onClick={() => props.onEditEpic(epic)}>编辑 Epic</Button>}</div>
          {stories.map(story => <div key={story.id} className="story-slot" onDragOver={event => { if (writable) event.preventDefault(); }}
            onDrop={event => dropped(event, writable, id => props.onMove(id, epic.id, stories.filter(s => s.id !== id).findIndex(s => s.id === story.id)))}>
            <StoryCard {...props} story={story} />
          </div>)}
          {!stories.length && <div className="drop-placeholder">暂无故事{!readOnly && '，可拖入故事'}</div>}
          {!readOnly && <Button block type="dashed" disabled={busy} onClick={() => props.onNewStory(epic)}>新建用户故事</Button>}
        </section>;
      })}</div>
    </section>)}
  </div>;
}
export interface StoryBoardProps extends CommonProps { stories: UserStory[]; onStatus(id: number, status: StoryStatus): void }
export function StoryBoard(props: StoryBoardProps) {
  const { stories, readOnly, busy } = props;
  return <div className="story-board" aria-label="用户故事看板" aria-busy={busy}>
    {(Object.keys(storyStatusLabels) as StoryStatus[]).map(status => <section key={status} className={`board-column board-${status.toLowerCase()}`} aria-label={storyStatusLabels[status]}
      onDragOver={event => { if (!readOnly && !busy) event.preventDefault(); }} onDrop={event => dropped(event, !readOnly && !busy, id => props.onStatus(id, status))}>
      <div className="board-heading"><strong>{storyStatusLabels[status]}</strong><Tag>{stories.filter(s => s.status === status).length}</Tag></div>
      {sorted(stories.filter(s => s.status === status)).map(story => <StoryCard {...props} key={story.id} story={story} />)}
      {!stories.some(s => s.status === status) && <div className="drop-placeholder">暂无故事</div>}
    </section>)}
  </div>;
}
