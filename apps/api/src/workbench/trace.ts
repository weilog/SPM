import type { RelationTarget, ResolvedRelations, ViewFocus } from "@spm/shared";
export type TraceNode = Omit<RelationTarget, "distance" | "path">;
export const nodeKey = (n: Pick<TraceNode, "entityType" | "entityId">) =>
  `${n.entityType}:${n.entityId}`;
// Typed paths avoid expanding a task through a shared story into sibling tasks,
// or treating a task's other plans as children of the selected plan.
export function traceRelations(
  nodes: TraceNode[],
  edges: [string, string][],
  focus: ViewFocus,
): ResolvedRelations | null {
  const byKey = new Map(nodes.map((n) => [nodeKey(n), n]));
  const root = byKey.get(nodeKey(focus));
  if (!root) return null;
  const adjacent = new Map<string, Set<string>>();
  for (const [a, b] of edges) {
    if (!byKey.has(a) || !byKey.has(b)) continue;
    if (!adjacent.has(a)) adjacent.set(a, new Set());
    if (!adjacent.has(b)) adjacent.set(b, new Set());
    adjacent.get(a)!.add(b);
    adjacent.get(b)!.add(a);
  }
  const found = new Map<string, RelationTarget>();
  const queue = [{ node: root, types: [root.entityType], path: [root.label] }];
  found.set(nodeKey(root), { ...root, distance: 0, path: [root.label] });
  for (let i = 0; i < queue.length; i++) {
    const { node, types, path } = queue[i];
    if (path.length >= 6) continue;
    for (const key of adjacent.get(nodeKey(node)) || []) {
      const next = byKey.get(key)!;
      if (types.includes(next.entityType) || found.has(key)) continue;
      const nextPath = [...path, next.label];
      found.set(key, { ...next, distance: path.length, path: nextPath });
      queue.push({
        node: next,
        types: [...types, next.entityType],
        path: nextPath,
      });
    }
  }
  const trace = [...found.values()];
  const ids = (type: TraceNode["entityType"]) =>
    trace.filter((x) => x.entityType === type).map((x) => x.entityId);
  return {
    requirements: ids("requirement") as number[],
    stories: ids("story") as number[],
    tasks: ids("task") as number[],
    planItems: ids("planItem") as string[],
    umlUseCases: ids("umlUseCase") as number[],
    members: ids("member") as number[],
    stages: ids("stage") as string[],
    sequences: ids("sequence") as number[],
    trace,
  };
}
