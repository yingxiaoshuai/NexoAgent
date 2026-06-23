import React, { useEffect, useMemo, useState } from "react";
import { Alert, Button, Input, Switch, Tag, message } from "antd";
import { CopyOutlined, GlobalOutlined } from "@ant-design/icons";
import { apiGet, apiPost } from "../../services/api";
import { useI18n } from "../../i18n";
import { useTheme } from "../../theme";

type ChannelId = "web" | "feishu" | "dingtalk" | "wecom" | "wechat";

interface ChannelField {
  key: string;
  label: string;
  secret?: boolean;
}

interface ChannelDef {
  id: ChannelId;
  name: string;
  desc: string;
  icon: React.ReactNode;
  fields: ChannelField[];
  alwaysEnabled?: boolean;
  note?: string;
}

interface ChannelConfig {
  id: Exclude<ChannelId, "web">;
  enabled: boolean;
  values: Record<string, string>;
  callbackUrl: string;
  runtimeStatus: "ready";
}

function buildChannels(lang: "zh" | "en"): ChannelDef[] {
  const zh = lang === "zh";
  return [
    {
      id: "web",
      name: zh ? "Web \u63a7\u5236\u53f0" : "Web Console",
      desc: zh ? "\u5f53\u524d\u9875\u9762\u8bbf\u95ee\u5730\u5740" : "Current page address",
      icon: <GlobalOutlined style={{ fontSize: 22, color: "#38bdf8" }} />,
      fields: [],
      alwaysEnabled: true,
    },
    {
      id: "feishu",
      name: zh ? "\u98de\u4e66" : "Feishu",
      desc: zh ? "\u63a5\u5165\u98de\u4e66\u673a\u5668\u4eba\u4e8b\u4ef6\u56de\u8c03" : "Receive Feishu bot callbacks",
      icon: <span style={{ fontSize: 22 }}>\u98de</span>,
      fields: [
        { key: "app_id", label: "App ID" },
        { key: "app_secret", label: "App Secret", secret: true },
        { key: "verification_token", label: "Verification Token", secret: true },
      ],
      note: zh
        ? "\u652f\u6301 challenge \u6821\u9a8c\u548c\u6587\u672c\u6d88\u606f\u4e8b\u4ef6\u63a5\u5165\u3002"
        : "Supports challenge verification and text message event ingress.",
    },
    {
      id: "dingtalk",
      name: zh ? "\u9489\u9489" : "DingTalk",
      desc: zh ? "\u63a5\u5165\u9489\u9489 Outgoing \u56de\u8c03" : "Receive DingTalk outgoing callbacks",
      icon: <span style={{ fontSize: 22 }}>\u9489</span>,
      fields: [
        { key: "agent_id", label: "Agent ID" },
        { key: "app_key", label: "App Key" },
        { key: "app_secret", label: "App Secret", secret: true },
      ],
      note: zh
        ? "\u652f\u6301 JSON \u6587\u672c\u5165\u7ad9\uff0c\u5e76\u6309 text \u54cd\u5e94\u683c\u5f0f\u8fd4\u56de\u3002"
        : "Accepts JSON text payloads and replies in text response format.",
    },
    {
      id: "wecom",
      name: zh ? "\u4f01\u4e1a\u5fae\u4fe1" : "WeCom",
      desc: zh ? "\u63a5\u5165\u4f01\u4e1a\u5fae\u4fe1\u56de\u8c03" : "Receive WeCom callbacks",
      icon: <span style={{ fontSize: 22 }}>\u4f01</span>,
      fields: [
        { key: "corp_id", label: "Corp ID" },
        { key: "agent_secret", label: "Agent Secret", secret: true },
        { key: "agent_id", label: "Agent ID" },
        { key: "token", label: "Token", secret: true },
        { key: "encoding_aes_key", label: "EncodingAESKey", secret: true },
      ],
      note: zh
        ? "\u57fa\u7840\u56de\u8c03\u94fe\u8def\u5df2\u63a5\u5165\uff0c\u540e\u7eed\u53ef\u6269\u5c55 AES \u89e3\u5bc6\u3002"
        : "Base callback flow is wired. AES decryption can be added later.",
    },
    {
      id: "wechat",
      name: zh ? "\u5fae\u4fe1\u516c\u4f17\u53f7" : "WeChat Official Account",
      desc: zh ? "\u63a5\u5165\u5fae\u4fe1\u516c\u4f17\u53f7\u6d88\u606f\u56de\u8c03" : "Receive WeChat official account callbacks",
      icon: <span style={{ fontSize: 22 }}>\u5fae</span>,
      fields: [
        { key: "app_id", label: "App ID" },
        { key: "app_secret", label: "App Secret", secret: true },
        { key: "token", label: "Token", secret: true },
      ],
      note: zh
        ? "\u652f\u6301 URL \u6821\u9a8c\uff0cXML \u6587\u672c\u6d88\u606f\u63a5\u6536\u548c\u88ab\u52a8\u56de\u590d\u3002"
        : "Supports URL verification, XML text messages, and passive replies.",
    },
  ];
}

function ChannelCard({ channel, config, onSaved, lang }: { channel: ChannelDef; config?: ChannelConfig; onSaved: (config: ChannelConfig) => void; lang: "zh" | "en" }) {
  const { colors } = useTheme();
  const { t } = useI18n();
  const [enabled, setEnabled] = useState(Boolean(channel.alwaysEnabled || config?.enabled));
  const [values, setValues] = useState<Record<string, string>>(config?.values ?? {});
  const [saving, setSaving] = useState(false);
  const [msgApi, contextHolder] = message.useMessage();

  useEffect(() => {
    setEnabled(Boolean(channel.alwaysEnabled || config?.enabled));
    setValues(config?.values ?? {});
  }, [channel.alwaysEnabled, config]);

  const callback = channel.id === "web" ? window.location.href : config?.callbackUrl || "";

  const cardStyle: React.CSSProperties = {
    background: colors.bgSecondary,
    border: `1px solid ${colors.border}`,
    borderRadius: 10,
    padding: "20px 24px",
  };

  const inputStyle: React.CSSProperties = {
    background: colors.bgPrimary,
    borderColor: colors.borderStrong,
    color: colors.textPrimary,
  };

  const labelStyle: React.CSSProperties = {
    color: colors.textSecondary,
    fontSize: 12,
    marginBottom: 4,
  };

  const runtimeStatus = channel.id === "web"
    ? (lang === "zh" ? "\u5df2\u63a5\u5165" : "Connected")
    : (lang === "zh" ? "Webhook \u5df2\u63a5\u5165" : "Webhook ready");

  const callbackLabel = channel.id === "web"
    ? (lang === "zh" ? "\u5f53\u524d\u5730\u5740" : "Current address")
    : (lang === "zh" ? "\u56de\u8c03\u5730\u5740" : "Callback URL");

  const copy = async (text: string) => {
    await navigator.clipboard.writeText(text);
    void msgApi.success(lang === "zh" ? "\u5df2\u590d\u5236" : "Copied.");
  };

  const handleSave = async () => {
    if (channel.id === "web") return;
    setSaving(true);
    try {
      const saved = await apiPost<ChannelConfig>(`/api/channels/${channel.id}`, { enabled, values });
      onSaved(saved);
      void msgApi.success(lang === "zh" ? "\u4fdd\u5b58\u6210\u529f" : "Saved successfully.");
    } catch (error) {
      void msgApi.error(error instanceof Error ? error.message : (lang === "zh" ? "\u4fdd\u5b58\u5931\u8d25" : "Save failed."));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={cardStyle}>
      {contextHolder}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          {channel.icon}
          <div>
            <div style={{ color: colors.textPrimary, fontWeight: 600 }}>{channel.name}</div>
            <div style={{ color: colors.textSecondary, fontSize: 12 }}>{channel.desc}</div>
          </div>
          <Tag color="green">{runtimeStatus}</Tag>
        </div>
        <Switch
          checked={enabled}
          onChange={channel.alwaysEnabled ? undefined : setEnabled}
          disabled={channel.alwaysEnabled}
        />
      </div>

      <div style={{ marginTop: 16 }}>
        <div style={labelStyle}>{callbackLabel}</div>
        <Input
          readOnly
          value={callback}
          style={inputStyle}
          suffix={
            <CopyOutlined
              style={{ color: colors.textMuted, cursor: "pointer" }}
              onClick={() => void copy(callback)}
            />
          }
        />
      </div>

      {channel.note && (
        <Alert type="info" showIcon message={channel.note} style={{ marginTop: 12 }} />
      )}

      {enabled && channel.fields.length > 0 && (
        <div style={{ marginTop: 16, display: "flex", flexDirection: "column", gap: 12 }}>
          {channel.fields.map((field) => {
            const InputControl = field.secret ? Input.Password : Input;
            return (
              <div key={field.key}>
                <div style={labelStyle}>{field.label}</div>
                <InputControl
                  style={inputStyle}
                  placeholder={field.label}
                  value={values[field.key] ?? ""}
                  onChange={(event) => setValues((current) => ({ ...current, [field.key]: event.target.value }))}
                />
              </div>
            );
          })}
          <Button type="primary" loading={saving} onClick={() => void handleSave()} style={{ alignSelf: "flex-end", marginTop: 4 }}>
            {t("save")}
          </Button>
        </div>
      )}
    </div>
  );
}

export const Channels: React.FC = () => {
  const { colors } = useTheme();
  const { lang } = useI18n();
  const [configs, setConfigs] = useState<Record<string, ChannelConfig>>({});

  useEffect(() => {
    void apiGet<ChannelConfig[]>("/api/channels").then((items) => {
      setConfigs(Object.fromEntries(items.map((item) => [item.id, item])));
    });
  }, []);

  const updateConfig = (config: ChannelConfig) => {
    setConfigs((current) => ({ ...current, [config.id]: config }));
  };

  const cards = useMemo(() => buildChannels(lang), [lang]);

  return (
    <div style={{ padding: "28px 32px", color: colors.textPrimary, background: colors.bgPrimary, minHeight: "100%" }}>
      <div style={{ fontSize: 18, fontWeight: 600, marginBottom: 24 }}>
        {lang === "zh" ? "\u6e20\u9053\u7ba1\u7406" : "Channel Management"}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(420px, 1fr))", gap: 20 }}>
        {cards.map((channel) => (
          <ChannelCard key={channel.id} channel={channel} config={configs[channel.id]} onSaved={updateConfig} lang={lang} />
        ))}
      </div>
    </div>
  );
};
