import { resolve } from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'

const alias = {
  '@main': resolve('src/main'),
  '@shared': resolve('src/shared'),
  '@renderer': resolve('src/renderer/src'),
}

export default defineConfig({
  main: {
    resolve: { alias },
    // CJS main: better-sqlite3 (native) behaves under require(); the Agent SDK is
    // loaded via dynamic import(). electron-store v11 is ESM-only → bundle it.
    plugins: [externalizeDepsPlugin({ exclude: ['electron-store'] })],
    build: {
      rollupOptions: {
        input: { index: resolve('src/main/index.ts') },
        output: { format: 'cjs', entryFileNames: '[name].cjs' },
      },
    },
  },
  preload: {
    resolve: { alias },
    // Preload imports only 'electron' (kept external automatically) and exposes a
    // tiny IPC bridge. Output is CommonJS (.cjs): ESM preloads are unsupported
    // under sandbox:true.
    build: {
      rollupOptions: {
        input: { index: resolve('src/preload/index.ts') },
        output: { format: 'cjs', entryFileNames: '[name].cjs' },
      },
    },
  },
  renderer: {
    root: resolve('src/renderer'),
    resolve: { alias },
    plugins: [react(), tailwindcss()],
    build: {
      rollupOptions: {
        input: {
          index: resolve('src/renderer/index.html'),
          tray: resolve('src/renderer/tray.html'),
        },
      },
    },
  },
})
