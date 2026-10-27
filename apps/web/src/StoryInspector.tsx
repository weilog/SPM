import { Button, Checkbox, Drawer, Form, Input, Modal, Select } from "antd";
import { useState } from "react";
import { storyStatusLabels, type StoryStatus } from "@spm/shared";
import { useProjectData } from "./ProjectData";
import { useTaskActions } from "./TaskActions";
import { storyNumber, taskNumber } from "./StoryViews";
import { Status } from "./ui";
export function StoryInspector({
  id,
  onClose,
}: {
  id: number | null;
  onClose(): void;
}) {
  const store = useProjectData(),
    actions = useTaskActions(),
    story = store.stories.stories.find((s) => s.id === id);
  const [editing, setEditing] = useState(false),
    [busy, setBusy] = useState(false);
  const [form] = Form.useForm();
  async function save() {
    if (!story) return;
    let values;
    try {
      values = await form.validateFields();
    } catch {
      return;
    }
    setBusy(true);
    try {
      await store.write(`/stories/${story.id}`, "PATCH", {
        ...values,
        revision: story.revision,
      });
      setEditing(false);
    } catch (e) {
      store.onError(e);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <Drawer
        className="v43-drawer"
        size={640}
        styles={{ wrapper: { top: 56, height: "calc(100% - 56px)" } }}
        open={!!story}
        onClose={onClose}
        title={story ? `${storyNumber(story.id)} · ${story.title}` : ""}
        footer={
          <>
            <Button onClick={onClose}>关闭</Button>
            {store.project.canManage && (
              <Button
                type="primary"
                onClick={() => {
                  if (story) {
                    setEditing(true);
                    form.resetFields();
                    form.setFieldsValue(story);
                  }
                }}
              >
                编辑故事
              </Button>
            )}
          </>
        }
      >
        {story && (
          <>
            <div className="detail-row">
              <div className="detail-label">所属 Epic</div>
              {store.stories.epics.find((e) => e.id === story.epicId)?.title}
            </div>
            <div className="detail-row">
              <div className="detail-label">故事状态</div>
              {store.project.canManage ? (
                <Select
                  aria-label="故事状态"
                  value={story.status}
                  disabled={busy}
                  options={Object.entries(storyStatusLabels).map(
                    ([value, label]) => ({ value, label }),
                  )}
                  onChange={(status: StoryStatus) => {
                    setBusy(true);
                    void store
                      .write(`/stories/${story.id}/status`, "PATCH", {
                        status,
                        revision: story.revision,
                      })
                      .catch(store.onError)
                      .finally(() => setBusy(false));
                  }}
                />
              ) : (
                <Status value={story.status} />
              )}
            </div>
            <div className="detail-row">
              <div className="detail-label">故事描述</div>
              {story.description}
            </div>
            <div className="detail-row">
              <div className="detail-label">验收标准</div>
              {story.acceptanceCriteria}
            </div>
            <div className="detail-row">
              <div className="detail-label">关联正式需求</div>
              {story.requirementIds.map((id) => (
                <span className="chip" key={id}>
                  {store.requirements.find((r) => r.id === id)?.title}
                </span>
              ))}
            </div>
            <div className="detail-row">
              <div className="detail-label">关联任务</div>
              {store.tasks
                .filter((t) => t.storyIds.includes(story.id))
                .map((t) => (
                  <button
                    className="btn small light"
                    key={t.id}
                    onClick={() => {
                      onClose();
                      actions.open(t.id);
                    }}
                  >
                    {taskNumber(t.id)} · {t.title}
                  </button>
                ))}
            </div>
          </>
        )}
      </Drawer>
      <Modal
        centered
        open={editing && !!story}
        title="编辑用户故事"
        onCancel={() => setEditing(false)}
        onOk={() => void save()}
        okText="保存"
        confirmLoading={busy}
        destroyOnHidden
      >
        <Form form={form} layout="vertical" preserve={false}>
          <Form.Item
            name="title"
            label="故事标题"
            rules={[{ required: true, whitespace: true }, { max: 200 }]}
          >
            <Input />
          </Form.Item>
          <Form.Item
            name="epicId"
            label="所属 Epic"
            rules={[{ required: true }]}
          >
            <Select
              options={store.stories.epics.map((e) => ({
                value: e.id,
                label: e.title,
              }))}
            />
          </Form.Item>
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
              {store.requirements.map((r) => (
                <Checkbox key={r.id} value={r.id}>
                  {r.title}
                </Checkbox>
              ))}
            </Checkbox.Group>
          </Form.Item>
        </Form>
      </Modal>
    </>
  );
}
