# @row-chat/prisma-sqlite-wasm-adapter

A [Prisma](https://www.prisma.io/) driver adapter for [`@sqlite.org/sqlite-wasm`](https://www.npmjs.com/package/@sqlite.org/sqlite-wasm). Used with `@prisma/client/edge`, it runs Prisma and SQLite entirely in the browser. Persistence is available with [OPFS](https://sqlite.org/wasm/doc/trunk/persistence.md).

## Install

```sh
npm install @row-chat/prisma-sqlite-wasm-adapter @sqlite.org/sqlite-wasm
```

## Demo

The [`prisma-browser-adapters` demo](https://row-chat.github.io/prisma-browser-adapters/) loads Chinook in the browser and exposes it through a Prisma Client REPL, a SQL REPL, and an embedded Prisma Studio — all client-side.

## When to choose this over `wa-sqlite`

`@sqlite.org/sqlite-wasm` is the official SQLite WASM build, so it tracks upstream SQLite releases directly and ships well-tested OPFS support. Trade-offs worth knowing:

- Its OPFS API is synchronous and can only run inside a Worker. That's a hard constraint, not a recommendation — there's no way to use OPFS on the main thread with this build.
- For sharing one database across browser tabs, a `SharedWorker` is the obvious topology: the OPFS connection lives in the shared worker and every tab attaches to it. No cross-tab locking required.

If you need wa-sqlite's main-thread OPFS or its `OPFSCoopSyncVFS` for SharedWorker-less multi-tab access, look at [`@row-chat/prisma-wa-sqlite-adapter`](../prisma-wa-sqlite-adapter) instead.

## Why a "remote"?

The adapter accepts any object matching the `SqliteWasmRemote` shape, which decouples it from your worker topology. The expected setup:

- **SharedWorker.** One worker per origin holds the sqlite-wasm DB; every tab attaches to it. The shared worker is the natural serialization point and the only place the synchronous OPFS API can legally run.

Construct a `SqliteWasmRemote` from sqlite-wasm directly with `createSqliteWasmRemote(db, sqlite3)`, expose it via [Comlink](https://www.npmjs.com/package/comlink) or your transport of choice, then hand the proxy to `SqliteWasmAdapterFactory` on the main thread.

## Usage

### Worker (`sqlite-worker.ts`)

```ts
import {
  createSqliteWasmRemote,
  type Sqlite3DB,
} from '@row-chat/prisma-sqlite-wasm-adapter';
import sqlite3InitModule from '@sqlite.org/sqlite-wasm';
import { expose } from 'comlink';

const ready = (async () => {
  const sqlite3 = await sqlite3InitModule();
  const poolVfs = await sqlite3.installOpfsSAHPoolVfs({});
  const db = new poolVfs.OpfsSAHPoolDb('app.db');
  db.exec('PRAGMA foreign_keys = ON;');
  return createSqliteWasmRemote(db as unknown as Sqlite3DB, sqlite3);
})();

addEventListener('connect', async (e) => {
  const port = (e as MessageEvent).ports[0];
  expose(await ready, port);
});
```

### Main thread

```ts
import { PrismaClient } from '@prisma/client/edge';
import {
  SqliteWasmAdapterFactory,
  type SqliteWasmRemote,
} from '@row-chat/prisma-sqlite-wasm-adapter';
import { wrap } from 'comlink';

const worker = new SharedWorker(
  new URL('./sqlite-worker.ts', import.meta.url),
  { type: 'module' },
);
const remote = wrap<SqliteWasmRemote>(worker.port);
const adapter = new SqliteWasmAdapterFactory(remote);

export const prisma = new PrismaClient({ adapter });
```

`await prisma.employee.findMany()` now runs entirely in the browser, with every tab on the origin sharing the database through the SharedWorker.

## Options

```ts
new SqliteWasmAdapterFactory(remote, {
  // How `Date` values are serialized into SQLite TEXT columns.
  timestampFormat: 'iso8601-offset', // default
  // Other choices:
  //   'iso8601'         → 2026-01-15T12:34:56.789Z
  //   'iso8601-micros'  → 2026-01-15T12:34:56.789000Z
  //   'iso8601-offset'  → 2026-01-15T12:34:56.789+00:00
  //   'epoch-ms'        → 1736944496789 (number)
});
```

## Migrations

`prisma migrate` is a Node CLI and can't reach a database living in a browser. Use it during development (`prisma migrate dev` on a local SQLite file) to author `.sql` migration files, then bundle those files with the app and apply them on worker startup, tracking progress via `PRAGMA user_version`.

## Notes

- The adapter doesn't import sqlite-wasm directly — it talks to the `SqliteWasmRemote` interface. This is what makes the worker topology the consumer's decision.
- `sqlite3_column_decltype` is available through `sqlite3.capi`, so declared column types feed Prisma's type resolution directly — value inference is only the fallback.
- Per-tab serialization is handled by an internal mutex. Cross-tab serialization is the SharedWorker's job: there's only one connection, so there's nothing to coordinate.

## License

Apache-2.0
