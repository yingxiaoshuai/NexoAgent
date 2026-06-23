import React, { useEffect, useState } from "react";
import { Table, Button, Modal, Form, Input, Switch, Tag, message } from "antd";
import { PlusOutlined } from "@ant-design/icons";
import dayjs from "dayjs";
import { apiGet, apiPost, apiDelete, apiPatch } from "../../services/api";
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
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Task | null>(null);
  const [form] = Form.useForm();

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
    form.setFieldsValue({ enabled: true });
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
    void message.success(editing ? "任务已更新" : "任务已创建");
    setModalOpen(false);
    void fetchTasks();
  };

  const handleDelete = async (id: string) => {
    await apiDelete(`/api/tasks/${id}`);
    void message.success("任务已删除");
    void fetchTasks();
  };

  const confirmDelete = (task: Task) => {
    Modal.confirm({
      title: "确认删除这条任务？",
      okText: "删除",
      cancelText: "取消",
      okButtonProps: { danger: true },
      onOk: async () => {
        await handleDelete(task.id);
      },
    });
  };

  const handleRun = async (id: string) => {
    await apiPost(`/api/tasks/${id}/run`, {});
    void message.success("任务已提交，完成后会生成一条任务会话");
    void fetchTasks();
  };

  const columns = [
    { title: "名称", dataIndex: "name", key: "name" },
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
      title: "提示词",
      dataIndex: "prompt",
      key: "prompt",
      render: (value: string) => (value.length > 40 ? `${value.slice(0, 40)}...` : value),
    },
    {
      title: "状态",
      dataIndex: "enabled",
      key: "enabled",
      render: (enabled: boolean) => <Tag color={enabled ? "green" : "default"}>{enabled ? "启用中" : "已停用"}</Tag>,
    },
    {
      title: "上次运行",
      dataIndex: "lastRun",
      key: "lastRun",
      render: (value?: string) => (value ? dayjs(value).format("YYYY-MM-DD HH:mm:ss") : "-"),
    },
    {
      title: "操作",
      key: "actions",
      render: (_: unknown, record: Task) => (
        <OverflowMenuButton
          color={colors.textSecondary}
          items={[
            { key: "run", label: "立即运行" },
            { key: "edit", label: "编辑" },
            { key: "delete", label: "删除", danger: true },
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
        <h2 style={{ color: colors.textPrimary, margin: 0 }}>定时任务</h2>
        <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
          新建任务
        </Button>
      </div>

      <div style={{ background: colors.bgSecondary, border: `1px solid ${colors.border}`, borderRadius: 12, overflow: "hidden" }}>
        <Table dataSource={tasks} columns={columns} rowKey="id" loading={loading} pagination={{ pageSize: 10 }} />
      </div>

      <Modal
        title={editing ? "编辑任务" : "新建任务"}
        open={modalOpen}
        onOk={() => void handleSubmit()}
        onCancel={() => setModalOpen(false)}
        okText="保存"
        cancelText="取消"
      >
        <Form form={form} layout="vertical">
          <Form.Item name="name" label="名称" rules={[{ required: true, message: "请输入名称" }]}>
            <Input />
          </Form.Item>
          <Form.Item
            name="cron"
            label="Cron 表达式"
            rules={[{ required: true, message: "请输入 Cron 表达式" }]}
            extra="例如：0 9 * * * 表示每天 9 点执行"
          >
            <Input placeholder="0 9 * * *" />
          </Form.Item>
          <Form.Item name="prompt" label="提示词" rules={[{ required: true, message: "请输入提示词" }]}>
            <Input.TextArea rows={4} />
          </Form.Item>
          <Form.Item name="enabled" label="启用" valuePropName="checked">
            <Switch />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
