import { Tooltip, UnstyledButton } from '@mantine/core';
import type { Icon } from '@tabler/icons-react';
import classes from './NavButton.module.css';

interface NavButtonProps {
  icon: Icon;
  label: string;
  active?: boolean;
  onClick?: () => void;
}

export function NavButton({
  icon: Icon,
  label,
  active,
  onClick,
}: NavButtonProps) {
  return (
    <Tooltip label={label} position="right" withArrow>
      <UnstyledButton
        onClick={onClick}
        data-active={active || undefined}
        className={classes.button}
      >
        <Icon size={20} stroke={1.5} />
      </UnstyledButton>
    </Tooltip>
  );
}
