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
    // CJS main: better-sqlite3 (native) and electron-trpc behave under require().
    // electron-store v11 is ESM-only, so bundle it instead of externalizing.
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
    // No externalizeDepsPlugin: with sandbox:true the preload cannot require()
    // node_modules at runtime, so electron-trpc must be bundled into the preload.
    // 'electron' and node builtins stay external automatically.
    // Sandboxed preloads must be CommonJS (ESM preload is unsupported under
    // sandbox:true), so force a .cjs output even though the package is ESM.
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
        input: { index: resolve('src/renderer/index.html') },
      },
    },
  },
})
