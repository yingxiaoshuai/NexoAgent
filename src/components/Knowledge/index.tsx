import React, { useEffect, useMemo, useState } from "react";
import { Tree, Button, Input, Modal, message } from "antd";
import { BookOutlined, FileOutlined, InboxOutlined } from "@ant-design/icons";
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

interface KnowledgeApiNode {
  name: string;
  path: string;
  type: "file" | "dir";
  children?: KnowledgeApiNode[];
}

function mapApiNodeToTreeNode(node: KnowledgeApiNode): TreeNode {
  return {
    key: node.path,
    title: node.name,
    isLeaf: node.type === "file",
    children: node.children?.map(mapApiNodeToTreeNode),
  };
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
  const [dragActive, setDragActive] = useState(false);

  const ui = useMemo(
    () => ({
      createFile: lang === "zh" ? "\u65b0\u5efa\u6587\u4ef6" : "New File",
      importFiles: lang === "zh" ? "\u62d6\u62fd\u6587\u4ef6\u5bfc\u5165" : "Drop files to import",
      importHint: lang === "zh" ? "\u652f\u6301 Markdown \u548c\u6587\u672c\u6587\u4ef6\uff0c\u5bfc\u5165\u540e\u81ea\u52a8\u5efa\u7acb\u5411\u91cf\u7d22\u5f15" : "Markdown and text files are indexed automatically after import.",
      importSuccess: (count: number) =>
        lang === "zh" ? `\u5df2\u5bfc\u5165 ${count} \u4e2a\u6587\u4ef6` : `Imported ${count} file${count === 1 ? "" : "s"}.`,
      importFailed: lang === "zh" ? "\u5bfc\u5165\u6587\u4ef6\u5931\u8d25" : "Failed to import files.",
      unsupportedFile: (name: string) =>
        lang === "zh" ? `\u5df2\u8df3\u8fc7\u4e0d\u652f\u6301\u7684\u6587\u4ef6\uff1a${name}` : `Skipped unsupported file: ${name}`,
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

  function normalizeImportedPath(fileName: string) {
    const clean = fileName
      .replace(/\\/g, "/")
      .split("/")
      .filter(Boolean)
      .pop() || "imported.md";
    const withoutUnsafeChars = clean.replace(/[<>:"|?*\u0000-\u001f]/g, "-").replace(/^\.+/, "").trim();
    const fallback = `import-${new Date().toISOString().replace(/[:.]/g, "-")}.md`;
    const safeName = withoutUnsafeChars || fallback;
    return safeName.toLowerCase().endsWith(".md") ? safeName : `${safeName}.md`;
  }

  function isSupportedImport(file: File) {
    const name = file.name.toLowerCase();
    return (
      name.endsWith(".md")
      || name.endsWith(".markdown")
      || name.endsWith(".txt")
      || name.endsWith(".text")
      || file.type.startsWith("text/")
    );
  }

  async function importFiles(files: FileList | File[]) {
    const list = Array.from(files);
    if (!list.length) return;
    let imported = 0;

    try {
      for (const file of list) {
        if (!isSupportedImport(file)) {
          void message.warning(ui.unsupportedFile(file.name));
          continue;
        }
        const content = await file.text();
        await apiPost("/api/knowledge/file", {
          path: normalizeImportedPath(file.name),
          content,
        });
        imported += 1;
      }

      if (imported > 0) {
        void message.success(ui.importSuccess(imported));
        await loadTree();
      }
    } catch {
      void message.error(ui.importFailed);
    }
  }

  const loadTree = async () => {
    try {
      const data = await apiGet<KnowledgeApiNode[]>("/api/knowledge/tree");
      setTreeData(data.map(mapApiNodeToTreeNode));
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

  const handleKnowledgeDrop = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragActive(false);
    if (event.dataTransfer.files?.length) {
      void importFiles(event.dataTransfer.files);
    }
  };

  return (
    <div
      style={{ display: "flex", height: "100%", background: colors.bgPrimary, color: colors.textPrimary, position: "relative" }}
      onDragEnter={(event) => {
        if (!event.dataTransfer.types.includes("Files")) return;
        event.preventDefault();
        setDragActive(true);
      }}
      onDragOver={(event) => {
        if (!event.dataTransfer.types.includes("Files")) return;
        event.preventDefault();
      }}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
          setDragActive(false);
        }
      }}
      onDrop={handleKnowledgeDrop}
    >
      {dragActive && (
        <div
          style={{
            position: "absolute",
            inset: 12,
            zIndex: 10,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: 10,
            background: `${colors.bgPrimary}ee`,
            border: `2px dashed ${colors.accent}`,
            borderRadius: 8,
            color: colors.textPrimary,
            pointerEvents: "none",
          }}
        >
          <InboxOutlined style={{ fontSize: 40, color: colors.accent }} />
          <div style={{ fontWeight: 700 }}>{ui.importFiles}</div>
          <div style={{ color: colors.textSecondary }}>{ui.importHint}</div>
        </div>
      )}
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
          <div
            style={{
              marginTop: 10,
              padding: "10px 8px",
              border: `1px dashed ${colors.borderStrong}`,
              borderRadius: 8,
              color: colors.textSecondary,
              fontSize: 12,
              lineHeight: 1.5,
              textAlign: "center",
            }}
          >
            <InboxOutlined style={{ marginRight: 6 }} />
            {ui.importFiles}
          </div>
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
