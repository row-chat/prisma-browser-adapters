# @row-chat/prisma-wa-sqlite-adapter

A [Prisma](https://www.prisma.io/) driver adapter for [`wa-sqlite`](https://github.com/rhashimoto/wa-sqlite). Used with `@prisma/client/edge`, it runs Prisma and SQLite entirely in the browser. Persistence is available through wa-sqlite's OPFS, IndexedDB, and in-memory VFSes.

## Install

```sh
npm install @row-chat/prisma-wa-sqlite-adapter wa-sqlite
```

## Demo

The [`prisma-browser-adapters` demo](https://row-chat.github.io/prisma-browser-adapters/) loads Chinook in the browser and exposes it through a Prisma Client REPL, a SQL REPL, and an embedded Prisma Studio — all client-side.

## When to choose this over `sqlite-wasm`

`@sqlite.org/sqlite-wasm` is the official build but its OPFS APIs are synchronous and require a Worker. `wa-sqlite` uses Asyncify, so every SQLite call returns a Promise. That has two consequences worth knowing:

- It can run on the main thread. A Worker is still a good idea for UI responsiveness, but it isn't required for correctness.
- Its async VFS layer supports OPFS variants that the sync API can't express, including `OPFSCoopSyncVFS` for coordinating one database across multiple tabs without a SharedWorker.

## Why a "remote"?

The adapter accepts any object matching the `WaSqliteRemote` shape, which decouples it from your worker topology. Two common setups:

- **SharedWorker.** One worker per origin holds the wa-sqlite DB; every tab attaches to it. The shared worker is the natural serialization point — no cross-tab locking required.
- **Dedicated Worker + OPFSCoopSyncVFS.** Each tab has its own wa-sqlite instance pointing at the same OPFS file; the VFS coordinates writes through the Web Locks API. More resilient to a single tab crashing, slightly higher write latency.

Construct a `WaSqliteRemote` from wa-sqlite directly with `createWaSqliteRemote(sqlite3, db)`, expose it via [Comlink](https://www.npmjs.com/package/comlink) or your transport of choice, then hand the proxy to `WaSqliteAdapterFactory` on the main thread.

## Usage

### Worker (`wa-sqlite-worker.ts`)

```ts
import {
  createWaSqliteRemote,
  type WaSqliteAPI,
} from '@row-chat/prisma-wa-sqlite-adapter';
import { Factory } from 'wa-sqlite';
import SQLiteAsyncModuleFactory from 'wa-sqlite/dist/wa-sqlite-async.mjs';
import { expose } from 'comlink';

const ready = (async () => {
  const wasmModule = await SQLiteAsyncModuleFactory();
  const sqlite3 = Factory(wasmModule) as unknown as WaSqliteAPI & {
    open_v2(path: string, flags?: number, vfs?: string): Promise<number>;
  };
  // Register an OPFS VFS here in production; `:memory:` shown for brevity.
  const db = await sqlite3.open_v2('app.db');
  await sqlite3.exec(db, 'PRAGMA foreign_keys = ON;');
  return createWaSqliteRemote(sqlite3, db);
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
  WaSqliteAdapterFactory,
  type WaSqliteRemote,
} from '@row-chat/prisma-wa-sqlite-adapter';
import { wrap } from 'comlink';

const worker = new SharedWorker(
  new URL('./wa-sqlite-worker.ts', import.meta.url),
  { type: 'module' },
);
const remote = wrap<WaSqliteRemote>(worker.port);
const adapter = new WaSqliteAdapterFactory(remote);

export const prisma = new PrismaClient({ adapter });
```

`await prisma.employee.findMany()` now runs entirely in the browser, with every tab on the origin sharing the database through the SharedWorker.

## Options

```ts
new WaSqliteAdapterFactory(remote, {
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

- The adapter doesn't import wa-sqlite directly — it talks to the `WaSqliteRemote` interface. This is what makes the worker topology the consumer's decision.
- `sqlite3_column_decltype` isn't exposed by wa-sqlite, so the adapter relies on per-value type inference. Prisma's engine corrects column types from the schema, so this is rarely visible.
- Per-tab serialization is handled by an internal mutex. Cross-tab serialization, when relevant, is the VFS's job (e.g. `OPFSCoopSyncVFS`).

## License

Apache-2.0
