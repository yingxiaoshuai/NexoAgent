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
  size?: "small" | "middle" | "large";
  placement?: "bottomLeft" | "bottomRight" | "topLeft" | "topRight";
  stopPropagation?: boolean;
}

export const OverflowMenuButton: React.FC<OverflowMenuButtonProps> = ({
  items,
  onItemClick,
  color,
  tooltip,
  size = "small",
  placement = "bottomRight",
  stopPropagation = true,
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
        type="text"
        icon={<MoreOutlined />}
        onClick={(event) => {
          if (stopPropagation) event.stopPropagation();
        }}
        style={{ color, padding: "0 4px" }}
      />
    </Dropdown>
  );

  return tooltip ? <Tooltip title={tooltip}>{trigger}</Tooltip> : trigger;
};
