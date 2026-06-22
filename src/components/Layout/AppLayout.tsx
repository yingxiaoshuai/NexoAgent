import React, { useEffect, useState } from "react";
import { Badge, Divider, Layout, Tooltip } from "antd";
import {
  ApiOutlined,
  BookOutlined,
  ClockCircleOutlined,
  DatabaseOutlined,
  FileTextOutlined,
  GlobalOutlined,
  MessageOutlined,
  MoonOutlined,
  SettingOutlined,
  SunOutlined,
  ThunderboltOutlined,
  ToolOutlined,
} from "@ant-design/icons";
import { SessionList } from "../SessionList";
import { ChatPanel } from "../ChatPanel";
import { MemoryPanel } from "../Memory";
import Knowledge from "../Knowledge";
import Tools from "../Tools";
import Skills from "../Skills";
import Tasks from "../Tasks";
import Logs from "../Logs";
import { Channels } from "../Channels";
import { Settings } from "../Settings";
import { useChatStore } from "../../store/chat";
import { useTheme } from "../../theme";
import { useI18n } from "../../i18n";

const { Content, Sider } = Layout;
const brandIconUrl = new URL("../../../assets/nexoagent-icon.svg", import.meta.url).href;

type View = "chat" | "memory" | "knowledge" | "tools" | "skills" | "tasks" | "logs" | "channels" | "settings";

export const AppLayout: React.FC = () => {
  const [view, setView] = useState<View>("chat");
  const { ensureRuntimeReady, loadSessions, newSession, loadSettings } = useChatStore();
  const { mode, colors, toggleTheme } = useTheme();
  const { lang, setLang, t } = useI18n();

  useEffect(() => {
    let disposed = false;
    let refreshTimer: number | undefined;

    void (async () => {
      await ensureRuntimeReady();
      if (disposed) return;
      await loadSessions();
      const sessions = useChatStore.getState().sessions;
      if (disposed) return;
      if (sessions.length === 0) {
        await newSession();
      } else {
        await useChatStore.getState().selectSession(sessions[0].id);
      }

      void loadSettings().catch((error) => {
        console.warn("[app] settings load failed:", error);
      });

      refreshTimer = window.setInterval(() => {
        void useChatStore.getState().loadSessions();
      }, 5000);
    })();

    return () => {
      disposed = true;
      if (refreshTimer !== undefined) {
        window.clearInterval(refreshTimer);
      }
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const iconButtonStyle = (active: boolean): React.CSSProperties => ({
    width: 36,
    height: 36,
    borderRadius: 10,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    cursor: "pointer",
    fontSize: 18,
    color: active ? colors.textPrimary : colors.textSecondary,
    background: active ? colors.bgTertiary : "transparent",
    transition: "all 0.15s",
  });

  const navItem = (targetView: View, icon: React.ReactNode, label: string) => (
    <Tooltip title={label} placement="right" key={targetView}>
      <div onClick={() => setView(targetView)} style={iconButtonStyle(view === targetView)}>
        {icon}
      </div>
    </Tooltip>
  );

  return (
    <Layout style={{ height: "100vh", background: colors.bgPrimary }}>
      <Sider width={52} style={{ background: colors.bgSecondary, borderRight: `1px solid ${colors.border}` }}>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", padding: "12px 0", gap: 4, height: "100%" }}>
          <img
            src={brandIconUrl}
            alt="NexoAgent"
            style={{ width: 22, height: 22, marginBottom: 16, display: "block", borderRadius: 6 }}
          />

          {navItem("chat", <MessageOutlined />, t("chat"))}

          <Divider style={{ margin: "4px 0", borderColor: colors.border, minWidth: 36, width: 36 }} />

          {navItem("memory", <DatabaseOutlined />, t("memory"))}
          {navItem("knowledge", <BookOutlined />, t("knowledge"))}
          {navItem("tools", <ToolOutlined />, t("tools"))}
          {navItem("skills", <ThunderboltOutlined />, t("skills"))}

          <Divider style={{ margin: "4px 0", borderColor: colors.border, minWidth: 36, width: 36 }} />

          {navItem("tasks", <ClockCircleOutlined />, t("tasks"))}
          {navItem("logs", <FileTextOutlined />, t("logs"))}
          {navItem("channels", <ApiOutlined />, t("channels"))}

          <div style={{ flex: 1 }} />

          <Tooltip title={lang === "zh" ? "Switch to English" : "切换到中文"} placement="right">
            <div onClick={() => setLang(lang === "zh" ? "en" : "zh")} style={{ ...iconButtonStyle(false), fontSize: 11, fontWeight: 600 }}>
              {lang === "zh" ? "EN" : "中"}
            </div>
          </Tooltip>

          <Tooltip title={mode === "dark" ? "Light mode" : "Dark mode"} placement="right">
            <div onClick={toggleTheme} style={iconButtonStyle(false)}>
              {mode === "dark" ? <SunOutlined /> : <MoonOutlined />}
            </div>
          </Tooltip>

          {navItem("settings", <SettingOutlined />, t("settings"))}

          <Tooltip title="localhost:9898" placement="right">
            <Badge dot status="success">
              <div style={iconButtonStyle(false)}>
                <GlobalOutlined />
              </div>
            </Badge>
          </Tooltip>
        </div>
      </Sider>

      {view === "chat" && (
        <Sider width={220} style={{ background: colors.bgSecondary, borderRight: `1px solid ${colors.border}`, overflow: "hidden" }}>
          <SessionList />
        </Sider>
      )}

      <Content style={{ display: "flex", flexDirection: "column", overflow: "auto", background: colors.bgPrimary }}>
        {view === "chat" && <ChatPanel />}
        {view === "memory" && <MemoryPanel />}
        {view === "knowledge" && <Knowledge />}
        {view === "tools" && <Tools />}
        {view === "skills" && <Skills />}
        {view === "tasks" && <Tasks />}
        {view === "logs" && <Logs />}
        {view === "channels" && <Channels />}
        {view === "settings" && <Settings />}
      </Content>
    </Layout>
  );
};
