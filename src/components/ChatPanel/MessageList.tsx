import React, { useEffect, useRef } from "react";
import { MessageBubble } from "./MessageBubble";
import { useChatStore } from "../../store/chat";
import { useTheme } from "../../theme";
import { useI18n } from "../../i18n";

interface Props {
  onSuggest: (text: string) => void;
  hasInput: boolean;
  emptyState?: React.ReactNode;
}

const STREAM_SCROLL_THROTTLE_MS = 90;

export const MessageList: React.FC<Props> = ({ onSuggest, hasInput, emptyState }) => {
  const { messages, streaming, toolCalls, messageBlocks, undoableMessageIds, undoAssistantMessage } = useChatStore();
  const { colors } = useTheme();
  const { t } = useI18n();
  const containerRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const scrollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastScrollAtRef = useRef(0);

  useEffect(() => {
    const scrollToBottom = () => {
      scrollTimerRef.current = null;
      lastScrollAtRef.current = Date.now();
      const container = containerRef.current;
      if (!container) return;
      container.scrollTo({
        top: container.scrollHeight,
        behavior: streaming ? "auto" : "smooth",
      });
    };

    if (!streaming) {
      if (scrollTimerRef.current) {
        clearTimeout(scrollTimerRef.current);
        scrollTimerRef.current = null;
      }
      scrollToBottom();
      return;
    }

    const elapsed = Date.now() - lastScrollAtRef.current;
    if (elapsed >= STREAM_SCROLL_THROTTLE_MS) {
      scrollToBottom();
      return;
    }

    if (!scrollTimerRef.current) {
      scrollTimerRef.current = setTimeout(scrollToBottom, STREAM_SCROLL_THROTTLE_MS - elapsed);
    }
  }, [messages, streaming, toolCalls, messageBlocks]);

  useEffect(() => () => {
    if (scrollTimerRef.current) {
      clearTimeout(scrollTimerRef.current);
      scrollTimerRef.current = null;
    }
  }, []);

  if (messages.length === 0) {
    if (emptyState) {
      return <div style={{ flex: 1, minHeight: 0 }}>{emptyState}</div>;
    }
    return (
      <div
        style={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          color: colors.textSecondary,
        }}
      >
        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: 48, marginBottom: 12 }}>✦</div>
          <div style={{ fontSize: 16, marginBottom: 4 }}>{t("startConversation")}</div>
          <div style={{ fontSize: 13, color: colors.textMuted, marginBottom: 24 }}>{t("typeMessage")}</div>
        </div>
        {!hasInput ? (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 10, justifyContent: "center", maxWidth: 480, padding: "0 24px" }}>
            {[t("suggestion1"), t("suggestion2"), t("suggestion3"), t("suggestion4")].map((text) => (
              <div
                key={text}
                onClick={() => onSuggest(text)}
                style={{
                  padding: "8px 16px",
                  borderRadius: 20,
                  cursor: "pointer",
                  background: colors.bgTertiary,
                  border: `1px solid ${colors.border}`,
                  color: colors.textSecondary,
                  fontSize: 13,
                  transition: "all 0.15s",
                }}
                onMouseEnter={(event) => {
                  event.currentTarget.style.borderColor = colors.accent;
                  event.currentTarget.style.color = colors.textPrimary;
                }}
                onMouseLeave={(event) => {
                  event.currentTarget.style.borderColor = colors.border;
                  event.currentTarget.style.color = colors.textSecondary;
                }}
              >
                {text}
              </div>
            ))}
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <div ref={containerRef} style={{ flex: 1, overflowY: "auto", padding: "20px 24px" }}>
      {messages.map((message, index) => {
        const undoable = undoableMessageIds.has(message.id);
        return (
        <MessageBubble
          key={message.id}
          message={message}
          attachments={message.attachments}
          streaming={streaming && index === messages.length - 1 && message.role === "assistant"}
          toolCalls={toolCalls[message.id]}
          blocks={messageBlocks[message.id]}
          undoable={undoable}
          onUndo={undoable ? () => undoAssistantMessage(message.id) : undefined}
        />)}
      )}
      <div ref={bottomRef} />
    </div>
  );
};
