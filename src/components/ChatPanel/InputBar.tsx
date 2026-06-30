import React, { useEffect, useRef, useState } from "react";
import { Button, Input, Tag, Tooltip } from "antd";
import { CloseOutlined, FileOutlined, PaperClipOutlined, SendOutlined, StopOutlined } from "@ant-design/icons";
import { getApiBase } from "../../services/api";
import { useTheme } from "../../theme";
import { useI18n } from "../../i18n";
import type { Attachment } from "../../shared/types";

interface Props {
  onSend: (content: string, attachments: Attachment[]) => void;
  attachments: Attachment[];
  onAttachmentsChange: (attachments: Attachment[]) => void;
  onUploadFiles: (files: File[]) => Promise<void>;
  disabled?: boolean;
  onCancel?: () => void;
  fillValue?: { text: string; ts: number } | null;
  onValueChange?: (v: string) => void;
  blockedMessage?: string;
}

export const InputBar: React.FC<Props> = ({
  onSend,
  attachments,
  onAttachmentsChange,
  onUploadFiles,
  disabled,
  onCancel,
  fillValue,
  onValueChange,
  blockedMessage,
}) => {
  const [value, setValue] = useState("");
  const ref = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { colors } = useTheme();
  const { t } = useI18n();

  useEffect(() => {
    if (!disabled) ref.current?.focus();
  }, [disabled]);

  useEffect(() => {
    if (fillValue?.text) {
      setValue(fillValue.text);
      onValueChange?.(fillValue.text);
      ref.current?.focus();
    }
  }, [fillValue]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleChange = (nextValue: string) => {
    setValue(nextValue);
    onValueChange?.(nextValue);
  };

  const submit = () => {
    if (disabled || (!value.trim() && attachments.length === 0)) return;
    onSend(value, attachments);
    setValue("");
    onAttachmentsChange([]);
    onValueChange?.("");
  };

  const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    if (files.length === 0) return;
    await onUploadFiles(files);
    event.target.value = "";
  };

  const handlePaste = (event: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const clipboardFiles = Array.from(event.clipboardData.files ?? []);
    const itemFiles = event.clipboardData.items
      ? Array.from(event.clipboardData.items)
        .filter((item) => item.kind === "file")
        .map((item) => item.getAsFile())
        .filter((file): file is File => Boolean(file))
      : [];
    const files = [...clipboardFiles, ...itemFiles].filter((file, index, all) =>
      all.findIndex((candidate) =>
        candidate.name === file.name
        && candidate.size === file.size
        && candidate.type === file.type) === index,
    );

    if (files.length > 0) {
      void onUploadFiles(files);
    }
  };

  const resolveAttachmentPreviewUrl = (attachment: Attachment) => (
    /^https?:\/\//i.test(attachment.url) ? attachment.url : `${getApiBase()}${attachment.url}`
  );

  const controlStyle: React.CSSProperties = {
    borderRadius: 12,
    background: colors.bgTertiary,
    color: colors.textPrimary,
    border: `1px solid ${colors.borderStrong}`,
  };

  return (
    <div style={{ padding: "12px 24px 20px", borderTop: `1px solid ${colors.border}`, background: colors.bgSecondary }}>
      {blockedMessage ? (
        <div
          style={{
            marginBottom: 10,
            padding: "10px 12px",
            borderRadius: 12,
            background: colors.bgTertiary,
            border: `1px solid ${colors.border}`,
            color: colors.textMuted,
            fontSize: 12,
          }}
        >
          {blockedMessage}
        </div>
      ) : null}
      {attachments.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginBottom: 8 }}>
          {attachments.map((attachment, index) => (
            <Tag
              key={`${attachment.url}-${index}`}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 4,
                padding: "2px 6px",
                background: colors.bgTertiary,
                border: `1px solid ${colors.borderStrong}`,
                color: colors.textPrimary,
              }}
              closeIcon={<CloseOutlined style={{ color: colors.textMuted }} />}
              closable
              onClose={() => onAttachmentsChange(attachments.filter((_, currentIndex) => currentIndex !== index))}
            >
              {attachment.type === "image"
                ? (
                  <img
                    src={resolveAttachmentPreviewUrl(attachment)}
                    alt={attachment.name}
                    style={{ width: 24, height: 24, objectFit: "cover", borderRadius: 2 }}
                  />
                )
                : <FileOutlined />}
              <span>{attachment.name}</span>
            </Tag>
          ))}
        </div>
      )}

      <div style={{ display: "flex", gap: 8, alignItems: "flex-end" }}>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          style={{ display: "none" }}
          onChange={handleFileChange}
        />
        <Tooltip title={t("attachFile")}>
          <Button
            icon={<PaperClipOutlined />}
            onClick={() => fileInputRef.current?.click()}
            disabled={disabled}
            style={{ ...controlStyle, height: 40, width: 48, flexShrink: 0, color: colors.textMuted }}
          />
        </Tooltip>
        <Input.TextArea
          ref={ref}
          value={value}
          onChange={(event) => handleChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              submit();
            }
          }}
          onPaste={handlePaste}
          placeholder={blockedMessage || t("typeMessage")}
          autoSize={{ minRows: 1, maxRows: 6 }}
          disabled={disabled && !onCancel}
          style={{ ...controlStyle, resize: "none" }}
        />
        {disabled && onCancel ? (
          <Tooltip title={t("stopGeneration")}>
            <Button
              danger
              icon={<StopOutlined />}
              onClick={() => { onCancel(); }}
              style={{ borderRadius: 12, height: 40, width: 48, flexShrink: 0 }}
            />
          </Tooltip>
        ) : (
          <Button
            type="primary"
            icon={<SendOutlined />}
            onClick={submit}
            disabled={disabled || (!value.trim() && attachments.length === 0)}
            style={{ borderRadius: 12, height: 40, width: 48, flexShrink: 0, background: colors.accent, border: "none" }}
          />
        )}
      </div>
    </div>
  );
};
