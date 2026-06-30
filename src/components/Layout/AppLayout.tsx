import React, { useEffect, useRef, useState } from "react";
import { Badge, Divider, Layout, Tooltip } from "antd";
import {
  ApiOutlined,
  BookOutlined,
  BorderOutlined,
  CloseOutlined,
  ClockCircleOutlined,
  CopyOutlined,
  DatabaseOutlined,
  FileTextOutlined,
  GlobalOutlined,
  MessageOutlined,
  MinusOutlined,
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
import BrowserWorkbench from "../BrowserWorkbench";
import { useChatStore } from "../../store/chat";
import { useTheme } from "../../theme";
import { useI18n } from "../../i18n";
import { getApiBase, isElectron } from "../../services/api";

const { Content, Sider } = Layout;
const brandIconUrl = new URL("../../../assets/nexoagent-icon-32.png", import.meta.url).href;
const DESKTOP_DRAG_BAR_HEIGHT = 44;
const COLLAPSED_SESSION_SIDER_WIDTH = 60;
const MIN_SESSION_SIDER_WIDTH = 220;
const DEFAULT_SESSION_SIDER_WIDTH = 280;
const MAX_SESSION_SIDER_WIDTH = 520;
const DEFAULT_EXPANDED_SESSION_SIDER_WIDTH = 340;

type View = "chat" | "browser" | "memory" | "knowledge" | "tools" | "skills" | "tasks" | "logs" | "channels" | "settings";

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
  const [windowMaximized, setWindowMaximized] = useState(false);
  const [hoveredWindowControl, setHoveredWindowControl] = useState<"minimize" | "maximize" | "close" | null>(null);
  const isDesktopApp = isElectron();
  const browserWorkbenchAvailable = isDesktopApp;
  const isWindowsDesktop = isDesktopApp && navigator.userAgent.includes("Windows");
  const { ensureRuntimeReady, loadSessions, loadModelProfiles, newSession, loadSettings } = useChatStore();
  const { mode, colors, toggleTheme } = useTheme();
  const { lang, setLang, t } = useI18n();
  const resizeOriginRef = useRef<{ startX: number; startWidth: number } | null>(null);
  const desktopApi = window.nexoDesktop;

  useEffect(() => {
    if (!isWindowsDesktop || !desktopApi?.isWindowMaximized) return;
    let disposed = false;
    const unsubscribe = desktopApi.onWindowMaximizedChange?.((value) => {
      if (!disposed) {
        setWindowMaximized(value);
      }
    });

    void desktopApi.isWindowMaximized().then((value) => {
      if (!disposed) {
        setWindowMaximized(value);
      }
    }).catch((error) => {
      console.warn("[window] failed to read maximize state:", error);
    });

    return () => {
      disposed = true;
      unsubscribe?.();
    };
  }, [desktopApi, isWindowsDesktop]);

  useEffect(() => {
    let disposed = false;
    let refreshTimer: number | undefined;

    void (async () => {
      await ensureRuntimeReady();
      if (disposed) return;
      await Promise.all([
        loadSessions(),
        loadModelProfiles().catch((error) => {
          console.warn("[app] model profiles load failed:", error);
        }),
      ]);
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
    if (view !== "chat") return;

    const interval = window.setInterval(() => {
      const state = useChatStore.getState();
      const activeSessionId = state.activeSessionId;
      if (!activeSessionId || state.streaming) return;

      const activeMeta = state.sessions.find((session) => session.id === activeSessionId);
      const latestMessageAt = state.messages[state.messages.length - 1]?.createdAt ?? "";
      if (!activeMeta?.updatedAt || !latestMessageAt) return;
      if (activeMeta.updatedAt <= latestMessageAt) return;

      void state.selectSession(activeSessionId).catch((error) => {
        console.warn("[app] failed to refresh active session:", error);
      });
    }, 2500);

    return () => {
      window.clearInterval(interval);
    };
  }, [view]);

  useEffect(() => {
    if (!browserWorkbenchAvailable && view === "browser") {
      setView("chat");
    }
  }, [browserWorkbenchAvailable, view]);

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
        Math.max(MIN_SESSION_SIDER_WIDTH, origin.startWidth + (event.clientX - origin.startX)),
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

  const titlebarButtonBaseStyle = (
    control: "minimize" | "maximize" | "close",
  ): React.CSSProperties & { WebkitAppRegion?: "no-drag" } => ({
    width: 46,
    height: DESKTOP_DRAG_BAR_HEIGHT,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    color: control === "close" && hoveredWindowControl === "close" ? "#ffffff" : colors.textSecondary,
    background:
      control === "close" && hoveredWindowControl === "close"
        ? "#dc2626"
        : hoveredWindowControl === control
          ? colors.hoverBg
          : "transparent",
    cursor: "pointer",
    WebkitAppRegion: "no-drag",
    transition: "background 0.15s ease, color 0.15s ease",
  });

  const desktopDragBarStyle: React.CSSProperties & { WebkitAppRegion?: "drag" } = {
    position: "fixed",
    top: 0,
    left: 0,
    right: 0,
    height: DESKTOP_DRAG_BAR_HEIGHT,
    background: colors.bgSecondary,
    borderBottom: `1px solid ${colors.border}`,
    WebkitAppRegion: "drag",
    zIndex: 20,
    display: "flex",
    alignItems: "stretch",
    justifyContent: "space-between",
  };

  const windowControlGroupStyle: React.CSSProperties & { WebkitAppRegion?: "no-drag" } = {
    display: "flex",
    alignItems: "stretch",
    marginLeft: "auto",
    WebkitAppRegion: "no-drag",
  };

  const handleMinimize = async () => {
    await desktopApi?.minimizeWindow?.();
  };

  const handleToggleMaximize = async () => {
    if (!desktopApi) return;
    if (windowMaximized) {
      await desktopApi.unmaximizeWindow?.();
      setWindowMaximized(false);
      return;
    }
    await desktopApi.maximizeWindow?.();
    setWindowMaximized(true);
  };

  const handleCloseWindow = async () => {
    await desktopApi?.closeWindow?.();
  };

  const openTaskSession = async (sessionId: string) => {
    setView("chat");
    await useChatStore.getState().loadSessions();
    await useChatStore.getState().selectSession(sessionId);
  };

  useEffect(() => {
    const unsubscribe = desktopApi?.onTaskSessionRequested?.((sessionId) => {
      void openTaskSession(sessionId);
    });
    return () => {
      unsubscribe?.();
    };
  }, [desktopApi]);

  return (
    <Layout style={{ height: "100vh", background: colors.bgPrimary, paddingTop: isWindowsDesktop ? DESKTOP_DRAG_BAR_HEIGHT : 0, position: "relative" }}>
      {isWindowsDesktop && (
        <div style={desktopDragBarStyle}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              paddingLeft: 12,
              minWidth: 0,
            }}
          >
            <img
              src={brandIconUrl}
              alt="NexoAgent"
              style={{ width: 16, height: 16, display: "block", borderRadius: 4, flexShrink: 0 }}
            />
            <span
              style={{
                color: colors.textPrimary,
                fontSize: 13,
                fontWeight: 600,
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              Nexo Agent
            </span>
          </div>

          <div style={windowControlGroupStyle}>
            <div
              onClick={() => void handleMinimize()}
              onMouseEnter={() => setHoveredWindowControl("minimize")}
              onMouseLeave={() => setHoveredWindowControl(null)}
              style={titlebarButtonBaseStyle("minimize")}
            >
              <MinusOutlined />
            </div>
            <div
              onClick={() => void handleToggleMaximize()}
              onMouseEnter={() => setHoveredWindowControl("maximize")}
              onMouseLeave={() => setHoveredWindowControl(null)}
              style={titlebarButtonBaseStyle("maximize")}
            >
              {windowMaximized ? <CopyOutlined /> : <BorderOutlined />}
            </div>
            <div
              onClick={() => void handleCloseWindow()}
              onMouseEnter={() => setHoveredWindowControl("close")}
              onMouseLeave={() => setHoveredWindowControl(null)}
              style={titlebarButtonBaseStyle("close")}
            >
              <CloseOutlined />
            </div>
          </div>
        </div>
      )}
      <Sider width={52} style={{ background: colors.bgSecondary, borderRight: `1px solid ${colors.border}` }}>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", padding: "12px 0", gap: 4, height: "100%" }}>
          {/* <img
            src={brandIconUrl}
            alt="NexoAgent"
            style={{ width: 22, height: 22, marginBottom: 16, display: "block", borderRadius: 6 }}
          /> */}

          {navItem("chat", <MessageOutlined />, t("chat"))}
          {browserWorkbenchAvailable && navItem("browser", <GlobalOutlined />, t("browserWorkbench"))}

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

          <Tooltip title={lang === "zh" ? t("switchToEnglish") : t("switchToChinese")} placement="right">
            <div onClick={() => setLang(lang === "zh" ? "en" : "zh")} style={{ ...iconButtonStyle(false), fontSize: 11, fontWeight: 700 }}>
              {lang === "zh" ? "EN" : "ZH"}
            </div>
          </Tooltip>

          <Tooltip title={mode === "dark" ? t("lightMode") : t("darkMode")} placement="right">
            <div onClick={toggleTheme} style={iconButtonStyle(false)}>
              {mode === "dark" ? <SunOutlined /> : <MoonOutlined />}
            </div>
          </Tooltip>

          {navItem("settings", <SettingOutlined />, t("settings"))}

          <Tooltip title={t("openWebConsole")} placement="right">
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

      <Content style={{ display: "flex", flexDirection: "column", overflow: "hidden", background: colors.bgPrimary }}>
        {view === "chat" && <ChatPanel onOpenSettings={() => setView("settings")} />}
        {browserWorkbenchAvailable && view === "browser" && <BrowserWorkbench />}
        {view === "memory" && <MemoryPanel />}
        {view === "knowledge" && <Knowledge />}
        {view === "tools" && <Tools />}
        {view === "skills" && <Skills />}
        {view === "tasks" && <Tasks onOpenTaskSession={openTaskSession} />}
        {view === "logs" && <Logs />}
        {view === "channels" && <Channels />}
        {view === "settings" && <Settings />}
      </Content>
    </Layout>
  );
};
