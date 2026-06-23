import { useEffect, useMemo, useRef, useState } from "react";
import { Button, Space, Tag } from "antd";
import { PauseCircleOutlined, PlayCircleOutlined, DeleteOutlined } from "@ant-design/icons";
import { getApiBase } from "../../services/api";
import { useI18n } from "../../i18n";
import { useTheme } from "../../theme";

function getColor(line: string) {
  if (line.includes("ERROR")) return "#ef4444";
  if (line.includes("WARN")) return "#f59e0b";
  if (line.includes("INFO")) return "#10b981";
  return "#94a3b8";
}

export default function Logs() {
  const { colors } = useTheme();
  const { lang, t } = useI18n();
  const [lines, setLines] = useState<string[]>([]);
  const [paused, setPaused] = useState(false);
  const esRef = useRef<EventSource | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  const ui = useMemo(
    () => ({
      title: lang === "zh" ? "\u8fd0\u884c\u65e5\u5fd7" : "Runtime Logs",
      live: lang === "zh" ? "\u5b9e\u65f6\u4e2d" : "Live",
      paused: lang === "zh" ? "\u5df2\u6682\u505c" : "Paused",
    }),
    [lang],
  );

  function connect() {
    esRef.current?.close();
    const es = new EventSource(`${getApiBase()}/api/logs`);
    es.onmessage = (event) => setLines((prev) => [...prev, event.data]);
    esRef.current = es;
  }

  useEffect(() => {
    connect();
    return () => esRef.current?.close();
  }, []);

  useEffect(() => {
    if (!paused) bottomRef.current?.scrollIntoView({ block: "end" });
  }, [lines, paused]);

  function handleClear() {
    setLines([]);
  }

  function handlePauseResume() {
    if (paused) {
      connect();
      setPaused(false);
      return;
    }
    esRef.current?.close();
    setPaused(true);
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", color: colors.textPrimary }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
          padding: "20px 24px 12px",
          borderBottom: `1px solid ${colors.border}`,
          background: colors.bgPrimary,
        }}
      >
        <Space align="center" size={12}>
          <span style={{ fontWeight: 600, fontSize: 18, color: colors.textPrimary }}>{ui.title}</span>
          <Tag color={paused ? "gold" : "green"}>{paused ? ui.paused : ui.live}</Tag>
        </Space>
        <Space size={8}>
          <Button icon={<DeleteOutlined />} onClick={handleClear}>
            {t("clear")}
          </Button>
          <Button
            icon={paused ? <PlayCircleOutlined /> : <PauseCircleOutlined />}
            onClick={handlePauseResume}
          >
            {paused ? t("resumeStream") : t("pauseStream")}
          </Button>
        </Space>
      </div>
      <div
        style={{
          flex: 1,
          background: colors.bgSecondary,
          fontFamily: "Consolas, Monaco, monospace",
          fontSize: 12,
          overflowY: "auto",
          padding: 16,
        }}
      >
        {lines.map((line, index) => (
          <div key={`${index}-${line.slice(0, 12)}`} style={{ color: getColor(line), whiteSpace: "pre-wrap", lineHeight: 1.6 }}>
            {line}
          </div>
        ))}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}
