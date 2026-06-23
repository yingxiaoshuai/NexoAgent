import React, { useEffect, useState } from "react";
import { Alert, Button, Checkbox, Divider, Form, Input, InputNumber, List, Modal, Select, Space, Switch, Tag, Typography, message } from "antd";
import { PlusOutlined, ReloadOutlined } from "@ant-design/icons";
import { useChatStore } from "../../store/chat";
import type { AgentSettings, DiscoveredModel, ModelCapability, ModelProfile, ProviderId } from "../../shared/types";
import { useTheme } from "../../theme";
import { apiDelete, apiGet, apiPost } from "../../services/api";
import { sanitizeApiKeyForSave, SAVED_API_KEY_MASK } from "../../shared/settings";
import { OverflowMenuButton } from "../Common/OverflowMenuButton";
import {
  getDefaultServiceProviderName,
  getProviderDefaultApiBase,
  getProviderName,
  getServiceProviderDefaultApiBase,
  getServiceProviderOptions,
  normalizeProviderId,
  normalizeServiceProviderName,
  PROVIDER_OPTIONS,
} from "../../shared/providers";

const { Text } = Typography;

const CAPABILITY_LABELS: Record<ModelCapability, string> = {
  orchestration: "主控",
  chat: "对话",
  vision: "图像识别",
  image_generation: "图像生成",
  image_editing: "P图",
  speech_to_text: "语音识别",
  text_to_speech: "语音合成",
  embedding: "Embedding",
};

const CAPABILITY_COLORS: Record<ModelCapability, string> = {
  orchestration: "blue",
  chat: "green",
  vision: "cyan",
  image_generation: "purple",
  image_editing: "magenta",
  speech_to_text: "orange",
  text_to_speech: "gold",
  embedding: "geekblue",
};

const MODEL_CAPABILITIES: ModelCapability[] = ["orchestration", "chat", "vision", "image_generation", "image_editing", "speech_to_text", "text_to_speech", "embedding"];

const capabilityOptions = MODEL_CAPABILITIES.map((value) => ({ value, label: CAPABILITY_LABELS[value] }));
const tokenCountFormatter = new Intl.NumberFormat("en-US");

function formatTokenCount(value?: number) {
  return typeof value === "number" && Number.isFinite(value) ? tokenCountFormatter.format(value) : "-";
}

function getContextSourceMeta(profile: Pick<ModelProfile, "contextWindowSource" | "contextWindowSourceDetail">) {
  const source = profile.contextWindowSource;
  const detail = (profile.contextWindowSourceDetail || "").toLowerCase();

  if (source === "user" || source === "profile") return { label: "manual", color: "gold" };
  if (source === "provider") return { label: "provider", color: "blue" };
  if (source === "lookup") return { label: "lookup", color: "purple" };
  if (source === "cache") return { label: "cache", color: "cyan" };
  if (source === "dictionary" && detail.startsWith("model-name token hint")) return { label: "hint", color: "orange" };
  if (source === "dictionary") return { label: "dictionary", color: "green" };
  return { label: source || "default", color: "default" };
}

function getServiceProviderLabel(profile: Pick<ModelProfile, "providerName" | "apiBase" | "providerId">) {
  return normalizeServiceProviderName(profile.providerName, profile.apiBase, profile.providerId) || "unknown";
}

const ApiKeyField: React.FC<{
  value?: string;
  onChange?: (value: string) => void;
  hasApiKey: boolean;
  inputStyle: React.CSSProperties;
  mutedColor: string;
}> = ({ value, onChange, hasApiKey, inputStyle, mutedColor }) => {
  const [editing, setEditing] = useState(!hasApiKey);
  const masked = hasApiKey && !editing;
  const displayValue = masked ? SAVED_API_KEY_MASK : (value ?? "");

  return (
    <div>
      <Input
        style={inputStyle}
        value={displayValue}
        readOnly={masked}
        placeholder={masked ? undefined : "sk-..."}
        onChange={(e) => onChange?.(e.target.value)}
      />
      {masked && (
        <Button
          type="link"
          size="small"
          style={{ padding: 0, height: "auto", marginTop: 4, color: mutedColor }}
          onClick={() => {
            setEditing(true);
            onChange?.("");
          }}
        >
          更换密钥
        </Button>
      )}
    </div>
  );
};

export const Settings: React.FC = () => {
  const { settings, loadSettings, saveSettings } = useChatStore();
  const { colors } = useTheme();
  const [form] = Form.useForm<AgentSettings>();
  const [messageApi, ctx] = message.useMessage();
  const [formKey, setFormKey] = useState(0);
  const [profiles, setProfiles] = useState<ModelProfile[]>([]);
  const [profileModalOpen, setProfileModalOpen] = useState(false);
  const [editingProfile, setEditingProfile] = useState<ModelProfile | null>(null);
  const [profileForm] = Form.useForm<ModelProfile>();
  const [discovering, setDiscovering] = useState(false);
  const [discoveredModels, setDiscoveredModels] = useState<DiscoveredModel[]>([]);
  const [refreshingContextProfileId, setRefreshingContextProfileId] = useState("");
  const watchedProviderId = Form.useWatch("providerId", profileForm) as ProviderId | undefined;
  const watchedProviderName = Form.useWatch("providerName", profileForm) as string | undefined;
  const watchedApiBase = Form.useWatch("apiBase", profileForm) as string | undefined;
  const watchedApiKey = Form.useWatch("apiKey", profileForm) as string | undefined;
  const normalizedWatchedProviderId = normalizeProviderId(watchedProviderId);
  const serviceProviderOptions = (() => {
    const baseOptions = getServiceProviderOptions(normalizedWatchedProviderId);
    const currentName = normalizeServiceProviderName(watchedProviderName, String(watchedApiBase ?? ""), normalizedWatchedProviderId);
    if (!currentName || baseOptions.some((option) => option.value === currentName)) {
      return baseOptions;
    }
    return [{ value: currentName, label: currentName }, ...baseOptions];
  })();

  useEffect(() => {
    void loadSettings();
  }, [loadSettings]);

  useEffect(() => {
    form.setFieldsValue({
      ...settings,
      fileAccessRoots: settings.fileAccessRoots ?? [],
    });
  }, [settings, form]);

  const loadProfiles = async () => {
    const data = await apiGet<ModelProfile[]>("/api/model-profiles");
    setProfiles(data);
  };

  useEffect(() => {
    void loadProfiles();
  }, []);

  const inputStyle: React.CSSProperties = {
    background: colors.bgTertiary,
    color: colors.textPrimary,
    border: `1px solid ${colors.borderStrong}`,
    borderRadius: 8,
  };

  const label = (text: string) => <span style={{ color: colors.textMuted }}>{text}</span>;

  const onSave = async (values: AgentSettings) => {
    await saveSettings(sanitizeApiKeyForSave({ ...settings, ...values }));
    setFormKey((k) => k + 1);
    void messageApi.success("设置已保存，下一条消息立即生效");
  };

  const openCreateProfile = () => {
    const providerId = normalizeProviderId(settings.providerId);
    const apiBase = settings.apiBase?.trim() || getProviderDefaultApiBase(providerId);
    setEditingProfile(null);
    profileForm.resetFields();
    profileForm.setFieldsValue({
      providerId,
      providerName: normalizeServiceProviderName(getDefaultServiceProviderName(providerId), apiBase, providerId),
      apiBase,
      apiKey: "",
      name: "",
      model: "",
      capabilities: ["chat"],
      enabled: true,
      isPrimary: false,
      temperature: settings.temperature ?? 0,
      description: "",
    } as Partial<ModelProfile>);
    setDiscoveredModels([]);
    setProfileModalOpen(true);
  };

  const openEditProfile = (profile: ModelProfile) => {
    setEditingProfile(profile);
    profileForm.setFieldsValue({
      ...profile,
      providerId: normalizeProviderId(profile.providerId),
      providerName: normalizeServiceProviderName(profile.providerName, profile.apiBase, profile.providerId),
      apiKey: "",
      capabilities: profile.capabilities?.length ? profile.capabilities : ["chat"],
    });
    setDiscoveredModels([]);
    setProfileModalOpen(true);
  };

  const discoverProfileModels = async () => {
    const values = await profileForm.validateFields(["providerId", "apiBase"]);
    const apiKeyValue = String(profileForm.getFieldValue("apiKey") ?? "");
    setDiscovering(true);
    try {
      const models = await apiPost<DiscoveredModel[]>("/api/model-profiles/discover", {
        providerId: values.providerId,
        apiBase: String(values.apiBase ?? ""),
        apiKey: apiKeyValue === SAVED_API_KEY_MASK ? "" : apiKeyValue,
        profileId: editingProfile?.id,
      });
      setDiscoveredModels(models);
      void messageApi.success(`发现 ${models.length} 个模型`);
      if (models.length > 0 && !profileForm.getFieldValue("model")) {
        const first = models[0];
        profileForm.setFieldsValue({
          model: first.id,
          providerName: normalizeServiceProviderName(
            profileForm.getFieldValue("providerName") || first.ownedBy || "",
            String(values.apiBase ?? ""),
            values.providerId
          ),
          capabilities: first.capabilities.length ? first.capabilities : ["chat"],
          name: profileForm.getFieldValue("name") || first.label,
          description: profileForm.getFieldValue("description") || (first.ownedBy ? `Discovered from ${first.ownedBy}` : "Discovered from provider"),
        });
      }
    } catch (error) {
      void messageApi.error(error instanceof Error ? error.message : "获取模型失败");
    } finally {
      setDiscovering(false);
    }
  };

  const saveProfile = async () => {
    const values = await profileForm.validateFields();
    const saved = await apiPost<ModelProfile>("/api/model-profiles", {
      ...editingProfile,
      ...values,
      providerName: normalizeServiceProviderName(values.providerName, String(values.apiBase ?? ""), values.providerId),
      apiBase: String(values.apiBase ?? "").trim(),
      apiKey: values.apiKey === SAVED_API_KEY_MASK ? "" : values.apiKey,
      providerId: normalizeProviderId(values.providerId),
    });

    setProfiles((current) => {
      const normalized = current.map((profile) => (
        saved.isPrimary && profile.id !== saved.id ? { ...profile, isPrimary: false } : profile
      ));
      const exists = normalized.some((profile) => profile.id === saved.id);
      return exists ? normalized.map((profile) => (profile.id === saved.id ? saved : profile)) : [...normalized, saved];
    });
    setProfileModalOpen(false);
    setEditingProfile(null);
    profileForm.resetFields();
    void messageApi.success("模型配置已保存");
  };

  const deleteProfile = async (id: string) => {
    await apiDelete(`/api/model-profiles/${id}`);
    setProfiles((current) => current.filter((profile) => profile.id !== id));
    void messageApi.success("模型配置已删除");
  };

  const confirmDeleteProfile = (profile: ModelProfile) => {
    Modal.confirm({
      title: `删除模型“${profile.name}”？`,
      okText: "删除",
      cancelText: "取消",
      okButtonProps: { danger: true },
      onOk: async () => {
        await deleteProfile(profile.id);
      },
    });
  };

  const setPrimaryProfile = async (profile: ModelProfile, isPrimary: boolean) => {
    const nextCapabilities = isPrimary && !profile.capabilities?.includes("orchestration")
      ? [...(profile.capabilities ?? []), "orchestration" as ModelCapability]
      : profile.capabilities;
    const saved = await apiPost<ModelProfile>("/api/model-profiles", {
      ...profile,
      isPrimary,
      capabilities: nextCapabilities,
      apiKey: "",
    });
    setProfiles((current) => current.map((item) => {
      if (saved.isPrimary && item.id !== saved.id) return { ...item, isPrimary: false };
      return item.id === saved.id ? saved : item;
    }));
  };

  const toggleProfileEnabled = async (profile: ModelProfile, enabled: boolean) => {
    const saved = await apiPost<ModelProfile>("/api/model-profiles", {
      ...profile,
      enabled,
      apiKey: "",
    });
    setProfiles((current) => current.map((item) => (item.id === saved.id ? saved : item)));
  };

  const refreshProfileContext = async (profile: ModelProfile) => {
    if (profile.contextWindowSource === "user" || profile.contextWindowSource === "profile") {
      void messageApi.info("This profile is using a manual context budget. Clear the manual override before re-detecting.");
      return;
    }

    setRefreshingContextProfileId(profile.id);
    try {
      const saved = await apiPost<ModelProfile>(`/api/model-profiles/${profile.id}/refresh-context`, {});
      setProfiles((current) => current.map((item) => (item.id === saved.id ? saved : item)));
      void messageApi.success(`Context budget refreshed from ${getContextSourceMeta(saved).label}.`);
    } catch (error) {
      void messageApi.error(error instanceof Error ? error.message : "Context refresh failed.");
    } finally {
      setRefreshingContextProfileId("");
    }
  };

  const modelOptions = discoveredModels.map((model) => ({
    value: model.id,
    label: model.ownedBy ? `${model.label} · ${model.ownedBy}` : model.label,
  }));

  useEffect(() => {
    if (!profileModalOpen || !watchedProviderId) return;
    const apiKeyValue = String(watchedApiKey ?? "");
    const hasTypedKey = Boolean(apiKeyValue.trim()) && apiKeyValue !== SAVED_API_KEY_MASK;
    const hasSavedKey = Boolean(editingProfile?.hasApiKey);
    if (!hasTypedKey && !hasSavedKey) return;
    const timer = window.setTimeout(() => {
      void discoverProfileModels();
    }, 300);
    return () => window.clearTimeout(timer);
  }, [profileModalOpen, watchedProviderId, watchedApiBase, watchedApiKey, editingProfile?.id, editingProfile?.hasApiKey]);

  return (
    <div style={{ padding: "28px 32px", maxWidth: 1040, color: colors.textPrimary }}>
      {ctx}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <div>
          <div style={{ fontSize: 18, fontWeight: 600 }}>设置</div>
          <div style={{ color: colors.textMuted, fontSize: 12, marginTop: 4 }}>模型、记忆和高级参数统一在这里管理</div>
        </div>
        <Button type="primary" icon={<PlusOutlined />} onClick={openCreateProfile}>
          新建模型
        </Button>
      </div>

      <Alert
        type="info"
        showIcon
        message="只保留一个模型配置入口：新建模型。协议仅支持 OpenAI 兼容和 Anthropic 兼容，模型发现会自动读取协议对应的默认接口与已保存密钥。"
        style={{ marginBottom: 16 }}
      />

      <Form
        key={formKey}
        form={form}
        layout="vertical"
        onFinish={(v) => void onSave(v as AgentSettings)}
        initialValues={{ ...settings, fileAccessRoots: settings.fileAccessRoots ?? [] }}
      >
        <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 16 }}>
          <div>
            <Form.Item label={label("工作区路径")} name="workspacePath" tooltip="file_read / file_write 的默认根目录，留空则使用当前项目目录">
              <Input style={inputStyle} placeholder="D:\company" />
            </Form.Item>
            <Form.Item label={label("额外文件访问目录")} name="fileAccessRoots" tooltip="允许 Agent 读写的其他绝对路径，例如 D:\company\ceshi">
              <Select mode="tags" open={false} style={{ width: "100%" }} placeholder="D:\company\ceshi" tokenSeparators={[","]} />
            </Form.Item>
            <Form.Item label={label("启用记忆")} name="enableMemory" valuePropName="checked">
              <Switch />
            </Form.Item>
            <Form.Item label={label("启用知识库")} name="enableKnowledge" valuePropName="checked">
              <Switch />
            </Form.Item>
          </div>
          <div>
            <Form.Item label={label("Temperature")} name="temperature">
              <InputNumber min={0} max={2} step={0.1} style={{ width: "100%" }} />
            </Form.Item>
            <Form.Item label={label("上下文自动压缩")} name="enableContextCompaction" valuePropName="checked">
              <Switch />
            </Form.Item>
            <Form.Item label={label("默认脚本超时（秒）")} name="shellCommandTimeoutMs" getValueProps={(value) => ({ value: Math.round((value ?? 300_000) / 1000) })} normalize={(seconds) => Math.max(5, Math.min(600, Number(seconds) || 300)) * 1000}>
              <InputNumber min={5} max={600} style={{ width: "100%" }} />
            </Form.Item>
            <Form.Item label={label("规划模式")} name="planningMode">
              <Select style={{ width: "100%" }} options={[
                { value: "fast", label: "快速（Fast）" },
                { value: "balanced", label: "平衡（Balanced）" },
                { value: "deep", label: "深度（Deep）" },
              ]} />
            </Form.Item>
          </div>
        </div>

        <Divider style={{ borderColor: colors.border, margin: "16px 0" }} />
        <Button htmlType="submit" type="primary" style={{ background: colors.accent, border: "none", borderRadius: 8 }}>
          保存设置
        </Button>
      </Form>

      <Divider style={{ borderColor: colors.border, margin: "24px 0" }} />

      <div style={{ fontSize: 14, color: colors.textMuted, marginBottom: 12 }}>模型列表</div>
      <List
        locale={{ emptyText: "还没有模型配置" }}
        dataSource={profiles}
        renderItem={(profile) => (
          <List.Item
            style={{ borderColor: colors.border }}
            actions={[
              <OverflowMenuButton
                key="more"
                color={colors.textSecondary}
                items={[
                  {
                    key: "primary",
                    label: profile.isPrimary ? "取消主模型" : "设为主模型",
                    disabled: !profile.enabled && !profile.isPrimary,
                  },
                  { key: "toggle", label: profile.enabled ? "停用" : "启用" },
                  {
                    key: "refresh-context",
                    label: refreshingContextProfileId === profile.id ? "重探测中..." : "重探测",
                    disabled: refreshingContextProfileId === profile.id || profile.contextWindowSource === "user" || profile.contextWindowSource === "profile",
                  },
                  { key: "edit", label: "编辑" },
                  { key: "delete", label: "删除", danger: true },
                ]}
                onItemClick={(key) => {
                  if (key === "primary") {
                    void setPrimaryProfile(profile, !profile.isPrimary);
                    return;
                  }
                  if (key === "toggle") {
                    void toggleProfileEnabled(profile, !profile.enabled);
                    return;
                  }
                  if (key === "refresh-context") {
                    void refreshProfileContext(profile);
                    return;
                  }
                  if (key === "edit") {
                    openEditProfile(profile);
                    return;
                  }
                  if (key === "delete") {
                    confirmDeleteProfile(profile);
                  }
                }}
              />,
            ]}
          >
            <List.Item.Meta
              title={
                <Space size={8} wrap>
                  <span style={{ color: colors.textPrimary, fontWeight: 500 }}>{profile.name}</span>
                  {profile.isPrimary && <Tag color="blue">主控</Tag>}
                  <Tag color={profile.enabled ? "green" : "default"}>{profile.enabled ? "启用" : "停用"}</Tag>
                  <Tag color="cyan">{getServiceProviderLabel(profile)}</Tag>
                  <Tag>{getProviderName(profile.providerId)}</Tag>
                  {profile.hasApiKey && <Tag color="gold">已保存密钥</Tag>}
                  <Tag color={getContextSourceMeta(profile).color}>{getContextSourceMeta(profile).label}</Tag>
                </Space>
              }
              description={
                <Space direction="vertical" size={4}>
                  <Text style={{ color: colors.textSecondary }}>{profile.model}</Text>
                  <Space wrap size={4}>
                    {(profile.capabilities ?? []).map((capability) => (
                      <Tag key={capability} color={CAPABILITY_COLORS[capability]}>
                        {CAPABILITY_LABELS[capability]}
                      </Tag>
                    ))}
                  </Space>
                  <Text style={{ color: colors.textSecondary }}>{profile.apiBase}</Text>
                  <Space wrap size={8}>
                    <Text style={{ color: colors.textSecondary }}>window {formatTokenCount(profile.contextWindowTokens)}</Text>
                    <Text style={{ color: colors.textSecondary }}>reserve {formatTokenCount(profile.reservedOutputTokens)}</Text>
                    <Text style={{ color: colors.textSecondary }}>compact {formatTokenCount(profile.autoCompactTokenLimit)}</Text>
                  </Space>
                  {profile.contextWindowSourceDetail && (
                    <Text style={{ color: colors.textMuted, fontSize: 12 }}>{profile.contextWindowSourceDetail}</Text>
                  )}
                  {profile.description && <Text style={{ color: colors.textSecondary }}>{profile.description}</Text>}
                </Space>
              }
            />
          </List.Item>
        )}
      />

      <Modal
        title={editingProfile ? "编辑模型" : "新建模型"}
        open={profileModalOpen}
        onOk={() => void saveProfile()}
        onCancel={() => {
          setProfileModalOpen(false);
          setEditingProfile(null);
          profileForm.resetFields();
        }}
        okText="保存"
        cancelText="取消"
        width={720}
      >
        <Form form={profileForm} layout="vertical">
          <Form.Item name="name" label="名称" rules={[{ required: true, message: "请输入名称" }]}>
            <Input />
          </Form.Item>
          <Form.Item name="providerId" label="协议" rules={[{ required: true, message: "请选择协议" }]}>
            <Select
              options={PROVIDER_OPTIONS}
              onChange={(nextProviderId) => {
                const previousProviderId = normalizeProviderId(profileForm.getFieldValue("providerId"));
                const currentProviderName = String(profileForm.getFieldValue("providerName") ?? "").trim();
                const currentApiBase = String(profileForm.getFieldValue("apiBase") ?? "").trim();
                const previousDefaultApiBase = getProviderDefaultApiBase(previousProviderId);
                const nextDefaultApiBase = getProviderDefaultApiBase(nextProviderId);
                const previousServiceDefault = getServiceProviderDefaultApiBase(currentProviderName, previousProviderId);
                const nextProviderName = !currentProviderName
                  || currentProviderName === normalizeServiceProviderName(currentProviderName, currentApiBase, previousProviderId)
                  || (previousServiceDefault && currentApiBase === previousServiceDefault)
                  ? normalizeServiceProviderName(getDefaultServiceProviderName(nextProviderId), nextDefaultApiBase, nextProviderId)
                  : currentProviderName;
                profileForm.setFieldsValue({
                  providerName: nextProviderName,
                  model: "",
                  capabilities: ["chat"],
                  apiBase: !currentApiBase || currentApiBase === previousDefaultApiBase ? nextDefaultApiBase : currentApiBase,
                });
                setDiscoveredModels([]);
              }}
            />
          </Form.Item>
                   <Form.Item
            name="providerName"
            label={"API \u670d\u52a1\u63d0\u4f9b\u5546"}
            extra={"\u7528\u4e8e\u533a\u5206\u540c\u534f\u8bae\u4e0b\u7684\u4e0d\u540c\u670d\u52a1\u5546\uff0c\u4f8b\u5982 DeepSeek\u3001OpenRouter\u3001\u5c0f\u7c73 Mimo\u3002"}
          >
            <Select
              showSearch
              options={serviceProviderOptions}
              placeholder={"\u8bf7\u9009\u62e9 API \u670d\u52a1\u63d0\u4f9b\u5546"}
              onChange={(nextProviderName) => {
                const defaultApiBase = getServiceProviderDefaultApiBase(nextProviderName, normalizedWatchedProviderId);
                if (!defaultApiBase) return;
                profileForm.setFieldsValue({
                  providerName: normalizeServiceProviderName(nextProviderName, defaultApiBase, normalizedWatchedProviderId),
                  apiBase: defaultApiBase,
                  model: "",
                });
                setDiscoveredModels([]);
              }}
            />
          </Form.Item>
          <Form.Item name="apiBase" label="API Base">
            <Input
              placeholder={getServiceProviderDefaultApiBase(watchedProviderName, normalizedWatchedProviderId) || (watchedProviderId ? getProviderDefaultApiBase(watchedProviderId) : "https://api.example.com/v1")}
              onBlur={(event) => {
                const currentProviderName = String(profileForm.getFieldValue("providerName") ?? "").trim();
                if (!currentProviderName || currentProviderName === "???") {
                  profileForm.setFieldsValue({
                    providerName: normalizeServiceProviderName(currentProviderName, event.target.value, normalizedWatchedProviderId),
                  });
                }
              }}
            />
          </Form.Item>
          <Form.Item name="apiKey" label={editingProfile?.hasApiKey ? "API Key（留空则保留原值）" : "API Key"}>
            <ApiKeyField hasApiKey={Boolean(editingProfile?.hasApiKey)} inputStyle={inputStyle} mutedColor={colors.textMuted} />
          </Form.Item>
          <Form.Item
            name="model"
            label={
              <Space style={{ width: "100%", justifyContent: "space-between" }}>
                <span>模型</span>
                <Button type="link" icon={<ReloadOutlined />} loading={discovering} onClick={() => void discoverProfileModels()}>
                  重新获取
                </Button>
              </Space>
            }
            rules={[{ required: true, message: "请选择模型" }]}
          >
            <Select
              options={modelOptions}
              showSearch
              placeholder={discovering ? "正在获取模型..." : "请选择模型"}
              onSelect={(value) => {
                const model = discoveredModels.find((item) => item.id === value);
                if (!model) return;
                profileForm.setFieldsValue({
                  model: model.id,
                  name: profileForm.getFieldValue("name") || model.label,
                  capabilities: model.capabilities.length ? model.capabilities : ["chat"],
                  description: profileForm.getFieldValue("description") || (model.ownedBy ? `Discovered from ${model.ownedBy}` : "Discovered from provider"),
                });
              }}
            />
          </Form.Item>
          <Form.Item name="capabilities" label="能力" rules={[{ required: true, message: "请选择至少一个能力" }]}>
            <Checkbox.Group options={capabilityOptions} style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 8 }} />
          </Form.Item>
          <Form.Item name="isPrimary" label="主控模型" valuePropName="checked">
            <Switch />
          </Form.Item>
          <Form.Item name="temperature" label="Temperature">
            <InputNumber min={0} max={2} step={0.1} style={{ width: "100%" }} />
          </Form.Item>
          <Form.Item name="description" label="说明">
            <Input.TextArea rows={3} />
          </Form.Item>
          <Form.Item name="enabled" label="启用" valuePropName="checked">
            <Switch />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
};
