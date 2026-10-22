import { useEffect, useRef, useState } from "react";
import type { ProjectDocumentEntry as Entry } from "@spm/shared";
import { useProjectData } from "./ProjectData";
import { api, RequestError } from "./api";
import { announceProject, useProjectRefresh } from "./ui";
import { AIcon as Icon } from "./AIcons";
import "./a-docs.css";
const localTime = (s: string) =>
  new Date(s)
    .toLocaleString("sv-SE", { timeZone: "Asia/Shanghai" })
    .slice(0, 16);
const type = (e: Entry) =>
  e.kind === "FOLDER"
    ? "folder"
    : /\.(png|jpg|jpeg|gif|webp)$/i.test(e.name)
      ? "image"
      : /\.pdf$/i.test(e.name)
        ? "pdf"
        : /\.(zip)$/i.test(e.name)
          ? "other"
          : "doc";
const kindLabel = (e: Entry) =>
  ({
    folder: "文件夹",
    image: "图片",
    pdf: "PDF",
    other: "压缩文件",
    doc: "文档",
  })[type(e)];
const size = (n: number) =>
  n >= 1048576
    ? (n / 1048576).toFixed(2) + " MB"
    : n >= 1024
      ? (n / 1024).toFixed(1) + " KB"
      : n + " B";
export function Documents() {
  const store = useProjectData(),
    p = store.project,
    can = p.canManage,
    base = `/projects/${p.id}/documents`;
  const [entries, setEntries] = useState<Entry[]>([]),
    [where, setWhere] = useState<number | null>(null),
    [expanded, setExpanded] = useState<Set<number>>(new Set()),
    [search, setSearch] = useState(""),
    [filter, setFilter] = useState("all"),
    [sort, setSort] = useState("time"),
    [view, setView] = useState("list"),
    [selected, setSelected] = useState<number[]>([]),
    [menu, setMenu] = useState<{
      id: number;
      left: number;
      top: number;
    } | null>(null),
    [modal, setModal] = useState<{
      action: "create" | "rename" | "move" | "delete";
      ids: number[];
    } | null>(null),
    [name, setName] = useState(""),
    [target, setTarget] = useState(""),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false),
    [detailId, setDetail] = useState<number | null>(null),
    [preview, setPreview] = useState<{
      url: string;
      text: string;
      loading: boolean;
      error?: string;
    }>({ url: "", text: "", loading: false });
  const input = useRef<HTMLInputElement>(null),
    version = useRef(0),
    live = useRef(true);
  async function load() {
    const n = ++version.current;
    const next = await api<Entry[]>(base);
    if (live.current && n === version.current) {
      setEntries(next);
      setSelected((s) => s.filter((id) => next.some((x) => x.id === id)));
      setWhere((w) => (w !== null && !next.some((e) => e.id === w) ? null : w));
    }
  }
  useEffect(() => {
    live.current = true;
    void load().catch(store.onError);
    return () => {
      live.current = false;
      version.current++;
    };
  }, [p.id]);
  useProjectRefresh(p.id, () => void load().catch(store.onError));
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(""), 3100);
    return () => clearTimeout(timer);
  }, [notice]);
  const detail = entries.find((e) => e.id === detailId),
    menuItem = entries.find((e) => e.id === menu?.id),
    folders = entries.filter((e) => e.kind === "FOLDER");
  const path = (id: number | null) => {
    const a: Entry[] = [];
    const seen = new Set<number>();
    let at = id;
    while (at !== null && !seen.has(at)) {
      seen.add(at);
      const f = folders.find((f) => f.id === at);
      if (!f) break;
      a.unshift(f);
      at = f.parentId;
    }
    return a;
  };
  useEffect(() => {
    if (!detail || detail.kind !== "FILE") {
      setPreview({ url: "", text: "", loading: false });
      return;
    }
    const controller = new AbortController();
    let objectUrl = "";
    setPreview({ url: "", text: "", loading: true });
    fetch(`/api${base}/${detail.id}/content`, {
      credentials: "include",
      signal: controller.signal,
    })
      .then(async (r) => {
        if (!r.ok) throw new Error("文件预览读取失败");
        const blob = await r.blob();
        if (controller.signal.aborted) return;
        objectUrl = URL.createObjectURL(blob);
        const text = /\.(txt|md|json|csv)$/i.test(detail.name)
          ? (await blob.text()).slice(0, 50000)
          : "";
        if (!controller.signal.aborted)
          setPreview({ url: objectUrl, text, loading: false });
      })
      .catch((e) => {
        if (!controller.signal.aborted)
          setPreview({
            url: "",
            text: "",
            loading: false,
            error: (e as Error).message,
          });
      });
    return () => {
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [detailId, detail?.revision, p.id]);
  useEffect(() => {
    const click = (e: PointerEvent) => {
      if (!(e.target as HTMLElement).closest(".file-actions-pop,.rowmore"))
        setMenu(null);
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) {
        setModal(null);
        setDetail(null);
        setMenu(null);
      }
    };
    document.addEventListener("pointerdown", click);
    window.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("pointerdown", click);
      window.removeEventListener("keydown", key);
    };
  }, [busy]);
  function navigate(id: number | null) {
    setWhere(id);
    setSearch("");
    setFilter("all");
    setSelected([]);
    setMenu(null);
  }
  function show(
    action: "create" | "rename" | "move" | "delete",
    ids: number[] = [],
  ) {
    setMenu(null);
    setModal({ action, ids });
    setName(
      action === "rename"
        ? entries.find((e) => e.id === ids[0])?.name || ""
        : "",
    );
    setTarget("");
    setError("");
  }
  async function commit() {
    if (!modal || busy) return;
    setBusy(true);
    setError("");
    try {
      if (modal.action === "create")
        await store.write("/documents/folders", "POST", {
          name,
          parentId: where,
        });
      else if (modal.action === "rename") {
        const row = entries.find((e) => e.id === modal.ids[0])!;
        await store.write(`/documents/${row.id}`, "PATCH", {
          name,
          revision: row.revision,
        });
      } else
        await store.write("/documents/batch", "POST", {
          ids: modal.ids,
          action: modal.action,
          parentId: target ? Number(target) : null,
        });
      await load();
      setModal(null);
      setSelected([]);
      setNotice("操作已保存");
      if (modal.action === "create" && where)
        setExpanded(new Set([...expanded, where]));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function upload(files: FileList | null) {
    if (!files || !can) return;
    setBusy(true);
    setError("");
    let count = 0;
    const failures: string[] = [];
    for (const file of Array.from(files)) {
      try {
        const body = new FormData();
        body.append("file", file);
        const response = await fetch(
          `/api${base}/upload${where === null ? "" : "?parentId=" + where}`,
          {
            method: "POST",
            credentials: "include",
            headers: { "X-SPM-Request": "1" },
            body,
          },
        );
        if (!response.ok) {
          const err = await response.json();
          throw new RequestError(
            response.status,
            Array.isArray(err.message) ? err.message.join("；") : err.message,
          );
        }
        count++;
      } catch (e) {
        failures.push(`${file.name}：${(e as Error).message}`);
      }
    }
    await load().catch(store.onError);
    announceProject(p.id);
    setNotice(
      [count ? `成功上传 ${count} 个文件` : "", ...failures]
        .filter(Boolean)
        .join("；"),
    );
    setBusy(false);
    if (input.current) input.current.value = "";
  }
  async function download(e: Entry) {
    try {
      const r = await fetch(`/api${base}/${e.id}/content?download=1`, {
        credentials: "include",
      });
      if (!r.ok) throw new Error("文件下载失败或访问权限已变化");
      const url = URL.createObjectURL(await r.blob());
      const a = document.createElement("a");
      a.href = url;
      a.download = e.name;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) {
      store.onError(e);
    }
    setMenu(null);
  }
  function open(e: Entry) {
    setMenu(null);
    if (e.kind === "FOLDER") navigate(e.id);
    else setDetail(e.id);
  }
  const records = (
    where === null
      ? entries.filter((e) => e.kind === "FILE" || e.parentId === null)
      : entries.filter((e) => e.parentId === where)
  )
    .filter(
      (e) =>
        (e.name + " " + e.ownerName)
          .toLowerCase()
          .includes(search.toLowerCase()) &&
        (filter === "all" || type(e) === filter),
    )
    .sort((a, b) =>
      sort === "name"
        ? a.name.localeCompare(b.name, "zh-CN")
        : sort === "size"
          ? b.size - a.size
          : b.updatedAt.localeCompare(a.updatedAt),
    );
  const title =
    modal?.action === "create"
      ? "新建文件夹"
      : modal?.action === "rename"
        ? "重命名"
        : modal?.action === "move"
          ? "移动到文件夹"
          : "确认删除";
  function tree(f: Entry, depth = 0): React.ReactNode {
    const children = folders.filter((e) => e.parentId === f.id);
    return (
      <div key={f.id}>
        <div
          className={`folderrow ${where === f.id ? "active" : ""}`}
          style={{ paddingLeft: 12 + Math.min(depth, 8) * 14 }}
        >
          <button
            className="caret"
            aria-label={`${expanded.has(f.id) ? "收起" : "展开"}${f.name}`}
            disabled={!children.length}
            onClick={() => {
              const s = new Set(expanded);
              s.has(f.id) ? s.delete(f.id) : s.add(f.id);
              setExpanded(s);
            }}
          >
            {children.length ? (expanded.has(f.id) ? "▾" : "▸") : ""}
          </button>
          <Icon name="folder" />
          <button className="foldername" onClick={() => navigate(f.id)}>
            {f.name}
          </button>
          <span className="count">
            {entries.filter((e) => e.parentId === f.id).length}
          </span>
        </div>
        {expanded.has(f.id) && children.map((c) => tree(c, depth + 1))}
      </div>
    );
  }
  const fileIcon = (e: Entry) => (
    <span className={`file-icon ${type(e) === "other" ? "zip" : type(e)}`}>
      <Icon
        name={
          e.kind === "FOLDER"
            ? "folder"
            : type(e) === "image"
              ? "image"
              : "file"
        }
        size={20}
      />
    </span>
  );
  return (
    <div className="a-docs">
      <main className="content">
        <div className="heading">
          <div>
            <h1>
              项目文档{" "}
              <span className="badge">
                {can ? "项目经理可管理" : "项目成员只读"}
              </span>
            </h1>
            <div className="subtitle">
              按文件夹组织团队资料，集中查阅与管理项目文件
            </div>
          </div>
          <div className="buttons">
            {can && (
              <>
                <button
                  className="btn"
                  onClick={() => show("create")}
                  disabled={busy}
                >
                  <Icon name="plus" />
                  新建文件夹
                </button>
                <button
                  className="btn primary"
                  onClick={() => input.current?.click()}
                  disabled={busy}
                >
                  <Icon name="upload" />
                  {busy ? "处理中…" : "上传文件"}
                </button>
              </>
            )}
          </div>
        </div>
        <input
          ref={input}
          style={{ display: "none" }}
          type="file"
          multiple
          accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.png,.jpg,.jpeg,.gif,.webp,.txt,.md,.csv,.json,.zip"
          onChange={(e) => void upload(e.target.files)}
          aria-label="上传项目文件"
        />
        <div className="doc-layout">
          <section className="folder-pane">
            <div className="folder-title">
              <span>文件目录</span>
              {can && (
                <button
                  className="icon-btn"
                  title="新建子文件夹"
                  onClick={() => show("create")}
                >
                  ＋
                </button>
              )}
            </div>
            <div className="foldertree">
              <button
                className={`folderrow ${where === null ? "active" : ""}`}
                onClick={() => navigate(null)}
              >
                <Icon name="grid" />
                <span className="foldername">全部文档</span>
                <span className="count">
                  {
                    entries.filter(
                      (e) => e.kind === "FILE" || e.parentId === null,
                    ).length
                  }
                </span>
              </button>
              {folders.filter((e) => e.parentId === null).map((e) => tree(e))}
            </div>

          </section>
          <section className="file-pane">
            <div className="file-top">
              <div className="file-topline">
                <button className="pathlink" onClick={() => navigate(null)}>
                  全部文档
                </button>
                {path(where).map((f) => (
                  <span key={f.id} style={{ display: "contents" }}>
                    <Icon name="arrow" />
                    <button className="pathlink" onClick={() => navigate(f.id)}>
                      {f.name}
                    </button>
                  </span>
                ))}
                <span className="grow" />
                <strong>
                  {where === null
                    ? "全部项目文件"
                    : folders.find((f) => f.id === where)?.name}
                </strong>
              </div>
              <div className="file-tools">
                <label className="searchwrap">
                  <Icon name="search" />
                  <input
                    placeholder="搜索文档名称、上传人"
                    aria-label="搜索文档名称、上传人"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                </label>
                <select
                  className="selectsmall"
                  aria-label="文档类型"
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                >
                  {[
                    ["all", "全部类型"],
                    ["folder", "文件夹"],
                    ["doc", "文档"],
                    ["pdf", "PDF"],
                    ["image", "图片"],
                    ["other", "其他文件"],
                  ].map(([v, t]) => (
                    <option key={v} value={v}>
                      {t}
                    </option>
                  ))}
                </select>
                <select
                  className="selectsmall"
                  aria-label="文档排序"
                  value={sort}
                  onChange={(e) => setSort(e.target.value)}
                >
                  <option value="time">最近修改</option>
                  <option value="name">名称 A-Z</option>
                  <option value="size">文件大小</option>
                </select>
                <span className="grow" />
                <span className="tiny">共 {records.length} 项</span>
                <button
                  className="icon-btn"
                  title="列表模式"
                  style={{ color: view === "list" ? "#1677ff" : undefined }}
                  onClick={() => setView("list")}
                >
                  <Icon name="list" />
                </button>
                <button
                  className="icon-btn"
                  title="缩略模式"
                  style={{ color: view === "tiles" ? "#1677ff" : undefined }}
                  onClick={() => setView("tiles")}
                >
                  <Icon name="grid" />
                </button>
              </div>
            </div>
            {selected.length > 0 && can && (
              <div className="a-doc-bulk">
                <span>已选择 {selected.length} 项</span>
                <button className="btn" onClick={() => show("move", selected)}>
                  批量移动
                </button>
                <button
                  className="btn"
                  onClick={() => show("delete", selected)}
                >
                  批量删除
                </button>
                <button
                  className="button-plain"
                  onClick={() => setSelected([])}
                >
                  取消选择
                </button>
              </div>
            )}
            <div className="file-table-scroll">
              {!records.length ? (
                <div className="empty">
                  <Icon name="folder" size={38} />
                  <strong>{search ? "没有匹配的文件" : "当前目录为空"}</strong>
                  <span>
                    可切换文件夹{can ? "，或上传文件、新建文件夹" : ""}
                  </span>
                </div>
              ) : view === "tiles" ? (
                <div className="folder-grid">
                  {records.map((e) => (
                    <button className="tile" key={e.id} onClick={() => open(e)}>
                      {fileIcon(e)}
                      <div className="tilelabel">{e.name}</div>
                      <small>
                        {localTime(e.updatedAt).slice(0, 10)} ·{" "}
                        {e.kind === "FOLDER" ? "文件夹" : size(e.size)}
                      </small>
                    </button>
                  ))}
                </div>
              ) : (
                <table className="file-table">
                  <thead>
                    <tr>
                      <th>
                        <input
                          type="checkbox"
                          disabled={!can}
                          checked={
                            records.length > 0 &&
                            records.every((e) => selected.includes(e.id))
                          }
                          aria-label="全选当前列表"
                          onChange={(e) =>
                            setSelected(
                              e.target.checked ? records.map((e) => e.id) : [],
                            )
                          }
                        />
                      </th>
                      {[
                        "名称",
                        "类型",
                        "上传人 / 创建人",
                        "最近修改",
                        "大小",
                        "操作",
                      ].map((t) => (
                        <th key={t}>{t}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {records.map((e) => (
                      <tr key={e.id}>
                        <td>
                          <input
                            type="checkbox"
                            disabled={!can}
                            checked={selected.includes(e.id)}
                            aria-label={`选择 ${e.name}`}
                            onChange={(ev) =>
                              setSelected((s) =>
                                ev.target.checked
                                  ? [...s, e.id]
                                  : s.filter((id) => id !== e.id),
                              )
                            }
                          />
                        </td>
                        <td>
                          <div className="namecell">
                            {fileIcon(e)}
                            <div style={{ minWidth: 0 }}>
                              <button
                                className="filename"
                                onClick={() => open(e)}
                              >
                                {e.name}
                              </button>
                              {where === null && (
                                <small className="a-doc-folder-label">
                                  {folders.find((f) => f.id === e.parentId)
                                    ?.name || "根目录"}
                                </small>
                              )}
                            </div>
                          </div>
                        </td>
                        <td>{kindLabel(e)}</td>
                        <td>{e.ownerName}</td>
                        <td title={e.updatedAt}>
                          {localTime(e.updatedAt).slice(0, 10)}
                        </td>
                        <td>{e.kind === "FOLDER" ? "—" : size(e.size)}</td>
                        <td>
                          <button
                            className="rowmore"
                            aria-label={`更多操作 ${e.name}`}
                            onClick={(ev) => {
                              const r =
                                ev.currentTarget.getBoundingClientRect();
                              setMenu({
                                id: e.id,
                                left: Math.min(
                                  innerWidth - 168,
                                  Math.max(10, r.right - 150),
                                ),
                                top: Math.min(innerHeight - 240, r.bottom + 3),
                              });
                            }}
                          >
                            <Icon name="more" />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
            <div className="file-count">
              <span>
                {records.length} 项 · 当前
                {where === null ? "全部文档" : "文件夹"} ·{" "}
                {can ? "可管理" : "只读访问"}
              </span>
              <span>项目内成员仅访问授权文件</span>
            </div>
          </section>
        </div>
      </main>
      {menu && menuItem && (
        <div
          className="file-actions-pop"
          role="menu"
          style={{ left: menu.left, top: menu.top }}
        >
          <button role="menuitem" onClick={() => open(menuItem)}>
            <Icon name="file" />
            {menuItem.kind === "FOLDER" ? "打开文件夹" : "查看详情"}
          </button>
          {menuItem.kind === "FILE" && (
            <button role="menuitem" onClick={() => void download(menuItem)}>
              <Icon name="download" />
              下载文件
            </button>
          )}
          {can && (
            <>
              <button
                role="menuitem"
                onClick={() => show("rename", [menuItem.id])}
              >
                ✎ 重命名
              </button>
              <button
                role="menuitem"
                onClick={() => show("move", [menuItem.id])}
              >
                ↗ 移动
              </button>
              <button
                role="menuitem"
                className="danger"
                onClick={() => show("delete", [menuItem.id])}
              >
                删除
              </button>
            </>
          )}
        </div>
      )}
      {detail && (
        <div
          className="drawer-mask"
          onClick={(e) => {
            if (e.target === e.currentTarget) setDetail(null);
          }}
        >
          <aside
            className="drawer"
            role="dialog"
            aria-modal="true"
            aria-label="文件详情"
          >
            <div className="drawerhead">
              <div>
                <span className="tiny">项目文档 / 文件详情</span>
                <h2>{detail.name}</h2>
              </div>
              <button
                className="icon-btn"
                onClick={() => setDetail(null)}
                aria-label="关闭文件详情"
              >
                ×
              </button>
            </div>
            <div className="drawerbody">
              <div className="detailgrid">
                {[
                  ["文件类型", kindLabel(detail)],
                  ["文件大小", size(detail.size)],
                  ["上传人", detail.ownerName],
                  ["最近修改", localTime(detail.updatedAt)],
                  [
                    "所在目录",
                    path(detail.parentId)
                      .map((f) => f.name)
                      .join(" / ") || "根目录",
                  ],
                ].map(([t, v]) => (
                  <span key={t} style={{ display: "contents" }}>
                    <span className="k">{t}</span>
                    <span>{v}</span>
                  </span>
                ))}
              </div>
              <h3 style={{ fontSize: 15, margin: "24px 0 0" }}>文件预览</h3>
              <div className="previewbox">
                {preview.loading ? (
                  "正在读取文件…"
                ) : preview.error ? (
                  <span role="alert">{preview.error}</span>
                ) : type(detail) === "image" ? (
                  <img alt={detail.name} src={preview.url} />
                ) : type(detail) === "pdf" ? (
                  <iframe title="PDF 预览" src={preview.url} />
                ) : /\.(txt|md|json|csv)$/i.test(detail.name) ? (
                  <pre>{preview.text}</pre>
                ) : (
                  <>
                    <Icon name="file" size={40} />
                    <strong>该格式暂不支持浏览器内预览</strong>
                    <small>可下载原始文件后使用对应应用查看</small>
                  </>
                )}
              </div>
            </div>
            <div className="drawerfoot">
              {can && (
                <>
                  <button
                    className="btn"
                    onClick={() => {
                      setDetail(null);
                      show("rename", [detail.id]);
                    }}
                  >
                    重命名
                  </button>
                  <button
                    className="btn"
                    onClick={() => {
                      setDetail(null);
                      show("move", [detail.id]);
                    }}
                  >
                    移动
                  </button>
                </>
              )}
              <button
                className="btn primary"
                onClick={() => void download(detail)}
              >
                <Icon name="download" />
                下载文件
              </button>
            </div>
          </aside>
        </div>
      )}
      {modal && (
        <div
          className="mask"
          onClick={(e) => {
            if (e.target === e.currentTarget && !busy) setModal(null);
          }}
        >
          <div
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-label={title}
          >
            <div className="modalhead">
              <strong>{title}</strong>
              <button
                className="icon-btn"
                onClick={() => !busy && setModal(null)}
                aria-label="关闭"
              >
                ×
              </button>
            </div>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void commit();
              }}
            >
              <div className="modalbody">
                {modal.action === "create" || modal.action === "rename" ? (
                  <>
                    <label className="formlabel" htmlFor="a-doc-name">
                      {modal.action === "create" ? "文件夹名称" : "名称"} *
                    </label>
                    <input
                      id="a-doc-name"
                      className="formcontrol"
                      required
                      maxLength={200}
                      autoFocus
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                    />
                    <div className="formhelp">
                      {modal.action === "create"
                        ? `创建位置：${
                            path(where)
                              .map((f) => f.name)
                              .join(" / ") || "根目录"
                          }`
                        : "重命名只影响名称，不修改文件内容。"}
                    </div>
                  </>
                ) : modal.action === "move" ? (
                  <>
                    <label className="formlabel" htmlFor="a-doc-target">
                      目标位置
                    </label>
                    <select
                      id="a-doc-target"
                      className="formcontrol"
                      value={target}
                      onChange={(e) => setTarget(e.target.value)}
                    >
                      <option value="">根目录</option>
                      {folders
                        .filter(
                          (f) =>
                            !path(f.id).some((x) => modal.ids.includes(x.id)),
                        )
                        .map((f) => (
                          <option key={f.id} value={f.id}>
                            {path(f.id)
                              .map((x) => x.name)
                              .join(" / ")}
                          </option>
                        ))}
                    </select>
                    <div className="formhelp">
                      将移动 {modal.ids.length} 项，不允许移动到自身或子目录。
                    </div>
                  </>
                ) : (
                  <p>
                    确定删除选中的 <strong>{modal.ids.length}</strong>{" "}
                    项吗？删除文件夹时，其中的子文件夹和文件也会一起删除。
                  </p>
                )}
                {error && (
                  <div role="alert" className="a-form-error">
                    {error}
                  </div>
                )}
              </div>
              <div className="modalfoot">
                <button
                  className="btn"
                  type="button"
                  disabled={busy}
                  onClick={() => setModal(null)}
                >
                  取消
                </button>
                <button className="btn primary" disabled={busy}>
                  {busy
                    ? "保存中…"
                    : modal.action === "create"
                      ? "创建"
                      : modal.action === "rename"
                        ? "保存"
                        : modal.action === "move"
                          ? "确认移动"
                          : "确认删除"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
      {notice && (
        <div className="toast" role="status" onClick={() => setNotice("")}>
          {notice}
        </div>
      )}
    </div>
  );
}
