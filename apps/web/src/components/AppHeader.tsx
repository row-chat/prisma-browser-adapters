import { AppShell, Button, Group, ThemeIcon, Title } from '@mantine/core';
import { IconBrandGithub, IconMesh } from '@tabler/icons-react';

export function AppHeader() {
  return (
    <AppShell.Header>
      <Group h="100%" px="md" gap="sm" justify="space-between">
        <Group gap="sm">
          <ThemeIcon variant="filled" radius="xl" size={32}>
            <IconMesh size={18} stroke={2} />
          </ThemeIcon>
          <Title order={4} fw={700}>
            @row-chat/prisma-sqlite-wasm-adapter
          </Title>
        </Group>
        <Button
          component="a"
          href="https://github.com/row-chat/prisma-browser-adapters"
          target="_blank"
          rel="noopener noreferrer"
          variant="default"
          size="sm"
          leftSection={<IconBrandGithub size={18} stroke={1.75} />}
        >
          GitHub
        </Button>
      </Group>
    </AppShell.Header>
  );
}
