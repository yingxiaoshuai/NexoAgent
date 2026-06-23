import React from "react";
import { Button, Dropdown, type MenuProps, Tooltip } from "antd";
import { MoreOutlined } from "@ant-design/icons";

export interface OverflowMenuItem {
  key: string;
  label: React.ReactNode;
  danger?: boolean;
  disabled?: boolean;
}

interface OverflowMenuButtonProps {
  items: OverflowMenuItem[];
  onItemClick: (key: string) => void;
  color?: string;
  tooltip?: string;
  label?: React.ReactNode;
  size?: "small" | "middle" | "large";
  placement?: "bottomLeft" | "bottomRight" | "topLeft" | "topRight";
  stopPropagation?: boolean;
  variant?: "text" | "outlined";
  backgroundColor?: string;
  borderColor?: string;
}

export const OverflowMenuButton: React.FC<OverflowMenuButtonProps> = ({
  items,
  onItemClick,
  color,
  tooltip,
  label,
  size = "small",
  placement = "bottomRight",
  stopPropagation = true,
  variant = "text",
  backgroundColor,
  borderColor,
}) => {
  const menuItems = items.filter((item) => item && item.label) satisfies OverflowMenuItem[];
  if (menuItems.length === 0) return null;

  const menu: MenuProps = {
    items: menuItems.map((item) => ({
      key: item.key,
      label: item.label,
      danger: item.danger,
      disabled: item.disabled,
    })),
    onClick: ({ key, domEvent }) => {
      if (stopPropagation) domEvent.stopPropagation();
      onItemClick(String(key));
    },
  };

  const trigger = (
    <Dropdown trigger={["click"]} placement={placement} menu={menu}>
      <Button
        size={size}
        type={variant === "outlined" ? "default" : "text"}
        icon={<MoreOutlined />}
        onClick={(event) => {
          if (stopPropagation) event.stopPropagation();
        }}
        style={variant === "outlined"
          ? {
              color,
              paddingInline: label ? 10 : 8,
              borderRadius: 999,
              borderColor,
              background: backgroundColor,
              fontWeight: 600,
              boxShadow: "none",
            }
          : { color, padding: "0 4px" }}
      >
        {label}
      </Button>
    </Dropdown>
  );

  return tooltip ? <Tooltip title={tooltip}>{trigger}</Tooltip> : trigger;
};
