import React, { useEffect, useRef } from "react";
import { MessageBubble } from "./MessageBubble";
import { useChatStore } from "../../store/chat";
import { useTheme } from "../../theme";
import { useI18n } from "../../i18n";

interface Props {
  onSuggest: (text: string) => void;
  hasInput: boolean;
}

export const MessageList: React.FC<Props> = ({ onSuggest, hasInput }) => {
  const { messages, streaming, toolCalls, messageBlocks } = useChatStore();
  const { colors } = useTheme();
  const { t } = useI18n();
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, streaming, toolCalls, messageBlocks]);

  if (messages.length === 0) {
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
    <div style={{ flex: 1, overflowY: "auto", padding: "20px 24px" }}>
      {messages.map((message, index) => (
        <MessageBubble
          key={message.id}
          message={message}
          attachments={message.attachments}
          streaming={streaming && index === messages.length - 1 && message.role === "assistant"}
          toolCalls={toolCalls[message.id]}
          blocks={messageBlocks[message.id]}
        />
      ))}
      <div ref={bottomRef} />
    </div>
  );
};
