export type SqliteResultSet = {
  columnNames: string[];
  declTypes: (string | null)[];
  rows: unknown[][];
};

export type WaSqliteRemote = {
  queryRaw(params: { sql: string; args: unknown[] }): Promise<SqliteResultSet>;
  executeRaw(sql: string, args: unknown[]): Promise<number>;
  executeScript(script: string): Promise<void>;
  beginTransaction(): Promise<void>;
  createSavepoint(name: string): Promise<void>;
  rollbackToSavepoint(name: string): Promise<void>;
  releaseSavepoint(name: string): Promise<void>;
  close(): Promise<void>;
};

// Structural subset of wa-sqlite's SQLiteAPI. Only the calls we make are
// declared, so consumers can pass the value returned from
// `Factory(Module)` (sync or async build) without type friction.
//
// We use `statements()` rather than `prepare_v2` directly. `prepare_v2` in
// wa-sqlite takes a SQL *pointer* into WASM heap (not a JS string), which
// would force every call site to manage `str_new`/`str_value`/`str_finish`.
// `statements()` handles that lifecycle internally and finalizes the stmt
// when the loop exits.
export type WaSqliteAPI = {
  statements(db: number, sql: string): AsyncIterable<number>;
  bind_collection(
    stmt: number,
    bindings: unknown[] | Record<string, unknown>,
  ): Promise<number>;
  step(stmt: number): Promise<number>;
  column_count(stmt: number): number;
  column_name(stmt: number, i: number): string;
  column(stmt: number, i: number): unknown;
  exec(
    db: number,
    sql: string,
    callback?: (row: unknown[], columns: string[]) => void,
  ): Promise<number>;
  changes(db: number): number;
  close(db: number): Promise<number>;
};

// wa-sqlite result-code constants we care about. SQLITE_ROW = 100,
// SQLITE_DONE = 101. Defined locally so we don't pull the whole wa-sqlite
// runtime in for two numbers.
const SQLITE_ROW = 100;

export function createWaSqliteRemote(
  sqlite3: WaSqliteAPI,
  db: number,
): WaSqliteRemote {
  return {
    // Single-statement only: we consume the first iteration of `statements`
    // and return. Prisma sends one statement per queryRaw/executeRaw call;
    // use executeScript for multi-statement SQL.
    async queryRaw({
      sql,
      args,
    }: {
      sql: string;
      args: unknown[];
    }): Promise<SqliteResultSet> {
      for await (const stmt of sqlite3.statements(db, sql)) {
        if (args.length > 0) await sqlite3.bind_collection(stmt, args);
        const n = sqlite3.column_count(stmt);
        if (n === 0) {
          await sqlite3.step(stmt);
          return { columnNames: [], declTypes: [], rows: [] };
        }
        const columnNames = Array.from({ length: n }, (_, i) =>
          sqlite3.column_name(stmt, i),
        );
        // wa-sqlite doesn't wrap `sqlite3_column_decltype`, so we always
        // pass null and let the result-set resolver fall back to per-value
        // type inference. This is less precise than declared types (e.g.
        // an all-NULL integer column defaults to Int32), but Prisma's
        // engine corrects from the schema anyway.
        const declTypes: (string | null)[] = new Array(n).fill(null);
        // N+1 calls per row (column_count + N × column). wa-sqlite exposes
        // no batch row helper — this is the API's ceiling, not a defect.
        const rows: unknown[][] = [];
        while ((await sqlite3.step(stmt)) === SQLITE_ROW) {
          const row: unknown[] = new Array(n);
          for (let i = 0; i < n; i++) row[i] = sqlite3.column(stmt, i);
          rows.push(row);
        }
        return { columnNames, declTypes, rows };
      }
      // Empty / comment-only SQL — Prisma never sends this, but return an
      // empty result if it ever happens.
      return { columnNames: [], declTypes: [], rows: [] };
    },

    async executeRaw(sql: string, args: unknown[]): Promise<number> {
      if (args.length === 0) {
        await sqlite3.exec(db, sql);
        return sqlite3.changes(db);
      }
      for await (const stmt of sqlite3.statements(db, sql)) {
        await sqlite3.bind_collection(stmt, args);
        // Drain any rows so step() reaches DONE and the statement finalizes
        // cleanly. Prisma routes RETURNING through queryRaw, not executeRaw,
        // so in practice this loop runs zero iterations.
        while ((await sqlite3.step(stmt)) === SQLITE_ROW) {
          /* discard */
        }
        return sqlite3.changes(db);
      }
      return 0;
    },

    async executeScript(script: string): Promise<void> {
      await sqlite3.exec(db, script);
    },

    async beginTransaction(): Promise<void> {
      await sqlite3.exec(db, 'BEGIN');
    },

    async createSavepoint(name: string): Promise<void> {
      await sqlite3.exec(db, `SAVEPOINT ${quoteIdent(name)}`);
    },

    async rollbackToSavepoint(name: string): Promise<void> {
      await sqlite3.exec(db, `ROLLBACK TO SAVEPOINT ${quoteIdent(name)}`);
    },

    async releaseSavepoint(name: string): Promise<void> {
      await sqlite3.exec(db, `RELEASE SAVEPOINT ${quoteIdent(name)}`);
    },

    async close(): Promise<void> {
      await sqlite3.close(db);
    },
  };
}

function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}
