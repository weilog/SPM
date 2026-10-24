import { useOptionalProjectData } from "./ProjectData";
export type AiKind =
  | "HEALTH"
  | "COVERAGE"
  | "TASK"
  | "PLAN"
  | "MEMBER"
  | "CROSS_VIEW"
  | "PLANNING"
  | "TASK_SPLIT";
export type AiScope = {
  taskId?: number;
  stageId?: string;
  requirementId?: number;
  requestText?: string;
};
export const aiNames: Record<AiKind, string> = {
  HEALTH: "AI 项目健康诊断",
  COVERAGE: "AI 故事关联与覆盖检查",
  TASK: "AI 任务拆分与执行建议",
  PLAN: "AI 进度风险与调整方案推演",
  MEMBER: "AI 工作集中度与瓶颈分析",
  CROSS_VIEW: "AI 跨视图关联与定位",
  PLANNING: "AI 智能需求规划",
  TASK_SPLIT: "AI 候选任务审核",
};
export function AiEntry({
  kind,
  label,
  scope = {},
  onOpen,
}: {
  kind: AiKind;
  label?: string;
  scope?: AiScope;
  onOpen?: () => void;
}) {
  const store = useOptionalProjectData();
  if (
    !store ||
    (["PLANNING", "TASK_SPLIT"].includes(kind) && !store.project.canManage)
  )
    return null;
  return (
    <button
      type="button"
      className="btn small ai-entry"
      onClick={() => {
        onOpen?.();
        window.dispatchEvent(
          new CustomEvent("spm-ai-open", {
            detail: { projectId: store.project.id, kind, scope },
          }),
        );
      }}
    >
      ✦ {label || aiNames[kind]}
    </button>
  );
}
export function confirmAiNavigation() {
  return (
    !document.querySelector('[data-ai-dirty="true"]') ||
    window.confirm("AI 草稿有未保存修改，确定离开并放弃这些修改？")
  );
}
