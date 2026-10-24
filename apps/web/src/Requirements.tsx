import {
  Alert,
  Button,
  Checkbox,
  Drawer,
  Form,
  Input,
  InputNumber,
  Modal,
  Select,
  Space,
  Spin,
  Table,
  Typography,
} from "antd";
import { useEffect, useRef, useState } from "react";
import {
  storyStatusLabels,
  type Epic,
  type LinkedRequirement,
  type ProductGoal,
  type Project,
  type StoryMapData,
  type StoryStatus,
  type UserStory,
  type ViewFocus,
} from "@spm/shared";
import { api } from "./api";
import { AiEntry } from "./ai-events";
import { Icon, PageHeading, announceProject, useProjectRefresh } from "./ui";
import { useOptionalProjectData } from "./ProjectData";
import {
  requirementNumber,
  StoryBoard,
  StoryMap,
  storyNumber,
  StoryStatusTag,
} from "./StoryViews";

const empty: StoryMapData = { goals: [], epics: [], stories: [] };
type Editor =
  | { kind: "requirement"; item?: LinkedRequirement; parentId?: number }
  | { kind: "story"; item?: UserStory; epicId?: number }
  | { kind: "goal"; item?: ProductGoal }
  | { kind: "epic"; item?: Epic; goalId?: number };
type Values = {
  title: string;
  description?: string;
  acceptanceCriteria?: string;
  storyIds?: number[];
  requirementIds?: number[];
  epicId?: number;
  goalId?: number;
  sortOrder?: number;
  parentId?: number | null;
};

interface Props {
  project: Project;
  onError: (error: unknown) => void;
  embeddedView?: "map" | "board";
  focusOnly?: boolean;
  onlyRelated?: boolean;
  focus?: ViewFocus | null;
  highlightIds?: number[];
  onFocusChange?: (focus: ViewFocus) => void;
  onOpenTask?: (id: number) => void;
}
// Keyed context prevents stale drawers, filters and responses from crossing projects.
export function Requirements(props: Props) {
  return <RequirementWorkspace key={props.project.id} {...props} />;
}
function RequirementWorkspace({
  project,
  onError,
  embeddedView,
  focusOnly = false,
  onlyRelated = false,
  focus,
  highlightIds,
  onFocusChange,
  onOpenTask,
}: Props) {
  const store = useOptionalProjectData();
  const [requirements, setRequirements] = useState<LinkedRequirement[]>([]);
  const [data, setData] = useState<StoryMapData>(empty);
  const [tab, setTab] = useState<string>(embeddedView ?? "list");
  const [search, setSearch] = useState("");
  const [relation, setRelation] = useState("all");
  const [expanded, setExpanded] = useState<number[]>([]);
  const [filterCollapsed, setFilterCollapsed] = useState<number[]>([]);
  const initialized = useRef(false);
  const [epic, setEpic] = useState<number | undefined>();
  const [viewing, setViewing] = useState<{
    kind: "requirement" | "story";
    id: number;
  } | null>(null);
  const [editor, setEditor] = useState<Editor | null>(null);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [failure, setFailure] = useState("");
  const [form] = Form.useForm<Values>();
  const alive = useRef(true);
  const busy = useRef(false);
  const readVersion = useRef(0);
  const path = `/projects/${project.id}`;
  async function reload() {
    const version = ++readVersion.current;
    const [nextRequirements, snapshot] = await Promise.all([
      api<LinkedRequirement[]>(`${path}/requirements`),
      api<StoryMapData>(`${path}/story-map`),
    ]);
    if (alive.current && version === readVersion.current) {
      setRequirements(nextRequirements);
      setData(snapshot);
      if (!initialized.current) {
        setExpanded(nextRequirements.map((r) => r.id));
        initialized.current = true;
      }
    }
  }
  function report(error: unknown) {
    if (!alive.current) return;
    setFailure((error as Error).message || "请求失败，请重试");
    onError(error);
  }
  useEffect(() => {
    alive.current = true;
    void reload()
      .catch(report)
      .finally(() => {
        if (alive.current) setLoading(false);
      });
    return () => {
      alive.current = false;
      readVersion.current++;
    };
  }, []);
  useEffect(() => {
    const refresh = () => {
      if (!busy.current) void reload().catch(report);
    };
    window.addEventListener("focus", refresh);
    return () => window.removeEventListener("focus", refresh);
  }, []);
  useProjectRefresh(project.id, () => {
    if (!busy.current) void reload().catch(report);
  });
  useEffect(() => {
    if (store && !busy.current) {
      setData(store.stories);
      setRequirements(store.requirements);
    }
  }, [store?.stories, store?.requirements]);
  const readOnly = !project.canManage;
  const story =
    viewing?.kind === "story"
      ? data.stories.find((s) => s.id === viewing.id)
      : undefined;
  const requirement =
    viewing?.kind === "requirement"
      ? requirements.find((r) => r.id === viewing.id)
      : undefined;
  function edit(next: Editor) {
    if (readOnly || busy.current) return;
    setEditor(next);
    form.resetFields();
    form.setFieldsValue(
      next.item
        ? { ...next.item }
        : {
            title: "",
            ...("parentId" in next ? { parentId: next.parentId } : {}),
            ...("epicId" in next ? { epicId: next.epicId } : {}),
            ...("goalId" in next ? { goalId: next.goalId } : {}),
          },
    );
  }
  useEffect(() => {
    const locate = (e: Event) => {
      const d = (e as CustomEvent).detail;
      if (d.projectId !== project.id) return;
      if (d.entityType === "requirement") {
        if (embeddedView) return;
        setTab("list");
        void openRequirement(Number(d.entityId));
      } else if (d.entityType === "story") {
        if (embeddedView) setTab(embeddedView);
        setViewing({ kind: "story", id: Number(d.entityId) });
      } else if (
        embeddedView === "map" &&
        (d.entityType === "goal" || d.entityType === "epic")
      )
        setTab("map");
    };
    window.addEventListener("spm-ai-locate", locate);
    return () => window.removeEventListener("spm-ai-locate", locate);
  }, [project.id]);
  async function openRequirement(id: number) {
    try {
      const result = await api<LinkedRequirement>(`${path}/requirements/${id}`);
      if (alive.current) {
        setRequirements((current) =>
          current.map((r) => (r.id === id ? result : r)),
        );
        setViewing({ kind: "requirement", id });
      }
    } catch (error) {
      report(error);
    }
  }
  async function mutate(
    action: () => Promise<unknown>,
    optimistic?: () => void,
  ) {
    if (readOnly || busy.current) return false;
    busy.current = true;
    setSaving(true);
    setFailure("");
    readVersion.current++;
    const previous = data;
    optimistic?.();
    try {
      await action();
      if (alive.current) {
        try {
          await reload();
        } catch (error) {
          report(
            new Error(
              `保存成功，但刷新失败，请刷新后继续：${(error as Error).message}`,
            ),
          );
        }
      }
      announceProject(project.id);
      return true;
    } catch (error) {
      if (alive.current) {
        setData(previous);
        report(error);
      }
      return false;
    } finally {
      busy.current = false;
      if (alive.current) setSaving(false);
    }
  }
  async function status(id: number, next: StoryStatus) {
    const current = data.stories.find((s) => s.id === id);
    if (!current || current.status === next) return;
    await mutate(
      () =>
        api(`${path}/stories/${id}/status`, "PATCH", {
          revision: current.revision,
          status: next,
        }),
      () =>
        setData({
          ...data,
          stories: data.stories.map((s) =>
            s.id === id ? { ...s, status: next } : s,
          ),
        }),
    );
  }
  async function move(id: number, epicId: number, position: number) {
    const current = data.stories.find((s) => s.id === id);
    if (!current || position < 0) return;
    await mutate(() =>
      api(`${path}/stories/${id}/move`, "PATCH", {
        revision: current.revision,
        epicId,
        position,
      }),
    );
  }
  async function save() {
    if (!editor || readOnly || busy.current) return;
    let values: Values;
    try {
      values = await form.validateFields();
    } catch {
      return;
    }
    const { kind, item } = editor;
    const resource =
      kind === "requirement"
        ? "requirements"
        : kind === "story"
          ? "stories"
          : kind === "goal"
            ? "goals"
            : "epics";
    let body: object;
    if (kind === "requirement")
      body = {
        title: values.title,
        description: values.description,
        acceptanceCriteria: values.acceptanceCriteria,
        ...(item ? { revision: item.revision } : {}),
        parentId: values.parentId ?? null,
        ...(values.storyIds !== undefined ? { storyIds: values.storyIds } : {}),
      };
    else if (kind === "story")
      body = {
        title: values.title,
        description: values.description,
        acceptanceCriteria: values.acceptanceCriteria,
        requirementIds: values.requirementIds ?? [],
        epicId: values.epicId,
        ...(item ? { revision: item.revision } : {}),
      };
    else
      body = {
        title: values.title,
        ...(item
          ? {
              revision: item.revision,
              sortOrder: values.sortOrder,
              ...(kind === "epic" ? { goalId: values.goalId } : {}),
            }
          : kind === "epic"
            ? { goalId: values.goalId }
            : {}),
      };
    const ok = await mutate(() =>
      api(
        `${path}/${resource}${item ? `/${item.id}` : ""}`,
        item ? "PATCH" : "POST",
        body,
      ),
    );
    if (ok && alive.current) setEditor(null);
  }
  const query = search.trim().toLocaleLowerCase();
  const filteredStories = data.stories.filter(
    (s) =>
      (!onlyRelated || highlightIds?.includes(s.id)) &&
      (!epic || s.epicId === epic) &&
      `${storyNumber(s.id)} ${s.title}`.toLocaleLowerCase().includes(query),
  );
  const taskCounts: Record<number, number> = {};
  store?.tasks.forEach((t) =>
    t.storyIds.forEach((id) => {
      taskCounts[id] = (taskCounts[id] ?? 0) + 1;
    }),
  );
  const relatedStories = data.stories.filter(
    (s) => !onlyRelated || highlightIds?.includes(s.id),
  );
  const relatedEpics = data.epics.filter(
    (e) => !onlyRelated || relatedStories.some((s) => s.epicId === e.id),
  );
  const common = {
    data: {
      ...data,
      stories: relatedStories,
      epics: relatedEpics,
      goals: data.goals.filter(
        (g) => !onlyRelated || relatedEpics.some((e) => e.goalId === g.id),
      ),
    },
    focusOnly,
    readOnly,
    busy: saving,
    focus,
    highlightIds,
    onFocusChange,
    taskCounts,
    onOpen: (s: UserStory) => setViewing({ kind: "story" as const, id: s.id }),
  };
  const title =
    editor?.kind === "requirement"
      ? "正式需求"
      : editor?.kind === "story"
        ? "用户故事"
        : editor?.kind === "goal"
          ? "产品目标"
          : "Epic";
  const parentMap = new Map(
    requirements.map((r) => [r.id, r.parentId ?? null]),
  );
  function descendants(id: number): number[] {
    const found: number[] = [];
    const visit = (key: number) => {
      for (const r of requirements)
        if (r.parentId === key && !found.includes(r.id)) {
          found.push(r.id);
          visit(r.id);
        }
    };
    visit(id);
    return found;
  }
  function depth(id: number) {
    let n = 0,
      cursor = parentMap.get(id);
    const seen = new Set<number>();
    while (cursor != null && !seen.has(cursor)) {
      seen.add(cursor);
      n++;
      cursor = parentMap.get(cursor);
    }
    return n;
  }
  const filtering = !!query || relation !== "all";
  const matches = requirements.filter(
    (r) =>
      `${requirementNumber(r.id)} ${r.title}`
        .toLocaleLowerCase()
        .includes(query) &&
      (relation === "all" ||
        (relation === "linked" ? r.storyIds?.length : !r.storyIds?.length)),
  );
  const included = new Set<number>();
  for (const row of matches) {
    included.add(row.id);
    let cursor = parentMap.get(row.id);
    while (cursor != null && !included.has(cursor)) {
      included.add(cursor);
      cursor = parentMap.get(cursor);
    }
    if (query && relation === "all")
      descendants(row.id).forEach((id) => included.add(id));
  }
  const rows: { item: LinkedRequirement; level: number }[] = [];
  const visited = new Set<number>();
  function traverse(parent: number | null, level: number) {
    for (const r of [...requirements].sort((a, b) => a.id - b.id)) {
      if (
        (r.parentId ?? null) !== parent ||
        visited.has(r.id) ||
        (filtering && !included.has(r.id))
      )
        continue;
      visited.add(r.id);
      rows.push({ item: r, level });
      if (filtering ? !filterCollapsed.includes(r.id) : expanded.includes(r.id))
        traverse(r.id, level + 1);
    }
  }
  traverse(null, 0);
  function toggle(id: number) {
    if (filtering)
      setFilterCollapsed((ids) =>
        ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id],
      );
    else
      setExpanded((ids) =>
        ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id],
      );
  }
  function clearFilters() {
    setSearch("");
    setRelation("all");
    setFilterCollapsed([]);
    setEpic(undefined);
  }
  const editingReq = editor?.kind === "requirement" ? editor.item : undefined;
  const parentOptions = requirements
    .filter(
      (r) =>
        depth(r.id) < 2 &&
        r.id !== editingReq?.id &&
        !descendants(editingReq?.id ?? -1).includes(r.id),
    )
    .map((r) => ({
      value: r.id,
      label: `${requirementNumber(r.id)} · ${r.title}`,
    }));
  const openStory = (id: number) => {
    setViewing({ kind: "story", id });
    onFocusChange?.({
      projectId: project.id,
      entityType: "story",
      entityId: id,
    });
  };
  return (
    <div className="requirements-workspace b-suite">
      {!embeddedView && (
        <PageHeading
          title="需求管理"
          description="管理正式需求及其关联关系"
          actions={
            !readOnly && (
              <>
                <AiEntry kind="PLANNING" label="AI 智能规划" />
                <button
                  className="btn primary"
                  disabled={saving}
                  onClick={() => edit({ kind: "requirement" })}
                >
                  <Icon name="plus" size={14} />
                  新建需求
                </button>
              </>
            )
          }
        />
      )}
      {failure && (
        <Alert
          type="error"
          title={failure}
          description="请刷新后重试。"
          closable
          onClose={() => setFailure("")}
        />
      )}
      <div className={embeddedView ? "" : "card"}>
        {!embeddedView && (
          <div className="view-tabbar">
            <div className="tabs" role="tablist">
              {[["list", "需求列表"]].map(([id, label]) => (
                <button
                  role="tab"
                  aria-selected={tab === id}
                  key={id}
                  className={`tab ${tab === id ? "active" : ""}`}
                  onClick={() => {
                    setTab(id);
                    clearFilters();
                  }}
                >
                  {label}
                  <span className={`chip ${tab === id ? "blue" : "gray"}`}>
                    {id === "list" ? requirements.length : data.stories.length}
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}
        <div
          className="plain-content"
          style={{ padding: tab === "list" ? 0 : embeddedView ? 0 : 16 }}
        >
          {tab === "list" ? (
            <>
              <div className="b-info-toolbar">
                <div className="b-info-left">
                  <div className="searchbox">
                    <Icon name="search" size={15} />
                    <input
                      className="input"
                      aria-label="搜索需求编号或标题"
                      placeholder="搜索需求编号或标题"
                      value={search}
                      onChange={(e) => {
                        setSearch(e.target.value);
                        setFilterCollapsed([]);
                      }}
                    />
                  </div>
                  <select
                    className="select"
                    aria-label="需求关联筛选"
                    style={{ width: 140 }}
                    value={relation}
                    onChange={(e) => {
                      setRelation(e.target.value);
                      setFilterCollapsed([]);
                    }}
                  >
                    <option value="all">全部关联情况</option>
                    <option value="linked">已关联故事</option>
                    <option value="unlinked">未关联故事</option>
                  </select>
                </div>
                <div className="b-info-right">
                  {filtering && (
                    <button className="btn small" onClick={clearFilters}>
                      清除筛选
                    </button>
                  )}
                  <button
                    className="btn"
                    onClick={() => void reload().catch(report)}
                  >
                    <Icon name="refresh" size={14} />
                    刷新
                  </button>
                </div>
              </div>
              <div className="b-req-tree-toolbar">
                <span>共 {matches.length} 条需求</span>
                <div className="b-tree-actions">
                  <button
                    className="b-link-mini"
                    onClick={() => {
                      setExpanded(requirements.map((r) => r.id));
                      setFilterCollapsed([]);
                    }}
                  >
                    全部展开
                  </button>
                  <button
                    className="b-link-mini"
                    onClick={() => {
                      setExpanded([]);
                      setFilterCollapsed(requirements.map((r) => r.id));
                    }}
                  >
                    全部收起
                  </button>
                </div>
              </div>
              <div className="data-table-wrap b-req-flat-wrap">
                <table className="b-req-table b-req-tree">
                  <thead>
                    <tr>
                      <th style={{ width: 110 }}>ID</th>
                      <th>需求标题</th>
                      <th style={{ width: 170 }}>关联用户故事</th>
                      <th style={{ width: 118 }}>更新时间</th>
                      <th style={{ width: 155 }}>操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map(({ item: r, level }) => {
                      const children = requirements.filter(
                          (c) => c.parentId === r.id,
                        ),
                        isExpanded = filtering
                          ? !filterCollapsed.includes(r.id)
                          : expanded.includes(r.id);
                      return (
                        <tr key={r.id} data-req-row={r.id}>
                          <td className="b-req-id">
                            {requirementNumber(r.id)}
                          </td>
                          <td>
                            <div
                              className="b-req-hierarchy"
                              style={{ paddingLeft: level * 23 }}
                            >
                              {children.length ? (
                                <button
                                  className="b-tree-toggle"
                                  aria-expanded={isExpanded}
                                  aria-label={`${isExpanded ? "收起" : "展开"}${r.title}的子需求`}
                                  onClick={() => toggle(r.id)}
                                >
                                  <Icon
                                    name={
                                      isExpanded ? "chevron" : "chevron-right"
                                    }
                                    size={14}
                                  />
                                </button>
                              ) : (
                                <span className="b-tree-indent" />
                              )}
                              <button
                                className={`b-req-name ${children.length ? "b-req-bold" : ""}`}
                                onClick={() => void openRequirement(r.id)}
                                title={r.description || r.title}
                              >
                                {r.title}
                              </button>
                              {children.length > 0 && (
                                <span className="b-req-counter">
                                  {children.length}
                                </span>
                              )}
                            </div>
                          </td>
                          <td>
                            <div className="b-rel-badges">
                              {r.storyIds?.map((id) => (
                                <button
                                  className="b-rel-id"
                                  key={id}
                                  onClick={() => openStory(id)}
                                >
                                  {storyNumber(id)}
                                </button>
                              ))}
                              {!r.storyIds?.length && (
                                <span className="muted">—</span>
                              )}
                            </div>
                          </td>
                          <td className="b-req-date">
                            {r.updatedAt?.slice(0, 10) || "—"}
                          </td>
                          <td>
                            <div className="b-row-ops">
                              <button
                                className="btn-text"
                                onClick={() => void openRequirement(r.id)}
                              >
                                查看
                              </button>
                              {!readOnly && (
                                <>
                                  <button
                                    className="btn-text"
                                    disabled={saving}
                                    onClick={() =>
                                      edit({ kind: "requirement", item: r })
                                    }
                                  >
                                    编辑
                                  </button>
                                  {level < 2 && (
                                    <button
                                      className="btn-text"
                                      disabled={saving}
                                      onClick={() =>
                                        edit({
                                          kind: "requirement",
                                          parentId: r.id,
                                        })
                                      }
                                    >
                                      子需求
                                    </button>
                                  )}
                                </>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                    {!rows.length && (
                      <tr>
                        <td colSpan={5}>
                          <div className="empty">
                            {loading ? "正在读取需求" : "没有符合条件的需求"}
                          </div>
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </>
          ) : tab === "map" ? (
            <>
              <div className="ai-row" style={{ marginBottom: 12 }}>
                <AiEntry kind="COVERAGE" label="AI 覆盖检查" />
              </div>
              <StoryMap
                {...common}
                onMove={(...args) => void move(...args)}
                onNewGoal={() => edit({ kind: "goal" })}
                onEditGoal={(item) => edit({ kind: "goal", item })}
                onNewEpic={(g) => edit({ kind: "epic", goalId: g.id })}
                onEditEpic={(item) => edit({ kind: "epic", item })}
                onNewStory={(e) => edit({ kind: "story", epicId: e.id })}
              />
            </>
          ) : (
            <>
              <div
                className="b-info-toolbar"
                style={{ padding: "0 0 12px", border: 0 }}
              >
                <div className="b-info-left">
                  <div className="searchbox">
                    <Icon name="search" size={15} />
                    <input
                      className="input"
                      aria-label="搜索故事"
                      placeholder="搜索故事编号或标题"
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                    />
                  </div>
                  <select
                    className="select"
                    aria-label="筛选 Epic"
                    style={{ width: 173 }}
                    value={epic ?? ""}
                    onChange={(e) =>
                      setEpic(
                        e.target.value ? Number(e.target.value) : undefined,
                      )
                    }
                  >
                    <option value="">全部 Epic</option>
                    {data.epics.map((e) => (
                      <option key={e.id} value={e.id}>
                        {e.title}
                      </option>
                    ))}
                  </select>
                  {(search || epic) && (
                    <button className="btn small" onClick={clearFilters}>
                      清空筛选
                    </button>
                  )}
                </div>
                {!readOnly && (
                  <button
                    className="btn small primary"
                    disabled={!data.epics.length || saving}
                    onClick={() =>
                      edit({ kind: "story", epicId: epic ?? data.epics[0]?.id })
                    }
                  >
                    <Icon name="plus" size={13} />
                    新建故事
                  </button>
                )}
              </div>
              <StoryBoard
                {...common}
                stories={filteredStories}
                onStatus={(...args) => void status(...args)}
              />
            </>
          )}
        </div>
      </div>
      <Drawer
        className="v43-drawer"
        styles={{ wrapper: { top: 56, height: "calc(100% - 56px)" } }}
        title={
          <>
            <div className="drawer-kicker">
              {story
                ? `用户故事 · ${storyNumber(story.id)}`
                : requirement
                  ? `正式需求 · ${requirementNumber(requirement.id)}`
                  : "详情"}
            </div>
            <h2 className="drawer-title">
              {story?.title || requirement?.title}
            </h2>
          </>
        }
        footer={
          <>
            <Button onClick={() => setViewing(null)}>关闭</Button>
            {!readOnly && (
              <>
                {requirement && (
                  <AiEntry
                    kind="PLANNING"
                    label="AI 分析已有需求"
                    scope={{
                      requirementId: requirement.id,
                      requestText: `分析已有需求：${requirement.title}，补齐场景、子需求、故事与验收条件。`,
                    }}
                    onOpen={() => setViewing(null)}
                  />
                )}
                <Button
                  type="primary"
                  disabled={saving}
                  onClick={() => {
                    if (story) edit({ kind: "story", item: story });
                    else if (requirement)
                      edit({ kind: "requirement", item: requirement });
                  }}
                >
                  {story ? "编辑故事" : "编辑需求"}
                </Button>
              </>
            )}
          </>
        }
        open={viewing !== null}
        onClose={() => setViewing(null)}
        size={640}
      >
        {story && (
          <>
            <Typography.Title level={5}>所属 Epic</Typography.Title>
            <p>{data.epics.find((e) => e.id === story.epicId)?.title}</p>
            <Typography.Title level={5}>故事状态</Typography.Title>
            {readOnly ? (
              <StoryStatusTag status={story.status} />
            ) : (
              <Select
                aria-label="故事状态"
                disabled={saving}
                value={story.status}
                options={Object.entries(storyStatusLabels).map(
                  ([value, label]) => ({ value, label }),
                )}
                onChange={(value) => void status(story.id, value)}
              />
            )}
            <Typography.Title level={5}>故事描述</Typography.Title>
            <p className="detail-text">{story.description || "暂无说明"}</p>
            <Typography.Title level={5}>验收标准</Typography.Title>
            <p className="detail-text">
              {story.acceptanceCriteria || "暂无验收标准"}
            </p>
            <Typography.Title level={5}>关联正式需求</Typography.Title>
            <Space wrap>
              {story.requirementIds.map((id) => (
                <Button key={id} onClick={() => void openRequirement(id)}>
                  {requirementNumber(id)} ·{" "}
                  {requirements.find((r) => r.id === id)?.title}
                </Button>
              ))}
              {!story.requirementIds.length && "暂无关联"}
            </Space>
            <Typography.Title level={5}>关联任务</Typography.Title>
            <Space wrap>
              {store?.tasks
                .filter((t) => t.storyIds.includes(story.id))
                .map((t) => (
                  <Button
                    key={t.id}
                    onClick={() => {
                      setViewing(null);
                      onOpenTask?.(t.id);
                    }}
                  >
                    {t.title}
                  </Button>
                ))}
            </Space>
          </>
        )}
        {requirement && (
          <>
            <div className="detail-row">
              <div className="detail-label">最近更新</div>
              <div className="detail-value">
                {requirement.updatedAt?.slice(0, 10) || "—"}
              </div>
            </div>
            <Typography.Title level={5}>上级需求</Typography.Title>
            <p>
              {requirements.find((r) => r.id === requirement.parentId)?.title ||
                "无（顶层需求）"}
            </p>
            <Typography.Title level={5}>子需求</Typography.Title>
            <Space wrap>
              {requirements
                .filter((r) => r.parentId === requirement.id)
                .map((r) => (
                  <Button key={r.id} onClick={() => void openRequirement(r.id)}>
                    {requirementNumber(r.id)} · {r.title}
                  </Button>
                ))}
            </Space>
            <Typography.Title level={5}>需求描述</Typography.Title>
            <p className="detail-text">
              {requirement.description || "暂无说明"}
            </p>
            <Typography.Title level={5}>需求验收条件</Typography.Title>
            <p className="detail-text">
              {requirement.acceptanceCriteria || "暂无验收条件"}
            </p>
            <Typography.Title level={5}>关联用户故事</Typography.Title>
            <Space wrap>
              {(requirement.storyIds ?? []).map((id) => (
                <Button
                  key={id}
                  onClick={() => setViewing({ kind: "story", id })}
                >
                  {storyNumber(id)} ·{" "}
                  {data.stories.find((s) => s.id === id)?.title}
                </Button>
              ))}
              {!requirement.storyIds?.length && "暂无关联"}
            </Space>
          </>
        )}
      </Drawer>
      <Modal
        centered
        okText="保存"
        cancelText="取消"
        title={`${editor?.item ? "编辑" : "新建"}${title}`}
        open={editor !== null}
        onCancel={() => {
          if (!saving) setEditor(null);
        }}
        onOk={() => void save()}
        confirmLoading={saving}
        cancelButtonProps={{ disabled: saving }}
        destroyOnHidden
      >
        <Form form={form} layout="vertical" preserve={false} disabled={saving}>
          <Form.Item
            name="title"
            label={
              editor?.kind === "requirement"
                ? "需求标题"
                : editor?.kind === "story"
                  ? "故事标题"
                  : editor?.kind === "goal"
                    ? "产品目标名称"
                    : "Epic 名称"
            }
            rules={[{ required: true, whitespace: true }, { max: 200 }]}
          >
            <Input maxLength={200} />
          </Form.Item>
          {editor?.kind === "requirement" && (
            <>
              <Form.Item name="parentId" label="上级需求">
                <Select
                  allowClear
                  placeholder="无（顶层需求）"
                  options={parentOptions}
                />
              </Form.Item>
              <Form.Item
                name="description"
                label="需求描述"
                rules={[{ max: 10000 }]}
              >
                <Input.TextArea rows={5} />
              </Form.Item>
              <Form.Item name="storyIds" label="关联用户故事">
                <Checkbox.Group className="checkbox-grid">
                  {data.stories.map((s) => (
                    <Checkbox key={s.id} value={s.id}>
                      {storyNumber(s.id)} · {s.title}
                    </Checkbox>
                  ))}
                </Checkbox.Group>
              </Form.Item>
              <Form.Item
                name="acceptanceCriteria"
                label="需求验收条件"
                rules={[{ max: 10000 }]}
              >
                <Input.TextArea rows={3} />
              </Form.Item>
            </>
          )}
          {editor?.kind === "story" && (
            <>
              {
                <Form.Item
                  name="epicId"
                  label="所属 Epic"
                  rules={[{ required: true }]}
                >
                  <Select
                    options={data.epics.map((e) => ({
                      value: e.id,
                      label: e.title,
                    }))}
                  />
                </Form.Item>
              }
              <Form.Item
                name="description"
                label="故事描述"
                rules={[{ max: 10000 }]}
              >
                <Input.TextArea rows={3} />
              </Form.Item>
              <Form.Item
                name="acceptanceCriteria"
                label="验收标准"
                rules={[{ max: 10000 }]}
              >
                <Input.TextArea rows={3} />
              </Form.Item>
              <Form.Item name="requirementIds" label="关联正式需求">
                <Checkbox.Group className="checkbox-grid">
                  {requirements.map((r) => (
                    <Checkbox key={r.id} value={r.id}>
                      {requirementNumber(r.id)} · {r.title}
                    </Checkbox>
                  ))}
                </Checkbox.Group>
              </Form.Item>
            </>
          )}
          {editor?.kind === "epic" && (
            <Form.Item
              name="goalId"
              label="所属产品目标"
              rules={[{ required: true }]}
            >
              <Select
                options={data.goals.map((g) => ({
                  value: g.id,
                  label: g.title,
                }))}
              />
            </Form.Item>
          )}
          {(editor?.kind === "goal" || editor?.kind === "epic") &&
            editor.item && (
              <Form.Item
                name="sortOrder"
                label="排序位置（从 0 开始）"
                rules={[{ type: "integer", min: 0, max: 1000000 }]}
              >
                <InputNumber min={0} precision={0} />
              </Form.Item>
            )}
        </Form>
      </Modal>
    </div>
  );
}
