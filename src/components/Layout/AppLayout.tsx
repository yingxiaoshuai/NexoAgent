import React, { useEffect, useRef, useState } from "react";
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
import { getApiBase, isElectron } from "../../services/api";

const { Content, Sider } = Layout;
const brandIconUrl = new URL("../../../assets/nexoagent-icon.svg", import.meta.url).href;
const COLLAPSED_SESSION_SIDER_WIDTH = 60;
const MIN_SESSION_SIDER_WIDTH = 220;
const DEFAULT_SESSION_SIDER_WIDTH = 280;
const MAX_SESSION_SIDER_WIDTH = 520;
const DEFAULT_EXPANDED_SESSION_SIDER_WIDTH = 340;

type View = "chat" | "memory" | "knowledge" | "tools" | "skills" | "tasks" | "logs" | "channels" | "settings";

export const AppLayout: React.FC = () => {
  const [view, setView] = useState<View>("chat");
  const [sessionSiderCollapsed, setSessionSiderCollapsed] = useState(() => localStorage.getItem("nexo-session-sider-collapsed") === "true");
  const [sessionSiderWidth, setSessionSiderWidth] = useState(() => {
    const saved = Number(localStorage.getItem("nexo-session-sider-width"));
    return Number.isFinite(saved) ? Math.min(MAX_SESSION_SIDER_WIDTH, Math.max(MIN_SESSION_SIDER_WIDTH, saved)) : DEFAULT_SESSION_SIDER_WIDTH;
  });
  const [preferredExpandedWidth, setPreferredExpandedWidth] = useState(() => {
    const saved = Number(localStorage.getItem("nexo-session-sider-expanded-width"));
    return Number.isFinite(saved) ? Math.min(MAX_SESSION_SIDER_WIDTH, Math.max(MIN_SESSION_SIDER_WIDTH, saved)) : DEFAULT_EXPANDED_SESSION_SIDER_WIDTH;
  });
  const [resizingSessionSider, setResizingSessionSider] = useState(false);
  const { ensureRuntimeReady, loadSessions, newSession, loadSettings } = useChatStore();
  const { mode, colors, toggleTheme } = useTheme();
  const { lang, setLang, t } = useI18n();
  const resizeOriginRef = useRef<{ startX: number; startWidth: number } | null>(null);
  const desktopApi = typeof window !== "undefined" && "nexoDesktop" in window
    ? (window as typeof window & { nexoDesktop?: { openExternal?: (url: string) => Promise<void> } }).nexoDesktop
    : undefined;

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

  useEffect(() => {
    localStorage.setItem("nexo-session-sider-collapsed", String(sessionSiderCollapsed));
  }, [sessionSiderCollapsed]);

  useEffect(() => {
    localStorage.setItem("nexo-session-sider-width", String(sessionSiderWidth));
  }, [sessionSiderWidth]);

  useEffect(() => {
    localStorage.setItem("nexo-session-sider-expanded-width", String(preferredExpandedWidth));
  }, [preferredExpandedWidth]);

  useEffect(() => {
    if (!resizingSessionSider) return undefined;

    const previousCursor = document.body.style.cursor;
    const previousUserSelect = document.body.style.userSelect;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";

    const handlePointerMove = (event: MouseEvent) => {
      const origin = resizeOriginRef.current;
      if (!origin) return;
      const nextWidth = Math.min(
        MAX_SESSION_SIDER_WIDTH,
        Math.max(MIN_SESSION_SIDER_WIDTH, origin.startWidth + (event.clientX - origin.startX))
      );
      setSessionSiderWidth(nextWidth);
      if (nextWidth > MIN_SESSION_SIDER_WIDTH) {
        setPreferredExpandedWidth(nextWidth);
      }
    };

    const stopResize = () => {
      resizeOriginRef.current = null;
      setResizingSessionSider(false);
      document.body.style.cursor = previousCursor;
      document.body.style.userSelect = previousUserSelect;
    };

    window.addEventListener("mousemove", handlePointerMove);
    window.addEventListener("mouseup", stopResize);

    return () => {
      window.removeEventListener("mousemove", handlePointerMove);
      window.removeEventListener("mouseup", stopResize);
      document.body.style.cursor = previousCursor;
      document.body.style.userSelect = previousUserSelect;
    };
  }, [resizingSessionSider]);

  const toggleSessionSiderWidth = () => {
    setSessionSiderCollapsed((current) => !current);
  };

  const startSessionResize = (event: React.MouseEvent<HTMLDivElement>) => {
    if (sessionSiderCollapsed) return;
    event.preventDefault();
    resizeOriginRef.current = { startX: event.clientX, startWidth: sessionSiderWidth };
    setResizingSessionSider(true);
  };

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

  const openWebConsole = async () => {
    const targetUrl = getApiBase() || "http://localhost:9898";
    if (isElectron() && desktopApi?.openExternal) {
      await desktopApi.openExternal(targetUrl);
      return;
    }
    window.open(targetUrl, "_blank", "noopener,noreferrer");
  };

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

          <Tooltip title="打开浏览器" placement="right">
            <Badge dot status="success">
              <div onClick={() => void openWebConsole()} style={iconButtonStyle(false)}>
                <GlobalOutlined />
              </div>
            </Badge>
          </Tooltip>
        </div>
      </Sider>

      {view === "chat" && (
        <>
          <Sider
            width={sessionSiderCollapsed ? COLLAPSED_SESSION_SIDER_WIDTH : sessionSiderWidth}
            style={{ background: colors.bgSecondary, borderRight: `1px solid ${colors.border}`, overflow: "hidden" }}
          >
            <SessionList
              collapsed={sessionSiderCollapsed}
              onToggleWidth={toggleSessionSiderWidth}
            />
          </Sider>
          {!sessionSiderCollapsed && (
            <div
              onMouseDown={startSessionResize}
              style={{
                width: 10,
                cursor: "col-resize",
                background: resizingSessionSider ? colors.accent : colors.bgPrimary,
                borderRight: `1px solid ${colors.border}`,
                transition: resizingSessionSider ? "none" : "background 0.15s",
                flexShrink: 0,
              }}
            />
          )}
        </>
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
