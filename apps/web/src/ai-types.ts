import type { AiKind, AiScope } from "./ai-events";
export interface AiEvidence {
  key: string;
  entityType: string;
  entityId: string | number;
  fields: Record<string, unknown>;
}
export interface AiFinding {
  id: string;
  eventKey: string;
  ruleId: string;
  severity: string;
  dimensions: string[];
  fact: string;
  evidence: AiEvidence[];
  evidenceCurrent: boolean;
  inference?: {
    explanation: string;
    recommendation: string;
    evidenceKeys: string[];
  } | null;
}
export interface AiReport {
  id: string;
  kind: AiKind;
  status: string;
  scope: AiScope;
  stale: boolean;
  createdAt: string;
  sourceDate?: string;
  modelState?: string;
  modelInfo?: Record<string, unknown>;
  errorCode?: string;
  summary: { uniqueEvents: number; dimensions: Record<string, number> };
  findings: AiFinding[];
  output?: { items?: AiCandidate[]; scenarios?: AiScenario[] };
  visibility?: string;
}
export interface AiScenario {
  name: string;
  shiftDays: number;
  baselineRisks: number;
  candidateRisks: number;
  uncertainty: string;
  conflicts: AiFinding[];
  changes: {
    id: string;
    title: string;
    start: string;
    end: string;
    revision: number;
    originalStart: string;
    originalEnd: string;
  }[];
}
export type CandidateKind = "GOAL" | "EPIC" | "REQUIREMENT" | "STORY" | "TASK";
export interface AiCandidate {
  key: string;
  kind: CandidateKind;
  title: string;
  description: string;
  acceptanceCriteria: string;
  action: "CREATE" | "REUSE" | "SKIP" | "UPDATE";
  reviewed: boolean;
  existingId?: number;
  parentKey?: string;
  goalKey?: string;
  epicKey?: string;
  requirementKeys: string[];
  storyKeys: string[];
  planIds: string[];
  assigneeUserId?: number | null;
  priority: string;
}
export interface AiDraft {
  sourceRunId?: string | null;
  id: string;
  title: string;
  kind: string;
  items: AiCandidate[];
  revision: number;
  status: string;
  stale?: boolean;
  updatedAt: string;
  result?: {
    objects: { kind: CandidateKind; id: number; key: string; action: string }[];
  };
}
