import type { AiEvidence } from "./ai-types";

export const riskNames: Record<string, string> = {
  TASK_EXECUTION_REVIEW: "任务执行建议",
  COVERAGE_SEMANTIC_REVIEW: "需求与故事关联核查",
  TASK_UNASSIGNED: "任务尚未指定负责人",
  TASK_WITHOUT_PLAN: "任务尚未关联计划",
  MILESTONE_OVERDUE: "里程碑已超过计划日期",
  PLAN_OVERDUE: "计划项已超过预计结束日期",
  PLAN_OUTSIDE_STAGE: "计划日期超出阶段范围",
  TASK_PRIORITY_CONCENTRATION: "高优先级任务集中",
  SAME_OWNER_PLAN_OVERLAP: "同一负责人计划日期重叠",
  LEAF_REQUIREMENT_WITHOUT_STORY: "叶子需求尚未关联故事",
  STORY_WITHOUT_REQUIREMENT: "故事尚未关联正式需求",
  STORY_WITHOUT_UML: "故事尚未关联用例",
};
export const severityNames: Record<string, string> = {
  HIGH: "高",
  MEDIUM: "中",
  LOW: "低",
  INFO: "核查建议",
};
const fields: Record<string, string> = {
  title: "标题",
  description: "描述",
  acceptanceCriteria: "验收条件",
  status: "状态",
  priority: "优先级",
  progress: "完成进度",
  assigneeUserId: "任务负责人编号",
  ownerUserId: "计划负责人编号",
  start: "预计开始",
  end: "预计结束",
  stageId: "所属阶段编号",
  parentId: "上级需求编号",
  storyIds: "关联故事编号",
  requirementIds: "关联需求编号",
  taskIds: "关联任务编号",
  planIds: "关联计划编号",
  epicId: "Epic 编号",
  goalId: "产品目标编号",
  kind: "类型",
  updatedAt: "更新时间",
  revision: "数据版本",
  recentActions: "最近操作",
  planItemIds: "关联计划编号",
  taskCount: "任务数量",
  stageStart: "阶段开始",
  stageEnd: "阶段结束",
  requirementCount: "需求数量",
  storyCount: "故事数量",
  archivedAt: "归档时间",
};
export function evidenceLabel(e: AiEvidence) {
  const title = typeof e.fields.title === "string" ? e.fields.title : "";
  const kind: Record<string, string> = {
    task: "任务",
    requirement: "需求",
    story: "故事",
    planItem: "计划项",
    stage: "阶段",
    member: "成员",
  };
  return (
    title ||
    `${kind[e.entityType] || "关联对象"}${typeof e.entityId === "number" ? ` #${e.entityId}` : ""}`
  );
}
export function evidenceFields(e: AiEvidence) {
  const values: Record<string, string> = {
    TODO: "待处理",
    IN_PROGRESS: "进行中",
    DONE: "已完成",
    URGENT: "紧急",
    HIGH: "高",
    MEDIUM: "中",
    LOW: "低",
    milestone: "里程碑",
    work: "计划工作项",
  };
  const display = (v: unknown): string =>
    v == null
      ? "未设置"
      : Array.isArray(v)
        ? v.length
          ? v.map(display).join("、")
          : "无"
        : typeof v === "object"
          ? Object.entries(v)
              .map(([k, x]) => `${fields[k] || k}：${display(x)}`)
              .join("；")
          : values[String(v)] || String(v);
  return Object.entries(e.fields).map(([key, value]) => ({
    key,
    label: fields[key] || key,
    value: key === "progress" ? `${display(value)}%` : display(value),
  }));
}
