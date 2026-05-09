import { createSQLiteAdapter } from '@prisma/studio-core/data/sqlite-core';
import { Studio } from '@prisma/studio-core/ui';
import '@prisma/studio-core/ui/index.css';
import { useMemo } from 'react';
import { studioExecutor } from './studioExecutor';

export default function StudioPanel() {
  const adapter = useMemo(
    () => createSQLiteAdapter({ executor: studioExecutor }),
    [],
  );
  return (
    <div style={{ height: '100%', width: '100%' }}>
      <Studio adapter={adapter} />
    </div>
  );
}
