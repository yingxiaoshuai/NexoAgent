import React, { useEffect, useState } from "react";
import { Tree, Button, Input, Modal, message } from "antd";
import { BookOutlined, FileOutlined } from "@ant-design/icons";
import ReactMarkdown from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import { apiGet, apiPost, apiDelete } from "../../services/api";
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
  const [treeData, setTreeData] = useState<TreeNode[]>([]);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [content, setContent] = useState("");
  const [editing, setEditing] = useState(false);
  const [creating, setCreating] = useState(false);
  const [editContent, setEditContent] = useState("");
  const [newFileName, setNewFileName] = useState("");

  const loadTree = async () => {
    try {
      const data = await apiGet<TreeNode[]>("/api/knowledge/tree");
      setTreeData(data);
    } catch {
      void message.error("加载目录失败");
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
      void message.error("加载文件失败");
    }
  };

  const deleteFile = async (path: string) => {
    try {
      await apiDelete(`/api/knowledge/file?path=${encodeURIComponent(path)}`);
      void message.success("删除成功");
      if (selectedPath === path) {
        setSelectedPath(null);
        setContent("");
      }
      void loadTree();
    } catch {
      void message.error("删除失败");
    }
  };

  const confirmDeleteFile = (path: string) => {
    Modal.confirm({
      title: `删除文件“${path}”？`,
      okText: "删除",
      cancelText: "取消",
      okButtonProps: { danger: true },
      onOk: async () => {
        await deleteFile(path);
      },
    });
  };

  const saveFile = async () => {
    const path = creating ? newFileName : selectedPath;
    if (!path) {
      void message.error("请输入文件名");
      return;
    }

    try {
      await apiPost("/api/knowledge/file", { path, content: editContent });
      void message.success("保存成功");
      setSelectedPath(path);
      setContent(editContent);
      setEditing(false);
      setCreating(false);
      void loadTree();
    } catch {
      void message.error("保存失败");
    }
  };

  const titleRender = (node: TreeNode) => (
    <span style={{ display: "flex", alignItems: "center", justifyContent: "space-between", width: "100%", color: colors.textPrimary }}>
      <span>{node.title}</span>
      {node.isLeaf && (
        <OverflowMenuButton
          color={colors.textSecondary}
          items={[{ key: "delete", label: "删除", danger: true }]}
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
            新建文件
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
            <span>选择或创建知识文件</span>
          </div>
        ) : creating ? (
          <div style={{ padding: 24, display: "flex", flexDirection: "column", gap: 12, flex: 1 }}>
            <Input
              placeholder="文件路径，例如 docs/readme.md"
              value={newFileName}
              onChange={(event) => setNewFileName(event.target.value)}
              style={{ background: colors.bgSecondary, borderColor: colors.borderStrong, color: colors.textPrimary }}
            />
            <textarea value={editContent} onChange={(event) => setEditContent(event.target.value)} style={editorStyle} />
            <div style={{ display: "flex", gap: 8 }}>
              <Button type="primary" onClick={() => void saveFile()}>
                保存
              </Button>
              <Button onClick={() => setCreating(false)}>取消</Button>
            </div>
          </div>
        ) : editing ? (
          <div style={{ padding: 24, display: "flex", flexDirection: "column", gap: 12, flex: 1 }}>
            <textarea value={editContent} onChange={(event) => setEditContent(event.target.value)} style={editorStyle} />
            <div style={{ display: "flex", gap: 8 }}>
              <Button type="primary" onClick={() => void saveFile()}>
                保存
              </Button>
              <Button onClick={() => setEditing(false)}>取消</Button>
            </div>
          </div>
        ) : (
          <div style={{ padding: 24, flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
              <span style={{ fontWeight: 600, color: colors.textPrimary }}>{selectedPath}</span>
              <OverflowMenuButton
                color={colors.textSecondary}
                items={[
                  { key: "edit", label: "编辑" },
                  { key: "delete", label: "删除", danger: true },
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
