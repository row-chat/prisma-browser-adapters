import react from '@vitejs/plugin-react';
import { createRequire } from 'module';
import path from 'path';
import type { Plugin } from 'vite';
import { defineConfig } from 'vite';
import wasm from 'vite-plugin-wasm';

// Resolve through `@row-chat/sqlite-db/edge` so the path tracks wherever the
// generated client lives (per-package output dir, configurable in schema).
const requireFrom = createRequire(import.meta.url);
const wasmPath = path.join(
  path.dirname(requireFrom.resolve('@row-chat/sqlite-db/edge')),
  'query_compiler_fast_bg.wasm',
);

// Intercepts Prisma's #wasm-compiler-loader and uses fetch-based loading
// instead of the ESM WASM integration proposal, which Vite doesn't support.
// Prisma calls: (await (await import('#wasm-compiler-loader')).default).default
// So the default export must be a Promise resolving to { default: WebAssembly.Module }.
const wasmLoaderCode = `
  import wasmUrl from '${wasmPath}?url';
  export default fetch(wasmUrl)
    .then(r => r.arrayBuffer())
    .then(b => WebAssembly.compile(b))
    .then(m => ({ default: m }));
`;

const prismaWasmLoader: Plugin = {
  name: 'prisma-wasm-loader',
  enforce: 'pre',
  resolveId(id) {
    if (id === '#wasm-compiler-loader') return '\0prisma-wasm-loader';
  },
  load(id) {
    if (id === '\0prisma-wasm-loader') return wasmLoaderCode;
  },
};

// https://vite.dev/config/
export default defineConfig({
  base: '/prisma-browser-adapters/',
  plugins: [react(), wasm(), prismaWasmLoader],
  optimizeDeps: {
    exclude: ['@sqlite.org/sqlite-wasm'],
    rolldownOptions: {
      external: ['#wasm-compiler-loader'],
    },
  },
});
