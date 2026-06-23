import React, { useEffect, useMemo, useState } from "react";
import { Table, Button, Modal, Form, Input, Switch, Tag, message } from "antd";
import { PlusOutlined } from "@ant-design/icons";
import dayjs from "dayjs";
import { apiGet, apiPost, apiDelete, apiPatch } from "../../services/api";
import { useI18n } from "../../i18n";
import { useTheme } from "../../theme";
import { OverflowMenuButton } from "../Common/OverflowMenuButton";

interface Task {
  id: string;
  name: string;
  cron: string;
  prompt: string;
  enabled: boolean;
  lastRun?: string;
}

export default function Tasks() {
  const { colors } = useTheme();
  const { lang, t } = useI18n();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Task | null>(null);
  const [form] = Form.useForm<Task>();

  const ui = useMemo(
    () => ({
      title: lang === "zh" ? "\u5b9a\u65f6\u4efb\u52a1" : "Scheduled Tasks",
      createTask: lang === "zh" ? "\u65b0\u5efa\u4efb\u52a1" : "New Task",
      editTask: lang === "zh" ? "\u7f16\u8f91\u4efb\u52a1" : "Edit Task",
      taskUpdated: lang === "zh" ? "\u4efb\u52a1\u5df2\u66f4\u65b0" : "Task updated.",
      taskCreated: lang === "zh" ? "\u4efb\u52a1\u5df2\u521b\u5efa" : "Task created.",
      taskDeleted: lang === "zh" ? "\u4efb\u52a1\u5df2\u5220\u9664" : "Task deleted.",
      deleteConfirm: lang === "zh" ? "\u786e\u8ba4\u5220\u9664\u8fd9\u6761\u4efb\u52a1\uff1f" : "Delete this task?",
      taskQueued: lang === "zh"
        ? "\u4efb\u52a1\u5df2\u63d0\u4ea4\uff0c\u5b8c\u6210\u540e\u4f1a\u751f\u6210\u4e00\u6761\u4efb\u52a1\u4f1a\u8bdd\u3002"
        : "Task submitted. A task session will appear when it finishes.",
      name: lang === "zh" ? "\u540d\u79f0" : "Name",
      prompt: lang === "zh" ? "\u63d0\u793a\u8bcd" : "Prompt",
      status: lang === "zh" ? "\u72b6\u6001" : "Status",
      lastRun: lang === "zh" ? "\u4e0a\u6b21\u8fd0\u884c" : "Last Run",
      runNow: lang === "zh" ? "\u7acb\u5373\u8fd0\u884c" : "Run now",
      enabled: lang === "zh" ? "\u542f\u7528\u4e2d" : "Enabled",
      paused: lang === "zh" ? "\u5df2\u505c\u7528" : "Disabled",
      nameRequired: lang === "zh" ? "\u8bf7\u8f93\u5165\u540d\u79f0" : "Please enter a name.",
      cronRequired: lang === "zh" ? "\u8bf7\u8f93\u5165 Cron \u8868\u8fbe\u5f0f" : "Please enter a cron expression.",
      promptRequired: lang === "zh" ? "\u8bf7\u8f93\u5165\u63d0\u793a\u8bcd" : "Please enter a prompt.",
      cronHelp: lang === "zh" ? "\u4f8b\u5982\uff1a`0 9 * * *` \u8868\u793a\u6bcf\u5929 9 \u70b9\u6267\u884c" : "Example: `0 9 * * *` runs every day at 9:00.",
    }),
    [lang],
  );

  const fetchTasks = async () => {
    setLoading(true);
    try {
      const data = await apiGet<Task[]>("/api/tasks");
      setTasks(data);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void fetchTasks();
  }, []);

  const openCreate = () => {
    setEditing(null);
    form.resetFields();
    form.setFieldsValue({ enabled: true } as Task);
    setModalOpen(true);
  };

  const openEdit = (task: Task) => {
    setEditing(task);
    form.setFieldsValue(task);
    setModalOpen(true);
  };

  const handleSubmit = async () => {
    const values = await form.validateFields();
    if (editing) {
      await apiPatch(`/api/tasks/${editing.id}`, values);
    } else {
      await apiPost("/api/tasks", values);
    }
    void message.success(editing ? ui.taskUpdated : ui.taskCreated);
    setModalOpen(false);
    void fetchTasks();
  };

  const handleDelete = async (id: string) => {
    await apiDelete(`/api/tasks/${id}`);
    void message.success(ui.taskDeleted);
    void fetchTasks();
  };

  const confirmDelete = (task: Task) => {
    Modal.confirm({
      title: ui.deleteConfirm,
      okText: t("delete"),
      cancelText: t("cancel"),
      okButtonProps: { danger: true },
      onOk: async () => {
        await handleDelete(task.id);
      },
    });
  };

  const handleRun = async (id: string) => {
    await apiPost(`/api/tasks/${id}/run`, {});
    void message.success(ui.taskQueued);
    void fetchTasks();
  };

  const columns = [
    { title: ui.name, dataIndex: "name", key: "name" },
    {
      title: "Cron",
      dataIndex: "cron",
      key: "cron",
      render: (value: string) => (
        <code
          style={{
            fontFamily: "Consolas, Monaco, monospace",
            background: colors.codeBg,
            color: colors.textPrimary,
            padding: "2px 6px",
            borderRadius: 4,
          }}
        >
          {value}
        </code>
      ),
    },
    {
      title: ui.prompt,
      dataIndex: "prompt",
      key: "prompt",
      render: (value: string) => (value.length > 40 ? `${value.slice(0, 40)}...` : value),
    },
    {
      title: ui.status,
      dataIndex: "enabled",
      key: "enabled",
      render: (enabled: boolean) => <Tag color={enabled ? "green" : "default"}>{enabled ? ui.enabled : ui.paused}</Tag>,
    },
    {
      title: ui.lastRun,
      dataIndex: "lastRun",
      key: "lastRun",
      render: (value?: string) => (value ? dayjs(value).format("YYYY-MM-DD HH:mm:ss") : "-"),
    },
    {
      title: t("actions"),
      key: "actions",
      render: (_: unknown, record: Task) => (
        <OverflowMenuButton
          color={colors.textSecondary}
          label={lang === "zh" ? "\u64cd\u4f5c" : "Actions"}
          variant="outlined"
          backgroundColor={colors.bgTertiary}
          borderColor={colors.borderStrong}
          items={[
            { key: "run", label: ui.runNow },
            { key: "edit", label: t("edit") },
            { key: "delete", label: t("delete"), danger: true },
          ]}
          onItemClick={(key) => {
            if (key === "run") {
              void handleRun(record.id);
              return;
            }
            if (key === "edit") {
              openEdit(record);
              return;
            }
            if (key === "delete") {
              confirmDelete(record);
            }
          }}
        />
      ),
    },
  ];

  return (
    <div style={{ padding: 24, background: colors.bgPrimary, minHeight: "100%", color: colors.textPrimary }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <h2 style={{ color: colors.textPrimary, margin: 0 }}>{ui.title}</h2>
        <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
          {ui.createTask}
        </Button>
      </div>

      <div style={{ background: colors.bgSecondary, border: `1px solid ${colors.border}`, borderRadius: 12, overflow: "hidden" }}>
        <Table dataSource={tasks} columns={columns} rowKey="id" loading={loading} pagination={{ pageSize: 10 }} />
      </div>

      <Modal
        title={editing ? ui.editTask : ui.createTask}
        open={modalOpen}
        onOk={() => void handleSubmit()}
        onCancel={() => setModalOpen(false)}
        okText={t("save")}
        cancelText={t("cancel")}
      >
        <Form form={form} layout="vertical">
          <Form.Item name="name" label={ui.name} rules={[{ required: true, message: ui.nameRequired }]}>
            <Input />
          </Form.Item>
          <Form.Item
            name="cron"
            label="Cron"
            rules={[{ required: true, message: ui.cronRequired }]}
            extra={ui.cronHelp}
          >
            <Input placeholder="0 9 * * *" />
          </Form.Item>
          <Form.Item name="prompt" label={ui.prompt} rules={[{ required: true, message: ui.promptRequired }]}>
            <Input.TextArea rows={4} />
          </Form.Item>
          <Form.Item name="enabled" label={t("enable")} valuePropName="checked">
            <Switch />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
