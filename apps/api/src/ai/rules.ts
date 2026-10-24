import { AnalysisContext, AnalysisKind, Finding } from "./ai.types";
export function detectRisks(
  c: AnalysisContext,
  kind: AnalysisKind,
  maximum = 1000,
): { findings: Finding[]; truncated: boolean } {
  const found = new Map<string, Finding>();
  let truncated = false;
  const add = (
    ruleId: string,
    ids: (string | number)[],
    dimensions: string[],
    severity: Finding["severity"],
    fact: string,
    keys: string[],
  ) => {
    const eventKey = `${ruleId}:${ids.join("|")}`;
    const previous = found.get(eventKey);
    if (previous) {
      previous.dimensions = [
        ...new Set([...previous.dimensions, ...dimensions]),
      ];
      return;
    }
    if (found.size >= maximum) {
      truncated = true;
      return;
    }
    const evidence = keys.map((key) => c.evidence.get(key)!);
    if (evidence.some((e) => !e)) throw new Error("Missing rule evidence");
    found.set(eventKey, {
      eventKey,
      ruleId,
      dimensions,
      severity,
      fact,
      evidence,
    });
  };
  const relevant = (...kinds: AnalysisKind[]) => kinds.includes(kind);
  if (kind === "TASK")
    for (const t of c.tasks)
      add(
        "TASK_EXECUTION_REVIEW",
        [t.id],
        ["EXECUTION"],
        "INFO",
        `任务 T-${t.id} 的状态、描述、故事与计划关联由授权记录提供，执行步骤仅为AI建议，需人工核查。`,
        [
          `task:${t.id}`,
          ...t.planLinks
            .map((l) => `planItem:${l.planId}`)
            .filter((k) => c.evidence.has(k)),
        ],
      );
  if (kind === "COVERAGE" && (c.stories.length || c.requirements.length))
    add(
      "COVERAGE_SEMANTIC_REVIEW",
      ["snapshot"],
      ["COVERAGE"],
      "INFO",
      `当前授权快照含 ${c.requirements.length} 条正式需求和 ${c.stories.length} 条用户故事。关联、重复、Epic归属与验收语义需进一步核查；结构关联不等于验收覆盖。`,
      [
        ...c.requirements.map((r) => `requirement:${r.id}`),
        ...c.stories.map((s) => `story:${s.id}`),
      ],
    );
  if (relevant("HEALTH", "TASK", "CROSS_VIEW"))
    for (const t of c.tasks) {
      if (t.status !== "DONE" && t.assigneeUserId === null)
        add(
          "TASK_UNASSIGNED",
          [t.id],
          ["PROGRESS", "ALLOCATION"],
          "MEDIUM",
          `任务 T-${t.id} 尚未完成且负责人为空；是否需要分配由项目经理核查。`,
          [`task:${t.id}`],
        );
      if (!t.planLinks.length)
        add(
          "TASK_WITHOUT_PLAN",
          [t.id],
          ["PLAN"],
          "INFO",
          `任务 T-${t.id} 未关联计划项，不能据此计算任务逾期。`,
          [`task:${t.id}`],
        );
    }
  if (relevant("HEALTH", "PLAN", "CROSS_VIEW"))
    for (const i of c.items) {
      if (i.status !== "DONE" && i.end < c.asOf)
        add(
          i.kind === "milestone" ? "MILESTONE_OVERDUE" : "PLAN_OVERDUE",
          [i.id],
          ["PLAN", "PROGRESS"],
          "HIGH",
          `计划${i.kind === "milestone" ? "里程碑" : "工作项"} ${i.id} 的结束日期 ${i.end} 早于检查日期 ${c.asOf}，当前状态 ${i.status}；这不是Task原生截止日期。`,
          [`planItem:${i.id}`],
        );
      const s = c.stages.find((s) => s.id === i.stageId);
      if (s && (i.start < s.start || i.end > s.end))
        add(
          "PLAN_OUTSIDE_STAGE",
          [i.id],
          ["PLAN"],
          "MEDIUM",
          `计划项 ${i.id} 日期超出所属阶段 ${s.id} 的计划区间。`,
          [`planItem:${i.id}`, `stage:${s.id}`],
        );
    }
  if (relevant("HEALTH", "MEMBER", "CROSS_VIEW")) {
    const owners = new Set(
      c.tasks
        .filter((t) => t.assigneeUserId !== null)
        .map((t) => t.assigneeUserId),
    );
    for (const id of owners) {
      const pending = c.tasks.filter(
        (t) =>
          t.assigneeUserId === id &&
          t.status !== "DONE" &&
          ["HIGH", "URGENT"].includes(t.priority),
      );
      if (pending.length >= 3)
        add(
          "TASK_PRIORITY_CONCENTRATION",
          [id!],
          ["MEMBER"],
          "MEDIUM",
          `成员 #${id} 有 ${pending.length} 项未完成的高/紧急优先级任务；这是任务集中信号，不代表工时超负荷。`,
          pending.map((t) => `task:${t.id}`),
        );
    }
  }
  if (relevant("HEALTH", "PLAN", "MEMBER", "CROSS_VIEW")) {
    const items = c.items.filter(
      (i) =>
        i.kind === "item" &&
        i.ownerUserId !== null &&
        ["TODO", "IN_PROGRESS"].includes(i.status),
    );
    for (let a = 0; a < items.length && !truncated; a++)
      for (let b = a + 1; b < items.length && !truncated; b++) {
        const x = items[a],
          y = items[b];
        if (
          x.ownerUserId === y.ownerUserId &&
          x.start <= y.end &&
          y.start <= x.end
        )
          add(
            "SAME_OWNER_PLAN_OVERLAP",
            [...[x.id, y.id].sort()],
            ["PLAN", "MEMBER"],
            "LOW",
            `同一计划负责人 #${x.ownerUserId} 的两个计划项日期交叠；未建模工时和依赖，不能据此断定资源冲突。`,
            [`planItem:${x.id}`, `planItem:${y.id}`],
          );
      }
  }
  if (relevant("COVERAGE", "CROSS_VIEW")) {
    const parents = new Set(c.requirements.map((r) => r.parentId));
    for (const r of c.requirements)
      if (!parents.has(r.id) && !r.storyLinks.length)
        add(
          "LEAF_REQUIREMENT_WITHOUT_STORY",
          [r.id],
          ["COVERAGE"],
          "MEDIUM",
          `叶子需求 REQ-${r.id} 的直接故事关联数为0；只统计叶子需求，不把父级缺少直接关联误作子树未覆盖。`,
          [`requirement:${r.id}`],
        );
    for (const s of c.stories) {
      if (!s.requirementLinks.length)
        add(
          "STORY_WITHOUT_REQUIREMENT",
          [s.id],
          ["COVERAGE"],
          "MEDIUM",
          `用户故事 US-${s.id} 没有直接正式需求关联；应人工核查是否需要建立关联。`,
          [`story:${s.id}`],
        );
      if (kind === "CROSS_VIEW" && !s.useCaseLinks.length)
        add(
          "STORY_WITHOUT_UML",
          [s.id],
          ["TRACEABILITY"],
          "INFO",
          `用户故事 US-${s.id} 无直接UML用例关联；不是所有故事都必须建模用例。`,
          [`story:${s.id}`],
        );
    }
  }
  return {
    findings: [...found.values()].sort((a, b) =>
      a.eventKey.localeCompare(b.eventKey),
    ),
    truncated,
  };
}
