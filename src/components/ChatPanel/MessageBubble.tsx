import React, { useMemo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import { Avatar, Button, Popconfirm, Tag, Tooltip } from "antd";
import { FileOutlined, RobotOutlined, SoundOutlined, UndoOutlined, UserOutlined } from "@ant-design/icons";
import type { ChatMessage } from "../../shared/types";
import { ToolCallItem } from "./ToolCallSteps";
import type { ToolCallEvent } from "./ToolCallSteps";
import type { MessageBlock } from "../../store/chat";
import { getApiBase } from "../../services/api";
import { useTheme, type ThemeColors } from "../../theme";
import { useI18n } from "../../i18n";
import "highlight.js/styles/github-dark.css";

interface Props {
  message: ChatMessage;
  streaming?: boolean;
  toolCalls?: ToolCallEvent[];
  blocks?: MessageBlock[];
  attachments?: ChatMessage["attachments"];
  undoable?: boolean;
  onUndo?: () => void;
}

const STREAM_CURSOR = "|";
const DSML_TAG_PATTERN = String.raw`(?:\|\|DSML\|\||\uFF5C\uFF5CDSML\uFF5C\uFF5C|锝滐綔DSML锝滐綔|閿濇粣缍擠SML閿濇粣缍攟闁挎繃绮ｇ紞鎿燬ML闁挎繃绮ｇ紞?)`;
const DSML_TOOL_BLOCK_RE = new RegExp(String.raw`<\s*${DSML_TAG_PATTERN}tool_calls\s*>[\s\S]*?<\/\s*${DSML_TAG_PATTERN}tool_calls\s*>`, "g");
const DSML_TOOL_START_RE = new RegExp(String.raw`<\s*${DSML_TAG_PATTERN}tool_calls\s*>`);
const DSML_ANY_TAG_RE = new RegExp(String.raw`<\/?\s*${DSML_TAG_PATTERN}(?:tool_calls|invoke|parameter)\b[^>]*>`, "g");

function stripDsmlArtifacts(content: string) {
  let visibleText = content;
  visibleText = visibleText.replace(DSML_TOOL_BLOCK_RE, "");
  const danglingStart = visibleText.search(DSML_TOOL_START_RE);
  if (danglingStart >= 0) {
    visibleText = visibleText.slice(0, danglingStart);
  }
  return visibleText.replace(DSML_ANY_TAG_RE, "");
}

function buildMarkdownComponents(colors: ThemeColors) {
  return {
    pre: ({ children }: { children?: React.ReactNode }) => (
      <pre style={{ margin: "8px 0", borderRadius: 8, overflow: "auto", background: colors.codeBg, padding: "12px" }}>
        {children}
      </pre>
    ),
    code: ({ children, className }: { children?: React.ReactNode; className?: string }) =>
      className ? (
        <code className={className}>{children}</code>
      ) : (
        <code style={{ background: colors.codeBg, padding: "1px 5px", borderRadius: 4, fontSize: "0.9em" }}>
          {children}
        </code>
      ),
    p: ({ children }: { children?: React.ReactNode }) => <p style={{ margin: "4px 0" }}>{children}</p>,
  };
}

const MarkdownText: React.FC<{ content: string; streaming?: boolean; colors: ThemeColors }> = ({ content, streaming, colors }) => {
  const components = useMemo(() => buildMarkdownComponents(colors), [colors]);
  return streaming ? (
    <span style={{ whiteSpace: "pre-wrap", lineHeight: 1.7 }}>
      {content}
      <span style={{ color: "#38bdf8", animation: "blink 1s step-end infinite" }}>{STREAM_CURSOR}</span>
    </span>
  ) : (
    <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]} components={components}>
      {content}
    </ReactMarkdown>
  );
};

function extractUploadArtifacts(content: string) {
  const matches = [...content.matchAll(/(?:^|\s)(\/uploads\/[^\s)]+?\.(?:png|jpe?g|webp|gif|mp3|wav|m4a|ogg|webm))/gi)];
  const seen = new Set<string>();
  return matches
    .map((match) => match[1])
    .filter((url) => {
      if (seen.has(url)) return false;
      seen.add(url);
      return true;
    })
    .map((url) => {
      const lower = url.toLowerCase();
      const type = /\.(png|jpe?g|webp|gif)$/i.test(lower) ? "image" : "audio";
      return { url, type, name: url.split("/").pop() || url };
    });
}

function getMessageStatusMeta(status: ChatMessage["status"], t: ReturnType<typeof useI18n>["t"]) {
  switch (status) {
    case "undone":
      return { color: "default" as const, label: t("undone") };
    case "failed":
      return { color: "error" as const, label: t("failedExecution") };
    case "interrupted":
      return { color: "warning" as const, label: t("interrupted") };
    case "needs_input":
      return { color: "processing" as const, label: t("needsInput") };
    default:
      return null;
  }
}

const MessageBubbleComponent: React.FC<Props> = ({ message, streaming, toolCalls, blocks, undoable, onUndo }) => {
  const { colors } = useTheme();
  const { t } = useI18n();
  const isUser = message.role === "user";
  const toolMap = new Map((toolCalls ?? []).map((toolCall) => [toolCall.id, toolCall]));
  const hasBlocks = !isUser && Boolean(blocks?.length);
  const apiBase = getApiBase();
  const safeContent = useMemo(() => (!isUser ? stripDsmlArtifacts(message.content) : message.content), [isUser, message.content]);
  const generatedArtifacts = useMemo(() => (!isUser ? extractUploadArtifacts(safeContent) : []), [isUser, safeContent]);
  const statusMeta = !isUser ? getMessageStatusMeta(message.status, t) : null;
  const isUndone = message.status === "undone";

  return (
    <div
      style={{
        display: "flex",
        gap: 10,
        flexDirection: isUser ? "row-reverse" : "row",
        marginBottom: 16,
        alignItems: "flex-start",
      }}
    >
      <Avatar
        icon={isUser ? <UserOutlined /> : <RobotOutlined />}
        style={{ background: isUser ? colors.bubbleUser : colors.assistantAvatar, flexShrink: 0, marginTop: 2 }}
        size={32}
      />
      <div style={{ maxWidth: "80%", minWidth: 0 }}>
        {message.attachments?.map((attachment, index) =>
          attachment.type === "image" ? (
            <img
              key={index}
              src={apiBase + attachment.url}
              alt={attachment.name}
              style={{ maxWidth: 200, borderRadius: 8, marginBottom: 6, display: "block", cursor: "pointer" }}
              onClick={() => window.open(apiBase + attachment.url)}
            />
          ) : attachment.type === "audio" ? (
            <div
              key={index}
              style={{
                background: colors.bgTertiary,
                border: `1px solid ${colors.borderStrong}`,
                padding: 8,
                borderRadius: 8,
                marginBottom: 6,
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6, color: colors.textMuted }}>
                <SoundOutlined />
                <a href={apiBase + attachment.url} target="_blank" rel="noreferrer" style={{ color: colors.textMuted }}>
                  {attachment.name}
                </a>
              </div>
              <audio controls src={apiBase + attachment.url} style={{ width: "100%" }} />
            </div>
          ) : (
            <div
              key={index}
              style={{
                background: colors.bgTertiary,
                border: `1px solid ${colors.borderStrong}`,
                padding: 8,
                borderRadius: 8,
                marginBottom: 6,
                display: "flex",
                alignItems: "center",
                gap: 8,
              }}
            >
              <FileOutlined style={{ color: colors.textMuted }} />
              <a href={apiBase + attachment.url} target="_blank" rel="noreferrer" style={{ color: colors.textMuted }}>
                {attachment.name}
              </a>
            </div>
          ),
        )}
        <div
          style={{
            background: isUndone ? colors.bgTertiary : (isUser ? colors.bubbleUser : colors.bubbleAssistant),
            color: isUndone ? colors.textMuted : (isUser ? "#ffffff" : colors.textPrimary),
            border: isUser ? "none" : `1px solid ${isUndone ? colors.borderStrong : colors.border}`,
            borderRadius: isUser ? "16px 4px 16px 16px" : "4px 16px 16px 16px",
            padding: "10px 14px",
            wordBreak: "break-word",
            opacity: isUndone ? 0.72 : 1,
          }}
        >
          {isUser ? (
            <span style={{ whiteSpace: "pre-wrap" }}>{message.content}</span>
          ) : hasBlocks && blocks ? (
            <>
              {blocks.map((block, index) => {
                const isLast = index === blocks.length - 1;
                if (block.type === "text") {
                  return (
                    <MarkdownText
                      key={`text-${index}`}
                      content={stripDsmlArtifacts(block.content)}
                      streaming={streaming && isLast}
                      colors={colors}
                    />
                  );
                }
                const call = toolMap.get(block.id);
                return call ? <ToolCallItem key={block.id} call={call} /> : null;
              })}
              {streaming && blocks.length > 0 && blocks[blocks.length - 1].type === "tool" ? (
                <span style={{ color: "#38bdf8", animation: "blink 1s step-end infinite" }}>{STREAM_CURSOR}</span>
              ) : null}
            </>
          ) : (
            <MarkdownText content={safeContent} streaming={streaming} colors={colors} />
          )}
        </div>
        {generatedArtifacts.length > 0 ? (
          <div style={{ marginTop: 8, display: "grid", gap: 8 }}>
            {generatedArtifacts.map((artifact) =>
              artifact.type === "image" ? (
                <img
                  key={artifact.url}
                  src={apiBase + artifact.url}
                  alt={artifact.name}
                  style={{ maxWidth: 280, borderRadius: 8, border: `1px solid ${colors.border}`, cursor: "pointer" }}
                  onClick={() => window.open(apiBase + artifact.url)}
                />
              ) : (
                <div
                  key={artifact.url}
                  style={{
                    background: colors.bgTertiary,
                    border: `1px solid ${colors.borderStrong}`,
                    padding: 8,
                    borderRadius: 8,
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                    <SoundOutlined style={{ color: colors.textMuted }} />
                    <a href={apiBase + artifact.url} target="_blank" rel="noreferrer" style={{ color: colors.textMuted }}>
                      {artifact.name}
                    </a>
                  </div>
                  <audio controls src={apiBase + artifact.url} style={{ width: "100%" }} />
                </div>
              ),
            )}
          </div>
        ) : null}
        <div style={{ marginTop: 6, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          {statusMeta ? <Tag color={statusMeta.color}>{statusMeta.label}</Tag> : null}
          {!isUser && isUndone && message.meta?.undoneMessage ? (
            <span style={{ color: colors.textMuted, fontSize: 12 }}>
              {message.meta.undoneMessage === "This turn was undone and its file changes were restored."
                ? t("undoneMessage")
                : message.meta.undoneMessage}
            </span>
          ) : null}
          {!isUser && !isUndone && undoable && onUndo ? (
            <Popconfirm
              title={t("confirmUndo")}
              description={t("confirmUndoDescription")}
              okText={t("confirm")}
              cancelText={t("cancel")}
              onConfirm={onUndo}
            >
              <Tooltip title={t("undoChanges")}>
                <Button
                  size="small"
                  type="text"
                  icon={<UndoOutlined />}
                  style={{ color: colors.textMuted, paddingInline: 6 }}
                >
                  {t("undo")}
                </Button>
              </Tooltip>
            </Popconfirm>
          ) : null}
        </div>
      </div>
    </div>
  );
};

export const MessageBubble = React.memo(MessageBubbleComponent, (prev, next) => (
  prev.message === next.message
  && prev.streaming === next.streaming
  && prev.toolCalls === next.toolCalls
  && prev.blocks === next.blocks
  && prev.attachments === next.attachments
  && prev.undoable === next.undoable
));
