import { useEffect, useId, useRef, useState } from "react";
import { Modal, Popconfirm, Select } from "antd";
import type { UmlSequence, ViewFocus } from "@spm/shared";
import { useProjectData } from "./ProjectData";

type Draft = Omit<UmlSequence, "id" | "projectId"> & { id?: number };
const blank = (): Draft => ({
  name: "",
  description: "",
  participants: [
    { id: "actor", name: "参与者" },
    { id: "system", name: "系统" },
  ],
  messages: [],
  storyIds: [],
  useCaseIds: [],
  revision: 0,
});
export function SequenceView({
  focus,
  highlightIds,
  onlyRelated,
  onFocusChange,
  onNavigate,
}: {
  focus: ViewFocus | null;
  highlightIds: number[];
  onlyRelated: boolean;
  onFocusChange(f: ViewFocus): void;
  onNavigate(f: Pick<ViewFocus, "entityType" | "entityId">): void;
}) {
  const store = useProjectData(),
    arrow = useId().replace(/:/g, ""),
    can = store.project.canManage;
  const [selected, setSelected] = useState<number>(),
    [draft, setDraft] = useState<Draft | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const lock = useRef(false);
  const sequences = store.sequences.filter(
    (s) => !onlyRelated || highlightIds.includes(s.id),
  );
  const sequence = sequences.find((s) => s.id === selected) || sequences[0];
  const uses = store.diagrams
    .flatMap((d) => d.nodes)
    .filter((n) => n.kind === "USE_CASE");
  useEffect(() => {
    if (focus?.entityType === "sequence") setSelected(Number(focus.entityId));
    else if (highlightIds.length && !highlightIds.includes(selected || -1))
      setSelected(highlightIds[0]);
  }, [focus?.entityType, focus?.entityId, highlightIds.join(",")]);
  useEffect(() => {
    if (!can) {
      setDraft(null);
      setError("");
    }
  }, [can]);
  function edit(value?: UmlSequence) {
    setError("");
    setDraft(value ? structuredClone(value) : blank());
  }
  async function save() {
    if (!draft || !can || lock.current) return;
    const ids = new Set(draft.participants.map((p) => p.id));
    if (
      !draft.name.trim() ||
      !ids.size ||
      draft.participants.some((p) => !p.name.trim()) ||
      draft.messages.some(
        (m) => !m.label.trim() || !ids.has(m.fromId) || !ids.has(m.toId),
      )
    ) {
      setError("请填写场景名称、参与者名称和有效消息。");
      return;
    }
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      const {
        id,
        name,
        description,
        participants,
        messages,
        storyIds,
        useCaseIds,
        revision,
      } = draft;
      const body = {
        name,
        description,
        participants,
        messages,
        storyIds,
        useCaseIds,
        revision,
      };
      const saved = await store.write<UmlSequence>(
        `/uml-sequences${id ? `/${id}` : ""}`,
        id ? "PATCH" : "POST",
        body,
      );
      setSelected(saved.id);
      setDraft(null);
      onFocusChange({
        projectId: store.project.id,
        entityType: "sequence",
        entityId: saved.id,
      });
    } catch (e) {
      setError(
        (e as Error).message + "；如有版本冲突，请保留内容并关闭后重新编辑。",
      );
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  async function remove() {
    if (!sequence || lock.current || !can) return;
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      await store.write(
        `/uml-sequences/${sequence.id}?revision=${sequence.revision}`,
        "DELETE",
      );
      setSelected(undefined);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  const positions = new Map(
    sequence?.participants.map((p, i) => [p.id, 110 + i * 190]),
  );
  const width = Math.max(640, (sequence?.participants.length || 0) * 190 + 30),
    height = Math.max(330, 150 + (sequence?.messages.length || 0) * 64);
  const update = (patch: Partial<Draft>) =>
    setDraft((d) => (d ? { ...d, ...patch } : null));
  return (
    <div className="wb-sequence">
      <div className="wb-sequence-toolbar">
        <label>
          交互场景
          <select
            className="select"
            aria-label="时序场景"
            value={sequence?.id || ""}
            onChange={(e) => {
              const id = Number(e.target.value);
              setSelected(id);
              onFocusChange({
                projectId: store.project.id,
                entityType: "sequence",
                entityId: id,
              });
            }}
          >
            {!sequences.length && <option value="">暂无场景</option>}
            {sequences.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
        {sequence && (
          <button
            className="btn small"
            onClick={() =>
              onFocusChange({
                projectId: store.project.id,
                entityType: "sequence",
                entityId: sequence.id,
              })
            }
          >
            追踪此场景
          </button>
        )}
        {can && (
          <>
            <button className="btn small primary" onClick={() => edit()}>
              新建时序场景
            </button>
            {sequence && (
              <>
                <button className="btn small" onClick={() => edit(sequence)}>
                  编辑场景
                </button>
                <Popconfirm
                  title="删除此时序场景？关联故事、用例和业务数据会保留。"
                  onConfirm={() => void remove()}
                >
                  <button className="btn small" disabled={busy}>
                    删除场景
                  </button>
                </Popconfirm>
              </>
            )}
          </>
        )}
      </div>
      {error && !draft && (
        <div role="alert" className="wb-error">
          {error}
        </div>
      )}
      {sequence ? (
        <>
          <div className="wb-sequence-intro">
            <h3>{sequence.name}</h3>
            <p>{sequence.description || "交互设计场景"}</p>
            <small>设计场景 · 非实时运行轨迹</small>
          </div>
          <div
            className="wb-sequence-chart"
            data-focus-key={`sequence:${sequence.id}`}
          >
            <svg
              width={width}
              height={height}
              viewBox={`0 0 ${width} ${height}`}
              role="img"
              aria-label={`${sequence.name}时序图`}
            >
              <defs>
                <marker
                  id={arrow}
                  markerWidth="8"
                  markerHeight="8"
                  refX="7"
                  refY="4"
                  orient="auto"
                >
                  <path d="M0 0 L8 4 L0 8" fill="none" stroke="#397dde" />
                </marker>
              </defs>
              {sequence.participants.map((p) => (
                <g key={p.id}>
                  <rect
                    x={positions.get(p.id)! - 76}
                    y={24}
                    width={152}
                    height={44}
                    rx={7}
                    fill="#f3f7ff"
                    stroke="#c4d6ee"
                  />
                  <text
                    x={positions.get(p.id)}
                    y={51}
                    textAnchor="middle"
                    fontSize={13}
                    fill="#365773"
                  >
                    <title>{p.name}</title>
                    {p.name.length > 10 ? p.name.slice(0, 9) + "…" : p.name}
                  </text>
                  <line
                    x1={positions.get(p.id)}
                    x2={positions.get(p.id)}
                    y1={68}
                    y2={height - 20}
                    stroke="#bbcddd"
                    strokeDasharray="5 6"
                  />
                </g>
              ))}
              {sequence.messages.map((m, i) => {
                const from = positions.get(m.fromId)!,
                  to = positions.get(m.toId)!,
                  y = 120 + i * 64,
                  self = from === to;
                return (
                  <g key={i}>
                    <path
                      d={
                        self
                          ? `M${from} ${y} h62 v25 h-62`
                          : `M${from} ${y} H${to}`
                      }
                      fill="none"
                      stroke="#397dde"
                      strokeWidth={1.5}
                      strokeDasharray={m.kind === "return" ? "5 4" : undefined}
                      markerEnd={`url(#${arrow})`}
                    />
                    <text
                      x={self ? from + 12 : (from + to) / 2}
                      y={y - 10}
                      textAnchor={self ? "start" : "middle"}
                      fontSize={12}
                      fill="#51657e"
                    >
                      <title>{m.label}</title>
                      {i + 1}.{" "}
                      {m.label.length > 22
                        ? m.label.slice(0, 21) + "…"
                        : m.label}
                    </text>
                  </g>
                );
              })}
            </svg>
          </div>
          <div className="wb-sequence-links">
            <span>关联故事：</span>
            {sequence.storyIds.map((id) => (
              <button
                className="link"
                key={id}
                onClick={() =>
                  onNavigate({ entityType: "story", entityId: id })
                }
              >
                {store.stories.stories.find((s) => s.id === id)?.title ||
                  `US-${id}`}
              </button>
            ))}
            <span>关联用例：</span>
            {sequence.useCaseIds.map((id) => (
              <button
                className="link"
                key={id}
                onClick={() =>
                  onNavigate({ entityType: "umlUseCase", entityId: id })
                }
              >
                {uses.find((u) => u.id === id)?.name || `UC-${id}`}
              </button>
            ))}
          </div>
        </>
      ) : (
        <div className="wb-empty wb-sequence-empty">
          <strong>
            {onlyRelated ? "当前焦点没有关联时序场景" : "还没有时序场景"}
          </strong>
          <p>
            {can
              ? "创建参与者和交互消息，再关联真实故事与用例。"
              : "项目经理创建场景后，可在这里查看和追踪。"}
          </p>
        </div>
      )}
      <Modal
        open={!!draft && can}
        title={draft?.id ? "编辑时序场景" : "新建时序场景"}
        width={940}
        onCancel={() => !busy && setDraft(null)}
        onOk={() => void save()}
        confirmLoading={busy}
        okText="保存场景"
        cancelText="取消"
        destroyOnHidden
        mask={{ closable: !busy }}
        closable={!busy}
        keyboard={!busy}
      >
        {draft && (
          <div className="wb-sequence-editor">
            <p className="wb-track-note">
              保存只更新此设计场景及其关联；不会修改任务状态、计划日期或原用例图。
            </p>
            {error && (
              <div role="alert" className="wb-error">
                {error}
              </div>
            )}
            <label>
              场景名称
              <input
                aria-label="场景名称"
                maxLength={200}
                value={draft.name}
                disabled={busy}
                onChange={(e) => update({ name: e.target.value })}
              />
            </label>
            <label>
              场景说明
              <textarea
                aria-label="场景说明"
                maxLength={10000}
                value={draft.description}
                disabled={busy}
                onChange={(e) => update({ description: e.target.value })}
              />
            </label>
            <div className="wb-editor-grid">
              <label>
                关联用户故事
                <Select
                  mode="multiple"
                  aria-label="场景关联故事"
                  value={draft.storyIds}
                  disabled={busy}
                  onChange={(storyIds) => update({ storyIds })}
                  options={store.stories.stories.map((s) => ({
                    value: s.id,
                    label: s.title,
                  }))}
                />
              </label>
              <label>
                关联用例
                <Select
                  mode="multiple"
                  aria-label="场景关联用例"
                  value={draft.useCaseIds}
                  disabled={busy}
                  onChange={(useCaseIds) => update({ useCaseIds })}
                  options={uses.map((u) => ({ value: u.id, label: u.name }))}
                />
              </label>
            </div>
            <h4>
              参与者 <span>{draft.participants.length}/24</span>
            </h4>
            {draft.participants.map((p, i) => (
              <div className="wb-participant-editor" key={p.id}>
                <span>{i + 1}</span>
                <input
                  aria-label={`参与者 ${i + 1} 名称`}
                  maxLength={100}
                  value={p.name}
                  disabled={busy}
                  onChange={(e) =>
                    update({
                      participants: draft.participants.map((x) =>
                        x.id === p.id ? { ...x, name: e.target.value } : x,
                      ),
                    })
                  }
                />
                <button
                  className="btn small"
                  disabled={
                    busy ||
                    draft.participants.length === 1 ||
                    draft.messages.some(
                      (m) => m.fromId === p.id || m.toId === p.id,
                    )
                  }
                  title="请先移除此参与者的消息"
                  onClick={() =>
                    update({
                      participants: draft.participants.filter(
                        (x) => x.id !== p.id,
                      ),
                    })
                  }
                >
                  移除
                </button>
              </div>
            ))}
            <button
              className="btn small"
              disabled={busy || draft.participants.length >= 24}
              onClick={() =>
                update({
                  participants: [
                    ...draft.participants,
                    { id: crypto.randomUUID(), name: "" },
                  ],
                })
              }
            >
              添加参与者
            </button>
            <h4>
              消息顺序 <span>{draft.messages.length}/200</span>
            </h4>
            {draft.messages.map((m, i) => (
              <div className="wb-message-editor" key={i}>
                <span>{i + 1}</span>
                <select
                  aria-label={`消息 ${i + 1} 发送方`}
                  disabled={busy}
                  value={m.fromId}
                  onChange={(e) =>
                    update({
                      messages: draft.messages.map((x, j) =>
                        i === j ? { ...x, fromId: e.target.value } : x,
                      ),
                    })
                  }
                >
                  {draft.participants.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name || "未命名"}
                    </option>
                  ))}
                </select>
                <span>→</span>
                <select
                  aria-label={`消息 ${i + 1} 接收方`}
                  disabled={busy}
                  value={m.toId}
                  onChange={(e) =>
                    update({
                      messages: draft.messages.map((x, j) =>
                        i === j ? { ...x, toId: e.target.value } : x,
                      ),
                    })
                  }
                >
                  {draft.participants.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name || "未命名"}
                    </option>
                  ))}
                </select>
                <input
                  aria-label={`消息 ${i + 1} 内容`}
                  maxLength={200}
                  disabled={busy}
                  value={m.label}
                  onChange={(e) =>
                    update({
                      messages: draft.messages.map((x, j) =>
                        i === j ? { ...x, label: e.target.value } : x,
                      ),
                    })
                  }
                />
                <select
                  aria-label={`消息 ${i + 1} 类型`}
                  value={m.kind}
                  disabled={busy}
                  onChange={(e) =>
                    update({
                      messages: draft.messages.map((x, j) =>
                        i === j
                          ? { ...x, kind: e.target.value as "call" | "return" }
                          : x,
                      ),
                    })
                  }
                >
                  <option value="call">调用</option>
                  <option value="return">返回</option>
                </select>
                <button
                  className="btn small"
                  aria-label={`上移消息 ${i + 1}`}
                  disabled={busy || i === 0}
                  onClick={() => {
                    const messages = [...draft.messages];
                    [messages[i - 1], messages[i]] = [
                      messages[i],
                      messages[i - 1],
                    ];
                    update({ messages });
                  }}
                >
                  ↑
                </button>
                <button
                  className="btn small"
                  aria-label={`下移消息 ${i + 1}`}
                  disabled={busy || i === draft.messages.length - 1}
                  onClick={() => {
                    const messages = [...draft.messages];
                    [messages[i + 1], messages[i]] = [
                      messages[i],
                      messages[i + 1],
                    ];
                    update({ messages });
                  }}
                >
                  ↓
                </button>
                <button
                  className="btn small"
                  aria-label={`删除消息 ${i + 1}`}
                  disabled={busy}
                  onClick={() =>
                    update({
                      messages: draft.messages.filter((_, j) => i !== j),
                    })
                  }
                >
                  ×
                </button>
              </div>
            ))}
            <button
              className="btn small"
              disabled={busy || draft.messages.length >= 200}
              onClick={() =>
                update({
                  messages: [
                    ...draft.messages,
                    {
                      fromId: draft.participants[0].id,
                      toId:
                        draft.participants[1]?.id || draft.participants[0].id,
                      label: "",
                      kind: "call",
                    },
                  ],
                })
              }
            >
              添加消息
            </button>
          </div>
        )}
      </Modal>
    </div>
  );
}
