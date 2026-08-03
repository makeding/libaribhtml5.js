import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'

const root = path.dirname(fileURLToPath(import.meta.url))
const komorebiRoot = process.env.KOMOREBI_ROOT
  ? path.resolve(process.env.KOMOREBI_ROOT)
  : path.resolve(root, '..', 'Komorebi')

export default defineConfig({
  build: {
    assetsInlineLimit: Number.POSITIVE_INFINITY,
    // The target directory also contains Komorebi's receiver shell.
    emptyOutDir: false,
    lib: {
      entry: path.join(root, 'src', 'tv.ts'),
      name: 'ARIBHTML5',
      formats: ['iife'],
      fileName: () => 'libaribhtml5.js',
    },
    outDir: path.join(
      komorebiRoot,
      'app',
      'src',
      'main',
      'assets',
      'libaribhtml5',
    ),
  },
})
