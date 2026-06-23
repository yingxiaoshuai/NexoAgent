import { useEffect, useMemo, useState } from "react";
import type { CSSProperties } from "react";
import {
  Alert,
  Button,
  Divider,
  Form,
  Input,
  List,
  Modal,
  Space,
  Spin,
  Tabs,
  Tag,
  Tooltip,
  Typography,
  message,
} from "antd";
import {
  CheckCircleOutlined,
  CloseCircleOutlined,
  GlobalOutlined,
  InfoCircleOutlined,
  LoadingOutlined,
  PlusOutlined,
  SyncOutlined,
  ThunderboltOutlined,
} from "@ant-design/icons";
import type { McpServerConfig, McpServerListItem, McpServerStatus } from "../../shared/types";
import { apiGet, apiPost } from "../../services/api";
import { useTheme } from "../../theme";
import { OverflowMenuButton } from "../Common/OverflowMenuButton";

const { Title, Text, Paragraph } = Typography;
const { TextArea } = Input;

interface ToolItem {
  name: string;
  label?: string;
  group: string;
  description: string;
  enabled: boolean;
  source?: string;
  sourceServerName?: string;
  mcpStatus?: "connected" | "empty" | "error";
  mcpError?: string;
}

interface McpServerFormValues {
  name: string;
  command: string;
  args: string;
}

type TestingState = Record<string, boolean>;

const UI_TEXT = {
  builtinTools: "\u5185\u7f6e\u5de5\u5177",
  mcpServices: "MCP \u670d\u52a1",
  enable: "\u542f\u7528",
  disable: "\u505c\u7528",
  enabled: "\u5df2\u542f\u7528",
  disabled: "\u5df2\u505c\u7528",
  configuredServices: "\u5df2\u914d\u7f6e\u670d\u52a1",
  connected: "\u8fde\u63a5\u6b63\u5e38",
  discoveredTools: "\u53d1\u73b0\u5de5\u5177",
  issues: "\u5f85\u5904\u7406\u5f02\u5e38",
  refresh: "\u5237\u65b0",
  addService: "\u65b0\u589e\u670d\u52a1",
  noServices: "\u8fd8\u6ca1\u6709 MCP \u670d\u52a1\u914d\u7f6e",
  testConnection: "\u6d4b\u8bd5\u8fde\u63a5",
  delete: "\u5220\u9664",
  startupCommand: "\u542f\u52a8\u547d\u4ee4\uff1a",
  noToolsFound: "\u6682\u672a\u53d1\u73b0\u5de5\u5177",
  save: "\u4fdd\u5b58",
  cancel: "\u53d6\u6d88",
  addMcpService: "\u65b0\u589e MCP \u670d\u52a1",
  serviceName: "\u670d\u52a1\u540d\u79f0",
  startCommand: "\u542f\u52a8\u547d\u4ee4",
  commandArgsJson: "\u547d\u4ee4\u53c2\u6570 JSON",
  saveSuccess: "MCP \u670d\u52a1\u914d\u7f6e\u5df2\u4fdd\u5b58",
  deleteSuccess: "MCP \u670d\u52a1\u5df2\u5220\u9664",
  testSuccess: "\u8fde\u63a5\u6210\u529f\uff0c\u53d1\u73b0 {count} \u4e2a\u5de5\u5177",
  testEmpty: "\u8fde\u63a5\u6210\u529f\uff0c\u4f46\u6ca1\u6709\u53d1\u73b0\u53ef\u7528\u5de5\u5177",
  testFailed: "\u8fde\u63a5\u6d4b\u8bd5\u5931\u8d25",
  argsMustBeArray: "\u53c2\u6570\u5fc5\u987b\u662f JSON \u6570\u7ec4",
  infoMessage:
    "MCP \u670d\u52a1\u4f1a\u5728\u4fdd\u5b58\u540e\u81ea\u52a8\u5237\u65b0\u3002\u4f60\u4e5f\u53ef\u4ee5\u5bf9\u5355\u4e2a\u670d\u52a1\u6267\u884c\u6d4b\u8bd5\u8fde\u63a5\uff0c\u7acb\u5373\u67e5\u770b\u9519\u8bef\u8be6\u60c5\u4e0e\u5de5\u5177\u53d1\u73b0\u7ed3\u679c\u3002",
  serviceNameRequired: "\u8bf7\u8f93\u5165\u670d\u52a1\u540d\u79f0",
  commandRequired: "\u8bf7\u8f93\u5165\u542f\u52a8\u547d\u4ee4",
  argsRequired: "\u8bf7\u8f93\u5165\u53c2\u6570 JSON",
  statusConnected: "\u5df2\u8fde\u63a5",
  statusEmpty: "\u5df2\u8fde\u63a5\u4f46\u65e0\u5de5\u5177",
  statusError: "\u8fde\u63a5\u5931\u8d25",
} as const;

function parseArgsInput(raw: string) {
  const trimmed = raw.trim();
  if (!trimmed) return [];
  const parsed = JSON.parse(trimmed) as unknown;
  if (!Array.isArray(parsed)) {
    throw new Error(UI_TEXT.argsMustBeArray);
  }
  return parsed.map((item) => String(item));
}

function summarizeToolName(name: string) {
  return name.replace(/^mcp__/, "");
}

function getStatusMeta(status?: McpServerStatus["status"]) {
  switch (status) {
    case "connected":
      return {
        color: "green",
        label: UI_TEXT.statusConnected,
        icon: <CheckCircleOutlined />,
      };
    case "empty":
      return {
        color: "gold",
        label: UI_TEXT.statusEmpty,
        icon: <InfoCircleOutlined />,
      };
    case "error":
    default:
      return {
        color: "red",
        label: UI_TEXT.statusError,
        icon: <CloseCircleOutlined />,
      };
  }
}

export default function Tools() {
  const { colors } = useTheme();
  const [messageApi, messageContext] = message.useMessage();
  const [tools, setTools] = useState<ToolItem[]>([]);
  const [mcpServers, setMcpServers] = useState<McpServerListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [mcpModalOpen, setMcpModalOpen] = useState(false);
  const [testingState, setTestingState] = useState<TestingState>({});
  const [mcpForm] = Form.useForm<McpServerFormValues>();

  const cardStyle: CSSProperties = useMemo(
    () => ({
      background: colors.bgSecondary,
      border: `1px solid ${colors.border}`,
      borderRadius: 14,
      padding: "0 16px",
      overflow: "hidden",
      boxShadow: colors.bgPrimary === "#0e1726" ? "0 10px 30px rgba(0, 0, 0, 0.2)" : "0 10px 24px rgba(15, 23, 42, 0.06)",
    }),
    [colors]
  );

  const subtlePanelStyle: CSSProperties = useMemo(
    () => ({
      background: `linear-gradient(135deg, ${colors.bgSecondary} 0%, ${colors.bgTertiary} 100%)`,
      border: `1px solid ${colors.border}`,
      borderRadius: 16,
      padding: 16,
    }),
    [colors]
  );

  const loadAll = async () => {
    setLoading(true);
    try {
      const [toolData, mcpData] = await Promise.all([
        apiGet<ToolItem[]>("/api/tools"),
        apiGet<McpServerListItem[]>("/api/mcp-servers"),
      ]);
      setTools(toolData);
      setMcpServers(mcpData);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadAll();
  }, []);

  const toggleTool = async (name: string, enabled: boolean) => {
    await apiPost("/api/tools", { name, enabled });
    setTools((current) => current.map((tool) => (tool.name === name ? { ...tool, enabled } : tool)));
  };

  const persistServers = async (servers: McpServerConfig[]) => {
    setSaving(true);
    try {
      const saved = await apiPost<McpServerConfig[]>("/api/mcp-servers", servers);
      await loadAll();
      return saved;
    } finally {
      setSaving(false);
    }
  };

  const saveMcpServer = async () => {
    const values = await mcpForm.validateFields();
    let args: string[];

    try {
      args = parseArgsInput(values.args);
    } catch (error) {
      void messageApi.error(error instanceof Error ? error.message : UI_TEXT.argsMustBeArray);
      return;
    }

    const next: McpServerConfig[] = [
      ...mcpServers.map((server) => ({
        name: server.name,
        command: server.command,
        args: server.args,
      })),
      {
        name: values.name.trim(),
        command: values.command.trim(),
        args,
      },
    ];

    await persistServers(next);
    setMcpModalOpen(false);
    mcpForm.resetFields();
    void messageApi.success(UI_TEXT.saveSuccess);
  };

  const deleteMcpServer = async (name: string) => {
    await persistServers(
      mcpServers
        .filter((server) => server.name !== name)
        .map((server) => ({ name: server.name, command: server.command, args: server.args }))
    );
    void messageApi.success(UI_TEXT.deleteSuccess);
  };

  const handleTestServer = async (server: McpServerListItem) => {
    setTestingState((current) => ({ ...current, [server.name]: true }));
    try {
      const result = await apiPost<McpServerStatus>("/api/mcp-servers/test", {
        name: server.name,
        command: server.command,
        args: server.args,
      });
      setMcpServers((current) =>
        current.map((item) => (item.name === server.name ? { ...item, runtimeStatus: result } : item))
      );
      await loadAll();
      if (result.status === "connected") {
        void messageApi.success(UI_TEXT.testSuccess.replace("{count}", String(result.toolCount)));
      } else if (result.status === "empty") {
        void messageApi.warning(UI_TEXT.testEmpty);
      } else {
        void messageApi.error(result.error || UI_TEXT.testFailed);
      }
    } catch (error) {
      void messageApi.error(error instanceof Error ? error.message : UI_TEXT.testFailed);
    } finally {
      setTestingState((current) => ({ ...current, [server.name]: false }));
    }
  };

  const builtinGroups = Array.from(new Set(tools.filter((tool) => tool.group !== "mcp").map((tool) => tool.group)));
  const mcpTools = tools.filter((tool) => tool.group === "mcp");
  const mcpToolsByServer = new Map<string, ToolItem[]>();
  for (const tool of mcpTools) {
    const key = tool.sourceServerName || "unknown";
    const list = mcpToolsByServer.get(key) ?? [];
    list.push(tool);
    mcpToolsByServer.set(key, list);
  }

  const connectedCount = mcpServers.filter((server) => server.runtimeStatus?.status === "connected").length;
  const errorCount = mcpServers.filter((server) => server.runtimeStatus?.status === "error").length;

  return (
    <div style={{ background: colors.bgPrimary, minHeight: "100%", padding: 24, color: colors.textPrimary }}>
      {messageContext}
      <Title level={4} style={{ color: colors.textPrimary, marginBottom: 16 }}>
        Tools
      </Title>

      <Tabs
        items={[
          {
            key: "builtins",
            label: UI_TEXT.builtinTools,
            children: loading ? (
              <div style={{ padding: 48, textAlign: "center" }}>
                <Spin />
              </div>
            ) : (
              <div style={cardStyle}>
                {builtinGroups.map((group, index) => (
                  <div key={group}>
                    {index > 0 && <Divider style={{ borderColor: colors.border, margin: 0 }} />}
                    <List
                      dataSource={tools.filter((tool) => tool.group === group)}
                      renderItem={(tool) => (
                        <List.Item
                          style={{ borderColor: colors.border, paddingBlock: 14 }}
                          actions={[
                            <OverflowMenuButton
                              key="more"
                              color={colors.textSecondary}
                              items={[{ key: "toggle", label: tool.enabled ? UI_TEXT.disable : UI_TEXT.enable }]}
                              onItemClick={(key) => {
                                if (key === "toggle") {
                                  void toggleTool(tool.name, !tool.enabled);
                                }
                              }}
                            />,
                          ]}
                        >
                          <List.Item.Meta
                            avatar={<ThunderboltOutlined style={{ color: colors.textSecondary, fontSize: 18, marginTop: 4 }} />}
                            title={
                              <Space size={8} wrap>
                                <span style={{ color: colors.textPrimary, fontWeight: 600 }}>{tool.label || tool.name}</span>
                                <Text style={{ color: colors.textMuted }}>{tool.name}</Text>
                                <Tag color="blue">{tool.group}</Tag>
                                <Tag color={tool.enabled ? "green" : "default"}>{tool.enabled ? UI_TEXT.enabled : UI_TEXT.disabled}</Tag>
                              </Space>
                            }
                            description={<Text style={{ color: colors.textSecondary }}>{tool.description}</Text>}
                          />
                        </List.Item>
                      )}
                    />
                  </div>
                ))}
              </div>
            ),
          },
          {
            key: "mcp",
            label: UI_TEXT.mcpServices,
            children: (
              <>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12, marginBottom: 16 }}>
                  <div style={subtlePanelStyle}>
                    <Text style={{ color: colors.textMuted, display: "block", marginBottom: 8 }}>{UI_TEXT.configuredServices}</Text>
                    <div style={{ fontSize: 28, fontWeight: 700, color: colors.textPrimary }}>{mcpServers.length}</div>
                  </div>
                  <div style={subtlePanelStyle}>
                    <Text style={{ color: colors.textMuted, display: "block", marginBottom: 8 }}>{UI_TEXT.connected}</Text>
                    <div style={{ fontSize: 28, fontWeight: 700, color: "#22c55e" }}>{connectedCount}</div>
                  </div>
                  <div style={subtlePanelStyle}>
                    <Text style={{ color: colors.textMuted, display: "block", marginBottom: 8 }}>{UI_TEXT.discoveredTools}</Text>
                    <div style={{ fontSize: 28, fontWeight: 700, color: colors.textPrimary }}>{mcpTools.length}</div>
                  </div>
                  <div style={subtlePanelStyle}>
                    <Text style={{ color: colors.textMuted, display: "block", marginBottom: 8 }}>{UI_TEXT.issues}</Text>
                    <div style={{ fontSize: 28, fontWeight: 700, color: errorCount > 0 ? "#ef4444" : colors.textPrimary }}>{errorCount}</div>
                  </div>
                </div>

                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, marginBottom: 16 }}>
                  <Alert type="info" showIcon message={UI_TEXT.infoMessage} style={{ flex: 1 }} />
                  <Space>
                    <Button icon={<SyncOutlined />} onClick={() => void loadAll()} loading={loading}>
                      {UI_TEXT.refresh}
                    </Button>
                    <Button type="primary" icon={<PlusOutlined />} onClick={() => setMcpModalOpen(true)}>
                      {UI_TEXT.addService}
                    </Button>
                  </Space>
                </div>

                <div style={cardStyle}>
                  <List
                    locale={{ emptyText: UI_TEXT.noServices }}
                    dataSource={mcpServers}
                    loading={loading || saving}
                    renderItem={(server) => {
                      const serverTools = mcpToolsByServer.get(server.name) ?? [];
                      const status = server.runtimeStatus;
                      const statusMeta = getStatusMeta(status?.status);
                      const testing = testingState[server.name];
                      const visibleToolNames = status?.toolNames?.length
                        ? status.toolNames
                        : serverTools.map((tool) => tool.label || summarizeToolName(tool.name));

                      return (
                        <List.Item
                          style={{ borderColor: colors.border, paddingBlock: 16 }}
                          actions={[
                            <Button
                              key="test"
                              size="small"
                              icon={testing ? <LoadingOutlined /> : <SyncOutlined />}
                              loading={testing}
                              onClick={() => void handleTestServer(server)}
                            >
                              {UI_TEXT.testConnection}
                            </Button>,
                            <OverflowMenuButton
                              key="more"
                              color={colors.textSecondary}
                              items={[{ key: "delete", label: UI_TEXT.delete, danger: true }]}
                              onItemClick={(key) => {
                                if (key === "delete") {
                                  void deleteMcpServer(server.name);
                                }
                              }}
                            />,
                          ]}
                        >
                          <List.Item.Meta
                            avatar={<GlobalOutlined style={{ color: colors.textSecondary, fontSize: 18, marginTop: 4 }} />}
                            title={
                              <Space size={8} wrap>
                                <span style={{ color: colors.textPrimary, fontWeight: 600 }}>{server.name}</span>
                                <Tag color={statusMeta.color} icon={statusMeta.icon}>
                                  {statusMeta.label}
                                </Tag>
                                <Tag color="blue">{status?.toolCount ?? serverTools.length} {UI_TEXT.discoveredTools}</Tag>
                              </Space>
                            }
                            description={
                              <Space direction="vertical" size={8} style={{ width: "100%" }}>
                                <Paragraph style={{ color: colors.textSecondary, marginBottom: 0 }}>
                                  <Text style={{ color: colors.textMuted }}>{UI_TEXT.startupCommand}</Text>
                                  {server.command} {server.args.length > 0 ? JSON.stringify(server.args) : ""}
                                </Paragraph>
                                {status?.error ? (
                                  <Alert
                                    type={status.status === "empty" ? "warning" : "error"}
                                    showIcon
                                    message={status.error}
                                  />
                                ) : null}
                                {visibleToolNames.length > 0 ? (
                                  <div>
                                    <Text style={{ color: colors.textMuted, display: "block", marginBottom: 6 }}>{UI_TEXT.discoveredTools}</Text>
                                    <Space size={[6, 6]} wrap>
                                      {visibleToolNames.map((toolName) => (
                                        <Tag key={`${server.name}-${toolName}`} color="default">
                                          {summarizeToolName(toolName)}
                                        </Tag>
                                      ))}
                                    </Space>
                                  </div>
                                ) : (
                                  <Text style={{ color: colors.textMuted }}>{UI_TEXT.noToolsFound}</Text>
                                )}
                              </Space>
                            }
                          />
                        </List.Item>
                      );
                    }}
                  />
                </div>
              </>
            ),
          },
        ]}
      />

      <Modal
        title={UI_TEXT.addMcpService}
        open={mcpModalOpen}
        onOk={() => void saveMcpServer()}
        onCancel={() => {
          setMcpModalOpen(false);
          mcpForm.resetFields();
        }}
        okText={UI_TEXT.save}
        cancelText={UI_TEXT.cancel}
        confirmLoading={saving}
      >
        <Form
          form={mcpForm}
          layout="vertical"
          initialValues={{
            name: "",
            command: "",
            args: "[]",
          }}
        >
          <Form.Item name="name" label={UI_TEXT.serviceName} rules={[{ required: true, message: UI_TEXT.serviceNameRequired }]}>
            <Input placeholder="filesystem" />
          </Form.Item>
          <Form.Item name="command" label={UI_TEXT.startCommand} rules={[{ required: true, message: UI_TEXT.commandRequired }]}>
            <Input placeholder="npx" />
          </Form.Item>
          <Form.Item
            name="args"
            label={
              <Space size={6}>
                <span>{UI_TEXT.commandArgsJson}</span>
                <Tooltip title='["@modelcontextprotocol/server-filesystem", "D:/company/nexoAgent"]'>
                  <InfoCircleOutlined style={{ color: colors.textMuted }} />
                </Tooltip>
              </Space>
            }
            rules={[{ required: true, message: UI_TEXT.argsRequired }]}
          >
            <TextArea rows={4} placeholder='["@modelcontextprotocol/server-filesystem", "D:/company/nexoAgent"]' />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
