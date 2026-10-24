import { createContext, useContext, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import {
  Button,
  Checkbox,
  Drawer,
  Form,
  Input,
  InputNumber,
  Modal,
  Select,
  Slider,
} from "antd";
import {
  priorityLabels,
  type ManagedTask,
  type Priority,
  type StoryStatus,
  type TaskActivity,
} from "@spm/shared";
import { api } from "./api";
import { useProjectData } from "./ProjectData";
import { ProgressBar, PriorityTag, Status } from "./ui";
import { storyNumber, taskNumber } from "./StoryViews";
import { AiEntry } from "./ai-events";
interface Actions {
  open(id: number, history?: boolean): void;
  edit(t: ManagedTask | "new"): void;
  assign(t: ManagedTask): void;
  progress(t: ManagedTask): void;
  status(t: ManagedTask, status: StoryStatus): Promise<void>;
  archive(t: ManagedTask, restore?: boolean): void;
  onStory?(id: number): void;
  busy: boolean;
}
const Context = createContext<Actions | null>(null);
export function useTaskActions() {
  const c = useContext(Context);
  if (!c) throw new Error("TaskActionsProvider required");
  return c;
}
interface TaskValues {
  title: string;
  description?: string;
  priority?: Priority;
  assigneeUserId?: number | null;
  storyIds?: number[];
  planIds?: string[];
  progress?: number;
}
export function TaskActionsProvider({
  children,
  onStory,
}: {
  children: ReactNode;
  onStory?: (id: number) => void;
}) {
  const store = useProjectData(),
    { project } = store;
  const [detail, setDetail] = useState<ManagedTask | null>(null),
    [history, setHistory] = useState<TaskActivity[]>([]),
    [editor, setEditor] = useState<ManagedTask | "new" | null>(null),
    [assigning, setAssigning] = useState<ManagedTask | null>(null),
    [busy, setBusy] = useState(false),
    [draft, setDraft] = useState(0);
  const [form] = Form.useForm<TaskValues>(),
    [assignForm] = Form.useForm<TaskValues>();
  const nextAssignee = Form.useWatch("assigneeUserId", assignForm);
  const historyRef = useRef<HTMLDivElement>(null);
  const lock = useRef(false),
    mounted = useRef(true);
  const detailVersion = useRef(0),
    activeDetail = useRef<number | null>(null);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      detailVersion.current++;
      activeDetail.current = null;
    };
  }, []);
  const path = `/projects/${project.id}/tasks`;
  async function open(id: number, scrollHistory = false) {
    const version = ++detailVersion.current;
    activeDetail.current = id;
    try {
      const [t, h] = await Promise.all([
        api<ManagedTask>(`${path}/${id}`),
        api<TaskActivity[]>(`${path}/${id}/history`),
      ]);
      if (version !== detailVersion.current || activeDetail.current !== id)
        return;
      setDetail(t);
      setDraft(t.progress);
      setHistory(h);
      if (scrollHistory)
        setTimeout(
          () => historyRef.current?.scrollIntoView?.({ behavior: "smooth" }),
          150,
        );
    } catch (e) {
      if (mounted.current && version === detailVersion.current)
        store.onError(e);
    }
  }
  function closeDetail() {
    detailVersion.current++;
    activeDetail.current = null;
    setDetail(null);
  }
  async function refreshDetail(id: number) {
    if (activeDetail.current === id) await open(id);
  }
  useEffect(() => {
    if (detail && activeDetail.current === detail.id) {
      const next = store.tasks.find((t) => t.id === detail.id);
      if (next) {
        if (next.revision !== detail.revision) void refreshDetail(detail.id);
        setDetail(next);
      } else if (!detail.archivedAt) closeDetail();
    }
  }, [store.tasks]);
  function edit(t: ManagedTask | "new") {
    if (!project.canManage) return;
    setEditor(t);
    form.resetFields();
    form.setFieldsValue(
      t === "new"
        ? {
            title: "",
            priority: "MEDIUM",
            assigneeUserId: null,
            storyIds: [],
            planIds: [],
          }
        : t,
    );
  }
  function assign(t: ManagedTask) {
    if (!project.canManage) return;
    setAssigning(t);
    assignForm.resetFields();
    assignForm.setFieldsValue({ assigneeUserId: t.assigneeUserId });
  }
  async function run(action: () => Promise<unknown>) {
    if (lock.current) return false;
    lock.current = true;
    setBusy(true);
    try {
      await action();
      return true;
    } catch (e) {
      store.onError(e);
      return false;
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  async function save() {
    let values: TaskValues;
    try {
      values = await form.validateFields();
    } catch {
      return;
    }
    if (!editor) return;
    const { planIds, ...fields } = values;
    const body = {
      ...fields,
      assigneeUserId: values.assigneeUserId ?? null,
      storyIds: values.storyIds ?? [],
      ...(store.plans.available ? { planIds: planIds ?? [] } : {}),
    };
    if (
      await run(() =>
        store.write(
          editor === "new" ? "/tasks" : `/tasks/${editor.id}`,
          editor === "new" ? "POST" : "PATCH",
          {
            ...body,
            ...(editor !== "new" ? { revision: editor.revision } : {}),
          },
        ),
      )
    )
      setEditor(null);
  }
  async function saveAssignee() {
    if (!assigning) return;
    let values: TaskValues;
    try {
      values = await assignForm.validateFields();
    } catch {
      return;
    }
    if (
      await run(() =>
        store.write(`/tasks/${assigning.id}/assignee`, "PATCH", {
          assigneeUserId: values.assigneeUserId ?? null,
          revision: assigning.revision,
        }),
      )
    ) {
      setAssigning(null);
      if (detail?.id === assigning.id) void refreshDetail(detail.id);
    }
  }
  async function status(t: ManagedTask, next: StoryStatus) {
    const execute = () =>
      run(async () => {
        await store.write(`/tasks/${t.id}/status`, "PATCH", {
          status: next,
          revision: t.revision,
        });
        if (detail?.id === t.id) await refreshDetail(t.id);
      });
    if (next === "TODO" && t.status === "IN_PROGRESS") {
      Modal.confirm({
        centered: true,
        title: "退回待处理",
        content: "退回后进度重置为 0%，操作记录将保留。",
        onOk: execute,
      });
    } else await execute();
  }
  function archive(t: ManagedTask, restore = false) {
    Modal.confirm({
      centered: true,
      title: restore ? "恢复任务" : "归档任务",
      content: restore
        ? "恢复后任务将重新出现在任务列表中。"
        : "归档后任务不再出现在常规列表与关系图，项目经理可恢复。",
      onOk: () =>
        run(async () => {
          await store.write(
            `/tasks/${t.id}/${restore ? "restore" : "archive"}`,
            "POST",
            { revision: t.revision },
          );
          if (detail?.id === t.id) closeDetail();
        }),
    });
  }
  const actions: Actions = {
    open,
    edit,
    assign,
    progress: (t) => {
      void open(t.id);
    },
    status,
    archive,
    onStory,
    busy,
  };
  const footer = detail ? (
    <>
      <Button onClick={closeDetail}>关闭</Button>
      {!project.canManage && (
        <AiEntry
          kind="TASK"
          label="查看 AI 执行建议"
          scope={{ taskId: detail.id }}
          onOpen={closeDetail}
        />
      )}
      {project.canManage && (
        <>
          {!detail.archivedAt && (
            <AiEntry
              kind="TASK"
              label="AI 执行建议"
              scope={{ taskId: detail.id }}
              onOpen={closeDetail}
            />
          )}
          <Button
            disabled={busy || !!detail.archivedAt}
            onClick={() => assign(detail)}
          >
            调整负责人
          </Button>
          <Button
            type="primary"
            disabled={busy || !!detail.archivedAt}
            onClick={() => edit(detail)}
          >
            编辑任务
          </Button>
        </>
      )}
    </>
  ) : null;
  const field = (label: string, value: ReactNode) => (
    <div className="detail-row">
      <div className="detail-label">{label}</div>
      <div className="detail-value">{value}</div>
    </div>
  );
  return (
    <Context.Provider value={actions}>
      {children}
      <Drawer
        className="v43-drawer"
        size={640}
        styles={{ wrapper: { top: 56, height: "calc(100% - 56px)" } }}
        title={
          detail ? (
            <>
              <div className="drawer-kicker">
                任务详情 · {taskNumber(detail.id)}
              </div>
              <h2 className="drawer-title">{detail.title}</h2>
            </>
          ) : (
            ""
          )
        }
        open={!!detail}
        onClose={closeDetail}
        footer={footer}
      >
        {detail && (
          <>
            {field("任务描述", detail.description || "暂无说明")}
            {field(
              "负责人",
              store.members.find((m) => m.userId === detail.assigneeUserId)
                ?.user.username || "未指派",
            )}
            {field("任务优先级", <PriorityTag value={detail.priority} />)}
            {field(
              "当前状态",
              <>
                <Status value={detail.status} />
                {!detail.archivedAt && (
                  <div className="filters" style={{ marginTop: 10 }}>
                    {detail.status === "TODO" ? (
                      <>
                        <Button
                          size="small"
                          disabled={busy}
                          onClick={() => void status(detail, "IN_PROGRESS")}
                        >
                          开始任务
                        </Button>
                        <Button
                          size="small"
                          disabled={busy}
                          onClick={() => void status(detail, "DONE")}
                        >
                          直接完成
                        </Button>
                      </>
                    ) : detail.status === "IN_PROGRESS" ? (
                      <>
                        <Button
                          size="small"
                          disabled={busy}
                          onClick={() => void status(detail, "DONE")}
                        >
                          标记完成
                        </Button>
                        <Button
                          size="small"
                          disabled={busy}
                          onClick={() => void status(detail, "TODO")}
                        >
                          退回待处理
                        </Button>
                      </>
                    ) : (
                      project.canManage && (
                        <Button
                          size="small"
                          disabled={busy}
                          onClick={() => void status(detail, "IN_PROGRESS")}
                        >
                          重新打开
                        </Button>
                      )
                    )}
                  </div>
                )}
              </>,
            )}
            {field(
              "完成百分比",
              <>
                <ProgressBar value={detail.progress} status={detail.status} />
                {detail.status === "IN_PROGRESS" && !detail.archivedAt && (
                  <div className="progress-edit" style={{ marginTop: 13 }}>
                    <input
                      aria-label="完成百分比"
                      type="range"
                      min={0}
                      max={99}
                      step={1}
                      value={draft}
                      onChange={(e) => setDraft(Number(e.target.value))}
                    />
                    <strong>{draft}%</strong>
                    <Button
                      size="small"
                      type="primary"
                      disabled={busy}
                      onClick={() =>
                        void run(async () => {
                          await store.write(
                            `/tasks/${detail.id}/progress`,
                            "PATCH",
                            { progress: draft, revision: detail.revision },
                          );
                          await refreshDetail(detail.id);
                        })
                      }
                    >
                      保存进度
                    </Button>
                  </div>
                )}
              </>,
            )}
            {field(
              "关联用户故事",
              detail.storyIds.map((id) => (
                <button
                  key={id}
                  className="btn small light"
                  onClick={() => {
                    closeDetail();
                    onStory?.(id);
                  }}
                >
                  {storyNumber(id)} ·{" "}
                  {store.stories.stories.find((s) => s.id === id)?.title}
                </button>
              )),
            )}
            {field(
              "关联计划项",
              <>
                {detail.planIds.map((id) => (
                  <span className="chip" key={id}>
                    {store.plans.items.find((p) => p.id === id)?.title || id}
                  </span>
                ))}
                {!store.plans.available && (
                  <span className="muted">{store.plans.reason}</span>
                )}
              </>,
            )}
            <div className="b-task-history" ref={historyRef}>
              <h4>操作记录</h4>
              {history.length ? (
                history.map((h) => (
                  <div className="b-history-row" key={h.id}>
                    <time>{new Date(h.createdAt).toLocaleString("zh-CN")}</time>
                    <div>
                      <strong>{h.actorName}</strong> · {h.action}
                      <details>
                        <summary>查看变更</summary>
                        <pre>
                          {JSON.stringify(
                            { before: h.before, after: h.after },
                            null,
                            2,
                          )}
                        </pre>
                      </details>
                    </div>
                  </div>
                ))
              ) : (
                <span className="muted">暂无操作记录</span>
              )}
            </div>
            {project.canManage && (
              <Button
                disabled={busy}
                danger={!detail.archivedAt}
                onClick={() => archive(detail, !!detail.archivedAt)}
              >
                {detail.archivedAt ? "恢复任务" : "归档任务"}
              </Button>
            )}
          </>
        )}
      </Drawer>
      <Modal
        centered
        title={editor === "new" ? "新建任务" : "编辑任务"}
        open={editor !== null}
        onCancel={() => {
          if (!busy) setEditor(null);
        }}
        onOk={() => void save()}
        okText="保存"
        confirmLoading={busy}
        destroyOnHidden
      >
        <Form form={form} layout="vertical" disabled={busy} preserve={false}>
          <Form.Item
            name="title"
            label="任务标题"
            rules={[{ required: true, whitespace: true }, { max: 200 }]}
          >
            <Input maxLength={200} />
          </Form.Item>
          <Form.Item
            name="description"
            label="任务描述"
            rules={[{ max: 10000 }]}
          >
            <Input.TextArea rows={3} />
          </Form.Item>
          <Form.Item name="assigneeUserId" label="负责人">
            <Select
              allowClear
              placeholder="未指派"
              options={store.members
                .filter((m) => m.user.active)
                .map((m) => ({ value: m.userId, label: m.user.username }))}
            />
          </Form.Item>
          <Form.Item
            name="priority"
            label="优先级"
            rules={[{ required: true }]}
          >
            <Select
              options={Object.entries(priorityLabels).map(([value, label]) => ({
                value,
                label,
              }))}
            />
          </Form.Item>
          <Form.Item name="storyIds" label="关联用户故事">
            <Checkbox.Group className="checkbox-grid">
              {store.stories.stories.map((s) => (
                <Checkbox key={s.id} value={s.id}>
                  {storyNumber(s.id)} · {s.title}
                </Checkbox>
              ))}
            </Checkbox.Group>
          </Form.Item>
          <Form.Item
            name="planIds"
            label="关联计划项"
            extra={!store.plans.available ? store.plans.reason : undefined}
          >
            <Checkbox.Group
              disabled={!store.plans.available}
              className="checkbox-grid"
            >
              {store.plans.items
                .filter((p) => p.kind === "item")
                .map((p) => (
                  <Checkbox key={p.id} value={p.id}>
                    {p.title}
                  </Checkbox>
                ))}
            </Checkbox.Group>
          </Form.Item>
        </Form>
      </Modal>
      <Modal
        centered
        title="调整任务负责人"
        open={!!assigning}
        onCancel={() => {
          if (!busy) setAssigning(null);
        }}
        onOk={() => void saveAssignee()}
        okText="保存"
        confirmLoading={busy}
        destroyOnHidden
      >
        <p className="banner-inline">
          {assigning && taskNumber(assigning.id)} · {assigning?.title}
        </p>
          <p className="banner-inline" aria-live="polite">
            负责人：{store.members.find((m) => m.userId === assigning?.assigneeUserId)?.user.username || "未分配"}
            {" → "}{store.members.find((m) => m.userId === nextAssignee)?.user.username || "未分配"}
            <br />保存只调整任务负责人，不修改计划负责人、计划日期或故事状态。
          </p>
        <Form form={assignForm} layout="vertical" disabled={busy}>
          <Form.Item name="assigneeUserId" label="新的主要负责人">
            <Select
              allowClear
              placeholder="未分配"
              options={store.members
                .filter((m) => m.user.active)
                .map((m) => ({ value: m.userId, label: m.user.username }))}
            />
          </Form.Item>
        </Form>
        <p className="help">负责人改变后，原负责人立即失去该任务的修改权限。</p>
      </Modal>
    </Context.Provider>
  );
}
