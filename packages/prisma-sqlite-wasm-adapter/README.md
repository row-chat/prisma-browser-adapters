# @row-chat/prisma-sqlite-wasm-adapter

A [Prisma](https://www.prisma.io/) driver adapter for [`@sqlite.org/sqlite-wasm`](https://www.npmjs.com/package/@sqlite.org/sqlite-wasm). Used with `@prisma/client/edge`, it runs Prisma and SQLite entirely in the browser. Persistence is available with [OPFS](https://sqlite.org/wasm/doc/trunk/persistence.md).

## Install

```sh
npm install @row-chat/prisma-sqlite-wasm-adapter @sqlite.org/sqlite-wasm
```

## Demo

A live example is deployed at [row-chat.github.io/prisma-sqlite-wasm-adapter](https://row-chat.github.io/prisma-sqlite-wasm-adapter/), with source at [github.com/row-chat/prisma-sqlite-wasm-adapter](https://github.com/row-chat/prisma-sqlite-wasm-adapter). It loads the [Chinook](https://github.com/lerocha/chinook-database) sample database in the browser and exposes it through a Prisma Client REPL, a raw SQL REPL, and an embedded [Prisma Studio](https://www.prisma.io/studio) — all running entirely client-side with SQLite-WASM and OPFS.

## Why a "remote"?

`sqlite-wasm`'s OPFS-backed APIs are synchronous and must run in a Worker. This adapter splits the work in two:

- **In the worker:** wrap the sqlite-wasm DB with `createSqliteWasmRemote(db, sqlite3)` and expose it (e.g. via [Comlink](https://www.npmjs.com/package/comlink)).
- **On the main thread:** wrap the worker proxy with `SqliteWasmAdapterFactory(remote)` and pass the result to `PrismaClient`.

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

`await prisma.employee.findMany()` now runs entirely in the browser.

A `SharedWorker` is used so that every browser tab on the same origin sees the same database — they all attach to the single OPFS connection living in the shared worker.

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

`prisma migrate` is a Node CLI and can't reach a database living in a browser. Use it during development (`prisma migrate dev` on a local SQLite file) to author `.sql` migration files, then bundle those files with the app and apply them on worker startup, tracking progress via `PRAGMA user_version`. See the [example app](https://github.com/row-chat/prisma-sqlite-wasm-adapter/blob/main/apps/web/src/db/sqlite-worker.ts) for one approach.

## License

Apache-2.0
