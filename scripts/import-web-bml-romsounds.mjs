import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const source = path.resolve(root, '..', 'web-bml', 'client', 'romsound_data.ts')
const output = path.join(root, 'src', 'runtime', 'romsound')
const text = await readFile(source, 'utf8')
const arraySource = text.match(/export const romsoundData\s*=\s*(\[[\s\S]*\]);?\s*$/)?.[1]
if (!arraySource) throw new Error(`Cannot parse ${source}`)

const sounds = JSON.parse(arraySource.replace(/,\s*]$/, ']'))
await mkdir(output, { recursive: true })
await Promise.all(sounds.map((sound, index) => {
  if (typeof sound !== 'string' || !sound.length) {
    throw new Error(`Invalid ROM sound ${index}`)
  }
  return writeFile(path.join(output, `${index}.mp3`), Buffer.from(sound, 'base64'))
}))

console.log(`Imported ${sounds.length} ROM sounds into ${output}`)
