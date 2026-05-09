import { AppShell, MantineProvider } from '@mantine/core';
import '@mantine/core/styles.css';
import { IconBrandPrisma, IconDatabase, IconTable } from '@tabler/icons-react';
import { lazy, Suspense, useState } from 'react';
import './App.css';
import classes from './App.module.css';
import { AppHeader } from './components/AppHeader';
import { AppNavbar, type NavItem } from './components/AppNavbar';
import SqlRepl from './repl/SqlRepl';

// Defer Monaco + the TS worker (~2 MB and pinned in memory once loaded) until
// the user actually opens the Prisma view.
const PrismaRepl = lazy(() => import('./repl/PrismaRepl'));
const StudioPanel = lazy(() => import('./repl/StudioPanel'));

type View = 'prisma' | 'sql' | 'studio';

const VIEW_STORAGE_KEY = 'app-view';

const navItems: readonly NavItem<View>[] = [
  { id: 'prisma', label: 'Prisma', icon: IconBrandPrisma },
  { id: 'sql', label: 'SQL', icon: IconDatabase },
  { id: 'studio', label: 'Studio', icon: IconTable },
];

function loadInitialView(): View {
  const saved = localStorage.getItem(VIEW_STORAGE_KEY);
  if (saved === 'sql' || saved === 'studio' || saved === 'prisma') return saved;
  return 'prisma';
}

function App() {
  const [view, setView] = useState<View>(loadInitialView);
  const [prismaLoaded, setPrismaLoaded] = useState(view === 'prisma');
  const [studioLoaded, setStudioLoaded] = useState(view === 'studio');

  const handleSelect = (id: View) => {
    setView(id);
    if (id === 'prisma') setPrismaLoaded(true);
    if (id === 'studio') setStudioLoaded(true);
    localStorage.setItem(VIEW_STORAGE_KEY, id);
  };

  return (
    <MantineProvider defaultColorScheme="dark">
      <AppShell header={{ height: 56 }} navbar={{ width: 64, breakpoint: 0 }}>
        <AppHeader />
        <AppNavbar items={navItems} activeId={view} onSelect={handleSelect} />

        <AppShell.Main className={classes.main}>
          {prismaLoaded && (
            <div
              className={classes.viewPane}
              data-active={view === 'prisma' || undefined}
            >
              <Suspense fallback={null}>
                <PrismaRepl />
              </Suspense>
            </div>
          )}
          <div
            className={classes.viewPane}
            data-active={view === 'sql' || undefined}
          >
            <SqlRepl />
          </div>
          {studioLoaded && (
            <div
              className={classes.viewPane}
              data-active={view === 'studio' || undefined}
            >
              <Suspense fallback={null}>
                <StudioPanel />
              </Suspense>
            </div>
          )}
        </AppShell.Main>
      </AppShell>
    </MantineProvider>
  );
}

export default App;
