import React, { useEffect, useMemo, useState } from "react";
import { Tree, Button, Input, Modal, message } from "antd";
import { BookOutlined, FileOutlined } from "@ant-design/icons";
import ReactMarkdown from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import { apiGet, apiPost, apiDelete } from "../../services/api";
import { useI18n } from "../../i18n";
import { useTheme } from "../../theme";
import { OverflowMenuButton } from "../Common/OverflowMenuButton";

interface TreeNode {
  key: string;
  title: string;
  children?: TreeNode[];
  isLeaf?: boolean;
}

export default function Knowledge() {
  const { colors } = useTheme();
  const { lang, t } = useI18n();
  const [treeData, setTreeData] = useState<TreeNode[]>([]);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [content, setContent] = useState("");
  const [editing, setEditing] = useState(false);
  const [creating, setCreating] = useState(false);
  const [editContent, setEditContent] = useState("");
  const [newFileName, setNewFileName] = useState("");

  const ui = useMemo(
    () => ({
      createFile: lang === "zh" ? "\u65b0\u5efa\u6587\u4ef6" : "New File",
      emptyState: lang === "zh" ? "\u9009\u62e9\u6216\u521b\u5efa\u77e5\u8bc6\u6587\u4ef6" : "Select or create a knowledge file",
      filePathPlaceholder: lang === "zh" ? "\u6587\u4ef6\u8def\u5f84\uff0c\u4f8b\u5982 docs/readme.md" : "File path, for example docs/readme.md",
      fileNameRequired: lang === "zh" ? "\u8bf7\u8f93\u5165\u6587\u4ef6\u540d" : "Please enter a file path.",
      loadTreeFailed: lang === "zh" ? "\u52a0\u8f7d\u76ee\u5f55\u5931\u8d25" : "Failed to load the knowledge tree.",
      loadFileFailed: lang === "zh" ? "\u52a0\u8f7d\u6587\u4ef6\u5931\u8d25" : "Failed to load the file.",
      deleteSuccess: lang === "zh" ? "\u5220\u9664\u6210\u529f" : "Deleted successfully.",
      deleteFailed: lang === "zh" ? "\u5220\u9664\u5931\u8d25" : "Failed to delete the file.",
      saveSuccess: lang === "zh" ? "\u4fdd\u5b58\u6210\u529f" : "Saved successfully.",
      saveFailed: lang === "zh" ? "\u4fdd\u5b58\u5931\u8d25" : "Failed to save the file.",
      deleteConfirm: (path: string) =>
        lang === "zh" ? `\u786e\u8ba4\u5220\u9664\u6587\u4ef6\u201c${path}\u201d\uff1f` : `Delete "${path}"?`,
    }),
    [lang],
  );

  const loadTree = async () => {
    try {
      const data = await apiGet<TreeNode[]>("/api/knowledge/tree");
      setTreeData(data);
    } catch {
      void message.error(ui.loadTreeFailed);
    }
  };

  useEffect(() => {
    void loadTree();
  }, []);

  const loadFile = async (path: string) => {
    try {
      const data = await apiGet<{ content?: string } | string>(`/api/knowledge/file?path=${encodeURIComponent(path)}`);
      setContent(typeof data === "string" ? data : (data.content ?? ""));
      setSelectedPath(path);
      setEditing(false);
      setCreating(false);
    } catch {
      void message.error(ui.loadFileFailed);
    }
  };

  const deleteFile = async (path: string) => {
    try {
      await apiDelete(`/api/knowledge/file?path=${encodeURIComponent(path)}`);
      void message.success(ui.deleteSuccess);
      if (selectedPath === path) {
        setSelectedPath(null);
        setContent("");
      }
      void loadTree();
    } catch {
      void message.error(ui.deleteFailed);
    }
  };

  const confirmDeleteFile = (path: string) => {
    Modal.confirm({
      title: ui.deleteConfirm(path),
      okText: t("delete"),
      cancelText: t("cancel"),
      okButtonProps: { danger: true },
      onOk: async () => {
        await deleteFile(path);
      },
    });
  };

  const saveFile = async () => {
    const path = creating ? newFileName : selectedPath;
    if (!path) {
      void message.error(ui.fileNameRequired);
      return;
    }

    try {
      await apiPost("/api/knowledge/file", { path, content: editContent });
      void message.success(ui.saveSuccess);
      setSelectedPath(path);
      setContent(editContent);
      setEditing(false);
      setCreating(false);
      void loadTree();
    } catch {
      void message.error(ui.saveFailed);
    }
  };

  const titleRender = (node: TreeNode) => (
    <span style={{ display: "flex", alignItems: "center", justifyContent: "space-between", width: "100%", color: colors.textPrimary }}>
      <span>{node.title}</span>
      {node.isLeaf && (
        <OverflowMenuButton
          color={colors.textSecondary}
          items={[{ key: "delete", label: t("delete"), danger: true }]}
          onItemClick={(key) => {
            if (key === "delete") {
              confirmDeleteFile(node.key);
            }
          }}
        />
      )}
    </span>
  );

  const editorStyle: React.CSSProperties = {
    flex: 1,
    background: colors.bgSecondary,
    border: `1px solid ${colors.borderStrong}`,
    color: colors.textPrimary,
    padding: 12,
    borderRadius: 8,
    resize: "none",
    fontFamily: "Consolas, Monaco, monospace",
  };

  return (
    <div style={{ display: "flex", height: "100%", background: colors.bgPrimary, color: colors.textPrimary }}>
      <div
        style={{
          width: 260,
          flexShrink: 0,
          background: colors.bgSecondary,
          borderRight: `1px solid ${colors.border}`,
          display: "flex",
          flexDirection: "column",
        }}
      >
        <div style={{ padding: "12px 8px", borderBottom: `1px solid ${colors.border}` }}>
          <Button
            block
            icon={<FileOutlined />}
            onClick={() => {
              setCreating(true);
              setEditing(false);
              setSelectedPath(null);
              setEditContent("");
              setNewFileName("");
            }}
            style={{ background: colors.bgTertiary, color: colors.textPrimary, border: `1px solid ${colors.borderStrong}` }}
          >
            {ui.createFile}
          </Button>
        </div>
        <div style={{ flex: 1, overflow: "auto", padding: "8px 4px" }}>
          <Tree
            treeData={treeData}
            titleRender={titleRender as never}
            onSelect={(keys, { node }) => {
              if ((node as TreeNode).isLeaf && keys[0]) {
                void loadFile(String(keys[0]));
              }
            }}
            style={{ background: "transparent", color: colors.textPrimary }}
          />
        </div>
      </div>

      <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
        {!selectedPath && !creating ? (
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
            <BookOutlined style={{ fontSize: 48, marginBottom: 16 }} />
            <span>{ui.emptyState}</span>
          </div>
        ) : creating ? (
          <div style={{ padding: 24, display: "flex", flexDirection: "column", gap: 12, flex: 1 }}>
            <Input
              placeholder={ui.filePathPlaceholder}
              value={newFileName}
              onChange={(event) => setNewFileName(event.target.value)}
              style={{ background: colors.bgSecondary, borderColor: colors.borderStrong, color: colors.textPrimary }}
            />
            <textarea value={editContent} onChange={(event) => setEditContent(event.target.value)} style={editorStyle} />
            <div style={{ display: "flex", gap: 8 }}>
              <Button type="primary" onClick={() => void saveFile()}>
                {t("save")}
              </Button>
              <Button onClick={() => setCreating(false)}>{t("cancel")}</Button>
            </div>
          </div>
        ) : editing ? (
          <div style={{ padding: 24, display: "flex", flexDirection: "column", gap: 12, flex: 1 }}>
            <textarea value={editContent} onChange={(event) => setEditContent(event.target.value)} style={editorStyle} />
            <div style={{ display: "flex", gap: 8 }}>
              <Button type="primary" onClick={() => void saveFile()}>
                {t("save")}
              </Button>
              <Button onClick={() => setEditing(false)}>{t("cancel")}</Button>
            </div>
          </div>
        ) : (
          <div style={{ padding: 24, flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
              <span style={{ fontWeight: 600, color: colors.textPrimary }}>{selectedPath}</span>
              <OverflowMenuButton
                color={colors.textSecondary}
                items={[
                  { key: "edit", label: t("edit") },
                  { key: "delete", label: t("delete"), danger: true },
                ]}
                onItemClick={(key) => {
                  if (key === "edit") {
                    setEditContent(content);
                    setEditing(true);
                    return;
                  }
                  if (key === "delete" && selectedPath) {
                    confirmDeleteFile(selectedPath);
                  }
                }}
              />
            </div>
            <div style={{ flex: 1, overflow: "auto", color: colors.textPrimary }}>
              <ReactMarkdown rehypePlugins={[rehypeHighlight]}>{content}</ReactMarkdown>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
