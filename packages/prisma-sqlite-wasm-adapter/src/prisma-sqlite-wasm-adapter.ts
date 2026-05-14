import type { ArgType } from '@prisma/driver-adapter-utils';
import { DriverAdapterError } from '@prisma/driver-adapter-utils';
import { convertError } from './prisma-sqlite-wasm-errors.ts';
import type { SqliteWasmRemote } from './prisma-sqlite-wasm-remote.ts';
import { resolveResultSet } from './prisma-sqlite-wasm-result-set.ts';

export {
  createSqliteWasmRemote,
  type Sqlite3DB,
  type Sqlite3Subset,
  type SqliteResultSet,
  type SqliteWasmRemote,
} from './prisma-sqlite-wasm-remote.ts';

export type SqliteWasmAdapterOptions = {
  timestampFormat?:
    | 'epoch-ms'
    | 'iso8601'
    | 'iso8601-micros'
    | 'iso8601-offset';
};

function formatDate(
  value: Date,
  options: SqliteWasmAdapterOptions | undefined,
): string | number {
  const format = options?.timestampFormat ?? 'iso8601-offset';
  switch (format) {
    case 'epoch-ms':
      return value.getTime();
    case 'iso8601':
      return value.toISOString();
    case 'iso8601-micros':
      return value.toISOString().replace(/Z$/, '000Z');
    case 'iso8601-offset':
      return value.toISOString().replace(/Z$/, '+00:00');
    default:
      throw new Error(`Unknown timestamp format: ${format}`);
  }
}

function prepareArg(
  value: unknown,
  argType: ArgType | undefined,
  options: SqliteWasmAdapterOptions | undefined,
): unknown {
  if (value === null) return null;
  switch (argType?.scalarType) {
    case 'int':
      if (typeof value === 'string') return parseInt(value, 10);
      break;
    case 'float':
    case 'decimal':
      if (typeof value === 'string') return parseFloat(value);
      break;
    case 'bigint':
      if (typeof value === 'string') return BigInt(value);
      break;
    case 'boolean':
      return value ? 1 : 0;
    case 'datetime':
      if (typeof value === 'string') value = new Date(value);
      break;
    case 'bytes': {
      if (typeof value === 'string') {
        const binary = atob(value);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
        return bytes;
      }
      return value;
    }
  }
  if (value instanceof Date) return formatDate(value, options);
  if (typeof value === 'bigint') return value;
  return value;
}

// Serializes every adapter call — including reads. SQLite's WAL mode allows
// concurrent readers, but we only hold one Sqlite3DB handle through the
// remote, so the WASM VM itself is the contention point. Parallel reads
// would require multiple remotes / connections.
class Mutex {
  #locked = false;
  #queue: Array<() => void> = [];

  acquire(): Promise<() => void> {
    return new Promise((resolve) => {
      const release = () => {
        const next = this.#queue.shift();
        if (next) next();
        else this.#locked = false;
      };
      if (this.#locked) {
        this.#queue.push(() => resolve(release));
      } else {
        this.#locked = true;
        resolve(release);
      }
    });
  }
}

class SqliteWasmTransaction {
  readonly provider = 'sqlite' as const;
  readonly adapterName = 'sqlite-wasm';
  readonly options = { usePhantomQuery: false };
  private readonly remote: SqliteWasmRemote;
  private readonly release: () => void;
  private readonly adapterOptions: SqliteWasmAdapterOptions | undefined;

  constructor(
    remote: SqliteWasmRemote,
    release: () => void,
    adapterOptions: SqliteWasmAdapterOptions | undefined,
  ) {
    this.remote = remote;
    this.release = release;
    this.adapterOptions = adapterOptions;
  }

  async queryRaw({
    sql,
    args,
    argTypes,
  }: {
    sql: string;
    args: unknown[];
    argTypes?: ArgType[];
  }) {
    try {
      const raw = await this.remote.queryRaw({
        sql,
        args: args.map((arg, i) =>
          prepareArg(arg, argTypes?.[i], this.adapterOptions),
        ),
      });
      return resolveResultSet(raw);
    } catch (error) {
      return convertError(error);
    }
  }

  async executeRaw({
    sql,
    args,
    argTypes,
  }: {
    sql: string;
    args: unknown[];
    argTypes?: ArgType[];
  }) {
    try {
      return await this.remote.executeRaw(
        sql,
        args.map((arg, i) =>
          prepareArg(arg, argTypes?.[i], this.adapterOptions),
        ),
      );
    } catch (error) {
      return convertError(error);
    }
  }

  async commit(): Promise<void> {
    this.release();
  }

  async rollback(): Promise<void> {
    this.release();
  }

  async createSavepoint(name: string): Promise<void> {
    await this.remote.createSavepoint(name);
  }

  async rollbackToSavepoint(name: string): Promise<void> {
    await this.remote.rollbackToSavepoint(name);
  }

  async releaseSavepoint(name: string): Promise<void> {
    await this.remote.releaseSavepoint(name);
  }
}

class SqliteWasmAdapter {
  readonly provider = 'sqlite' as const;
  readonly adapterName = 'sqlite-wasm';
  private readonly remote: SqliteWasmRemote;
  private readonly adapterOptions: SqliteWasmAdapterOptions | undefined;
  #mutex = new Mutex();

  constructor(
    remote: SqliteWasmRemote,
    adapterOptions: SqliteWasmAdapterOptions | undefined,
  ) {
    this.remote = remote;
    this.adapterOptions = adapterOptions;
  }

  async queryRaw({
    sql,
    args,
    argTypes,
  }: {
    sql: string;
    args: unknown[];
    argTypes?: ArgType[];
  }) {
    const release = await this.#mutex.acquire();
    try {
      const raw = await this.remote.queryRaw({
        sql,
        args: args.map((arg, i) =>
          prepareArg(arg, argTypes?.[i], this.adapterOptions),
        ),
      });
      return resolveResultSet(raw);
    } catch (error) {
      return convertError(error);
    } finally {
      release();
    }
  }

  async executeRaw({
    sql,
    args,
    argTypes,
  }: {
    sql: string;
    args: unknown[];
    argTypes?: ArgType[];
  }) {
    const release = await this.#mutex.acquire();
    try {
      return await this.remote.executeRaw(
        sql,
        args.map((arg, i) =>
          prepareArg(arg, argTypes?.[i], this.adapterOptions),
        ),
      );
    } catch (error) {
      return convertError(error);
    } finally {
      release();
    }
  }

  async executeScript(script: string): Promise<void> {
    const release = await this.#mutex.acquire();
    try {
      await this.remote.executeScript(script);
    } catch (error) {
      return convertError(error);
    } finally {
      release();
    }
  }

  async startTransaction(
    isolationLevel?: string,
  ): Promise<SqliteWasmTransaction> {
    if (isolationLevel && isolationLevel !== 'SERIALIZABLE') {
      throw new DriverAdapterError({
        kind: 'InvalidIsolationLevel',
        level: isolationLevel,
      });
    }
    const release = await this.#mutex.acquire();
    try {
      await this.remote.beginTransaction();
    } catch (error) {
      release();
      return convertError(error);
    }
    return new SqliteWasmTransaction(this.remote, release, this.adapterOptions);
  }

  async dispose(): Promise<void> {
    await this.remote.close();
  }
}

export class SqliteWasmAdapterFactory {
  readonly provider = 'sqlite' as const;
  readonly adapterName = 'sqlite-wasm';
  private readonly remote: SqliteWasmRemote;
  private readonly adapterOptions: SqliteWasmAdapterOptions | undefined;

  constructor(remote: SqliteWasmRemote, options?: SqliteWasmAdapterOptions) {
    this.remote = remote;
    this.adapterOptions = options;
  }

  async connect(): Promise<SqliteWasmAdapter> {
    return new SqliteWasmAdapter(this.remote, this.adapterOptions);
  }

  async connectToShadowDb(): Promise<SqliteWasmAdapter> {
    throw new DriverAdapterError({
      kind: 'GenericJs',
      id: 1,
      originalMessage:
        'connectToShadowDb is not supported in the browser. Run migrations at build time.',
    });
  }
}
