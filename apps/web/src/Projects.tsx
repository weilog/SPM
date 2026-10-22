import {
  Alert,
  Button,
  Card,
  Empty,
  Form,
  Input,
  Modal,
  Popconfirm,
  Select,
  Space,
  Table,
  Tag,
  Typography,
} from "antd";
import { useEffect, useState } from "react";
import {
  projectRoleLabels,
  type CreationOptions,
  type Project,
  type ProjectMember,
  type ProjectRole,
  type User,
} from "@spm/shared";
import { api } from "./api";
import "./a-project.css";

export function ProjectList({
  user,
  onSelect,
  onError,
  onProjectsChanged,
}: {
  user: User;
  onProjectsChanged?: () => void;
  onSelect: (id: number) => void;
  onError: (error: unknown) => void;
}) {
  const [search, setSearch] = useState(""),
    [role, setRole] = useState("all"),
    [mode, setMode] = useState("card");
  const [projects, setProjects] = useState<Project[]>([]);
  const [managers, setManagers] = useState<User[]>([]);
  const [canCreate, setCanCreate] = useState(false);
  const [notice, setNotice] = useState("");
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form] = Form.useForm();
  const reload = () =>
    api<Project[]>("/projects").then(setProjects).catch(onError);
  useEffect(() => {
    void reload();
    void api<CreationOptions>("/projects/creation-options")
      .then((options) => {
        setCanCreate(options.canCreate);
        setManagers(options.managers);
      })
      .catch(onError);
  }, []);
  async function create() {
    let values: { name: string; description?: string; managerId?: number };
    try {
      values = await form.validateFields();
    } catch {
      return;
    }
    setSaving(true);
    try {
      const created = await api<{ id: number; canManage: boolean }>(
        "/projects",
        "POST",
        values,
      );
      setOpen(false);
      onProjectsChanged?.();
      if (created.canManage) {
        setNotice("项目已创建，可进入项目。");
        await reload();
      } else {
        setNotice(
          "项目已创建，已授权给指定经理；创建操作不会自动授予项目访问权。",
        );
        await reload();
      }
    } catch (error) {
      onError(error);
    } finally {
      setSaving(false);
    }
  }
  async function showCreate() {
    try {
      const options = await api<CreationOptions>("/projects/creation-options");
      setCanCreate(options.canCreate);
      setManagers(options.managers);
      form.resetFields();
      form.setFieldsValue({ managerId: user.id });
      setOpen(true);
    } catch (error) {
      onError(error);
    }
  }
  const shown = projects.filter(
    (p) =>
      `${p.name} ${p.id} P-${String(p.id).padStart(3, "0")}`
        .toLowerCase()
        .includes(search.toLowerCase()) &&
      (role === "all" ||
        (role === "member" ? !p.canManage : p.projectRole === role)),
  );
  return (
    <>
      <div className="a-projects">
        <div className="page-title">
          <div>
            <h1>我的项目</h1>
          </div>
          {canCreate && (
            <button className="primary" onClick={() => void showCreate()}>
              ＋ 创建项目
            </button>
          )}
        </div>
        <div className="stats">
          {[
            ["可访问项目", projects.length, "▦"],
            ["我管理的项目", projects.filter((p) => p.canManage).length, "♙"],
            ["我参与的项目", projects.filter((p) => !p.canManage).length, "♧"],
          ].map(([label, num, icon]) => (
            <div className="stat" key={label}>
              <div>
                <strong>{num}</strong>
                <label>{label}</label>
              </div>
              <span className="ico">{icon}</span>
            </div>
          ))}
        </div>
        {notice && <Alert type="success" title={notice} />}
        <div className="work">
          <div className="toolbar">
            <input
              className="search"
              aria-label="搜索项目"
              placeholder="⌕ 搜索项目名称 / 项目编号"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <select
              aria-label="项目角色筛选"
              value={role}
              onChange={(e) => setRole(e.target.value)}
            >
              <option value="all">全部项目角色</option>
              <option value="MANAGER">项目经理</option>
              <option value="DEVELOPER">开发人员</option>
              <option value="TESTER">测试人员</option>
              <option value="member">我参与的项目</option>
            </select>
            <span className="count">共 {shown.length} 个项目</span>
            <span className="push" />
            <div className="seg">
              <button
                className={mode === "card" ? "on" : ""}
                onClick={() => setMode("card")}
              >
                ▦ 卡片
              </button>
              <button
                className={mode === "list" ? "on" : ""}
                onClick={() => setMode("list")}
              >
                ☷ 列表
              </button>
            </div>
          </div>
          {shown.length ? (
            mode === "card" ? (
              <div className="cards">
                {shown.map((p) => (
                  <article key={p.id} className="card">
                    <div className="head">
                      <div className="projecticon">▦</div>
                      <div style={{ minWidth: 0 }}>
                        <button
                          className="project-title-button name"
                          onClick={() => onSelect(p.id)}
                        >
                          {p.name}
                        </button>
                        <div className="identifier">
                          项目编号 P-{String(p.id).padStart(3, "0")}
                        </div>
                      </div>
                      <span className={`badge ${p.canManage ? "" : "other"}`}>
                        {projectRoleLabels[p.projectRole]}
                      </span>
                    </div>
                    <div className="desc">{p.description || "暂无描述"}</div>
                    <div className="card-foot">
                      <span>项目经理：{p.manager.username}</span>
                      <button
                        className="enter project-enter"
                        onClick={() => onSelect(p.id)}
                      >
                        进入项目 →
                      </button>
                    </div>
                  </article>
                ))}
              </div>
            ) : (
              <div className="tablebox">
                <table className="table">
                  <thead>
                    <tr>
                      {[
                        "项目名称",
                        "项目编号",
                        "项目经理",
                        "我的角色",
                        "创建日期",
                        "操作",
                      ].map((t) => (
                        <th key={t}>{t}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {shown.map((p) => (
                      <tr key={p.id}>
                        <td>
                          <button
                            className="pname project-enter"
                            onClick={() => onSelect(p.id)}
                          >
                            {p.name}
                          </button>
                        </td>
                        <td>P-{String(p.id).padStart(3, "0")}</td>
                        <td>{p.manager.username}</td>
                        <td>{projectRoleLabels[p.projectRole]}</td>
                        <td>
                          {("createdAt" in p ? String(p.createdAt) : "").slice(
                            0,
                            10,
                          ) || "—"}
                        </td>
                        <td>
                          <button
                            className="link"
                            onClick={() => onSelect(p.id)}
                          >
                            进入项目 →
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )
          ) : (
            <div className="empty">
              <b>⌕</b>没有找到符合条件的项目
              <br />
              <small>请更换搜索词或筛选条件</small>
            </div>
          )}
        </div>
      </div>
      <Modal
        centered
        title="创建项目"
        className="a-project-modal"
        width={560}
        okText="创建项目"
        cancelText="取消"
        open={open}
        onCancel={() => setOpen(false)}
        onOk={() => void create()}
        confirmLoading={saving}
        destroyOnHidden
      >
        <Form form={form} layout="vertical">
          <Form.Item
            label="项目名称"
            name="name"
            rules={[{ required: true, whitespace: true }, { max: 80 }]}
          >
            <Input maxLength={80} placeholder="输入项目名称" />
          </Form.Item>
          <Form.Item label="项目描述" name="description" rules={[{ max: 500 }]}>
            <Input.TextArea
              rows={3}
              maxLength={500}
              placeholder="简要介绍项目背景和目标"
            />
          </Form.Item>
          <Form.Item
            label="项目经理"
            name="managerId"
            rules={[{ required: true }]}
          >
            <Select
              disabled={user.role !== "ADMIN"}
              options={(user.role === "ADMIN" ? managers : [user]).map(
                (manager) => ({
                  value: manager.id,
                  label: manager.username,
                }),
              )}
            />
          </Form.Item>
        </Form>
      </Modal>
    </>
  );
}

export function Members({
  project,
  onError,
  onChanged,
}: {
  project: Project;
  onError: (error: unknown) => void;
  onChanged: () => void;
}) {
  const [members, setMembers] = useState<ProjectMember[]>([]);
  const [candidates, setCandidates] = useState<User[]>([]);
  const [busy, setBusy] = useState(false);
  const [form] = Form.useForm();
  const path = `/projects/${project.id}`;
  async function reload() {
    try {
      const [nextMembers, nextCandidates] = await Promise.all([
        api<ProjectMember[]>(path + "/members"),
        api<User[]>(path + "/member-candidates"),
      ]);
      setMembers(nextMembers);
      setCandidates(nextCandidates);
    } catch (error) {
      onError(error);
    }
  }
  useEffect(() => {
    void reload();
  }, [project.id]);
  async function add(values: { userId: number; role: ProjectRole }) {
    setBusy(true);
    try {
      await api(path + "/members", "POST", values);
      form.resetFields();
      await reload();
      onChanged();
    } catch (error) {
      onError(error);
    } finally {
      setBusy(false);
    }
  }
  async function remove(userId: number) {
    try {
      await api(path + `/members/${userId}`, "DELETE");
      await reload();
      onChanged();
    } catch (error) {
      onError(error);
    }
  }
  async function changeRole(userId: number, role: ProjectRole) {
    try {
      await api(path + `/members/${userId}/role`, "PATCH", { role });
      await reload();
      onChanged();
    } catch (error) {
      onError(error);
    }
  }
  return (
    <>
      <Typography.Title level={3}>项目成员</Typography.Title>
      <Form
        form={form}
        layout="inline"
        onFinish={add}
        initialValues={{ role: "DEVELOPER" }}
        className="member-form"
      >
        <Form.Item name="userId" label="添加成员" rules={[{ required: true }]}>
          <Select
            style={{ width: 220 }}
            showSearch
            optionFilterProp="label"
            options={candidates.map((user) => ({
              value: user.id,
              label: user.username,
            }))}
          />
        </Form.Item>
        <Form.Item name="role" label="项目角色" rules={[{ required: true }]}>
          <Select
            style={{ width: 160 }}
            options={Object.entries(projectRoleLabels).map(
              ([value, label]) => ({ value, label }),
            )}
          />
        </Form.Item>
        <Button htmlType="submit" type="primary" loading={busy}>
          添加
        </Button>
      </Form>
      <Table
        rowKey="id"
        dataSource={members}
        columns={[
          { title: "用户名", render: (_, member) => member.user.username },
          {
            title: "状态",
            render: (_, member) => (member.user.active ? "有效" : "已停用"),
          },
          {
            title: "预设项目角色",
            render: (_, member) => (
              <Select
                aria-label={`${member.user.username}的项目角色`}
                value={member.role}
                style={{ width: 160 }}
                options={Object.entries(projectRoleLabels).map(
                  ([value, label]) => ({ value, label }),
                )}
                onChange={(role) => void changeRole(member.userId, role)}
              />
            ),
          },
          {
            title: "操作",
            render: (_, member) => (
              <Popconfirm
                title="移除成员将清空其本项目任务指派；项目须保留有效经理，确认？"
                onConfirm={() => remove(member.userId)}
              >
                <Button danger>移除</Button>
              </Popconfirm>
            ),
          },
        ]}
      />
    </>
  );
}
