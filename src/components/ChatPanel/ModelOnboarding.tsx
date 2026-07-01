import React, { useEffect, useMemo, useState } from "react";
import { Alert, AutoComplete, Button, Form, Input, Select, Space, Spin, Typography, message } from "antd";
import { ReloadOutlined, SettingOutlined } from "@ant-design/icons";
import type { AgentSettings, DiscoveredModel, ModelProfile, ProviderId } from "../../shared/types";
import { useTheme } from "../../theme";
import { useI18n } from "../../i18n";
import { apiPost } from "../../services/api";
import {
  getDefaultServiceProviderName,
  getProviderDefaultApiBase,
  getProviderOptions,
  getServiceProviderDefaultApiBase,
  getServiceProviderDisplayName,
  getServiceProviderOptions,
  normalizeProviderId,
  normalizeServiceProviderName,
  providerConnectionAllowsEmptyApiKey,
} from "../../shared/providers";

const { Paragraph, Text, Title } = Typography;

interface QuickModelForm {
  providerId: ProviderId;
  providerName: string;
  apiBase: string;
  apiKey: string;
  model: string;
}

interface Props {
  loading?: boolean;
  settings: AgentSettings;
  onSuccess: () => Promise<void> | void;
  onOpenSettings?: () => void;
}

function buildUi(lang: "zh" | "en") {
  return {
    eyebrow: lang === "zh" ? "首次使用" : "First Run",
    title: lang === "zh" ? "先添加一个模型，马上开始使用" : "Add one model to get started",
    subtitle: lang === "zh"
      ? "只需要填最基本的连接信息。成功后会自动保存为主模型，你就可以直接开始聊天。"
      : "Enter the minimum connection details. We will save the result as your primary model so chat works right away.",
    providerId: lang === "zh" ? "协议" : "Protocol",
    providerName: lang === "zh" ? "API 服务商" : "API Service Provider",
    providerNamePlaceholder: lang === "zh" ? "选择服务商" : "Select a service provider",
    apiBase: "API Base",
    apiKey: "API Key",
    apiKeyPlaceholder: lang === "zh" ? "填入 API Key，若本地模型无需可留空" : "Enter an API key, or leave empty for local providers that do not need one",
    model: lang === "zh" ? "模型" : "Model",
    modelPlaceholder: lang === "zh" ? "可手动输入模型名，或先获取模型列表" : "Enter a model name or fetch models first",
    refreshModels: lang === "zh" ? "获取模型" : "Fetch Models",
    fetchingModels: lang === "zh" ? "正在获取模型..." : "Loading models...",
    save: lang === "zh" ? "保存并开始聊天" : "Save And Start Chat",
    openSettings: lang === "zh" ? "打开完整设置" : "Open Full Settings",
    loading: lang === "zh" ? "正在检查模型配置..." : "Checking model setup...",
    loadingHint: lang === "zh" ? "请稍候，我们正在确认当前工作区是否已经配置过模型。" : "One moment while we check whether this workspace already has a model configured.",
    primaryNote: lang === "zh" ? "保存后会自动设为主模型" : "This will be saved as your primary model",
    apiKeyOptional: lang === "zh" ? "当前连接允许不填 API Key" : "This connection does not require an API key",
    discoverFailed: lang === "zh" ? "获取模型失败" : "Failed to fetch models.",
    saveFailed: lang === "zh" ? "保存模型失败" : "Failed to save model.",
    saveSuccess: lang === "zh" ? "模型已保存，现在可以开始聊天了。" : "Model saved. You can start chatting now.",
    noModels: lang === "zh" ? "没有获取到可用模型，请确认服务地址和凭证。" : "No models were returned. Check the service URL and credentials.",
    modelRequired: lang === "zh" ? "请输入模型名" : "Please enter a model.",
    protocolRequired: lang === "zh" ? "请选择协议" : "Please select a protocol.",
  };
}

export const ModelOnboarding: React.FC<Props> = ({ loading = false, settings, onSuccess, onOpenSettings }) => {
  const { colors } = useTheme();
  const { lang } = useI18n();
  const ui = useMemo(() => buildUi(lang), [lang]);
  const providerOptions = useMemo(() => getProviderOptions(lang), [lang]);
  const [form] = Form.useForm<QuickModelForm>();
  const [messageApi, messageContext] = message.useMessage();
  const [discovering, setDiscovering] = useState(false);
  const [saving, setSaving] = useState(false);
  const [inlineError, setInlineError] = useState("");
  const [discoveredModels, setDiscoveredModels] = useState<DiscoveredModel[]>([]);
  const watchedProviderId = Form.useWatch("providerId", form) as ProviderId | undefined;
  const watchedProviderName = Form.useWatch("providerName", form) as string | undefined;
  const watchedApiBase = Form.useWatch("apiBase", form) as string | undefined;
  const watchedApiKey = Form.useWatch("apiKey", form) as string | undefined;
  const normalizedProviderId = normalizeProviderId(watchedProviderId);
  const allowsEmptyApiKey = providerConnectionAllowsEmptyApiKey({
    providerId: normalizedProviderId,
    providerName: watchedProviderName,
    apiBase: String(watchedApiBase ?? ""),
  });

  const serviceProviderOptions = useMemo(() => {
    const options = getServiceProviderOptions(normalizedProviderId, lang);
    const current = normalizeServiceProviderName(
      watchedProviderName,
      String(watchedApiBase ?? ""),
      normalizedProviderId,
    );
    if (!current || options.some((option) => option.value === current)) {
      return options;
    }
    return [
      {
        value: current,
        label: getServiceProviderDisplayName(current, lang, normalizedProviderId),
      },
      ...options,
    ];
  }, [lang, normalizedProviderId, watchedApiBase, watchedProviderName]);

  const modelOptions = discoveredModels.map((model) => ({
    value: model.id,
    label: model.ownedBy ? `${model.label} | ${model.ownedBy}` : model.label,
  }));

  const applyDiscoveredModel = (modelId: string) => {
    const model = discoveredModels.find((item) => item.id === modelId);
    if (!model) {
      return;
    }
    form.setFieldsValue({ model: model.id });
  };

  useEffect(() => {
    if (form.isFieldsTouched(["providerId", "providerName", "apiBase", "apiKey", "model"])) {
      return;
    }
    const providerId = normalizeProviderId(settings.providerId);
    const apiBase = settings.apiBase?.trim() || getProviderDefaultApiBase(providerId);
    form.setFieldsValue({
      providerId,
      providerName: normalizeServiceProviderName(getDefaultServiceProviderName(providerId), apiBase, providerId),
      apiBase,
      apiKey: "",
      model: "",
    });
  }, [form, settings]);

  const panelStyle: React.CSSProperties = {
    width: "min(760px, calc(100% - 32px))",
    margin: "0 auto",
    padding: "28px 30px",
    borderRadius: 28,
    background: colors.bgSecondary,
    border: `1px solid ${colors.borderStrong}`,
    boxShadow: "0 28px 72px rgba(15, 23, 42, 0.16)",
  };

  const inputStyle: React.CSSProperties = {
    background: colors.bgTertiary,
    color: colors.textPrimary,
    border: `1px solid ${colors.borderStrong}`,
    borderRadius: 10,
  };

  const discoverModels = async () => {
    const values = await form.validateFields(["providerId", "apiBase"]);
    const apiKey = String(form.getFieldValue("apiKey") ?? "").trim();
    if (!allowsEmptyApiKey && !apiKey) return;
    setDiscovering(true);
    setInlineError("");
    try {
      const models = await apiPost<DiscoveredModel[]>("/api/model-profiles/discover", {
        providerId: normalizeProviderId(values.providerId),
        apiBase: String(values.apiBase ?? "").trim(),
        apiKey,
      });
      setDiscoveredModels(models);
      if (models.length > 0) {
        const currentModel = String(form.getFieldValue("model") ?? "");
        if (!currentModel) {
          form.setFieldsValue({ model: models[0].id });
        }
      } else {
        setInlineError(ui.noModels);
      }
    } catch (error) {
      setDiscoveredModels([]);
      setInlineError(error instanceof Error ? error.message : ui.discoverFailed);
    } finally {
      setDiscovering(false);
    }
  };

  useEffect(() => {
    if (loading || !watchedProviderId) return;
    const apiKey = String(watchedApiKey ?? "").trim();
    if (!watchedApiBase?.trim()) return;
    if (!allowsEmptyApiKey && !apiKey) return;
    const timer = window.setTimeout(() => {
      void discoverModels();
    }, 300);
    return () => window.clearTimeout(timer);
  }, [allowsEmptyApiKey, loading, watchedApiBase, watchedApiKey, watchedProviderId]);

  const saveModel = async () => {
    const values = await form.validateFields();
    const modelId = String(values.model ?? "").trim();
    const selectedModel = discoveredModels.find((model) => model.id === modelId);
    setSaving(true);
    setInlineError("");
    try {
      await apiPost<ModelProfile>("/api/model-profiles", {
        name: selectedModel?.label || modelId,
        providerId: normalizeProviderId(values.providerId),
        providerName: normalizeServiceProviderName(values.providerName, String(values.apiBase ?? ""), values.providerId),
        apiBase: String(values.apiBase ?? "").trim(),
        apiKey: String(values.apiKey ?? "").trim(),
        model: modelId,
        capabilities: selectedModel?.capabilities?.length ? selectedModel.capabilities : ["chat"],
        enabled: true,
        isPrimary: true,
        temperature: settings.temperature ?? 0.4,
        thinkingEnabled: settings.thinkingEnabled ?? true,
        thinkingEffort: settings.thinkingEffort ?? "high",
        description: selectedModel?.ownedBy
          ? `Discovered from ${selectedModel.ownedBy}`
          : "Created from homepage onboarding.",
      });
      await onSuccess();
      void messageApi.success(ui.saveSuccess);
    } catch (error) {
      setInlineError(error instanceof Error ? error.message : ui.saveFailed);
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
        <div style={panelStyle}>
          <Space direction="vertical" size={16} style={{ width: "100%", alignItems: "center", textAlign: "center" }}>
            <Spin size="large" />
            <Title level={4} style={{ margin: 0, color: colors.textPrimary }}>{ui.loading}</Title>
            <Text style={{ color: colors.textMuted }}>{ui.loadingHint}</Text>
          </Space>
        </div>
      </div>
    );
  }

  return (
    <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
      {messageContext}
      <div style={panelStyle}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16, marginBottom: 20 }}>
          <div>
            <Text style={{ color: colors.accent, fontSize: 12, fontWeight: 700, letterSpacing: 1.2, textTransform: "uppercase" }}>
              {ui.eyebrow}
            </Text>
            <Title level={3} style={{ margin: "8px 0 10px", color: colors.textPrimary }}>
              {ui.title}
            </Title>
            <Paragraph style={{ marginBottom: 10, color: colors.textSecondary }}>
              {ui.subtitle}
            </Paragraph>
            <Text style={{ color: colors.textMuted }}>{ui.primaryNote}</Text>
          </div>
          {onOpenSettings ? (
            <Button type="text" icon={<SettingOutlined />} onClick={onOpenSettings} style={{ color: colors.textMuted }}>
              {ui.openSettings}
            </Button>
          ) : null}
        </div>

        {inlineError ? (
          <Alert
            type="error"
            showIcon
            message={inlineError}
            style={{ marginBottom: 18, borderRadius: 12 }}
          />
        ) : null}

        {allowsEmptyApiKey ? (
          <Alert
            type="info"
            showIcon
            message={ui.apiKeyOptional}
            style={{ marginBottom: 18, borderRadius: 12 }}
          />
        ) : null}

        <Form form={form} layout="vertical">
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 14 }}>
            <Form.Item name="providerId" label={ui.providerId} rules={[{ required: true, message: ui.protocolRequired }]} style={{ marginBottom: 0 }}>
              <Select
                options={providerOptions}
                onChange={(nextProviderId) => {
                  const previousProviderId = normalizeProviderId(form.getFieldValue("providerId"));
                  const currentProviderName = String(form.getFieldValue("providerName") ?? "").trim();
                  const currentApiBase = String(form.getFieldValue("apiBase") ?? "").trim();
                  const previousDefaultApiBase = getProviderDefaultApiBase(previousProviderId);
                  const nextDefaultApiBase = getProviderDefaultApiBase(nextProviderId);
                  const previousServiceDefault = getServiceProviderDefaultApiBase(currentProviderName, previousProviderId);
                  const nextProviderName = !currentProviderName
                    || currentProviderName === normalizeServiceProviderName(currentProviderName, currentApiBase, previousProviderId)
                    || (previousServiceDefault && currentApiBase === previousServiceDefault)
                    ? normalizeServiceProviderName(getDefaultServiceProviderName(nextProviderId), nextDefaultApiBase, nextProviderId)
                    : currentProviderName;
                  form.setFieldsValue({
                    providerName: nextProviderName,
                    apiBase: !currentApiBase || currentApiBase === previousDefaultApiBase ? nextDefaultApiBase : currentApiBase,
                    model: "",
                  });
                  setDiscoveredModels([]);
                  setInlineError("");
                }}
              />
            </Form.Item>

            <Form.Item name="providerName" label={ui.providerName} style={{ marginBottom: 0 }}>
              <Select
                showSearch
                options={serviceProviderOptions}
                placeholder={ui.providerNamePlaceholder}
                onChange={(nextProviderName) => {
                  const defaultApiBase = getServiceProviderDefaultApiBase(nextProviderName, normalizedProviderId);
                  form.setFieldsValue({
                    providerName: normalizeServiceProviderName(nextProviderName, defaultApiBase || String(form.getFieldValue("apiBase") ?? ""), normalizedProviderId),
                    apiBase: defaultApiBase || String(form.getFieldValue("apiBase") ?? ""),
                    model: "",
                  });
                  setDiscoveredModels([]);
                  setInlineError("");
                }}
              />
            </Form.Item>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 14, marginTop: 14 }}>
            <Form.Item name="apiBase" label={ui.apiBase} style={{ marginBottom: 0 }}>
              <Input style={inputStyle} />
            </Form.Item>
            <Form.Item name="apiKey" label={ui.apiKey} style={{ marginBottom: 0 }}>
              <Input.Password style={inputStyle} placeholder={ui.apiKeyPlaceholder} />
            </Form.Item>
          </div>

          <Form.Item
            name="model"
            label={(
              <Space style={{ width: "100%", justifyContent: "space-between" }}>
                <span>{ui.model}</span>
                <Button type="link" icon={<ReloadOutlined />} loading={discovering} onClick={() => void discoverModels()}>
                  {ui.refreshModels}
                </Button>
              </Space>
            )}
            rules={[{ required: true, message: ui.modelRequired }]}
            style={{ marginTop: 14, marginBottom: 20 }}
          >
            <AutoComplete
              options={modelOptions}
              placeholder={discovering ? ui.fetchingModels : ui.modelPlaceholder}
              filterOption={(inputValue, option) =>
                String(option?.value ?? "").toLowerCase().includes(inputValue.toLowerCase())
                || String(option?.label ?? "").toLowerCase().includes(inputValue.toLowerCase())
              }
              onChange={(value) => {
                form.setFieldsValue({ model: value });
              }}
              onSelect={(value) => {
                applyDiscoveredModel(String(value));
              }}
            />
          </Form.Item>

          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
            <Button
              type="primary"
              loading={saving}
              onClick={() => void saveModel()}
              style={{ background: colors.accent, border: "none", borderRadius: 10, minWidth: 190 }}
            >
              {ui.save}
            </Button>
            {onOpenSettings ? (
              <Button type="text" onClick={onOpenSettings} style={{ color: colors.textMuted }}>
                {ui.openSettings}
              </Button>
            ) : null}
          </div>
        </Form>
      </div>
    </div>
  );
};
