import React, { useEffect, useState } from "react";
import { Button, Input, Modal, Tooltip, Typography } from "antd";
import { PlusOutlined, MenuUnfoldOutlined, MenuFoldOutlined, CheckOutlined } from "@ant-design/icons";
import { OverflowMenuButton } from "../Common/OverflowMenuButton";
import { useChatStore, type SessionMeta } from "../../store/chat";
import { useTheme } from "../../theme";
import { useI18n } from "../../i18n";

const { Text } = Typography;

const SessionItem: React.FC<{ session: SessionMeta; active: boolean }> = ({ session, active }) => {
  const { selectSession, deleteSession, renameSession } = useChatStore();
  const { colors } = useTheme();
  const { t } = useI18n();
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(session.title);

  useEffect(() => {
    setTitle(session.title);
  }, [session.title]);

  const confirmRename = () => {
    if (title.trim()) void renameSession(session.id, title.trim());
    setEditing(false);
  };

  const openActionMenu = (key: string) => {
    if (key === "rename") {
      setTitle(session.title);
      setEditing(true);
      return;
    }

    if (key === "delete") {
      Modal.confirm({
        title: `${t("delete")}?`,
        okText: t("delete"),
        cancelText: t("cancel"),
        okButtonProps: { danger: true },
        onOk: async () => {
          await deleteSession(session.id);
        },
      });
    }
  };

  return (
    <div
      className="session-row"
      onClick={() => !editing && void selectSession(session.id)}
      style={{
        display: "flex", alignItems: "center", gap: 6, padding: "8px 10px",
        borderRadius: 8, cursor: "pointer", marginBottom: 2,
        background: active ? colors.bgTertiary : "transparent",
        transition: "background 0.15s",
      }}
      onMouseEnter={(e) => { if (!active) (e.currentTarget as HTMLDivElement).style.background = colors.hoverBg; }}
      onMouseLeave={(e) => { if (!active) (e.currentTarget as HTMLDivElement).style.background = "transparent"; }}
    >
      {editing ? (
        <>
          <Input
            size="small"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onPressEnter={confirmRename}
            autoFocus
            style={{
              flex: 1,
              background: colors.bgPrimary,
              color: colors.textPrimary,
              border: `1px solid ${colors.borderStrong}`,
            }}
          />
          <Button size="small" type="text" icon={<CheckOutlined />} onClick={confirmRename} style={{ color: colors.textMuted }} />
        </>
      ) : (
        <>
          <Text
            ellipsis style={{ flex: 1, color: active ? colors.textPrimary : colors.textMuted, fontSize: 13 }}
          >
            {session.title}
          </Text>
          <div style={{ display: "flex", gap: 2, opacity: 1 }} className="session-actions">
            <OverflowMenuButton
              color={colors.textSecondary}
              items={[
                { key: "rename", label: t("rename") },
                { key: "delete", label: t("delete"), danger: true },
              ]}
              onItemClick={openActionMenu}
            />
          </div>
        </>
      )}
    </div>
  );
};

interface SessionListProps {
  collapsed: boolean;
  onToggleWidth: () => void;
}

export const SessionList: React.FC<SessionListProps> = ({ collapsed, onToggleWidth }) => {
  const { sessions, activeSessionId, newSession } = useChatStore();
  const { colors } = useTheme();
  const { lang, t } = useI18n();

  const widthTooltip = collapsed
    ? (lang === "zh" ? "展开历史记录" : "Expand history")
    : (lang === "zh" ? "折叠历史记录" : "Collapse history");

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <div
        style={{
          padding: collapsed ? "12px 10px" : "12px 10px 8px",
          display: "flex",
          gap: 8,
          flexDirection: collapsed ? "column" : "row",
        }}
      >
        {!collapsed && (
          <Button
            icon={<PlusOutlined />}
            onClick={() => void newSession()}
            style={{
              flex: 1,
              background: colors.bgTertiary,
              color: colors.textMuted,
              border: `1px solid ${colors.borderStrong}`,
              borderRadius: 8,
            }}
          >
            {t("newChat")}
          </Button>
        )}
        <Tooltip title={widthTooltip}>
          <Button
            onClick={onToggleWidth}
            style={{
              width: collapsed ? "100%" : 40,
              flexShrink: 0,
              background: colors.bgTertiary,
              color: colors.textMuted,
              border: `1px solid ${colors.borderStrong}`,
              borderRadius: 8,
            }}
            icon={collapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
          />
        </Tooltip>
      </div>
      {!collapsed && (
        <div style={{ flex: 1, overflowY: "auto", padding: "0 6px" }}>
          {sessions.map((s) => (
            <SessionItem key={s.id} session={s} active={s.id === activeSessionId} />
          ))}
        </div>
      )}
    </div>
  );
};
