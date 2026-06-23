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
import { useI18n } from "../../i18n";

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

function summarizeToolName(name: string) {
  return name.replace(/^mcp__/, "");
}

function localizeGroup(group: string, lang: "zh" | "en") {
  const labels: Record<string, string> = lang === "zh"
    ? {
        system: "\u7cfb\u7edf",
        research: "\u7814\u7a76",
        productivity: "\u6548\u7387",
        extension: "\u6269\u5c55",
        mcp: "MCP",
      }
    : {
        system: "System",
        research: "Research",
        productivity: "Productivity",
        extension: "Extension",
        mcp: "MCP",
      };
  return labels[group] ?? group;
}

export default function Tools() {
  const { colors } = useTheme();
  const { lang, t } = useI18n();
  const [messageApi, messageContext] = message.useMessage();
  const [tools, setTools] = useState<ToolItem[]>([]);
  const [mcpServers, setMcpServers] = useState<McpServerListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [mcpModalOpen, setMcpModalOpen] = useState(false);
  const [testingState, setTestingState] = useState<TestingState>({});
  const [mcpForm] = Form.useForm<McpServerFormValues>();

  const ui = useMemo(() => ({
    subtitle: lang === "zh"
      ? "\u7edf\u4e00\u7ba1\u7406\u5185\u7f6e\u5de5\u5177\u548c MCP \u670d\u52a1\u3002"
      : "Manage built-in tools and MCP services in one place.",
    builtinTools: lang === "zh" ? "\u5185\u7f6e\u5de5\u5177" : "Built-in Tools",
    mcpServices: lang === "zh" ? "MCP \u670d\u52a1" : "MCP Services",
    configuredServices: lang === "zh" ? "\u5df2\u914d\u7f6e\u670d\u52a1" : "Configured Services",
    connected: lang === "zh" ? "\u8fde\u63a5\u6b63\u5e38" : "Connected",
    discoveredTools: lang === "zh" ? "\u5df2\u53d1\u73b0\u5de5\u5177" : "Discovered Tools",
    issues: lang === "zh" ? "\u5f02\u5e38" : "Issues",
    addService: lang === "zh" ? "\u65b0\u589e\u670d\u52a1" : "Add Service",
    noBuiltinTools: lang === "zh" ? "\u6682\u65e0\u5185\u7f6e\u5de5\u5177" : "No built-in tools found.",
    noServices: lang === "zh" ? "\u8fd8\u6ca1\u6709 MCP \u670d\u52a1\u914d\u7f6e" : "No MCP services configured yet.",
    testConnection: lang === "zh" ? "\u6d4b\u8bd5\u8fde\u63a5" : "Test Connection",
    startupCommand: lang === "zh" ? "\u542f\u52a8\u547d\u4ee4\uff1a" : "Startup command:",
    noToolsFound: lang === "zh" ? "\u6682\u672a\u53d1\u73b0\u5de5\u5177" : "No tools discovered yet.",
    addMcpService: lang === "zh" ? "\u65b0\u589e MCP \u670d\u52a1" : "Add MCP Service",
    serviceName: lang === "zh" ? "\u670d\u52a1\u540d\u79f0" : "Service Name",
    startCommand: lang === "zh" ? "\u542f\u52a8\u547d\u4ee4" : "Start Command",
    commandArgsJson: lang === "zh" ? "\u547d\u4ee4\u53c2\u6570 JSON" : "Command Args JSON",
    saveSuccess: lang === "zh" ? "MCP \u670d\u52a1\u914d\u7f6e\u5df2\u4fdd\u5b58" : "MCP service settings saved.",
    deleteSuccess: lang === "zh" ? "MCP \u670d\u52a1\u5df2\u5220\u9664" : "MCP service deleted.",
    testSuccess: (count: number) => lang === "zh"
      ? `\u8fde\u63a5\u6210\u529f\uff0c\u53d1\u73b0 ${count} \u4e2a\u5de5\u5177`
      : `Connection successful. Discovered ${count} tools.`,
    testEmpty: lang === "zh"
      ? "\u8fde\u63a5\u6210\u529f\uff0c\u4f46\u6ca1\u6709\u53d1\u73b0\u53ef\u7528\u5de5\u5177"
      : "Connection successful, but no tools were discovered.",
    testFailed: lang === "zh" ? "\u8fde\u63a5\u6d4b\u8bd5\u5931\u8d25" : "Connection test failed.",
    loadFailed: lang === "zh" ? "\u52a0\u8f7d\u5de5\u5177\u6570\u636e\u5931\u8d25" : "Failed to load tool data.",
    argsMustBeArray: lang === "zh" ? "\u53c2\u6570\u5fc5\u987b\u662f JSON \u6570\u7ec4" : "Args must be a JSON array.",
    infoMessage: lang === "zh"
      ? "MCP \u670d\u52a1\u5728\u4fdd\u5b58\u540e\u4f1a\u81ea\u52a8\u5237\u65b0\u3002\u4f60\u4e5f\u53ef\u4ee5\u5355\u72ec\u6d4b\u8bd5\u67d0\u4e2a\u670d\u52a1\uff0c\u7acb\u5373\u67e5\u770b\u9519\u8bef\u4fe1\u606f\u548c\u5de5\u5177\u53d1\u73b0\u7ed3\u679c\u3002"
      : "MCP services refresh automatically after saving. You can also test a single service to inspect connection errors and discovered tools right away.",
    serviceNameRequired: lang === "zh" ? "\u8bf7\u8f93\u5165\u670d\u52a1\u540d\u79f0" : "Please enter a service name.",
    commandRequired: lang === "zh" ? "\u8bf7\u8f93\u5165\u542f\u52a8\u547d\u4ee4" : "Please enter a start command.",
    argsRequired: lang === "zh" ? "\u8bf7\u8f93\u5165\u53c2\u6570 JSON" : "Please enter args JSON.",
    statusConnected: lang === "zh" ? "\u5df2\u8fde\u63a5" : "Connected",
    statusEmpty: lang === "zh" ? "\u5df2\u8fde\u63a5\uff0c\u4f46\u65e0\u5de5\u5177" : "Connected, no tools",
    statusError: lang === "zh" ? "\u8fde\u63a5\u5931\u8d25" : "Connection failed",
    toolsCount: (count: number) => lang === "zh" ? `${count} \u4e2a\u5de5\u5177` : `${count} tools`,
  }), [lang]);

  const cardStyle: CSSProperties = useMemo(
    () => ({
      background: colors.bgSecondary,
      border: `1px solid ${colors.border}`,
      borderRadius: 14,
      padding: "0 16px",
      overflow: "hidden",
      boxShadow: colors.bgPrimary === "#0e1726" ? "0 10px 30px rgba(0, 0, 0, 0.2)" : "0 10px 24px rgba(15, 23, 42, 0.06)",
    }),
    [colors],
  );

  const subtlePanelStyle: CSSProperties = useMemo(
    () => ({
      background: `linear-gradient(135deg, ${colors.bgSecondary} 0%, ${colors.bgTertiary} 100%)`,
      border: `1px solid ${colors.border}`,
      borderRadius: 16,
      padding: 16,
    }),
    [colors],
  );

  const parseArgsInput = (raw: string) => {
    const trimmed = raw.trim();
    if (!trimmed) return [];
    const parsed = JSON.parse(trimmed) as unknown;
    if (!Array.isArray(parsed)) {
      throw new Error(ui.argsMustBeArray);
    }
    return parsed.map((item) => String(item));
  };

  const getStatusMeta = (status?: McpServerStatus["status"]) => {
    switch (status) {
      case "connected":
        return {
          color: "green",
          label: ui.statusConnected,
          icon: <CheckCircleOutlined />,
        };
      case "empty":
        return {
          color: "gold",
          label: ui.statusEmpty,
          icon: <InfoCircleOutlined />,
        };
      case "error":
      default:
        return {
          color: "red",
          label: ui.statusError,
          icon: <CloseCircleOutlined />,
        };
    }
  };

  const loadAll = async () => {
    setLoading(true);
    try {
      const [toolData, mcpData] = await Promise.all([
        apiGet<ToolItem[]>("/api/tools"),
        apiGet<McpServerListItem[]>("/api/mcp-servers"),
      ]);
      setTools(toolData);
      setMcpServers(mcpData);
    } catch (error) {
      void messageApi.error(error instanceof Error ? error.message : ui.loadFailed);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadAll();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

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
      void messageApi.error(error instanceof Error ? error.message : ui.argsMustBeArray);
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
    void messageApi.success(ui.saveSuccess);
  };

  const deleteMcpServer = async (name: string) => {
    await persistServers(
      mcpServers
        .filter((server) => server.name !== name)
        .map((server) => ({ name: server.name, command: server.command, args: server.args })),
    );
    void messageApi.success(ui.deleteSuccess);
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
        current.map((item) => (item.name === server.name ? { ...item, runtimeStatus: result } : item)),
      );
      await loadAll();
      if (result.status === "connected") {
        void messageApi.success(ui.testSuccess(result.toolCount));
      } else if (result.status === "empty") {
        void messageApi.warning(ui.testEmpty);
      } else {
        void messageApi.error(result.error || ui.testFailed);
      }
    } catch (error) {
      void messageApi.error(error instanceof Error ? error.message : ui.testFailed);
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
      <div style={{ marginBottom: 18 }}>
        <Title level={4} style={{ color: colors.textPrimary, marginBottom: 6 }}>
          {t("tools")}
        </Title>
        <Text style={{ color: colors.textMuted }}>{ui.subtitle}</Text>
      </div>

      <Tabs
        items={[
          {
            key: "builtins",
            label: ui.builtinTools,
            children: loading ? (
              <div style={{ padding: 48, textAlign: "center" }}>
                <Spin />
              </div>
            ) : (
              <div style={cardStyle}>
                {builtinGroups.length === 0 ? (
                  <div style={{ padding: "18px 0" }}>
                    <Text style={{ color: colors.textMuted }}>{ui.noBuiltinTools}</Text>
                  </div>
                ) : (
                  builtinGroups.map((group, index) => (
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
                                items={[{ key: "toggle", label: tool.enabled ? t("disable") : t("enable") }]}
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
                              title={(
                                <Space size={8} wrap>
                                  <span style={{ color: colors.textPrimary, fontWeight: 600 }}>{tool.label || tool.name}</span>
                                  {tool.label && tool.label !== tool.name ? (
                                    <Text style={{ color: colors.textMuted }}>{tool.name}</Text>
                                  ) : null}
                                  <Tag color="blue">{localizeGroup(tool.group, lang)}</Tag>
                                  <Tag color={tool.enabled ? "green" : "default"}>{tool.enabled ? t("enabled") : t("disabled")}</Tag>
                                </Space>
                              )}
                              description={<Text style={{ color: colors.textSecondary }}>{tool.description}</Text>}
                            />
                          </List.Item>
                        )}
                      />
                    </div>
                  ))
                )}
              </div>
            ),
          },
          {
            key: "mcp",
            label: ui.mcpServices,
            children: (
              <>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12, marginBottom: 16 }}>
                  <div style={subtlePanelStyle}>
                    <Text style={{ color: colors.textMuted, display: "block", marginBottom: 8 }}>{ui.configuredServices}</Text>
                    <div style={{ fontSize: 28, fontWeight: 700, color: colors.textPrimary }}>{mcpServers.length}</div>
                  </div>
                  <div style={subtlePanelStyle}>
                    <Text style={{ color: colors.textMuted, display: "block", marginBottom: 8 }}>{ui.connected}</Text>
                    <div style={{ fontSize: 28, fontWeight: 700, color: "#22c55e" }}>{connectedCount}</div>
                  </div>
                  <div style={subtlePanelStyle}>
                    <Text style={{ color: colors.textMuted, display: "block", marginBottom: 8 }}>{ui.discoveredTools}</Text>
                    <div style={{ fontSize: 28, fontWeight: 700, color: colors.textPrimary }}>{mcpTools.length}</div>
                  </div>
                  <div style={subtlePanelStyle}>
                    <Text style={{ color: colors.textMuted, display: "block", marginBottom: 8 }}>{ui.issues}</Text>
                    <div style={{ fontSize: 28, fontWeight: 700, color: errorCount > 0 ? "#ef4444" : colors.textPrimary }}>{errorCount}</div>
                  </div>
                </div>

                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, marginBottom: 16 }}>
                  <Alert type="info" showIcon message={ui.infoMessage} style={{ flex: 1 }} />
                  <Space>
                    <Button icon={<SyncOutlined />} onClick={() => void loadAll()} loading={loading}>
                      {t("refresh")}
                    </Button>
                    <Button type="primary" icon={<PlusOutlined />} onClick={() => setMcpModalOpen(true)}>
                      {ui.addService}
                    </Button>
                  </Space>
                </div>

                <div style={cardStyle}>
                  <List
                    locale={{ emptyText: ui.noServices }}
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
                              {ui.testConnection}
                            </Button>,
                            <OverflowMenuButton
                              key="more"
                              color={colors.textSecondary}
                              items={[{ key: "delete", label: t("delete"), danger: true }]}
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
                            title={(
                              <Space size={8} wrap>
                                <span style={{ color: colors.textPrimary, fontWeight: 600 }}>{server.name}</span>
                                <Tag color={statusMeta.color} icon={statusMeta.icon}>
                                  {statusMeta.label}
                                </Tag>
                                <Tag color="blue">{ui.toolsCount(status?.toolCount ?? serverTools.length)}</Tag>
                              </Space>
                            )}
                            description={(
                              <Space direction="vertical" size={8} style={{ width: "100%" }}>
                                <Paragraph style={{ color: colors.textSecondary, marginBottom: 0 }}>
                                  <Text style={{ color: colors.textMuted }}>{ui.startupCommand}</Text>{" "}
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
                                    <Text style={{ color: colors.textMuted, display: "block", marginBottom: 6 }}>{ui.discoveredTools}</Text>
                                    <Space size={[6, 6]} wrap>
                                      {visibleToolNames.map((toolName) => (
                                        <Tag key={`${server.name}-${toolName}`} color="default">
                                          {summarizeToolName(toolName)}
                                        </Tag>
                                      ))}
                                    </Space>
                                  </div>
                                ) : (
                                  <Text style={{ color: colors.textMuted }}>{ui.noToolsFound}</Text>
                                )}
                              </Space>
                            )}
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
        title={ui.addMcpService}
        open={mcpModalOpen}
        onOk={() => void saveMcpServer()}
        onCancel={() => {
          setMcpModalOpen(false);
          mcpForm.resetFields();
        }}
        okText={t("save")}
        cancelText={t("cancel")}
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
          <Form.Item name="name" label={ui.serviceName} rules={[{ required: true, message: ui.serviceNameRequired }]}>
            <Input placeholder="filesystem" />
          </Form.Item>
          <Form.Item name="command" label={ui.startCommand} rules={[{ required: true, message: ui.commandRequired }]}>
            <Input placeholder="npx" />
          </Form.Item>
          <Form.Item
            name="args"
            label={(
              <Space size={6}>
                <span>{ui.commandArgsJson}</span>
                <Tooltip title='["@modelcontextprotocol/server-filesystem", "D:/company/nexoAgent"]'>
                  <InfoCircleOutlined style={{ color: colors.textMuted }} />
                </Tooltip>
              </Space>
            )}
            rules={[{ required: true, message: ui.argsRequired }]}
          >
            <TextArea rows={4} placeholder='["@modelcontextprotocol/server-filesystem", "D:/company/nexoAgent"]' />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
