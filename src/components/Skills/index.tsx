import { useEffect, useMemo, useState } from "react";
import {
  Alert,
  Button,
  Empty,
  List,
  Space,
  Tag,
  Typography,
  message,
} from "antd";
import { ReloadOutlined, ThunderboltOutlined } from "@ant-design/icons";
import type { SkillDefinition } from "../../shared/types";
import { apiDelete, apiGet, apiPost } from "../../services/api";
import { useI18n } from "../../i18n";
import { useTheme } from "../../theme";
import { OverflowMenuButton } from "../Common/OverflowMenuButton";

const { Title, Text, Paragraph } = Typography;

interface SkillItem extends SkillDefinition {
  instruction: string;
}

function sourceLabel(skill: SkillItem) {
  if (skill.source === "built-in") return "builtIn";
  if (skill.source === "marketplace") return skill.marketplaceName || "Marketplace";
  return skill.managed ? "managed" : "discovered";
}

export default function Skills() {
  const { colors } = useTheme();
  const { t } = useI18n();
  const [skills, setSkills] = useState<SkillItem[]>([]);
  const [loading, setLoading] = useState(false);

  const sectionStyle = useMemo<React.CSSProperties>(
    () => ({
      background: colors.bgSecondary,
      border: `1px solid ${colors.border}`,
      borderRadius: 8,
      padding: 20,
    }),
    [colors],
  );

  const loadAll = async () => {
    setLoading(true);
    try {
      setSkills(await apiGet<SkillItem[]>("/api/skills"));
    } catch (error) {
      void message.error(error instanceof Error ? error.message : String(error));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadAll();
  }, []);

  const toggleSkill = async (skill: SkillItem, enabled: boolean) => {
    try {
      await apiPost("/api/skills/toggle", { key: skill.key, enabled });
      setSkills((current) => current.map((item) => (item.key === skill.key ? { ...item, enabled } : item)));
    } catch (error) {
      void message.error(error instanceof Error ? error.message : String(error));
    }
  };

  const removeSkill = async (skill: SkillItem) => {
    if (skill.source === "built-in") {
      void message.warning(t("builtInCannotDelete"));
      return;
    }
    try {
      await apiDelete(`/api/skills/${skill.key}`);
      setSkills((current) => current.filter((item) => item.key !== skill.key));
    } catch (error) {
      void message.error(error instanceof Error ? error.message : String(error));
    }
  };

  const summary = useMemo(() => ({
    total: skills.length,
    enabled: skills.filter((skill) => skill.enabled).length,
    managed: skills.filter((skill) => skill.managed).length,
  }), [skills]);

  const renderSkillList = (items: SkillItem[], emptyText: string) => (
    items.length === 0 ? (
      <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={emptyText} />
    ) : (
      <List
        dataSource={items}
        renderItem={(skill) => (
          <List.Item
            style={{ borderColor: colors.border, paddingInline: 0 }}
            actions={[
              <OverflowMenuButton
                key="more"
                color={colors.textSecondary}
                items={[
                  { key: "toggle", label: skill.enabled ? t("disabled") : t("enabled") },
                  ...(skill.source !== "built-in"
                    ? [{ key: "delete", label: t("removeSkill"), danger: skill.managed }]
                    : []),
                ]}
                onItemClick={(key) => {
                  if (key === "toggle") {
                    void toggleSkill(skill, !skill.enabled);
                    return;
                  }
                  if (key === "delete") {
                    void removeSkill(skill);
                  }
                }}
              />,
            ]}
          >
            <List.Item.Meta
              avatar={<ThunderboltOutlined style={{ color: colors.accent, fontSize: 18, marginTop: 4 }} />}
              title={(
                <Space size={8} wrap>
                  <span style={{ color: colors.textPrimary, fontWeight: 600 }}>{skill.name}</span>
                  <Tag color={skill.enabled ? "green" : "default"}>{skill.enabled ? t("enabled") : t("disabled")}</Tag>
                  <Tag color="blue">{skill.category}</Tag>
                  <Tag color={skill.source === "built-in" ? "gold" : skill.source === "marketplace" ? "purple" : "cyan"}>
                    {sourceLabel(skill) === "builtIn" || sourceLabel(skill) === "managed" || sourceLabel(skill) === "discovered"
                      ? t(sourceLabel(skill) as "builtIn" | "managed" | "discovered")
                      : sourceLabel(skill)}
                  </Tag>
                </Space>
              )}
              description={(
                <Space direction="vertical" size={4} style={{ display: "flex" }}>
                  <Text style={{ color: colors.textPrimary }}>{skill.description}</Text>
                  {skill.path && (
                    <Paragraph style={{ color: colors.textMuted, marginBottom: 0 }} ellipsis={{ rows: 1 }}>
                      {skill.path}
                    </Paragraph>
                  )}
                  <Paragraph
                    style={{ color: colors.textMuted, marginBottom: 0 }}
                    ellipsis={{ rows: 2, expandable: true, symbol: "More" }}
                  >
                    {skill.instruction}
                  </Paragraph>
                </Space>
              )}
            />
          </List.Item>
        )}
      />
    )
  );

  const managedSkills = useMemo(
    () => skills.filter((skill) => skill.managed).sort((left, right) => Number(right.enabled) - Number(left.enabled) || left.name.localeCompare(right.name)),
    [skills],
  );
  const discoveredSkills = useMemo(
    () => skills.filter((skill) => !skill.managed && skill.source !== "built-in").sort((left, right) => Number(right.enabled) - Number(left.enabled) || left.name.localeCompare(right.name)),
    [skills],
  );
  const builtInSkills = useMemo(
    () => skills.filter((skill) => skill.source === "built-in").sort((left, right) => Number(right.enabled) - Number(left.enabled) || left.name.localeCompare(right.name)),
    [skills],
  );

  return (
    <div style={{ background: colors.bgPrimary, minHeight: "100%", padding: 24, color: colors.textPrimary }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16, marginBottom: 20 }}>
        <div>
          <Title level={4} style={{ color: colors.textPrimary, margin: 0 }}>
            {t("skills")}
          </Title>
          <Text style={{ color: colors.textMuted }}>
            {t("skillsSubtitle")}
          </Text>
        </div>
        <Button icon={<ReloadOutlined />} onClick={() => void loadAll()} loading={loading}>
          {t("refresh")}
        </Button>
      </div>

      <Space wrap size={12} style={{ marginBottom: 20 }}>
        <div style={{ minWidth: 140, padding: "12px 14px", borderRadius: 8, background: colors.bgSecondary, border: `1px solid ${colors.border}` }}>
          <Text style={{ color: colors.textMuted }}>{t("loaded")}</Text>
          <div style={{ fontSize: 24, fontWeight: 700, color: colors.textPrimary }}>{summary.total}</div>
        </div>
        <div style={{ minWidth: 140, padding: "12px 14px", borderRadius: 8, background: colors.bgSecondary, border: `1px solid ${colors.border}` }}>
          <Text style={{ color: colors.textMuted }}>{t("enabled")}</Text>
          <div style={{ fontSize: 24, fontWeight: 700, color: colors.textPrimary }}>{summary.enabled}</div>
        </div>
        <div style={{ minWidth: 140, padding: "12px 14px", borderRadius: 8, background: colors.bgSecondary, border: `1px solid ${colors.border}` }}>
          <Text style={{ color: colors.textMuted }}>{t("managed")}</Text>
          <div style={{ fontSize: 24, fontWeight: 700, color: colors.textPrimary }}>{summary.managed}</div>
        </div>
      </Space>

      <Space direction="vertical" size={16} style={{ display: "flex" }}>
        <Alert
          type="info"
          showIcon
          message={t("skillsInjected")}
        />

        <div style={sectionStyle}>
          <Title level={5} style={{ color: colors.textPrimary, marginTop: 0 }}>
            {t("managedSkills")}
          </Title>
          {renderSkillList(managedSkills, t("noManagedSkills"))}
        </div>

        <div style={sectionStyle}>
          <Title level={5} style={{ color: colors.textPrimary, marginTop: 0 }}>
            {t("workspaceDiscoveries")}
          </Title>
          {renderSkillList(discoveredSkills, t("noDiscoveredSkills"))}
        </div>

        <div style={sectionStyle}>
          <Title level={5} style={{ color: colors.textPrimary, marginTop: 0 }}>
            {t("builtInPresets")}
          </Title>
          {renderSkillList(builtInSkills, t("noBuiltInSkills"))}
        </div>
      </Space>
    </div>
  );
}
