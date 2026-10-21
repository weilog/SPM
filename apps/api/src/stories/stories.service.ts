import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { User } from '@spm/shared';
import { DbService } from '../db/db.module';
import { Database, ProjectsService } from '../projects/projects.module';
import { CreateEpicDto, CreateStoryDto, EditNodeDto, EditStoryDto, MoveStoryDto, StoryStatusDto, TitleDto } from './stories.dto';

const order = [{ sortOrder: 'asc' }, { id: 'asc' }] as const;
const storyInclude = { requirementLinks: { select: { requirementId: true } } } as const;
function present<T extends { requirementLinks: { requirementId: number }[] }>(story: T) {
  const { requirementLinks, ...data } = story;
  return { ...data, requirementIds: requirementLinks.map(link => link.requirementId).sort((a, b) => a - b) };
}
function checkRevision(current: number, expected: number) {
  if (current !== expected) throw new ConflictException('内容已被修改，请刷新后重试');
}
@Injectable()
export class StoriesService {
  constructor(private readonly db: DbService, private readonly projects: ProjectsService) {}
  // One authorized snapshot for all three views; task details are deliberately excluded.
  async snapshot(actor: User, projectId: number) {
    return this.db.atomic(async tx => {
      await this.projects.authorized(actor, projectId, false, tx);
      const goals = await tx.productGoal.findMany({ where: { projectId }, orderBy: [...order] });
      const epics = await tx.epic.findMany({ where: { projectId }, orderBy: [...order] });
      const stories = await tx.userStory.findMany({ where: { projectId }, orderBy: [...order], include: storyInclude });
      return { goals, epics, stories: stories.map(present) };
    });
  }
  async list(actor: User, projectId: number) { return (await this.snapshot(actor, projectId)).stories; }
  async detail(actor: User, projectId: number, id: number) {
    return this.db.atomic(async tx => {
      await this.projects.authorized(actor, projectId, false, tx);
      return present(await this.story(tx, projectId, id));
    });
  }
  private async story(tx: Database, projectId: number, id: number) {
    const story = await tx.userStory.findFirst({ where: { projectId, id }, include: storyInclude });
    if (!story) throw new NotFoundException('本项目用户故事不存在');
    return story;
  }
  private async epic(tx: Database, projectId: number, id: number) {
    const epic = await tx.epic.findFirst({ where: { projectId, id } });
    if (!epic) throw new NotFoundException('本项目 Epic 不存在');
    return epic;
  }
  private async goal(tx: Database, projectId: number, id: number) {
    const goal = await tx.productGoal.findFirst({ where: { projectId, id } });
    if (!goal) throw new NotFoundException('本项目产品目标不存在');
    return goal;
  }
  private async validateRequirements(tx: Database, projectId: number, ids: number[]) {
    if (await tx.requirement.count({ where: { projectId, id: { in: ids } } }) !== ids.length) throw new BadRequestException('关联需求必须属于当前项目');
  }
  async createGoal(actor: User, projectId: number, dto: TitleDto) {
    return this.db.atomic(async tx => {
      await this.projects.authorized(actor, projectId, true, tx);
      return tx.productGoal.create({ data: { projectId, title: dto.title, sortOrder: await tx.productGoal.count({ where: { projectId } }) } });
    });
  }
  async createEpic(actor: User, projectId: number, dto: CreateEpicDto) {
    return this.db.atomic(async tx => {
      await this.projects.authorized(actor, projectId, true, tx);
      await this.goal(tx, projectId, dto.goalId);
      return tx.epic.create({ data: { projectId, ...dto, sortOrder: await tx.epic.count({ where: { projectId, goalId: dto.goalId } }) } });
    });
  }
  async editNode(actor: User, projectId: number, id: number, kind: 'goal' | 'epic', dto: EditNodeDto) {
    if (dto.title === undefined && dto.sortOrder === undefined) throw new BadRequestException('请提供修改内容');
    return this.db.atomic(async tx => {
      await this.projects.authorized(actor, projectId, true, tx);
      const current = kind === 'goal' ? await this.goal(tx, projectId, id) : await this.epic(tx, projectId, id);
      checkRevision(current.revision, dto.revision);
      const scope = kind === 'goal' ? { projectId } : { projectId, goalId: (await this.epic(tx, projectId, id)).goalId };
      const siblings = kind === 'goal' ? await tx.productGoal.findMany({ where: scope, orderBy: [...order] }) : await tx.epic.findMany({ where: scope, orderBy: [...order] });
      const ids = siblings.filter(item => item.id !== id).map(item => item.id);
      ids.splice(Math.min(dto.sortOrder ?? current.sortOrder, ids.length), 0, id);
      for (const [sortOrder, nodeId] of ids.entries()) {
        const previous = siblings.find(item => item.id === nodeId)!;
        if (nodeId !== id && previous.sortOrder === sortOrder) continue;
        const data = { sortOrder, revision: { increment: 1 }, ...(nodeId === id && dto.title !== undefined ? { title: dto.title } : {}) };
        if (kind === 'goal') await tx.productGoal.update({ where: { id: nodeId }, data });
        else await tx.epic.update({ where: { id: nodeId }, data });
      }
      return kind === 'goal' ? this.goal(tx, projectId, id) : this.epic(tx, projectId, id);
    });
  }
  async createStory(actor: User, projectId: number, dto: CreateStoryDto) {
    return this.db.atomic(async tx => {
      await this.projects.authorized(actor, projectId, true, tx);
      await this.epic(tx, projectId, dto.epicId);
      const { requirementIds = [], ...data } = dto;
      await this.validateRequirements(tx, projectId, requirementIds);
      const story = await tx.userStory.create({ data: { ...data, projectId, sortOrder: await tx.userStory.count({ where: { projectId, epicId: dto.epicId } }) } });
      await tx.storyRequirement.createMany({ data: requirementIds.map(requirementId => ({ projectId, storyId: story.id, requirementId })) });
      return present(await this.story(tx, projectId, story.id));
    });
  }
  async editStory(actor: User, projectId: number, id: number, dto: EditStoryDto) {
    const { revision, requirementIds, ...data } = dto;
    if (!Object.values(data).some(value => value !== undefined) && requirementIds === undefined) throw new BadRequestException('请提供修改内容');
    return this.db.atomic(async tx => {
      await this.projects.authorized(actor, projectId, true, tx);
      checkRevision((await this.story(tx, projectId, id)).revision, revision);
      if (requirementIds !== undefined) {
        await this.validateRequirements(tx, projectId, requirementIds);
        await tx.storyRequirement.deleteMany({ where: { projectId, storyId: id } });
        await tx.storyRequirement.createMany({ data: requirementIds.map(requirementId => ({ projectId, storyId: id, requirementId })) });
      }
      await tx.userStory.update({ where: { id }, data: { ...data, revision: { increment: 1 } } });
      return present(await this.story(tx, projectId, id));
    });
  }
  async status(actor: User, projectId: number, id: number, dto: StoryStatusDto) {
    return this.db.atomic(async tx => {
      await this.projects.authorized(actor, projectId, true, tx);
      checkRevision((await this.story(tx, projectId, id)).revision, dto.revision);
      return present(await tx.userStory.update({ where: { id }, data: { status: dto.status, revision: { increment: 1 } }, include: storyInclude }));
    });
  }
  async move(actor: User, projectId: number, id: number, dto: MoveStoryDto) {
    return this.db.atomic(async tx => {
      await this.projects.authorized(actor, projectId, true, tx);
      const current = await this.story(tx, projectId, id);
      checkRevision(current.revision, dto.revision);
      await this.epic(tx, projectId, dto.epicId);
      const siblings = await tx.userStory.findMany({ where: { projectId, epicId: { in: [current.epicId, dto.epicId] } }, orderBy: [...order] });
      const target = siblings.filter(s => s.epicId === dto.epicId && s.id !== id).map(s => s.id);
      target.splice(Math.min(dto.position, target.length), 0, id);
      const groups = [{ epicId: dto.epicId, ids: target }];
      if (current.epicId !== dto.epicId) groups.push({ epicId: current.epicId, ids: siblings.filter(s => s.epicId === current.epicId && s.id !== id).map(s => s.id) });
      for (const group of groups) for (const [sortOrder, storyId] of group.ids.entries()) {
        const previous = siblings.find(s => s.id === storyId)!;
        if (storyId !== id && previous.sortOrder === sortOrder && previous.epicId === group.epicId) continue;
        await tx.userStory.update({ where: { id: storyId }, data: { epicId: group.epicId, sortOrder, revision: { increment: 1 } } });
      }
      return present(await this.story(tx, projectId, id));
    });
  }
}
