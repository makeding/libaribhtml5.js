import { readdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const declarationRoot = fileURLToPath(new URL('../dist/types/', import.meta.url))

async function rewriteDirectory(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const filename = path.join(directory, entry.name)
    if (entry.isDirectory()) {
      await rewriteDirectory(filename)
      continue
    }
    if (!entry.name.endsWith('.d.ts')) continue

    const source = await readFile(filename, 'utf8')
    const rewritten = source.replace(
      /(\b(?:from|import)\s*\(?\s*['"][^'"]+)\.ts(['"])/g,
      '$1.js$2',
    )
    if (rewritten !== source) await writeFile(filename, rewritten)
  }
}

await rewriteDirectory(declarationRoot)
