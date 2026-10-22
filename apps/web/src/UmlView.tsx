import { useEffect, useId, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import {
  Button,
  Checkbox,
  Drawer,
  Form,
  Input,
  InputNumber,
  Modal,
  Select,
} from "antd";
import type { UmlEdge, UmlNode, ViewFocus } from "@spm/shared";
import { useProjectData } from "./ProjectData";
import { Icon } from "./ui";
import { storyNumber } from "./StoryViews";
export function UmlView({
  highlightIds = [],
  onFocusChange,
  onStory,
}: {
  highlightIds?: number[];
  onFocusChange?: (f: ViewFocus) => void;
  onStory?: (id: number) => void;
}) {
  const store = useProjectData();
  const [selected, setSelected] = useState<number>(),
    [zoom, setZoom] = useState(1),
    [search, setSearch] = useState(""),
    [storyFilter, setStoryFilter] = useState<number>(),
    [linking, setLinking] = useState(false),
    [linkType, setLinkType] = useState<UmlEdge["kind"]>("association"),
    [linkFrom, setLinkFrom] = useState<number>(),
    [busy, setBusy] = useState(false),
    [nodeDrawer, setNodeDrawer] = useState<number>(),
    [edgeDrawer, setEdgeDrawer] = useState<number>(),
    [editing, setEditing] = useState<{
      kind: "ACTOR" | "USE_CASE" | "diagram" | "boundary";
      node?: UmlNode;
    } | null>(null),
    [draft, setDraft] = useState<Record<number, { x: number; y: number }>>({});
  const [form] = Form.useForm();
  const drag = useRef<{
      id: number;
      x: number;
      y: number;
      startX: number;
      startY: number;
      moved: boolean;
    } | null>(null),
    suppress = useRef(false);
  const arrow = useId().replace(/:/g, "");
  const diagram =
      store.diagrams.find((d) => d.id === selected) || store.diagrams[0],
    readOnly = !store.project.canManage;
  const node = diagram?.nodes.find((n) => n.id === nodeDrawer),
    edge = diagram?.edges.find((e) => e.id === edgeDrawer);
  const base = `/uml-diagrams/${diagram?.id}`;
  async function run(path: string, method: string, body?: unknown) {
    if (busy) return false;
    setBusy(true);
    try {
      await store.write(path, method, body);
      return true;
    } catch (e) {
      store.onError(e);
      return false;
    } finally {
      setBusy(false);
    }
  }
  function edit(
    kind: "ACTOR" | "USE_CASE" | "diagram" | "boundary",
    node?: UmlNode,
    fromStory = false,
  ) {
    if (readOnly) return;
    setEditing({ kind, node });
    form.resetFields();
    const story = store.stories.stories.find((s) => s.id === storyFilter);
    form.setFieldsValue(
      kind === "boundary"
        ? { ...diagram?.boundary }
        : node
          ? node
          : {
              name: fromStory ? story?.title : "",
              description: fromStory ? story?.description : "",
              storyIds: fromStory && story ? [story.id] : [],
            },
    );
  }
  async function save() {
    if (!editing) return;
    let v: Record<string, unknown>;
    try {
      v = await form.validateFields();
    } catch {
      return;
    }
    let ok = false;
    if (editing.kind === "diagram") {
      setBusy(true);
      try {
        const created = await store.write<{ id: number }>(
          "/uml-diagrams",
          "POST",
          { name: v.name },
        );
        setSelected(created.id);
        ok = true;
      } catch (e) {
        store.onError(e);
      } finally {
        setBusy(false);
      }
    } else if (editing.kind === "boundary")
      ok = await run(base + "/boundary", "PATCH", {
        ...v,
        revision: diagram?.revision,
      });
    else {
      const n = editing.node;
      ok = await run(
        base + (n ? `/nodes/${n.id}` : "/nodes"),
        n ? "PATCH" : "POST",
        {
          ...v,
          ...(n
            ? { revision: n.revision }
            : {
                kind: editing.kind,
                x: editing.kind === "ACTOR" ? 115 : 476,
                y:
                  editing.kind === "ACTOR"
                    ? 120 +
                      (diagram?.nodes.filter((n) => n.kind === "ACTOR")
                        .length ?? 0) *
                        90
                    : 100 +
                      (((diagram?.nodes.filter((n) => n.kind === "USE_CASE")
                        .length ?? 0) *
                        83) %
                        330),
              }),
        },
      );
    }
    if (ok) setEditing(null);
  }
  function openNode(n: UmlNode) {
    if (linking && !readOnly) {
      if (linkFrom === undefined) {
        setLinkFrom(n.id);
        return;
      }
      void run(base + "/edges", "POST", {
        fromId: linkFrom,
        toId: n.id,
        kind: linkType,
      }).then((ok) => {
        if (ok) {
          setLinking(false);
          setLinkFrom(undefined);
        }
      });
      return;
    }
    setNodeDrawer(n.id);
    setEdgeDrawer(undefined);
    if (n.kind === "USE_CASE")
      onFocusChange?.({
        projectId: store.project.id,
        entityType: "umlUseCase",
        entityId: n.id,
      });
  }
  function point(e: ReactPointerEvent<SVGGElement>) {
    const svg = e.currentTarget.ownerSVGElement!,
      pt = svg.createSVGPoint();
    pt.x = e.clientX;
    pt.y = e.clientY;
    return pt.matrixTransform(svg.getScreenCTM()!.inverse());
  }
  function down(e: ReactPointerEvent<SVGGElement>, n: UmlNode) {
    if (readOnly || linking || busy || e.button !== 0) return;
    const p = point(e);
    drag.current = {
      id: n.id,
      x: n.x,
      y: n.y,
      startX: p.x,
      startY: p.y,
      moved: false,
    };
    e.currentTarget.setPointerCapture(e.pointerId);
  }
  function move(e: ReactPointerEvent<SVGGElement>) {
    const d = drag.current;
    if (!d) return;
    const p = point(e);
    if (Math.abs(p.x - d.startX) + Math.abs(p.y - d.startY) > 3) d.moved = true;
    if (d.moved)
      setDraft((old) => ({
        ...old,
        [d.id]: {
          x: Math.max(0, Math.min(5000, d.x + p.x - d.startX)),
          y: Math.max(0, Math.min(5000, d.y + p.y - d.startY)),
        },
      }));
  }
  function up(e: ReactPointerEvent<SVGGElement>, n: UmlNode) {
    const d = drag.current;
    if (!d) return;
    drag.current = null;
    if (d.moved) {
      const p = point(e);
      suppress.current = true;
      void run(base + `/nodes/${n.id}`, "PATCH", {
        x: Math.max(0, Math.min(5000, d.x + p.x - d.startX)),
        y: Math.max(0, Math.min(5000, d.y + p.y - d.startY)),
        revision: n.revision,
      }).finally(() => setDraft({}));
    }
  }
  useEffect(() => {
    const d = store.diagrams.find((d) =>
      d.nodes.some((n) => highlightIds.includes(n.id)),
    );
    if (d) setSelected(d.id);
  }, [highlightIds.join(",")]);
  const boundary = diagram?.boundary ?? {
    x: 260,
    y: 52,
    width: 477,
    height: 397,
    name: "系统边界",
  };
  const canvasWidth = Math.max(
      760,
      boundary.x + boundary.width + 24,
      ...(diagram?.nodes.map((n) => (draft[n.id]?.x ?? n.x) + 130) ?? []),
    ),
    canvasHeight = Math.max(
      480,
      boundary.y + boundary.height + 24,
      ...(diagram?.nodes.map((n) => (draft[n.id]?.y ?? n.y) + 70) ?? []),
    );
  return (
    <div>
      <div className="pane-subbar">
        <div className="filters" style={{ margin: 0 }}>
          <select
            className="select"
            aria-label="UML 图选择"
            style={{ maxWidth: 210 }}
            value={diagram?.id ?? ""}
            onChange={(e) => {
              setSelected(Number(e.target.value));
              setNodeDrawer(undefined);
              setEdgeDrawer(undefined);
              setLinkFrom(undefined);
            }}
          >
            {store.diagrams.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
          {!readOnly && (
            <button
              className="btn small"
              disabled={busy}
              onClick={() => edit("diagram")}
            >
              <Icon name="plus" size={12} />
              新图
            </button>
          )}
        </div>
        {!readOnly && (
          <div className="filters" style={{ margin: 0 }}>
            <button
              className="btn small"
              disabled={busy || !diagram}
              onClick={() => edit("ACTOR")}
            >
              <Icon name="plus" size={12} />
              参与者
            </button>
            <button
              className="btn small"
              disabled={busy || !diagram}
              onClick={() => edit("USE_CASE")}
            >
              <Icon name="plus" size={12} />
              用例
            </button>
            <button
              className="btn small"
              disabled={busy || !diagram}
              onClick={() => edit("boundary")}
            >
              系统边界
            </button>
            <button
              className={`btn small ${linking ? "is-selected" : ""}`}
              disabled={busy}
              onClick={() => {
                setLinking((v) => !v);
                setLinkFrom(undefined);
              }}
            >
              <Icon name="link" size={12} />
              {linking ? "退出连线" : "连线"}
            </button>
            {linking && (
              <select
                className="select"
                aria-label="UML 关系类型"
                value={linkType}
                onChange={(e) => setLinkType(e.target.value as UmlEdge["kind"])}
              >
                <option value="association">关联</option>
                <option value="include">«include»</option>
                <option value="extend">«extend»</option>
              </select>
            )}
          </div>
        )}
      </div>
      <div className="b-uml-summary">
        <span>
          参与者{" "}
          <b>{diagram?.nodes.filter((n) => n.kind === "ACTOR").length ?? 0}</b>
        </span>
        <span>
          用例{" "}
          <b>
            {diagram?.nodes.filter((n) => n.kind === "USE_CASE").length ?? 0}
          </b>
        </span>
        <span>
          关系线 <b>{diagram?.edges.length ?? 0}</b>
        </span>
        <select
          className="select"
          aria-label="UML 故事定位"
          style={{ width: 173, height: 28 }}
          value={storyFilter ?? ""}
          onChange={(e) =>
            setStoryFilter(e.target.value ? Number(e.target.value) : undefined)
          }
        >
          <option value="">全部关联故事</option>
          {store.stories.stories.map((s) => (
            <option key={s.id} value={s.id}>
              {storyNumber(s.id)} · {s.title}
            </option>
          ))}
        </select>
        {!readOnly && (
          <button
            className="btn small"
            disabled={!storyFilter || busy}
            onClick={() => edit("USE_CASE", undefined, true)}
          >
            从故事创建用例草稿
          </button>
        )}
        <span style={{ marginLeft: "auto" }}>
          <button
            className="btn small"
            aria-label="缩小UML"
            onClick={() => setZoom((z) => Math.max(0.5, z - 0.1))}
          >
            －
          </button>
          <button className="btn small" onClick={() => setZoom(1)}>
            适应
          </button>
          <button
            className="btn small"
            aria-label="放大UML"
            onClick={() => setZoom((z) => Math.min(2, z + 0.1))}
          >
            ＋
          </button>
        </span>
      </div>
      <div className="uml-scroll">
        <svg
          className="uml-svg"
          style={{
            width: canvasWidth * zoom,
            maxWidth: "none",
            touchAction: "none",
          }}
          viewBox={`0 0 ${canvasWidth} ${canvasHeight}`}
          aria-label="项目 UML 用例图"
        >
          <defs>
            <marker
              id={arrow}
              markerWidth={9}
              markerHeight={9}
              refX={8}
              refY={3}
              orient="auto"
            >
              <path d="M0 0L8 3L0 6" stroke="#849ab5" fill="none" />
            </marker>
          </defs>
          <rect width="100%" height="100%" rx={7} fill="#fcfdff" />
          <g onDoubleClick={() => edit("boundary")}>
            <rect
              x={boundary.x}
              y={boundary.y}
              width={boundary.width}
              height={boundary.height}
              rx={9}
              fill="white"
              stroke="#b5c4d6"
              strokeWidth={1.5}
            />
            <text
              x={boundary.x + boundary.width / 2}
              y={boundary.y + 25}
              textAnchor="middle"
              fill="#576b85"
              fontSize={13}
              fontWeight={680}
            >
              {boundary.name}
            </text>
          </g>
          {diagram?.edges.map((e) => {
            const from = diagram.nodes.find((n) => n.id === e.fromId),
              to = diagram.nodes.find((n) => n.id === e.toId);
            if (!from || !to) return null;
            const a = draft[from.id] ?? from,
              b = draft[to.id] ?? to;
            return (
              <g
                key={e.id}
                role="button"
                tabIndex={0}
                aria-label={`关系 ${e.kind} ${from.name} 到 ${to.name}`}
                onClick={() => {
                  setEdgeDrawer(e.id);
                  setNodeDrawer(undefined);
                }}
                style={{ cursor: "pointer" }}
              >
                <line
                  x1={a.x + (from.kind === "ACTOR" ? 23 : 0)}
                  y1={a.y}
                  x2={b.x - (to.kind === "ACTOR" ? 23 : 0)}
                  y2={b.y}
                  stroke="#849ab5"
                  strokeWidth={1.6}
                  strokeDasharray={e.kind === "association" ? undefined : "6 4"}
                  markerEnd={
                    e.kind === "association" ? undefined : `url(#${arrow})`
                  }
                />
                <line
                  x1={a.x}
                  y1={a.y}
                  x2={b.x}
                  y2={b.y}
                  stroke="transparent"
                  strokeWidth={17}
                  pointerEvents="stroke"
                />
                {e.kind !== "association" && (
                  <text
                    x={(a.x + b.x) / 2}
                    y={(a.y + b.y) / 2 - 12}
                    fill="#57718e"
                    fontSize={11}
                    textAnchor="middle"
                  >
                    «{e.kind}»
                  </text>
                )}
              </g>
            );
          })}
          {diagram?.nodes.map((n) => {
            const { x, y } = draft[n.id] ?? n,
              highlight =
                highlightIds.includes(n.id) ||
                (storyFilter && n.storyIds.includes(storyFilter));
            return (
              <g
                key={n.id}
                className={`uml-node ${highlight ? "highlight" : ""}`}
                data-node-id={n.id}
                role="button"
                tabIndex={0}
                aria-label={`${n.kind === "ACTOR" ? "参与者" : "用例"} ${n.name}`}
                opacity={
                  (!search ||
                    `${n.id} ${n.name}`
                      .toLowerCase()
                      .includes(search.toLowerCase())) &&
                  (!storyFilter ||
                    n.kind === "ACTOR" ||
                    n.storyIds.includes(storyFilter))
                    ? 1
                    : 0.28
                }
                onPointerDown={(e) => down(e, n)}
                onPointerMove={move}
                onPointerUp={(e) => up(e, n)}
                onPointerCancel={() => {
                  drag.current = null;
                  setDraft({});
                }}
                onClick={() => {
                  if (suppress.current) {
                    suppress.current = false;
                    return;
                  }
                  openNode(n);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") openNode(n);
                }}
              >
                {n.kind === "ACTOR" ? (
                  <>
                    <rect
                      className="actor-hit"
                      x={x - 55}
                      y={y - 48}
                      width={110}
                      height={105}
                      rx={8}
                      fill="transparent"
                      stroke={linkFrom === n.id ? "#1677ff" : "transparent"}
                    />
                    <circle
                      cx={x}
                      cy={y - 28}
                      r={11}
                      fill="white"
                      stroke="#5e7392"
                      strokeWidth={2}
                    />
                    <path
                      d={`M${x} ${y - 17}v31 M${x - 19} ${y - 4}h38 M${x} ${y + 14}l-18 20M${x} ${y + 14}l18 20`}
                      fill="none"
                      stroke="#5e7392"
                      strokeWidth={2}
                    />
                    <text
                      x={x}
                      y={y + 49}
                      fontSize={12}
                      fontWeight={650}
                      textAnchor="middle"
                      fill="#57677d"
                    >
                      {n.name}
                    </text>
                  </>
                ) : (
                  <>
                    <ellipse
                      cx={x}
                      cy={y}
                      rx={115}
                      ry={37}
                      fill={highlight ? "#e3f0ff" : "#f0f6ff"}
                      stroke={
                        highlight || linkFrom === n.id ? "#2878e5" : "#a7c6f0"
                      }
                      strokeWidth={highlight ? 2.3 : 1.4}
                    />
                    <text
                      x={x}
                      y={y - 3}
                      fill="#275b9f"
                      fontSize={13}
                      fontWeight={650}
                      textAnchor="middle"
                    >
                      {n.name}
                    </text>
                    <text
                      x={x}
                      y={y + 17}
                      fill="#7393b8"
                      fontSize={10}
                      textAnchor="middle"
                    >
                      UC-{n.id} ·{" "}
                      {n.storyIds.map(storyNumber).join(" / ") || "未关联故事"}
                    </text>
                  </>
                )}
              </g>
            );
          })}
        </svg>
      </div>
      <p className="note">
        {linking
          ? linkFrom
            ? "已选择连线起点，请点击终点。"
            : "连线模式：先点击起点，再点击终点。"
          : "点击节点查看属性；项目经理可拖动节点调整位置，并关联真实用户故事。"}
      </p>
      <Drawer
        className="v43-drawer"
        size={640}
        styles={{ wrapper: { top: 56, height: "calc(100% - 56px)" } }}
        open={!!node || !!edge}
        onClose={() => {
          setNodeDrawer(undefined);
          setEdgeDrawer(undefined);
        }}
        title={node?.name || "UML 关系"}
        footer={
          <>
            <Button
              onClick={() => {
                setNodeDrawer(undefined);
                setEdgeDrawer(undefined);
              }}
            >
              关闭
            </Button>
            {!readOnly && node && (
              <>
                <Button
                  danger
                  disabled={busy}
                  onClick={() =>
                    void run(base + `/nodes/${node.id}`, "DELETE").then(
                      (ok) => {
                        if (ok) setNodeDrawer(undefined);
                      },
                    )
                  }
                >
                  删除图形
                </Button>
                <Button type="primary" onClick={() => edit(node.kind, node)}>
                  编辑属性
                </Button>
              </>
            )}
            {!readOnly && edge && (
              <Button
                danger
                disabled={busy}
                onClick={() =>
                  void run(base + `/edges/${edge.id}`, "DELETE").then((ok) => {
                    if (ok) setEdgeDrawer(undefined);
                  })
                }
              >
                删除关系
              </Button>
            )}
          </>
        }
      >
        {node && (
          <>
            <div className="detail-row">
              <div className="detail-label">图形类型</div>
              {node.kind === "ACTOR" ? "参与者 Actor" : "用例 Use case"}
            </div>
            <div className="detail-row">
              <div className="detail-label">用例说明</div>
              {node.description || "未填写"}
            </div>
            <div className="detail-row">
              <div className="detail-label">关联用户故事</div>
              {node.storyIds.map((id) => (
                <button
                  className="btn small light"
                  key={id}
                  onClick={() => {
                    setNodeDrawer(undefined);
                    onStory?.(id);
                  }}
                >
                  {storyNumber(id)}
                </button>
              ))}
            </div>
          </>
        )}
        {edge && (
          <>
            <p>
              起点：{diagram?.nodes.find((n) => n.id === edge.fromId)?.name}
            </p>
            <p>终点：{diagram?.nodes.find((n) => n.id === edge.toId)?.name}</p>
            <Select
              aria-label="关系类型"
              value={edge.kind}
              disabled={readOnly || busy}
              options={(diagram?.nodes.find((n) => n.id === edge.fromId)
                ?.kind === "USE_CASE" &&
              diagram?.nodes.find((n) => n.id === edge.toId)?.kind ===
                "USE_CASE"
                ? ["include", "extend"]
                : ["association"]
              ).map((value) => ({ value, label: value }))}
              onChange={(kind) =>
                void run(base + `/edges/${edge.id}`, "PATCH", {
                  fromId: edge.fromId,
                  toId: edge.toId,
                  kind,
                })
              }
            />
          </>
        )}
      </Drawer>
      <Modal
        centered
        title={
          editing?.kind === "diagram"
            ? "新建 UML 用例图"
            : editing?.kind === "boundary"
              ? "编辑系统边界"
              : `${editing?.node ? "编辑" : "新增"}${editing?.kind === "ACTOR" ? "参与者" : "用例"}`
        }
        open={!!editing}
        onCancel={() => {
          if (!busy) setEditing(null);
        }}
        onOk={() => void save()}
        okText="保存"
        confirmLoading={busy}
        destroyOnHidden
      >
        <Form form={form} layout="vertical" preserve={false} disabled={busy}>
          <Form.Item
            name="name"
            label="名称"
            rules={[{ required: true, whitespace: true }, { max: 200 }]}
          >
            <Input maxLength={200} />
          </Form.Item>
          {editing?.kind === "boundary" ? (
            <>
              {(["x", "y", "width", "height"] as const).map((key) => (
                <Form.Item
                  key={key}
                  name={key}
                  label={
                    { x: "横坐标", y: "纵坐标", width: "宽度", height: "高度" }[
                      key
                    ]
                  }
                  rules={[
                    {
                      required: true,
                      type: "number",
                      min: key === "width" || key === "height" ? 100 : 0,
                      max: 5000,
                    },
                  ]}
                >
                  <InputNumber />
                </Form.Item>
              ))}
            </>
          ) : (
            editing?.kind === "USE_CASE" && (
              <>
                <Form.Item
                  name="description"
                  label="用例说明"
                  rules={[{ max: 10000 }]}
                >
                  <Input.TextArea rows={3} />
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
              </>
            )
          )}
        </Form>
      </Modal>
    </div>
  );
}
