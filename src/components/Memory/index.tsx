import React, { useCallback, useEffect, useMemo, useState } from "react";
import { List, Button, Popconfirm, Empty, Typography, Space, Tag, Tabs, DatePicker, Input, Modal, message } from "antd";
import { ClearOutlined, ReloadOutlined, SearchOutlined } from "@ant-design/icons";
import dayjs, { type Dayjs } from "dayjs";
import { apiGet, apiDelete, apiPost } from "../../services/api";
import { useTheme } from "../../theme";
import { OverflowMenuButton } from "../Common/OverflowMenuButton";

const { Text } = Typography;

type MemoryKind = "daily" | "dream" | "long_term" | "script";

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

const KIND_META: Record<MemoryKind, { label: string; description: string; color: string }> = {
  daily: {
    label: "每日记忆",
    description: "按自然日保存对话中抽取的事实，作为梦境整合和召回的基础。",
    color: "green",
  },
  dream: {
    label: "梦境记忆",
    description: "把某一天的记忆汇总成可召回的梦境记录，帮助后续回答连接上下文。",
    color: "magenta",
  },
  long_term: {
    label: "长期记忆",
    description: "保存跨对话仍然有效的事实，并参与语义召回。",
    color: "blue",
  },
  script: {
    label: "脚本记忆",
    description: "保存流程运行状态和关键数据，保证脚本多次运行时结果一致。",
    color: "purple",
  },
};

const MEMORY_TABS = (Object.keys(KIND_META) as MemoryKind[]).map((key) => ({
  key,
  label: KIND_META[key].label,
}));

function dayToKey(day: Dayjs | null) {
  return day ? day.format("YYYYMMDD") : "";
}

export const MemoryPanel: React.FC = () => {
  const { colors } = useTheme();
  const [kind, setKind] = useState<MemoryKind>("daily");
  const [day, setDay] = useState<Dayjs | null>(null);
  const [entries, setEntries] = useState<MemoryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [regenerating, setRegenerating] = useState(false);

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
      title: "删除这条记忆？",
      okText: "删除",
      cancelText: "取消",
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
      message.success("梦境已重新生成");
      setKind("dream");
      await load();
    } catch (error) {
      message.warning(error instanceof Error ? error.message : "梦境生成失败");
    } finally {
      setRegenerating(false);
    }
  };

  const meta = KIND_META[kind];
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
          <DatePicker value={day} onChange={setDay} allowClear format="YYYY-MM-DD" placeholder="全部日期" />
          <Input.Search
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onSearch={() => void runSearch()}
            placeholder="搜索记忆"
            loading={searching}
            enterButton={<SearchOutlined />}
            style={{ width: 260 }}
          />
          {kind === "dream" && dayKey && (
            <Button icon={<ReloadOutlined />} loading={regenerating} onClick={() => void regenerateDream()}>
              重新生成
            </Button>
          )}
        </Space>
        {entries.length > 0 && (
          <Popconfirm
            title={`清空当前筛选下的${meta.label}？`}
            onConfirm={() => void clearAll()}
            okText="清空"
            cancelText="取消"
          >
            <Button icon={<ClearOutlined />} size="small" danger>
              清空
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
        <Tag color="default">{dayKey || "全部日期"}</Tag>
      </div>

      <Tabs activeKey={kind} onChange={(key) => setKind(key as MemoryKind)} items={MEMORY_TABS} />

      <Text style={{ color: colors.textSecondary, fontSize: 13, display: "block", marginBottom: 16 }}>
        {meta.description}
      </Text>

      {entries.length === 0 && !loading ? (
        <Empty description={<span style={{ color: colors.textSecondary }}>还没有记忆</span>} />
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
                <Text style={{ color: colors.textSecondary, fontSize: 12 }}>{groupItems.length} 条</Text>
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
                        items={[{ key: "delete", label: "删除", danger: true }]}
                        onItemClick={(key) => {
                          if (key === "delete") confirmDelete(item);
                        }}
                      />,
                    ]}
                  >
                    <Space direction="vertical" size={4} style={{ flex: 1 }}>
                      <Space size={6} wrap>
                        <Tag color={KIND_META[item.kind].color}>{KIND_META[item.kind].label}</Tag>
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
