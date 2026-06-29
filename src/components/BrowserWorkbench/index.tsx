import React, { useEffect, useState } from "react";
import { Button, Input, Tooltip, message } from "antd";
import {
  AimOutlined,
  ArrowLeftOutlined,
  ArrowRightOutlined,
  LinkOutlined,
  ReloadOutlined,
  ZoomInOutlined,
  ZoomOutOutlined,
} from "@ant-design/icons";
import { SessionList } from "../SessionList";
import { ChatPanel } from "../ChatPanel";
import { useTheme } from "../../theme";
import type { BrowserActionRequest, BrowserElementPickResult, BrowserState } from "../../shared/types";

const MIN_CONVERSATION_WIDTH = 620;
const MAX_CONVERSATION_WIDTH = 1040;
const DEFAULT_CONVERSATION_WIDTH = 760;
const CONTROL_RAIL_WIDTH = 44;
const SESSION_HISTORY_WIDTH = 240;
const COLLAPSED_SESSION_HISTORY_WIDTH = 58;

function browserUrlFromState(state?: BrowserState | null) {
  return state?.url || "about:blank";
}

function formatPickedElement(result: BrowserElementPickResult) {
  const element = result.element;
  if (!element) return "";
  const bounds = element.bounds
    ? `x=${element.bounds.x}, y=${element.bounds.y}, w=${element.bounds.width}, h=${element.bounds.height}`
    : "";
  return [
    "已选择浏览器元素：",
    `- 名称: ${element.name || "(empty)"}`,
    `- 标签: <${element.tag}>${element.role ? ` role=${element.role}` : ""}`,
    element.text ? `- 文本: ${element.text}` : "",
    element.value ? `- 值: ${element.value}` : "",
    element.href ? `- 链接: ${element.href}` : "",
    element.selector ? `- Selector: ${element.selector}` : "",
    bounds ? `- Bounds: ${bounds}` : "",
    `- 页面: ${result.title || "Untitled"}`,
    `- URL: ${result.url}`,
  ].filter(Boolean).join("\n");
}

export default function BrowserWorkbench() {
  const { colors } = useTheme();
  const desktopApi = window.nexoDesktop;
  const [browserState, setBrowserState] = useState<BrowserState | null>(null);
  const [url, setUrl] = useState("https://");
  const [busy, setBusy] = useState(false);
  const [conversationWidth, setConversationWidth] = useState(() => {
    const saved = Number(localStorage.getItem("nexo-browser-chat-panel-width"));
    return Number.isFinite(saved)
      ? Math.min(MAX_CONVERSATION_WIDTH, Math.max(MIN_CONVERSATION_WIDTH, saved))
      : DEFAULT_CONVERSATION_WIDTH;
  });
  const [sessionHistoryCollapsed, setSessionHistoryCollapsed] = useState(() =>
    localStorage.getItem("nexo-browser-session-history-collapsed") === "true"
  );
  const [resizing, setResizing] = useState(false);
  const [pickingElement, setPickingElement] = useState(false);
  const [elementFillValue, setElementFillValue] = useState<{ text: string; ts: number } | null>(null);
  const browserPaneRef = React.useRef<HTMLDivElement | null>(null);
  const resizeOriginRef = React.useRef<{ startX: number; startWidth: number } | null>(null);

  useEffect(() => {
    void desktopApi?.openBrowserWorkbench?.();
    void desktopApi?.getBrowserState?.().then((state) => {
      setBrowserState(state);
      setUrl(browserUrlFromState(state));
    }).catch(() => undefined);
    const unsubscribe = desktopApi?.onBrowserStateChange?.((state) => {
      setBrowserState(state);
      setUrl(browserUrlFromState(state));
    });

    return () => {
      unsubscribe?.();
      void desktopApi?.closeBrowserWorkbench?.();
    };
  }, [desktopApi]);

  useEffect(() => {
    if (!desktopApi?.setBrowserBounds) return undefined;
    const setBrowserBounds = desktopApi.setBrowserBounds;

    const updateBounds = () => {
      const element = browserPaneRef.current;
      if (!element) return;
      const rect = element.getBoundingClientRect();
      void setBrowserBounds({
        x: Math.round(rect.left),
        y: Math.round(rect.top),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
      });
    };

    updateBounds();
    const observer = new ResizeObserver(updateBounds);
    if (browserPaneRef.current) {
      observer.observe(browserPaneRef.current);
    }
    window.addEventListener("resize", updateBounds);

    return () => {
      observer.disconnect();
      window.removeEventListener("resize", updateBounds);
    };
  }, [desktopApi, conversationWidth]);

  useEffect(() => {
    localStorage.setItem("nexo-browser-chat-panel-width", String(conversationWidth));
  }, [conversationWidth]);

  useEffect(() => {
    localStorage.setItem("nexo-browser-session-history-collapsed", String(sessionHistoryCollapsed));
  }, [sessionHistoryCollapsed]);

  useEffect(() => {
    if (!resizing) return undefined;
    const previousCursor = document.body.style.cursor;
    const previousUserSelect = document.body.style.userSelect;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";

    const handleMove = (event: MouseEvent) => {
      const origin = resizeOriginRef.current;
      if (!origin) return;
      const next = Math.min(
        MAX_CONVERSATION_WIDTH,
        Math.max(MIN_CONVERSATION_WIDTH, origin.startWidth + (origin.startX - event.clientX)),
      );
      setConversationWidth(next);
    };

    const stop = () => {
      resizeOriginRef.current = null;
      setResizing(false);
      document.body.style.cursor = previousCursor;
      document.body.style.userSelect = previousUserSelect;
    };

    window.addEventListener("mousemove", handleMove);
    window.addEventListener("mouseup", stop);
    return () => {
      window.removeEventListener("mousemove", handleMove);
      window.removeEventListener("mouseup", stop);
      document.body.style.cursor = previousCursor;
      document.body.style.userSelect = previousUserSelect;
    };
  }, [resizing]);

  const runAction = async (request: BrowserActionRequest) => {
    if (!desktopApi?.browserAction) return;
    setBusy(true);
    try {
      const result = await desktopApi.browserAction(request);
      setBrowserState(result);
      setUrl(browserUrlFromState(result));
    } finally {
      setBusy(false);
    }
  };

  const setBrowserZoom = async (mode: "in" | "out" | "reset") => {
    if (!desktopApi?.setBrowserZoom) return;
    const result = await desktopApi.setBrowserZoom(mode);
    setBrowserState(result);
  };

  const pickBrowserElement = async () => {
    if (!desktopApi?.pickBrowserElement || pickingElement) return;
    setPickingElement(true);
    try {
      const result = await desktopApi.pickBrowserElement();
      if (result.ok && result.element) {
        setElementFillValue({ text: formatPickedElement(result), ts: Date.now() });
      } else if (result.error && result.error !== "Element selection cancelled.") {
        void message.warning(result.error);
      }
    } catch (error) {
      void message.error(error instanceof Error ? error.message : "Element selection failed.");
    } finally {
      setPickingElement(false);
    }
  };

  const startResize = (event: React.MouseEvent<HTMLDivElement>) => {
    if ((event.target as HTMLElement).closest("[data-browser-zoom-controls]")) return;
    event.preventDefault();
    resizeOriginRef.current = { startX: event.clientX, startWidth: conversationWidth };
    setResizing(true);
  };

  const zoomLabel = `${Math.round((browserState?.zoomFactor ?? 1) * 100)}%`;
  const sessionHistoryWidth = sessionHistoryCollapsed ? COLLAPSED_SESSION_HISTORY_WIDTH : SESSION_HISTORY_WIDTH;

  return (
    <div
      id="browser-workbench-shell"
      style={{
        display: "grid",
        gridTemplateColumns: `minmax(0, 1fr) ${CONTROL_RAIL_WIDTH}px ${conversationWidth}px`,
        height: "100%",
        minHeight: 0,
        background: colors.bgPrimary,
        position: "relative",
        overflow: "hidden",
      }}
    >
      <div style={{ display: "flex", flexDirection: "column", minWidth: 0, minHeight: 0 }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              padding: 12,
              background: colors.bgSecondary,
              borderBottom: `1px solid ${colors.border}`,
            }}
          >
            <Input
              value={url}
              onChange={(event) => setUrl(event.target.value)}
              onPressEnter={() => void runAction({ action: "navigate", url })}
              prefix={<LinkOutlined style={{ color: colors.textMuted }} />}
              disabled={busy}
              style={{ flex: 1, minWidth: 0 }}
            />
            <Tooltip title="Back">
              <Button
                icon={<ArrowLeftOutlined />}
                onClick={() => void runAction({ action: "back" })}
                disabled={!browserState?.canGoBack || busy}
              />
            </Tooltip>
            <Tooltip title="Forward">
              <Button
                icon={<ArrowRightOutlined />}
                onClick={() => void runAction({ action: "forward" })}
                disabled={!browserState?.canGoForward || busy}
              />
            </Tooltip>
            <Tooltip title="Refresh">
              <Button
                icon={<ReloadOutlined />}
                onClick={() => void runAction({ action: "refresh" })}
                disabled={busy}
              />
            </Tooltip>
            <Tooltip title={pickingElement ? "Click an element in the browser" : "Select element"}>
              <Button
                type={pickingElement ? "primary" : "default"}
                icon={<AimOutlined />}
                onClick={() => void pickBrowserElement()}
                disabled={busy || pickingElement || !desktopApi?.pickBrowserElement}
              />
            </Tooltip>
          </div>

          <div
            ref={browserPaneRef}
            id="browser-workbench-view"
            style={{
              flex: 1,
              minHeight: 0,
              background: colors.bgSecondary,
              overflow: "hidden",
              position: "relative",
            }}
          />
        </div>

      <div
        onMouseDown={startResize}
        style={{
          position: "relative",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          cursor: "col-resize",
          background: resizing ? colors.accent : colors.border,
          transition: resizing ? "none" : "background 0.15s ease",
        }}
      >
        <div
          data-browser-zoom-controls
          style={{
            display: "grid",
            gap: 6,
            padding: 4,
            borderRadius: 999,
            background: colors.bgSecondary,
            border: `1px solid ${colors.borderStrong}`,
            boxShadow: "0 10px 28px rgba(15, 23, 42, 0.18)",
          }}
        >
          <Tooltip title="Zoom out" placement="left">
            <Button
              size="small"
              type="text"
              icon={<ZoomOutOutlined />}
              onClick={() => void setBrowserZoom("out")}
              style={{ width: 28, height: 28, color: colors.textMuted }}
            />
          </Tooltip>
          <Tooltip title="Zoom in" placement="left">
            <Button
              size="small"
              type="text"
              icon={<ZoomInOutlined />}
              onClick={() => void setBrowserZoom("in")}
              style={{ width: 28, height: 28, color: colors.textMuted }}
            />
          </Tooltip>
        </div>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: `${sessionHistoryWidth}px minmax(0, 1fr)`,
          minWidth: 0,
          minHeight: 0,
          borderLeft: `1px solid ${colors.border}`,
          background: colors.bgSecondary,
        }}
      >
        <div style={{ minWidth: 0, minHeight: 0, borderRight: `1px solid ${colors.border}`, overflow: "hidden" }}>
          <SessionList
            collapsed={sessionHistoryCollapsed}
            onToggleWidth={() => setSessionHistoryCollapsed((current) => !current)}
          />
        </div>
        <div style={{ minWidth: 0, minHeight: 0 }}>
          <ChatPanel surface="browser" externalFillValue={elementFillValue} />
        </div>
      </div>
    </div>
  );
}
