import { useEffect, useMemo, useState } from "react";
import {
  Alert,
  Button,
  Divider,
  Form,
  Input,
  List,
  Modal,
  Space,
  Tabs,
  Tag,
  Typography,
  message,
} from "antd";
import {
  GlobalOutlined,
  PlusOutlined,
  ThunderboltOutlined,
} from "@ant-design/icons";
import type { McpServerConfig } from "../../shared/types";
import { apiGet, apiPost } from "../../services/api";
import { useTheme } from "../../theme";
import { OverflowMenuButton } from "../Common/OverflowMenuButton";

const { Title, Text } = Typography;
const { TextArea } = Input;

interface ToolItem {
  name: string;
  label?: string;
  group: string;
  description: string;
  enabled: boolean;
}

export default function Tools() {
  const { colors } = useTheme();
  const [messageApi, messageContext] = message.useMessage();
  const [tools, setTools] = useState<ToolItem[]>([]);
  const [mcpServers, setMcpServers] = useState<McpServerConfig[]>([]);
  const [mcpModalOpen, setMcpModalOpen] = useState(false);
  const [mcpForm] = Form.useForm<{ name: string; command: string; args: string }>();

  const cardStyle: React.CSSProperties = useMemo(
    () => ({
      background: colors.bgSecondary,
      border: `1px solid ${colors.border}`,
      borderRadius: 8,
      padding: "0 16px",
    }),
    [colors]
  );

  const loadAll = async () => {
    const [toolData, mcpData] = await Promise.all([
      apiGet<ToolItem[]>("/api/tools"),
      apiGet<McpServerConfig[]>("/api/mcp-servers"),
    ]);
    setTools(toolData);
    setMcpServers(mcpData);
  };

  useEffect(() => {
    void loadAll();
  }, []);

  const toggleTool = async (name: string, enabled: boolean) => {
    await apiPost("/api/tools", { name, enabled });
    setTools((current) => current.map((tool) => (tool.name === name ? { ...tool, enabled } : tool)));
  };

  const saveMcpServer = async () => {
    const values = await mcpForm.validateFields();
    let args: string[];
    try {
      args = JSON.parse(values.args) as string[];
      if (!Array.isArray(args)) throw new Error("args must be array");
    } catch {
      void messageApi.error("参数必须是 JSON 数组");
      return;
    }

    const next = [...mcpServers, { name: values.name.trim(), command: values.command.trim(), args }];
    const saved = await apiPost<McpServerConfig[]>("/api/mcp-servers", next);
    setMcpServers(saved);
    mcpForm.resetFields();
    setMcpModalOpen(false);
    void messageApi.success("MCP 服务配置已保存");
  };

  const deleteMcpServer = async (name: string) => {
    const saved = await apiPost<McpServerConfig[]>(
      "/api/mcp-servers",
      mcpServers.filter((server) => server.name !== name)
    );
    setMcpServers(saved);
    void messageApi.success("MCP 服务配置已删除");
  };

  const toolGroups = Array.from(new Set(tools.map((tool) => tool.group)));

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
            label: "内置工具",
            children: (
              <div style={cardStyle}>
                {toolGroups.map((group, index) => (
                  <div key={group}>
                    {index > 0 && <Divider style={{ borderColor: colors.border, margin: 0 }} />}
                    <List
                      dataSource={tools.filter((tool) => tool.group === group)}
                      renderItem={(tool) => (
                        <List.Item
                          style={{ borderColor: colors.border }}
                          actions={[
                            <OverflowMenuButton
                              key="more"
                              color={colors.textSecondary}
                              items={[{ key: "toggle", label: tool.enabled ? "停用" : "启用" }]}
                              onItemClick={(key) => {
                                if (key === "toggle") {
                                  void toggleTool(tool.name, !tool.enabled);
                                }
                              }}
                            />,
                          ]}
                        >
                          <List.Item.Meta
                            avatar={
                              <ThunderboltOutlined style={{ color: colors.textSecondary, fontSize: 18, marginTop: 4 }} />
                            }
                            title={
                              <Space size={8} wrap>
                                <span style={{ color: colors.textPrimary, fontWeight: 500 }}>{tool.label || tool.name}</span>
                                <Text style={{ color: colors.textSecondary }}>{tool.name}</Text>
                                <Tag color="blue">{tool.group}</Tag>
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
            label: "MCP 工具服务",
            children: (
              <>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
                  <Alert
                    type="warning"
                    showIcon
                    message="当前先维护 MCP 服务配置，后续再接入真实的连接与发现流程。"
                    style={{ flex: 1, marginRight: 12 }}
                  />
                  <Button type="primary" icon={<PlusOutlined />} onClick={() => setMcpModalOpen(true)}>
                    新增服务
                  </Button>
                </div>
                <div style={cardStyle}>
                  <List
                    locale={{ emptyText: "还没有 MCP 服务配置" }}
                    dataSource={mcpServers}
                    renderItem={(server) => (
                      <List.Item
                        style={{ borderColor: colors.border }}
                        actions={[
                          <OverflowMenuButton
                            key="more"
                            color={colors.textSecondary}
                            items={[{ key: "delete", label: "删除", danger: true }]}
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
                          title={<span style={{ color: colors.textPrimary, fontWeight: 500 }}>{server.name}</span>}
                          description={<Text style={{ color: colors.textSecondary }}>{server.command} {JSON.stringify(server.args)}</Text>}
                        />
                      </List.Item>
                    )}
                  />
                </div>
              </>
            ),
          },
        ]}
      />

      <Modal
        title="新增 MCP 服务"
        open={mcpModalOpen}
        onOk={() => void saveMcpServer()}
        onCancel={() => {
          setMcpModalOpen(false);
          mcpForm.resetFields();
        }}
        okText="保存"
        cancelText="取消"
      >
        <Form form={mcpForm} layout="vertical">
          <Form.Item name="name" label="名称" rules={[{ required: true, message: "请输入名称" }]}>
            <Input />
          </Form.Item>
          <Form.Item name="command" label="命令" rules={[{ required: true, message: "请输入命令" }]}>
            <Input placeholder="npx" />
          </Form.Item>
          <Form.Item name="args" label="参数 JSON" rules={[{ required: true, message: "请输入参数 JSON" }]}>
            <TextArea rows={3} placeholder='["@modelcontextprotocol/server-filesystem", "/tmp"]' />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
