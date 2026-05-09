import { AppShell, Stack } from '@mantine/core';
import { type Icon } from '@tabler/icons-react';
import { NavButton } from './NavButton';

export interface NavItem<TId extends string> {
  id: TId;
  label: string;
  icon: Icon;
}

interface AppNavbarProps<TId extends string> {
  items: readonly NavItem<TId>[];
  activeId: TId;
  onSelect: (id: TId) => void;
}

export function AppNavbar<TId extends string>({
  items,
  activeId,
  onSelect,
}: AppNavbarProps<TId>) {
  return (
    <AppShell.Navbar p="xs">
      <AppShell.Section grow>
        <Stack align="center" gap="xs">
          {items.map((item) => (
            <NavButton
              key={item.id}
              icon={item.icon}
              label={item.label}
              active={activeId === item.id}
              onClick={() => onSelect(item.id)}
            />
          ))}
        </Stack>
      </AppShell.Section>
    </AppShell.Navbar>
  );
}
