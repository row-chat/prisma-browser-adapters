import react from '@vitejs/plugin-react';
import path from 'path';
import { fileURLToPath } from 'url';
import type { Plugin } from 'vite';
import { defineConfig } from 'vite';
import wasm from 'vite-plugin-wasm';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const wasmPath = path.resolve(
  __dirname,
  '../../node_modules/.prisma/client/query_compiler_fast_bg.wasm',
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
