import type { Executor, Query } from '@prisma/studio-core/data';
import { workerApi } from '../db/prisma-sqlite-client';

async function runQuery(
  query: Query<unknown>,
): Promise<Record<string, unknown>[]> {
  const { sql, parameters, transformations } = query;
  const { columnNames, rows } = await workerApi.queryRaw({
    sql,
    args: parameters as unknown[],
  });

  const objectRows: Record<string, unknown>[] = rows.map((row) => {
    const obj: Record<string, unknown> = {};
    for (let i = 0; i < columnNames.length; i++) obj[columnNames[i]] = row[i];
    return obj;
  });

  if (!transformations || Object.keys(transformations).length === 0) {
    return objectRows;
  }

  const typed = transformations as Record<string, 'json-parse' | undefined>;
  for (const row of objectRows) {
    for (const column in typed) {
      if (typed[column] !== 'json-parse') continue;
      const value = row[column];
      if (typeof value === 'string') {
        try {
          row[column] = JSON.parse(value);
        } catch (err) {
          console.error(
            `Failed to JSON.parse column "${column}" with value: ${value}`,
            err,
          );
        }
      }
    }
  }
  return objectRows;
}

export const studioExecutor: Executor = {
  async execute(query) {
    try {
      const rows = await runQuery(query);
      return [null, rows] as never;
    } catch (err) {
      return [err as Error];
    }
  },

  async executeTransaction(queries) {
    try {
      await workerApi.executeRaw('BEGIN', []);
      const results: Record<string, unknown>[][] = [];
      for (const q of queries) results.push(await runQuery(q));
      await workerApi.executeRaw('COMMIT', []);
      return [null, results] as never;
    } catch (err) {
      try {
        await workerApi.executeRaw('ROLLBACK', []);
      } catch {
        /* no-op */
      }
      return [err as Error];
    }
  },
};
