import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'

const root = path.dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  build: {
    assetsInlineLimit: Number.POSITIVE_INFINITY,
    emptyOutDir: true,
    lib: {
      entry: path.join(root, 'src', 'index.ts'),
      name: 'ARIBHTML5',
      formats: ['es', 'iife'],
      fileName: format => format === 'es' ? 'libaribhtml5.mjs' : 'libaribhtml5.js',
    },
    outDir: 'dist/sdk',
  },
})
