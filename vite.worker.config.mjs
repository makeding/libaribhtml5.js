import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'

const root = path.dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  build: {
    emptyOutDir: false,
    minify: false,
    outDir: 'dist/sdk',
    rollupOptions: {
      input: path.join(root, 'src', 'browser', 'arib-vfs-worker.js'),
      output: {
        entryFileNames: 'arib-vfs-sw.js',
        format: 'iife',
        inlineDynamicImports: true,
      },
    },
  },
})
