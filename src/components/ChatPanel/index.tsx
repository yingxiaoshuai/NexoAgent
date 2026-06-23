import React, { useEffect, useRef, useState } from "react";
import { MessageList } from "./MessageList";
import { InputBar } from "./InputBar";
import { uploadFiles } from "./upload";
import { useChatStore } from "../../store/chat";
import { useTheme } from "../../theme";
import { useI18n } from "../../i18n";
import type { Attachment } from "../../shared/types";

function hasDraggedFiles(dataTransfer?: DataTransfer | null) {
  return Array.from(dataTransfer?.types ?? []).includes("Files");
}

export const ChatPanel: React.FC = () => {
  const { streaming, sendMessage, cancelStream } = useChatStore();
  const { colors, mode } = useTheme();
  const { t } = useI18n();
  const [fillValue, setFillValue] = useState<{ text: string; ts: number } | null>(null);
  const [inputText, setInputText] = useState("");
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [dragActive, setDragActive] = useState(false);
  const [uploading, setUploading] = useState(false);
  const dragDepthRef = useRef(0);

  useEffect(() => {
    const preventWindowFileDrop = (event: DragEvent) => {
      if (!hasDraggedFiles(event.dataTransfer)) return;
      event.preventDefault();
    };

    window.addEventListener("dragover", preventWindowFileDrop);
    window.addEventListener("drop", preventWindowFileDrop);
    return () => {
      window.removeEventListener("dragover", preventWindowFileDrop);
      window.removeEventListener("drop", preventWindowFileDrop);
    };
  }, []);

  async function handleUploadFiles(files: File[]) {
    if (files.length === 0) return;

    setUploading(true);
    try {
      const uploaded = await uploadFiles(files);
      if (uploaded.length > 0) {
        setAttachments((current) => [...current, ...uploaded]);
      }
    } catch (error) {
      console.warn("[chat] attachment upload failed:", error);
    } finally {
      setUploading(false);
    }
  }

  async function handleDrop(event: React.DragEvent<HTMLDivElement>) {
    if (!hasDraggedFiles(event.dataTransfer)) return;
    event.preventDefault();
    event.stopPropagation();
    dragDepthRef.current = 0;
    setDragActive(false);
    await handleUploadFiles(Array.from(event.dataTransfer.files ?? []));
  }

  function handleDragEnter(event: React.DragEvent<HTMLDivElement>) {
    if (!hasDraggedFiles(event.dataTransfer)) return;
    event.preventDefault();
    event.stopPropagation();
    dragDepthRef.current += 1;
    setDragActive(true);
  }

  function handleDragLeave(event: React.DragEvent<HTMLDivElement>) {
    if (!hasDraggedFiles(event.dataTransfer)) return;
    event.preventDefault();
    event.stopPropagation();
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
    if (dragDepthRef.current === 0) {
      setDragActive(false);
    }
  }

  function handleDragOver(event: React.DragEvent<HTMLDivElement>) {
    if (!hasDraggedFiles(event.dataTransfer)) return;
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = "copy";
  }

  return (
    <div
      style={{ display: "flex", flexDirection: "column", height: "100%", position: "relative" }}
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={(event) => { void handleDrop(event); }}
    >
      <MessageList
        onSuggest={(text) => setFillValue({ text, ts: Date.now() })}
        hasInput={inputText.length > 0}
      />
      <InputBar
        onSend={(content, messageAttachments) => {
          void sendMessage(content, messageAttachments);
          setAttachments([]);
        }}
        attachments={attachments}
        onAttachmentsChange={setAttachments}
        onUploadFiles={handleUploadFiles}
        disabled={streaming || uploading}
        onCancel={streaming ? cancelStream : undefined}
        fillValue={fillValue}
        onValueChange={setInputText}
      />

      {dragActive && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            zIndex: 10,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 24,
            pointerEvents: "none",
            background: mode === "dark"
              ? "rgba(8, 15, 26, 0.78)"
              : "rgba(248, 250, 252, 0.82)",
          }}
        >
          <div
            style={{
              minWidth: 280,
              maxWidth: 520,
              padding: "28px 32px",
              borderRadius: 20,
              border: `2px dashed ${colors.accent}`,
              background: colors.bgSecondary,
              color: colors.textPrimary,
              textAlign: "center",
              boxShadow: "0 24px 80px rgba(15, 23, 42, 0.22)",
            }}
          >
            <div style={{ fontSize: 18, fontWeight: 600, marginBottom: 8 }}>{t("dropFilesToAttach")}</div>
            <div style={{ fontSize: 13, color: colors.textMuted }}>{t("uploadFile")}</div>
          </div>
        </div>
      )}
    </div>
  );
};
