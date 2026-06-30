import React, { useEffect, useMemo, useState } from "react";
import { Table, Button, Modal, Form, Input, Switch, Tag, Tooltip, message } from "antd";
import { PlusOutlined } from "@ant-design/icons";
import dayjs from "dayjs";
import { apiGet, apiPost, apiDelete, apiPatch } from "../../services/api";
import { useI18n } from "../../i18n";
import { useTheme } from "../../theme";
import { OverflowMenuButton } from "../Common/OverflowMenuButton";
import type { TurnCompletionStatus } from "../../shared/types";

interface Task {
  id: string;
  name: string;
  cron: string;
  prompt: string;
  enabled: boolean;
  lastRun?: string;
  lastRunStatus?: TurnCompletionStatus;
  lastError?: string;
}

interface TaskRunResponse {
  ok: true;
  taskId: string;
  taskName: string;
  sessionId: string;
  sessionTitle: string;
  status: TurnCompletionStatus;
  finishedAt: string;
  assistantPreview: string;
}

interface TasksProps {
  onOpenTaskSession?: (sessionId: string) => Promise<void> | void;
}

export default function Tasks({ onOpenTaskSession }: TasksProps) {
  const { colors } = useTheme();
  const { lang, t } = useI18n();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Task | null>(null);
  const [runningTaskId, setRunningTaskId] = useState("");
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
      taskRunning: lang === "zh" ? "\u4efb\u52a1\u6267\u884c\u4e2d..." : "Task is running...",
      runningTask: lang === "zh" ? "\u6267\u884c\u4e2d" : "Running",
      taskFinished: lang === "zh" ? "\u4efb\u52a1\u5df2\u5b8c\u6210\uff0c\u5df2\u6253\u5f00\u4efb\u52a1\u4f1a\u8bdd\u3002" : "Task completed and its session was opened.",
      taskNeedsInput: lang === "zh" ? "\u4efb\u52a1\u9700\u8981\u7ee7\u7eed\u5904\u7406\uff0c\u5df2\u6253\u5f00\u4efb\u52a1\u4f1a\u8bdd\u3002" : "Task needs follow-up and its session was opened.",
      taskInterrupted: lang === "zh" ? "\u4efb\u52a1\u5df2\u4e2d\u65ad\uff0c\u5df2\u6253\u5f00\u4efb\u52a1\u4f1a\u8bdd\u3002" : "Task was interrupted and its session was opened.",
      taskFailed: lang === "zh" ? "\u4efb\u52a1\u6267\u884c\u5931\u8d25\uff0c\u5df2\u6253\u5f00\u4efb\u52a1\u4f1a\u8bdd\u67e5\u770b\u539f\u56e0\u3002" : "Task failed and its session was opened for details.",
      taskFinishedNoOpen: lang === "zh" ? "\u4efb\u52a1\u5df2\u5b8c\u6210" : "Task completed.",
      taskNeedsInputNoOpen: lang === "zh" ? "\u4efb\u52a1\u9700\u8981\u7ee7\u7eed\u5904\u7406" : "Task needs follow-up.",
      taskInterruptedNoOpen: lang === "zh" ? "\u4efb\u52a1\u5df2\u4e2d\u65ad" : "Task was interrupted.",
      taskFailedNoOpen: lang === "zh" ? "\u4efb\u52a1\u6267\u884c\u5931\u8d25" : "Task failed.",
      name: lang === "zh" ? "\u540d\u79f0" : "Name",
      prompt: lang === "zh" ? "\u63d0\u793a\u8bcd" : "Prompt",
      status: lang === "zh" ? "\u72b6\u6001" : "Status",
      lastRun: lang === "zh" ? "\u4e0a\u6b21\u8fd0\u884c" : "Last Run",
      lastResult: lang === "zh" ? "\u4e0a\u6b21\u7ed3\u679c" : "Last Result",
      noRunsYet: lang === "zh" ? "\u672a\u8fd0\u884c" : "Not run yet",
      runNow: lang === "zh" ? "\u7acb\u5373\u8fd0\u884c" : "Run now",
      enabled: lang === "zh" ? "\u542f\u7528\u4e2d" : "Enabled",
      paused: lang === "zh" ? "\u5df2\u505c\u7528" : "Disabled",
      nameRequired: lang === "zh" ? "\u8bf7\u8f93\u5165\u540d\u79f0" : "Please enter a name.",
      cronRequired: lang === "zh" ? "\u8bf7\u8f93\u5165 Cron \u8868\u8fbe\u5f0f" : "Please enter a cron expression.",
      promptRequired: lang === "zh" ? "\u8bf7\u8f93\u5165\u63d0\u793a\u8bcd" : "Please enter a prompt.",
      cronHelp: lang === "zh" ? "\u4f8b\u5982\uff1a`0 9 * * *` \u8868\u793a\u6bcf\u5929 9 \u70b9\u6267\u884c" : "Example: `0 9 * * *` runs every day at 9:00.",
    }),
    [lang, t],
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

  const openTaskSession = async (sessionId: string) => {
    if (!onOpenTaskSession) return false;
    await onOpenTaskSession(sessionId);
    return true;
  };

  const getCompletionMessage = (status: TurnCompletionStatus, opened: boolean) => {
    if (status === "failed") return opened ? ui.taskFailed : ui.taskFailedNoOpen;
    if (status === "needs_input") return opened ? ui.taskNeedsInput : ui.taskNeedsInputNoOpen;
    if (status === "interrupted") return opened ? ui.taskInterrupted : ui.taskInterruptedNoOpen;
    return opened ? ui.taskFinished : ui.taskFinishedNoOpen;
  };

  const getCompletionType = (status: TurnCompletionStatus) => {
    if (status === "failed") return "error" as const;
    if (status === "needs_input" || status === "interrupted") return "warning" as const;
    return "success" as const;
  };

  const handleRun = async (id: string) => {
    const messageKey = `task-run-${id}`;
    setRunningTaskId(id);
    void message.open({ key: messageKey, type: "loading", content: ui.taskRunning, duration: 0 });
    try {
      const result = await apiPost<TaskRunResponse>(`/api/tasks/${id}/run`, {});
      await fetchTasks();
      const opened = await openTaskSession(result.sessionId);
      void message.open({
        key: messageKey,
        type: getCompletionType(result.status),
        content: getCompletionMessage(result.status, opened),
        duration: 4,
      });
    } catch (error) {
      const content = error instanceof Error ? error.message : String(error);
      void message.open({ key: messageKey, type: "error", content, duration: 4 });
    } finally {
      setRunningTaskId("");
    }
  };

  const formatTaskResultLabel = (status?: TurnCompletionStatus) => {
    if (!status) return ui.noRunsYet;
    if (status === "completed") return t("done");
    if (status === "needs_input") return t("needsInput");
    if (status === "interrupted") return t("interrupted");
    if (status === "failed") return t("failedExecution");
    if (status === "undone") return t("undone");
    return status;
  };

  const getTaskResultColor = (status?: TurnCompletionStatus) => {
    if (status === "completed") return "green";
    if (status === "needs_input") return "gold";
    if (status === "interrupted") return "orange";
    if (status === "failed") return "red";
    if (status === "undone") return "default";
    return "default";
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
      title: ui.lastResult,
      dataIndex: "lastRunStatus",
      key: "lastRunStatus",
      render: (value: TurnCompletionStatus | undefined, record: Task) => (
        <Tooltip title={record.lastError || undefined}>
          <Tag color={getTaskResultColor(value)}>{formatTaskResultLabel(value)}</Tag>
        </Tooltip>
      ),
    },
    {
      title: ui.lastRun,
      key: "lastRun",
      render: (_value: unknown, record: Task) => (
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <span>{record.lastRun ? dayjs(record.lastRun).format("YYYY-MM-DD HH:mm:ss") : "-"}</span>
          {record.lastError ? (
            <span style={{ color: "#cf1322", fontSize: 12 }}>
              {record.lastError.length > 60 ? `${record.lastError.slice(0, 57)}...` : record.lastError}
            </span>
          ) : null}
        </div>
      ),
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
            { key: "run", label: runningTaskId === record.id ? ui.runningTask : ui.runNow, disabled: runningTaskId === record.id },
            { key: "edit", label: t("edit"), disabled: runningTaskId === record.id },
            { key: "delete", label: t("delete"), danger: true, disabled: runningTaskId === record.id },
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
