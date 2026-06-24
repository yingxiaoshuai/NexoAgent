import React, { useCallback, useEffect, useMemo, useState } from "react";
import { List, Button, Popconfirm, Empty, Typography, Space, Tag, Tabs, DatePicker, Input, Modal, message } from "antd";
import { ClearOutlined, ReloadOutlined, SearchOutlined } from "@ant-design/icons";
import dayjs, { type Dayjs } from "dayjs";
import { apiGet, apiDelete, apiPost } from "../../services/api";
import { useI18n } from "../../i18n";
import { useTheme } from "../../theme";
import { OverflowMenuButton } from "../Common/OverflowMenuButton";

const { Text } = Typography;

type MemoryKind = "daily" | "dream" | "script";

interface MemoryEntry {
  id: string;
  kind: MemoryKind;
  dayKey: string;
  content: string;
  sessionId: string;
  createdAt: string;
  updatedAt: string;
  key?: string;
  scope?: string;
  metadata?: Record<string, unknown>;
}

function dayToKey(day: Dayjs | null) {
  return day ? day.format("YYYYMMDD") : "";
}

export const MemoryPanel: React.FC = () => {
  const { colors } = useTheme();
  const { lang, t } = useI18n();
  const [kind, setKind] = useState<MemoryKind>("daily");
  const [day, setDay] = useState<Dayjs | null>(null);
  const [entries, setEntries] = useState<MemoryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [regenerating, setRegenerating] = useState(false);

  const ui = useMemo(() => ({
    allDates: lang === "zh" ? "\u5168\u90e8\u65e5\u671f" : "All dates",
    searchMemory: lang === "zh" ? "\u641c\u7d22\u8bb0\u5fc6" : "Search memory",
    regenerateDream: lang === "zh" ? "\u91cd\u65b0\u751f\u6210" : "Regenerate",
    clearCurrent: lang === "zh" ? "\u6e05\u7a7a" : "Clear",
    noMemory: lang === "zh" ? "\u8fd8\u6ca1\u6709\u8bb0\u5fc6" : "No memories yet",
    deleteConfirm: lang === "zh" ? "\u5220\u9664\u8fd9\u6761\u8bb0\u5fc6\uff1f" : "Delete this memory?",
    clearConfirm: (label: string) =>
      lang === "zh" ? `\u6e05\u7a7a\u5f53\u524d\u7b5b\u9009\u4e0b\u7684${label}\uff1f` : `Clear the current ${label} filter?`,
    dreamRegenerated: lang === "zh" ? "\u68a6\u5883\u5df2\u91cd\u65b0\u751f\u6210" : "Dream memory regenerated.",
    dreamGenerateFailed: lang === "zh" ? "\u68a6\u5883\u751f\u6210\u5931\u8d25" : "Failed to regenerate the dream memory.",
    dailyLabel: lang === "zh" ? "\u6bcf\u65e5\u8bb0\u5fc6" : "Daily",
    dailyDescription: lang === "zh"
      ? "\u6309\u81ea\u7136\u65e5\u6301\u4e45\u4fdd\u5b58\u5bf9\u8bdd\u4e2d\u62bd\u53d6\u7684\u4e8b\u5b9e\uff0c\u652f\u6301\u8de8\u4f1a\u8bdd\u53ec\u56de\u4e0e embedding \u68c0\u7d22\u3002"
      : "Conversation facts stored persistently by day for cross-session and embedding-backed recall.",
    dreamLabel: lang === "zh" ? "\u68a6\u5883\u8bb0\u5fc6" : "Dream",
    dreamDescription: lang === "zh"
      ? "\u628a\u6bcf\u65e5\u8bb0\u5fc6\u4e0e\u811a\u672c\u8bb0\u5fc6\u6574\u5408\u4e3a\u53ef\u6301\u4e45\u68c0\u7d22\u7684\u68a6\u5883\u8bb0\u5f55\uff0c\u5e2e\u52a9\u540e\u7eed\u8de8\u4f1a\u8bdd\u8fde\u63a5\u4e0a\u4e0b\u6587\u3002"
      : "Persistent synthesized summaries built from daily and script memories for future cross-session recall.",
    scriptLabel: lang === "zh" ? "\u811a\u672c\u8bb0\u5fc6" : "Script",
    scriptDescription: lang === "zh"
      ? "\u6301\u4e45\u4fdd\u5b58\u6d41\u7a0b\u8fd0\u884c\u72b6\u6001\u548c\u5173\u952e\u6570\u636e\uff0c\u4fdd\u8bc1\u811a\u672c\u5728\u4e0d\u540c\u4f1a\u8bdd\u4e2d\u4e5f\u80fd\u7eed\u7528\u3002"
      : "Persistent workflow state and keyed data that remain reusable across sessions.",
  }), [lang]);

  const kindMeta: Record<MemoryKind, { label: string; description: string; color: string }> = useMemo(
    () => ({
      daily: { label: ui.dailyLabel, description: ui.dailyDescription, color: "green" },
      dream: { label: ui.dreamLabel, description: ui.dreamDescription, color: "magenta" },
      script: { label: ui.scriptLabel, description: ui.scriptDescription, color: "purple" },
    }),
    [ui],
  );

  const memoryTabs = (Object.keys(kindMeta) as MemoryKind[]).map((key) => ({
    key,
    label: kindMeta[key].label,
  }));

  const dayKey = useMemo(() => dayToKey(day), [day]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ kind });
      if (dayKey) params.set("dayKey", dayKey);
      const data = await apiGet<MemoryEntry[]>(`/api/memory?${params.toString()}`);
      setEntries(data);
    } finally {
      setLoading(false);
    }
  }, [dayKey, kind]);

  useEffect(() => {
    void load();
  }, [load]);

  const del = async (id: string) => {
    await apiDelete(`/api/memory/${id}`);
    setEntries((current) => current.filter((item) => item.id !== id));
  };

  const confirmDelete = (item: MemoryEntry) => {
    Modal.confirm({
      title: ui.deleteConfirm,
      okText: t("delete"),
      cancelText: t("cancel"),
      okButtonProps: { danger: true },
      onOk: async () => {
        await del(item.id);
      },
    });
  };

  const clearAll = async () => {
    const params = new URLSearchParams({ kind });
    if (dayKey) params.set("dayKey", dayKey);
    await apiDelete(`/api/memory?${params.toString()}`);
    setEntries([]);
  };

  const runSearch = async () => {
    if (!query.trim()) {
      await load();
      return;
    }
    setSearching(true);
    try {
      const params = new URLSearchParams({ query: query.trim(), kinds: kind, k: "20" });
      if (dayKey) params.set("dayKey", dayKey);
      const data = await apiGet<MemoryEntry[]>(`/api/memory/search?${params.toString()}`);
      setEntries(data);
    } finally {
      setSearching(false);
    }
  };

  const regenerateDream = async () => {
    if (!dayKey) return;
    setRegenerating(true);
    try {
      await apiPost(`/api/memory/dream/${dayKey}/regenerate`, {});
      message.success(ui.dreamRegenerated);
      setKind("dream");
      await load();
    } catch (error) {
      message.warning(error instanceof Error ? error.message : ui.dreamGenerateFailed);
    } finally {
      setRegenerating(false);
    }
  };

  const meta = kindMeta[kind];
  const groupedEntries = useMemo(() => {
    const groups = new Map<string, MemoryEntry[]>();
    for (const entry of entries) {
      const group = groups.get(entry.dayKey) ?? [];
      group.push(entry);
      groups.set(entry.dayKey, group);
    }
    return Array.from(groups.entries()).sort(([a], [b]) => b.localeCompare(a));
  }, [entries]);

  return (
    <div style={{ padding: "24px 32px", maxWidth: 980, color: colors.textPrimary }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 16 }}>
        <Space size={8} wrap>
          <DatePicker value={day} onChange={setDay} allowClear format="YYYY-MM-DD" placeholder={ui.allDates} />
          <Input.Search
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onSearch={() => void runSearch()}
            placeholder={ui.searchMemory}
            loading={searching}
            enterButton={<SearchOutlined />}
            style={{ width: 260 }}
          />
          {kind === "dream" && dayKey && (
            <Button icon={<ReloadOutlined />} loading={regenerating} onClick={() => void regenerateDream()}>
              {ui.regenerateDream}
            </Button>
          )}
        </Space>
        {entries.length > 0 && (
          <Popconfirm
            title={ui.clearConfirm(meta.label)}
            onConfirm={() => void clearAll()}
            okText={ui.clearCurrent}
            cancelText={t("cancel")}
          >
            <Button icon={<ClearOutlined />} size="small" danger>
              {ui.clearCurrent}
            </Button>
          </Popconfirm>
        )}
      </div>

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
        <span style={{ fontSize: 18, fontWeight: 600, color: colors.textPrimary }}>
          {meta.label}
          <Tag color={meta.color} style={{ marginLeft: 8, fontSize: 12 }}>
            {entries.length}
          </Tag>
        </span>
        <Tag color="default">{dayKey || ui.allDates}</Tag>
      </div>

      <Tabs activeKey={kind} onChange={(key) => setKind(key as MemoryKind)} items={memoryTabs} />

      <Text style={{ color: colors.textSecondary, fontSize: 13, display: "block", marginBottom: 16 }}>
        {meta.description}
      </Text>

      {entries.length === 0 && !loading ? (
        <Empty description={<span style={{ color: colors.textSecondary }}>{ui.noMemory}</span>} />
      ) : (
        <div>
          {loading ? (
            <List loading />
          ) : groupedEntries.map(([groupDay, groupItems]) => (
            <div key={groupDay} style={{ marginBottom: 18 }}>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  marginBottom: 6,
                  paddingBottom: 6,
                  borderBottom: `1px solid ${colors.border}`,
                }}
              >
                <Tag color="default">{dayjs(groupDay, "YYYYMMDD").format("YYYY-MM-DD")}</Tag>
                <Text style={{ color: colors.textSecondary, fontSize: 12 }}>{t("itemCount", { count: groupItems.length })}</Text>
              </div>
              <List
                dataSource={groupItems}
                renderItem={(item) => (
                  <List.Item
                    style={{ borderBottom: `1px solid ${colors.border}`, padding: "12px 0" }}
                    actions={[
                      <OverflowMenuButton
                        key="more"
                        color={colors.textMuted}
                        items={[{ key: "delete", label: t("delete"), danger: true }]}
                        onItemClick={(key) => {
                          if (key === "delete") confirmDelete(item);
                        }}
                      />,
                    ]}
                  >
                    <Space direction="vertical" size={4} style={{ flex: 1 }}>
                      <Space size={6} wrap>
                        <Tag color={kindMeta[item.kind].color}>{kindMeta[item.kind].label}</Tag>
                        <Tag color="default">{item.dayKey}</Tag>
                        {item.key && <Tag color="default">{item.key}</Tag>}
                        {item.scope && <Tag color="geekblue">{item.scope}</Tag>}
                      </Space>
                      <Text style={{ color: colors.textPrimary }}>{item.content}</Text>
                      <Text style={{ color: colors.textSecondary, fontSize: 12 }}>
                        {new Date(item.updatedAt || item.createdAt).toLocaleString()}
                      </Text>
                    </Space>
                  </List.Item>
                )}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
