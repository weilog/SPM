export const RULES_VERSION = "p1-2026-10-23.1";
export const ANALYSIS_KINDS = [
  "HEALTH",
  "COVERAGE",
  "TASK",
  "PLAN",
  "MEMBER",
  "CROSS_VIEW",
] as const;
export type AnalysisKind = (typeof ANALYSIS_KINDS)[number];
export interface AnalysisScope {
  taskId?: number;
  stageId?: string;
}
export type Fields = Record<
  string,
  string | number | boolean | null | number[] | string[]
>;
export interface Evidence {
  key: string;
  entityType: string;
  entityId: number | string;
  fields: Fields;
}
export interface Finding {
  eventKey: string;
  ruleId: string;
  severity: "INFO" | "LOW" | "MEDIUM" | "HIGH";
  dimensions: string[];
  fact: string;
  evidence: Evidence[];
}
export interface AnalysisContext {
  hash: string;
  asOf: string;
  visibleKeys: Set<string>;
  tasks: {
    id: number;
    title: string;
    status: string;
    progress: number;
    priority: string;
    assigneeUserId: number | null;
    planLinks: { planId: string }[];
  }[];
  stages: { id: string; title: string; start: string; end: string }[];
  items: {
    id: string;
    title: string;
    stageId: string;
    start: string;
    end: string;
    status: string;
    kind: string;
    ownerUserId: number | null;
  }[];
  requirements: {
    id: number;
    title: string;
    parentId: number | null;
    storyLinks: { storyId: number }[];
  }[];
  stories: {
    id: number;
    title: string;
    requirementLinks: { requirementId: number }[];
    useCaseLinks: { nodeId: number }[];
  }[];
  evidence: Map<string, Evidence>;
}
export interface Explanation {
  eventKey: string;
  explanation: string;
  recommendation: string;
  evidenceKeys: string[];
}
export interface ModelResult {
  state: string;
  explanations: Explanation[];
  info: Record<string, string | number | boolean>;
}
