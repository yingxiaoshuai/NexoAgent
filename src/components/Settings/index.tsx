import React, { useEffect, useMemo, useState } from "react";
import {
  AutoComplete,
  Button,
  Checkbox,
  Divider,
  Form,
  Input,
  InputNumber,
  List,
  Modal,
  Select,
  Space,
  Switch,
  Tag,
  Typography,
  message,
} from "antd";
import { PlusOutlined, ReloadOutlined } from "@ant-design/icons";
import { useChatStore } from "../../store/chat";
import {
  MODEL_CAPABILITIES,
  type AgentSettings,
  type DiscoveredModel,
  type ModelCapability,
  type ModelProfile,
  type ProviderId,
  type ThinkingEffort,
} from "../../shared/types";
import { useTheme } from "../../theme";
import { apiDelete, apiGet, apiPost } from "../../services/api";
import { sanitizeApiKeyForSave, SAVED_API_KEY_MASK } from "../../shared/settings";
import { OverflowMenuButton } from "../Common/OverflowMenuButton";
import { useI18n } from "../../i18n";
import {
  getDefaultServiceProviderName,
  providerConnectionAllowsEmptyApiKey,
  getProviderDefaultApiBase,
  getProviderOptions,
  getProviderProtocolName,
  getServiceProviderDefaultApiBase,
  getServiceProviderDisplayName,
  getServiceProviderOptions,
  normalizeProviderId,
  normalizeServiceProviderName,
} from "../../shared/providers";

const { Text, Paragraph, Title } = Typography;

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

const tokenCountFormatter = new Intl.NumberFormat("en-US");

function formatTokenCount(value?: number) {
  return typeof value === "number" && Number.isFinite(value) ? tokenCountFormatter.format(value) : "-";
}

function buildCapabilityLabels(lang: "zh" | "en"): Record<ModelCapability, string> {
  if (lang === "zh") {
    return {
      orchestration: "\u4e3b\u63a7",
      chat: "\u5bf9\u8bdd",
      vision: "\u89c6\u89c9",
      image_generation: "\u56fe\u50cf\u751f\u6210",
      image_editing: "\u56fe\u50cf\u7f16\u8f91",
      speech_to_text: "\u8bed\u97f3\u8bc6\u522b",
      text_to_speech: "\u8bed\u97f3\u5408\u6210",
      embedding: "Embedding",
    };
  }

  return {
    orchestration: "Orchestration",
    chat: "Chat",
    vision: "Vision",
    image_generation: "Image Generation",
    image_editing: "Image Editing",
    speech_to_text: "Speech to Text",
    text_to_speech: "Text to Speech",
    embedding: "Embedding",
  };
}

function buildUi(lang: "zh" | "en") {
  return {
    pageTitle: lang === "zh" ? "\u8bbe\u7f6e" : "Settings",
    pageSubtitle: lang === "zh"
      ? "\u5728\u8fd9\u91cc\u7edf\u4e00\u7ba1\u7406\u5de5\u4f5c\u533a\u3001\u8bb0\u5fc6\u80fd\u529b\u548c\u6a21\u578b\u914d\u7f6e\u3002"
      : "Manage workspace behavior, memory features, and model profiles from one place.",
    createModel: lang === "zh" ? "\u65b0\u5efa\u6a21\u578b" : "New Model",
    generalSection: lang === "zh" ? "\u901a\u7528\u8bbe\u7f6e" : "General Settings",
    modelSection: lang === "zh" ? "\u6a21\u578b\u5217\u8868" : "Model Profiles",
    workspacePath: lang === "zh" ? "\u5de5\u4f5c\u533a\u8def\u5f84" : "Workspace Path",
    workspacePathTip: lang === "zh"
      ? "Agent \u9ed8\u8ba4\u4f7f\u7528\u7684\u5de5\u4f5c\u76ee\u5f55\u6839\u8def\u5f84\uff0c\u7559\u7a7a\u5219\u4f7f\u7528\u5f53\u524d\u9879\u76ee\u76ee\u5f55\u3002"
      : "Default workspace root for the agent. Leave empty to use the current project directory.",
    fileAccessRoots: lang === "zh" ? "\u989d\u5916\u6587\u4ef6\u8bbf\u95ee\u76ee\u5f55" : "Extra File Access Roots",
    fileAccessRootsTip: lang === "zh"
      ? "\u5141\u8bb8 Agent \u8bfb\u5199\u7684\u5176\u4ed6\u7edd\u5bf9\u8def\u5f84\uff0c\u4f8b\u5982 D:\\company\\shared\u3002"
      : "Additional absolute directories the agent can read and write, for example D:\\company\\shared.",
    enableMemory: lang === "zh" ? "\u542f\u7528\u8bb0\u5fc6" : "Enable Memory",
    enableKnowledge: lang === "zh" ? "\u542f\u7528\u77e5\u8bc6\u5e93" : "Enable Knowledge Base",
    temperature: "Temperature",
    enableContextCompaction: lang === "zh" ? "\u542f\u7528\u4e0a\u4e0b\u6587\u81ea\u52a8\u538b\u7f29" : "Enable Context Auto-compaction",
    shellTimeout: lang === "zh" ? "\u9ed8\u8ba4\u811a\u672c\u8d85\u65f6\uff08\u79d2\uff09" : "Default Shell Timeout (s)",
    planningMode: lang === "zh" ? "\u89c4\u5212\u6a21\u5f0f" : "Planning Mode",
    planningFast: lang === "zh" ? "\u5feb\u901f" : "Fast",
    planningBalanced: lang === "zh" ? "\u5e73\u8861" : "Balanced",
    planningDeep: lang === "zh" ? "\u6df1\u5ea6" : "Deep",
    saveApplied: lang === "zh" ? "\u8bbe\u7f6e\u5df2\u4fdd\u5b58\uff0c\u4e0b\u4e00\u6761\u6d88\u606f\u4f1a\u7acb\u5373\u751f\u6548\u3002" : "Settings saved. The next message will use the updated configuration.",
    modelEmpty: lang === "zh" ? "\u8fd8\u6ca1\u6709\u6a21\u578b\u914d\u7f6e" : "No model profiles yet.",
    savedApiKey: lang === "zh" ? "\u5df2\u4fdd\u5b58 API Key" : "Saved API key",
    primary: lang === "zh" ? "\u4e3b\u6a21\u578b" : "Primary",
    contextManual: lang === "zh" ? "\u624b\u52a8" : "Manual",
    contextProvider: lang === "zh" ? "\u63d0\u4f9b\u5546" : "Provider",
    contextLookup: lang === "zh" ? "\u67e5\u8be2" : "Lookup",
    contextCache: lang === "zh" ? "\u7f13\u5b58" : "Cache",
    contextHint: lang === "zh" ? "\u63d0\u793a" : "Hint",
    contextDictionary: lang === "zh" ? "\u5b57\u5178" : "Dictionary",
    contextDefault: lang === "zh" ? "\u9ed8\u8ba4" : "Default",
    contextWindow: lang === "zh" ? "\u7a97\u53e3" : "Window",
    reservedOutput: lang === "zh" ? "\u9884\u7559\u8f93\u51fa" : "Reserve",
    compactLimit: lang === "zh" ? "\u538b\u7f29\u9608\u503c" : "Compact",
    thinking: lang === "zh" ? "\u6df1\u5ea6\u601d\u8003" : "Thinking",
    thinkingOn: lang === "zh" ? "\u5f00\u542f" : "On",
    thinkingOff: lang === "zh" ? "\u5173\u95ed" : "Off",
    thinkingEffort: lang === "zh" ? "\u601d\u8003\u5f3a\u5ea6" : "Reasoning Effort",
    thinkingHigh: lang === "zh" ? "\u9ad8" : "High",
    thinkingMax: lang === "zh" ? "\u6700\u5927" : "Max",
    description: lang === "zh" ? "\u8bf4\u660e" : "Description",
    modalCreateTitle: lang === "zh" ? "\u65b0\u5efa\u6a21\u578b" : "Create Model",
    modalEditTitle: lang === "zh" ? "\u7f16\u8f91\u6a21\u578b" : "Edit Model",
    name: lang === "zh" ? "\u540d\u79f0" : "Name",
    nameRequired: lang === "zh" ? "\u8bf7\u8f93\u5165\u540d\u79f0" : "Please enter a name.",
    protocol: lang === "zh" ? "\u534f\u8bae" : "Protocol",
    protocolRequired: lang === "zh" ? "\u8bf7\u9009\u62e9\u534f\u8bae" : "Please select a protocol.",
    serviceProvider: lang === "zh" ? "API \u670d\u52a1\u5546" : "API Service Provider",
    serviceProviderHint: lang === "zh"
      ? "\u7528\u4e8e\u533a\u5206\u540c\u4e00\u534f\u8bae\u4e0b\u7684\u4e0d\u540c\u670d\u52a1\u5546\uff0c\u4f8b\u5982 DeepSeek\u3001OpenRouter \u6216 Xiaomi Mimo\u3002"
      : "Use this to distinguish providers on the same protocol, such as DeepSeek, OpenRouter, or Xiaomi Mimo.",
    serviceProviderPlaceholder: lang === "zh" ? "\u8bf7\u9009\u62e9 API \u670d\u52a1\u5546" : "Select an API service provider",
    apiBase: "API Base",
    apiKey: "API Key",
    apiKeyKeep: lang === "zh" ? "API Key\uff08\u7559\u7a7a\u5219\u4fdd\u7559\u539f\u503c\uff09" : "API Key (leave empty to keep current value)",
    replaceApiKey: lang === "zh" ? "\u66ff\u6362 API Key" : "Replace API key",
    model: lang === "zh" ? "\u6a21\u578b" : "Model",
    modelRequired: lang === "zh" ? "\u8bf7\u8f93\u5165\u6a21\u578b\u540d" : "Please enter a model.",
    fetchModels: lang === "zh" ? "\u91cd\u65b0\u83b7\u53d6" : "Refresh",
    fetchingModels: lang === "zh" ? "\u6b63\u5728\u83b7\u53d6\u6a21\u578b..." : "Loading models...",
    selectModel: lang === "zh" ? "\u53ef\u624b\u52a8\u8f93\u5165\u6a21\u578b\u540d\uff0c\u6216\u5148\u83b7\u53d6\u5217\u8868" : "Enter a model name or fetch models",
    capabilities: lang === "zh" ? "\u80fd\u529b" : "Capabilities",
    capabilitiesRequired: lang === "zh" ? "\u8bf7\u81f3\u5c11\u9009\u62e9\u4e00\u4e2a\u80fd\u529b" : "Select at least one capability.",
    primaryModel: lang === "zh" ? "\u8bbe\u4e3a\u4e3b\u6a21\u578b" : "Set as Primary",
    enabledField: lang === "zh" ? "\u542f\u7528" : "Enabled",
    discoveredFrom: (provider: string) => lang === "zh"
      ? `\u4ece ${provider} \u53d1\u73b0`
      : `Discovered from ${provider}`,
    discoverSuccess: (count: number) => lang === "zh"
      ? `\u5df2\u53d1\u73b0 ${count} \u4e2a\u6a21\u578b`
      : `Discovered ${count} models.`,
    discoverFailed: lang === "zh" ? "\u83b7\u53d6\u6a21\u578b\u5931\u8d25" : "Failed to fetch models.",
    profileSaved: lang === "zh" ? "\u6a21\u578b\u914d\u7f6e\u5df2\u4fdd\u5b58" : "Model profile saved.",
    profileDeleted: lang === "zh" ? "\u6a21\u578b\u914d\u7f6e\u5df2\u5220\u9664" : "Model profile deleted.",
    deleteTitle: (name: string) => lang === "zh"
      ? `\u5220\u9664\u6a21\u578b\u201c${name}\u201d\uff1f`
      : `Delete model "${name}"?`,
    primaryAction: lang === "zh" ? "\u8bbe\u4e3a\u4e3b\u6a21\u578b" : "Set as primary",
    unsetPrimaryAction: lang === "zh" ? "\u53d6\u6d88\u4e3b\u6a21\u578b" : "Unset primary",
    refreshContext: lang === "zh" ? "\u91cd\u65b0\u63a2\u6d4b\u4e0a\u4e0b\u6587" : "Refresh Context Budget",
    refreshContextLoading: lang === "zh" ? "\u5237\u65b0\u4e2d..." : "Refreshing...",
    refreshContextManual: lang === "zh"
      ? "\u5f53\u524d\u6a21\u578b\u6b63\u5728\u4f7f\u7528\u624b\u52a8\u4e0a\u4e0b\u6587\u9884\u7b97\uff0c\u8bf7\u5148\u6e05\u9664\u624b\u52a8\u8986\u76d6\u518d\u91cd\u65b0\u63a2\u6d4b\u3002"
      : "This profile is using a manual context budget. Clear the manual override before re-detecting.",
    refreshContextSuccess: (source: string) => lang === "zh"
      ? `\u4e0a\u4e0b\u6587\u9884\u7b97\u5df2\u4ece ${source} \u5237\u65b0\u3002`
      : `Context budget refreshed from ${source}.`,
    refreshContextFailed: lang === "zh" ? "\u4e0a\u4e0b\u6587\u9884\u7b97\u5237\u65b0\u5931\u8d25" : "Context refresh failed.",
    actionsLabel: lang === "zh" ? "\u64cd\u4f5c" : "Actions",
    actionsTooltip: lang === "zh" ? "\u7ba1\u7406\u8fd9\u4e2a\u6a21\u578b\u7684\u72b6\u6001\u548c\u914d\u7f6e" : "Manage this model",
    thinkingHelpTitle: lang === "zh" ? "\u6df1\u5ea6\u601d\u8003" : "Thinking",
    thinkingHelpText: lang === "zh"
      ? "\u9ed8\u8ba4\u5f00\u542f\uff0c\u7528\u4e8e\u63a7\u5236\u8fd9\u4e2a\u6a21\u578b\u7684\u601d\u8003\u6a21\u5f0f\u548c\u601d\u8003\u5f3a\u5ea6\u3002"
      : "Enabled by default. Controls this model's reasoning mode and effort.",
    unknownProvider: lang === "zh" ? "\u672a\u77e5" : "Unknown",
  };
}

function getContextSourceMeta(
  profile: Pick<ModelProfile, "contextWindowSource" | "contextWindowSourceDetail">,
  ui: ReturnType<typeof buildUi>,
) {
  const source = profile.contextWindowSource;
  const detail = (profile.contextWindowSourceDetail || "").toLowerCase();

  if (source === "user" || source === "profile") return { label: ui.contextManual, color: "gold" };
  if (source === "provider") return { label: ui.contextProvider, color: "blue" };
  if (source === "lookup") return { label: ui.contextLookup, color: "purple" };
  if (source === "cache") return { label: ui.contextCache, color: "cyan" };
  if (source === "dictionary" && detail.startsWith("model-name token hint")) return { label: ui.contextHint, color: "orange" };
  if (source === "dictionary") return { label: ui.contextDictionary, color: "green" };
  return { label: ui.contextDefault, color: "default" };
}

function getServiceProviderLabel(
  profile: Pick<ModelProfile, "providerName" | "apiBase" | "providerId">,
  lang: "zh" | "en",
  fallback: string,
) {
  const normalized = normalizeServiceProviderName(profile.providerName, profile.apiBase, profile.providerId);
  if (!normalized) return fallback;
  return getServiceProviderDisplayName(normalized, lang, profile.providerId);
}

const ApiKeyField: React.FC<{
  value?: string;
  onChange?: (value: string) => void;
  hasApiKey: boolean;
  inputStyle: React.CSSProperties;
  mutedColor: string;
  placeholder: string;
  replaceText: string;
}> = ({ value, onChange, hasApiKey, inputStyle, mutedColor, placeholder, replaceText }) => {
  const [editing, setEditing] = useState(!hasApiKey);

  useEffect(() => {
    setEditing(!hasApiKey);
  }, [hasApiKey]);

  const masked = hasApiKey && !editing;
  const displayValue = masked ? SAVED_API_KEY_MASK : (value ?? "");

  return (
    <div>
      <Input
        style={inputStyle}
        value={displayValue}
        readOnly={masked}
        placeholder={masked ? undefined : placeholder}
        onChange={(event) => onChange?.(event.target.value)}
      />
      {masked ? (
        <Button
          type="link"
          size="small"
          style={{ padding: 0, height: "auto", marginTop: 4, color: mutedColor }}
          onClick={() => {
            setEditing(true);
            onChange?.("");
          }}
        >
          {replaceText}
        </Button>
      ) : null}
    </div>
  );
};

export const Settings: React.FC = () => {
  const { settings, loadSettings, saveSettings, modelProfiles: profiles, loadModelProfiles } = useChatStore();
  const { colors } = useTheme();
  const { lang, t } = useI18n();
  const ui = useMemo(() => buildUi(lang), [lang]);
  const capabilityLabels = useMemo(() => buildCapabilityLabels(lang), [lang]);
  const providerOptions = useMemo(() => getProviderOptions(lang), [lang]);
  const [form] = Form.useForm<AgentSettings>();
  const [messageApi, ctx] = message.useMessage();
  const [formKey, setFormKey] = useState(0);
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
  const allowsEmptyProfileApiKey = providerConnectionAllowsEmptyApiKey({
    providerId: normalizedWatchedProviderId,
    providerName: watchedProviderName,
    apiBase: String(watchedApiBase ?? ""),
  });
  const thinkingEffortOptions = useMemo(
    () => [
      { value: "high" as ThinkingEffort, label: ui.thinkingHigh },
      { value: "max" as ThinkingEffort, label: ui.thinkingMax },
    ],
    [ui],
  );
  const capabilityOptions = useMemo(
    () => MODEL_CAPABILITIES.map((value) => ({ value, label: capabilityLabels[value] })),
    [capabilityLabels],
  );

  const serviceProviderOptions = useMemo(() => {
    const baseOptions = getServiceProviderOptions(normalizedWatchedProviderId, lang);
    const currentName = normalizeServiceProviderName(
      watchedProviderName,
      String(watchedApiBase ?? ""),
      normalizedWatchedProviderId,
    );
    if (!currentName || baseOptions.some((option) => option.value === currentName)) {
      return baseOptions;
    }
    return [
      {
        value: currentName,
        label: getServiceProviderDisplayName(currentName, lang, normalizedWatchedProviderId),
      },
      ...baseOptions,
    ];
  }, [lang, normalizedWatchedProviderId, watchedApiBase, watchedProviderName]);

  useEffect(() => {
    void loadSettings();
  }, [loadSettings]);

  useEffect(() => {
    form.setFieldsValue({
      ...settings,
      fileAccessRoots: settings.fileAccessRoots ?? [],
    });
  }, [settings, form]);

  useEffect(() => {
    void loadModelProfiles().catch((error) => {
      console.warn("[settings] failed to load model profiles:", error);
    });
  }, [loadModelProfiles]);

  const inputStyle: React.CSSProperties = {
    background: colors.bgTertiary,
    color: colors.textPrimary,
    border: `1px solid ${colors.borderStrong}`,
    borderRadius: 8,
  };

  const label = (text: string) => <span style={{ color: colors.textMuted }}>{text}</span>;

  const onSave = async (values: AgentSettings) => {
    await saveSettings(sanitizeApiKeyForSave({ ...settings, ...values }));
    setFormKey((key) => key + 1);
    void messageApi.success(ui.saveApplied);
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
      thinkingEnabled: true,
      thinkingEffort: "high",
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
      void messageApi.success(ui.discoverSuccess(models.length));
      if (models.length > 0 && !profileForm.getFieldValue("model")) {
        const first = models[0];
        profileForm.setFieldsValue({
          model: first.id,
          providerName: normalizeServiceProviderName(
            profileForm.getFieldValue("providerName") || first.ownedBy || "",
            String(values.apiBase ?? ""),
            values.providerId,
          ),
          capabilities: first.capabilities.length ? first.capabilities : ["chat"],
          name: profileForm.getFieldValue("name") || first.label,
          description: profileForm.getFieldValue("description") || (first.ownedBy ? ui.discoveredFrom(first.ownedBy) : ui.discoveredFrom("provider")),
        });
      }
    } catch (error) {
      void messageApi.error(error instanceof Error ? error.message : ui.discoverFailed);
    } finally {
      setDiscovering(false);
    }
  };

  const saveProfile = async () => {
    const values = await profileForm.validateFields();
    const modelId = String(values.model ?? "").trim();
    await apiPost<ModelProfile>("/api/model-profiles", {
      ...editingProfile,
      ...values,
      name: String(values.name ?? "").trim() || modelId,
      model: modelId,
      providerName: normalizeServiceProviderName(values.providerName, String(values.apiBase ?? ""), values.providerId),
      apiBase: String(values.apiBase ?? "").trim(),
      apiKey: values.apiKey === SAVED_API_KEY_MASK ? "" : values.apiKey,
      providerId: normalizeProviderId(values.providerId),
    });
    await loadModelProfiles();
    setProfileModalOpen(false);
    setEditingProfile(null);
    profileForm.resetFields();
    void messageApi.success(ui.profileSaved);
  };

  const deleteProfile = async (id: string) => {
    await apiDelete(`/api/model-profiles/${id}`);
    await loadModelProfiles();
    void messageApi.success(ui.profileDeleted);
  };

  const confirmDeleteProfile = (profile: ModelProfile) => {
    Modal.confirm({
      title: ui.deleteTitle(profile.name),
      okText: t("delete"),
      cancelText: t("cancel"),
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
    await apiPost<ModelProfile>("/api/model-profiles", {
      ...profile,
      isPrimary,
      capabilities: nextCapabilities,
      apiKey: "",
    });
    await loadModelProfiles();
  };

  const toggleProfileEnabled = async (profile: ModelProfile, enabled: boolean) => {
    await apiPost<ModelProfile>("/api/model-profiles", {
      ...profile,
      enabled,
      apiKey: "",
    });
    await loadModelProfiles();
  };

  const refreshProfileContext = async (profile: ModelProfile) => {
    if (profile.contextWindowSource === "user" || profile.contextWindowSource === "profile") {
      void messageApi.info(ui.refreshContextManual);
      return;
    }

    setRefreshingContextProfileId(profile.id);
    try {
      const saved = await apiPost<ModelProfile>(`/api/model-profiles/${profile.id}/refresh-context`, {});
      await loadModelProfiles();
      void messageApi.success(ui.refreshContextSuccess(getContextSourceMeta(saved, ui).label));
    } catch (error) {
      void messageApi.error(error instanceof Error ? error.message : ui.refreshContextFailed);
    } finally {
      setRefreshingContextProfileId("");
    }
  };

  const modelOptions = discoveredModels.map((model) => ({
    value: model.id,
    label: model.ownedBy ? `${model.label} | ${model.ownedBy}` : model.label,
  }));

  const applyDiscoveredModel = (modelId: string) => {
    const model = discoveredModels.find((item) => item.id === modelId);
    if (!model) return;
    profileForm.setFieldsValue({
      model: model.id,
      name: profileForm.getFieldValue("name") || model.label,
      capabilities: model.capabilities.length ? model.capabilities : ["chat"],
      thinkingEnabled: profileForm.getFieldValue("thinkingEnabled") ?? true,
      thinkingEffort: profileForm.getFieldValue("thinkingEffort") || "high",
      description: profileForm.getFieldValue("description") || (model.ownedBy ? ui.discoveredFrom(model.ownedBy) : ui.discoveredFrom("provider")),
    });
  };

  useEffect(() => {
    if (!profileModalOpen || !watchedProviderId) return;
    const apiKeyValue = String(watchedApiKey ?? "");
    const hasTypedKey = Boolean(apiKeyValue.trim()) && apiKeyValue !== SAVED_API_KEY_MASK;
    const hasSavedKey = Boolean(editingProfile?.hasApiKey);
    if (!hasTypedKey && !hasSavedKey && !allowsEmptyProfileApiKey) return;
    const timer = window.setTimeout(() => {
      void discoverProfileModels();
    }, 300);
    return () => window.clearTimeout(timer);
  }, [profileModalOpen, watchedProviderId, watchedApiBase, watchedApiKey, watchedProviderName, editingProfile?.id, editingProfile?.hasApiKey, allowsEmptyProfileApiKey]);

  return (
    <div
      style={{
        height: "100%",
        minHeight: 0,
        overflowY: "auto",
        overflowX: "hidden",
        padding: "28px 32px",
        maxWidth: 1100,
        color: colors.textPrimary,
        boxSizing: "border-box",
      }}
    >
      {ctx}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 16, marginBottom: 16 }}>
        <div>
          <Title level={4} style={{ color: colors.textPrimary, marginBottom: 6 }}>
            {ui.pageTitle}
          </Title>
          <Text style={{ color: colors.textMuted }}>{ui.pageSubtitle}</Text>
        </div>
        <Button type="primary" icon={<PlusOutlined />} onClick={openCreateProfile}>
          {ui.createModel}
        </Button>
      </div>

      <Form
        key={formKey}
        form={form}
        layout="vertical"
        onFinish={(values) => void onSave(values as AgentSettings)}
        initialValues={{ ...settings, fileAccessRoots: settings.fileAccessRoots ?? [] }}
      >
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 16 }}>
          <div>
            <Form.Item label={label(ui.workspacePath)} name="workspacePath" tooltip={ui.workspacePathTip}>
              <Input style={inputStyle} placeholder={"D:\\company"} />
            </Form.Item>
            <Form.Item label={label(ui.fileAccessRoots)} name="fileAccessRoots" tooltip={ui.fileAccessRootsTip}>
              <Select mode="tags" open={false} style={{ width: "100%" }} placeholder={"D:\\company\\shared"} tokenSeparators={[","]} />
            </Form.Item>
            <Form.Item label={label(ui.enableMemory)} name="enableMemory" valuePropName="checked">
              <Switch />
            </Form.Item>
            <Form.Item label={label(ui.enableKnowledge)} name="enableKnowledge" valuePropName="checked">
              <Switch />
            </Form.Item>
          </div>
          <div>
            <Form.Item label={label(ui.temperature)} name="temperature">
              <InputNumber min={0} max={2} step={0.1} style={{ width: "100%" }} />
            </Form.Item>
            <Form.Item label={label(ui.enableContextCompaction)} name="enableContextCompaction" valuePropName="checked">
              <Switch />
            </Form.Item>
            <Form.Item
              label={label(ui.shellTimeout)}
              name="shellCommandTimeoutMs"
              getValueProps={(value) => ({ value: Math.round((value ?? 300_000) / 1000) })}
              normalize={(seconds) => Math.max(5, Math.min(600, Number(seconds) || 300)) * 1000}
            >
              <InputNumber min={5} max={600} style={{ width: "100%" }} />
            </Form.Item>
            <Form.Item label={label(ui.planningMode)} name="planningMode">
              <Select
                style={{ width: "100%" }}
                options={[
                  { value: "fast", label: ui.planningFast },
                  { value: "balanced", label: ui.planningBalanced },
                  { value: "deep", label: ui.planningDeep },
                ]}
              />
            </Form.Item>
          </div>
        </div>

        <Divider style={{ borderColor: colors.border, margin: "16px 0" }} />
        <Button htmlType="submit" type="primary" style={{ background: colors.accent, border: "none", borderRadius: 8 }}>
          {t("saveSettings")}
        </Button>
      </Form>

      <Divider style={{ borderColor: colors.border, margin: "24px 0" }} />

      <div style={{ fontSize: 14, fontWeight: 600, color: colors.textPrimary, marginBottom: 12 }}>{ui.modelSection}</div>
      <List
        locale={{ emptyText: ui.modelEmpty }}
        dataSource={profiles}
        renderItem={(profile) => {
          const contextMeta = getContextSourceMeta(profile, ui);
          const isRefreshing = refreshingContextProfileId === profile.id;

          return (
            <List.Item
              style={{
                borderColor: colors.border,
                padding: "16px 18px",
                marginBottom: 12,
                borderRadius: 16,
                background: colors.bgSecondary,
                boxShadow: `inset 0 0 0 1px ${colors.border}`,
              }}
              actions={[
                <OverflowMenuButton
                  key="more"
                  color={colors.accent}
                  tooltip={ui.actionsTooltip}
                  label={ui.actionsLabel}
                  size="middle"
                  variant="outlined"
                  backgroundColor={colors.bgPrimary}
                  borderColor={colors.accent}
                  items={[
                    {
                      key: "primary",
                      label: profile.isPrimary ? ui.unsetPrimaryAction : ui.primaryAction,
                      disabled: !profile.enabled && !profile.isPrimary,
                    },
                    { key: "toggle", label: profile.enabled ? t("disable") : t("enable") },
                    {
                      key: "refresh-context",
                      label: isRefreshing ? ui.refreshContextLoading : ui.refreshContext,
                      disabled: isRefreshing || profile.contextWindowSource === "user" || profile.contextWindowSource === "profile",
                    },
                    { key: "edit", label: t("edit") },
                    { key: "delete", label: t("delete"), danger: true },
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
                title={(
                  <Space size={8} wrap>
                    <span style={{ color: colors.textPrimary, fontWeight: 600 }}>{profile.name}</span>
                    {profile.isPrimary ? <Tag color="blue">{ui.primary}</Tag> : null}
                    <Tag color={profile.enabled ? "green" : "default"}>{profile.enabled ? t("enabled") : t("disabled")}</Tag>
                    <Tag color="cyan">{getServiceProviderLabel(profile, lang, ui.unknownProvider)}</Tag>
                    <Tag>{getProviderProtocolName(profile.providerId, lang)}</Tag>
                    {profile.hasApiKey ? <Tag color="gold">{ui.savedApiKey}</Tag> : null}
                    <Tag color={contextMeta.color}>{contextMeta.label}</Tag>
                  </Space>
                )}
                description={(
                  <Space direction="vertical" size={6} style={{ width: "100%" }}>
                    <Text style={{ color: colors.textSecondary }}>{profile.model}</Text>
                    <Space wrap size={4}>
                      {(profile.capabilities ?? []).map((capability) => (
                        <Tag key={capability} color={CAPABILITY_COLORS[capability]}>
                          {capabilityLabels[capability]}
                        </Tag>
                      ))}
                    </Space>
                    <Text style={{ color: colors.textSecondary }}>{profile.apiBase}</Text>
                    <Space wrap size={8}>
                      <Text style={{ color: colors.textSecondary }}>{ui.contextWindow} {formatTokenCount(profile.contextWindowTokens)}</Text>
                      <Text style={{ color: colors.textSecondary }}>{ui.reservedOutput} {formatTokenCount(profile.reservedOutputTokens)}</Text>
                      <Text style={{ color: colors.textSecondary }}>{ui.compactLimit} {formatTokenCount(profile.autoCompactTokenLimit)}</Text>
                    </Space>
                    <Space wrap size={8}>
                      <Text style={{ color: colors.textSecondary }}>{ui.thinking} {profile.thinkingEnabled === false ? ui.thinkingOff : ui.thinkingOn}</Text>
                      <Text style={{ color: colors.textSecondary }}>{ui.thinkingEffort} {profile.thinkingEffort === "max" ? ui.thinkingMax : ui.thinkingHigh}</Text>
                    </Space>
                    {profile.contextWindowSourceDetail ? (
                      <Text style={{ color: colors.textMuted, fontSize: 12 }}>{profile.contextWindowSourceDetail}</Text>
                    ) : null}
                    {profile.description ? <Text style={{ color: colors.textSecondary }}>{profile.description}</Text> : null}
                  </Space>
                )}
              />
            </List.Item>
          );
        }}
      />

      <Modal
        title={editingProfile ? ui.modalEditTitle : ui.modalCreateTitle}
        open={profileModalOpen}
        onOk={() => void saveProfile()}
        onCancel={() => {
          setProfileModalOpen(false);
          setEditingProfile(null);
          profileForm.resetFields();
        }}
        okText={t("save")}
        cancelText={t("cancel")}
        width={760}
      >
        <Form form={profileForm} layout="vertical">
          <Form.Item name="name" label={ui.name} rules={[{ required: true, message: ui.nameRequired }]}>
            <Input />
          </Form.Item>
          <Form.Item name="providerId" label={ui.protocol} rules={[{ required: true, message: ui.protocolRequired }]}>
            <Select
              options={providerOptions}
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
            label={ui.serviceProvider}
            extra={ui.serviceProviderHint}
          >
            <Select
              showSearch
              options={serviceProviderOptions}
              placeholder={ui.serviceProviderPlaceholder}
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
          <Form.Item name="apiBase" label={ui.apiBase}>
            <Input
              placeholder={getServiceProviderDefaultApiBase(watchedProviderName, normalizedWatchedProviderId) || (watchedProviderId ? getProviderDefaultApiBase(watchedProviderId) : "https://api.example.com/v1")}
              onBlur={(event) => {
                const currentProviderName = String(profileForm.getFieldValue("providerName") ?? "").trim();
                if (!currentProviderName || currentProviderName === "Custom") {
                  profileForm.setFieldsValue({
                    providerName: normalizeServiceProviderName(currentProviderName, event.target.value, normalizedWatchedProviderId),
                  });
                }
              }}
            />
          </Form.Item>
          <Form.Item name="apiKey" label={editingProfile?.hasApiKey ? ui.apiKeyKeep : ui.apiKey}>
            <ApiKeyField
              hasApiKey={Boolean(editingProfile?.hasApiKey)}
              inputStyle={inputStyle}
              mutedColor={colors.textMuted}
              placeholder="sk-..."
              replaceText={ui.replaceApiKey}
            />
          </Form.Item>
          <Form.Item
            name="model"
            label={(
              <Space style={{ width: "100%", justifyContent: "space-between" }}>
                <span>{ui.model}</span>
                <Button type="link" icon={<ReloadOutlined />} loading={discovering} onClick={() => void discoverProfileModels()}>
                  {ui.fetchModels}
                </Button>
              </Space>
            )}
            rules={[{ required: true, message: ui.modelRequired }]}
          >
            <AutoComplete
              options={modelOptions}
              placeholder={discovering ? ui.fetchingModels : ui.selectModel}
              filterOption={(inputValue, option) =>
                String(option?.value ?? "").toLowerCase().includes(inputValue.toLowerCase())
                || String(option?.label ?? "").toLowerCase().includes(inputValue.toLowerCase())
              }
              onChange={(value) => {
                const nextModel = String(value ?? "");
                const discovered = discoveredModels.find((item) => item.id === nextModel);
                profileForm.setFieldsValue({
                  model: nextModel,
                  name: profileForm.getFieldValue("name") || (discovered ? undefined : nextModel.trim()),
                });
              }}
              onSelect={(value) => {
                applyDiscoveredModel(String(value));
              }}
            />
          </Form.Item>
          <Form.Item name="capabilities" label={ui.capabilities} rules={[{ required: true, message: ui.capabilitiesRequired }]}>
            <Checkbox.Group options={capabilityOptions} style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 8 }} />
          </Form.Item>
          <Form.Item name="isPrimary" label={ui.primaryModel} valuePropName="checked">
            <Switch />
          </Form.Item>
          <Form.Item name="temperature" label={ui.temperature}>
            <InputNumber min={0} max={2} step={0.1} style={{ width: "100%" }} />
          </Form.Item>
          <div
            style={{
              marginBottom: 16,
              padding: "14px 16px",
              borderRadius: 14,
              border: `1px solid ${colors.borderStrong}`,
              background: colors.bgTertiary,
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, marginBottom: 12 }}>
              <div>
                <div style={{ color: colors.textPrimary, fontWeight: 600 }}>{ui.thinkingHelpTitle}</div>
                <div style={{ color: colors.textMuted, fontSize: 12, marginTop: 4 }}>
                  {ui.thinkingHelpText}
                </div>
              </div>
              <Form.Item name="thinkingEnabled" valuePropName="checked" noStyle>
                <Switch />
              </Form.Item>
            </div>
            <Form.Item noStyle shouldUpdate={(prev, next) => prev.thinkingEnabled !== next.thinkingEnabled}>
              {({ getFieldValue }) => (
                <Form.Item name="thinkingEffort" label={ui.thinkingEffort} style={{ marginBottom: 0 }}>
                  <Select
                    disabled={getFieldValue("thinkingEnabled") === false}
                    options={thinkingEffortOptions}
                  />
                </Form.Item>
              )}
            </Form.Item>
          </div>
          <Form.Item name="description" label={ui.description}>
            <Input.TextArea rows={3} />
          </Form.Item>
          <Form.Item name="enabled" label={ui.enabledField} valuePropName="checked">
            <Switch />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
};
