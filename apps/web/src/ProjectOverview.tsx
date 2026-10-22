import { Drawer } from "antd";
import { useState } from "react";
import { projectRoleLabels } from "@spm/shared";
import { useProjectData } from "./ProjectData";
import { useTaskActions } from "./TaskActions";
import { Status } from "./ui";
import { taskNumber } from "./StoryViews";
import "./a-overview.css";
export function ProjectOverview({
  onNavigate,
}: {
  onNavigate(p: string): void;
}) {
  const store = useProjectData(),
    actions = useTaskActions(),
    p = store.project;
  const [info, setInfo] = useState(false);
  const facts = [
    ["项目名称", p.name],
    ["项目编号", `P-${String(p.id).padStart(3, "0")}`],
    ["项目经理", p.manager.username],
    [
      "创建日期",
      ("createdAt" in p ? String(p.createdAt) : "").slice(0, 10) || "—",
    ],
    ["我的角色", projectRoleLabels[p.projectRole]],
    ["项目描述", p.description || "暂无描述"],
  ];
  const quick = [
    ["requirements", "需求管理", "查看当前项目的正式需求"],
    ["plan", "项目计划", "计划与甘特图"],
    [
      p.canManage ? "tasks" : "mine",
      p.canManage ? "任务管理" : "我的任务",
      p.canManage ? "查看与指派项目任务" : "查看本人被分配的任务",
    ],
    ["docs", "项目文档", "项目资料"],
    ...(p.canManage ? [["members", "成员与角色", "项目成员及预设角色"]] : []),
    ["workspace", "多视图工作台", "多视图关联定位"],
  ];
  const recent = [...store.tasks]
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || b.id - a.id)
    .slice(0, 3);
  return (
    <div className="a-overview">
      <div className="content">
        <div className="heading">
          <div>
            <h1>{p.name}</h1>
          </div>
          <button className="btn outline" onClick={() => setInfo(true)}>
            项目信息
          </button>
        </div>
        <div className="cards">
          {[
            [
              "正式需求",
              store.requirements.length,
            ],
            [
              p.canManage ? "项目任务" : "我的任务",
              store.tasks.length,
            ],
            [
              "项目成员",
              p.canManage ? store.members.length : "—",
            ],
          ].map(([label, num]) => (
            <div className="metric" key={label}>
              <div className="label">{label}</div>
              <div className="num">{num}</div>
            </div>
          ))}
        </div>
        <div className="twocol">
          <section className="panel">
            <div className="panelhead">
              项目基本信息{" "}
              <span className="tag">{projectRoleLabels[p.projectRole]}</span>
            </div>
            <dl className="facts">
              {facts.map(([label, value]) => (
                <span key={label} style={{ display: "contents" }}>
                  <dt>{label}</dt>
                  <dd>{value}</dd>
                </span>
              ))}
            </dl>
          </section>
          <section className="panel">
            <div className="panelhead">快捷入口</div>
            <div className="quick">
              {quick.map(([id, name, note]) => (
                <button key={id} onClick={() => onNavigate(id)}>
                  <b>↗ {name}</b>
                  <small>{note}</small>
                </button>
              ))}
            </div>
          </section>
        </div>
        <section className="panel">
          <div className="panelhead">
            <span>{p.canManage ? "项目最近工作" : "我的最近任务"}</span>
            <button
              className="link"
              onClick={() => onNavigate(p.canManage ? "tasks" : "mine")}
            >
              查看任务 →
            </button>
          </div>
          {recent.length ? (
            recent.map((t) => (
              <div className="workrow" key={t.id}>
                <div>
                  <button className="t" onClick={() => actions.open(t.id)}>
                    {t.title}
                  </button>
                  <div className="secondary">
                    {taskNumber(t.id)} ·{" "}
                    {store.members.find((m) => m.userId === t.assigneeUserId)
                      ?.user.username || "未指派"}
                  </div>
                </div>
                <Status value={t.status} />
              </div>
            ))
          ) : (
            <div className="workempty">当前没有可查看的任务</div>
          )}
        </section>
        <p className="bottom">工作摘要仅显示当前角色有权访问的内容。</p>
      </div>
      <Drawer
        className="v43-drawer"
        size={640}
        styles={{ wrapper: { top: 56, height: "calc(100% - 56px)" } }}
        title="项目信息"
        open={info}
        onClose={() => setInfo(false)}
      >
        {facts.map(([label, value]) => (
          <div className="detail-row" key={label}>
            <div className="detail-label">{label}</div>
            <div className="detail-value">{value}</div>
          </div>
        ))}
      </Drawer>
    </div>
  );
}
