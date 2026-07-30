import sound0 from './romsound/0.mp3'
import sound1 from './romsound/1.mp3'
import sound2 from './romsound/2.mp3'
import sound3 from './romsound/3.mp3'
import sound4 from './romsound/4.mp3'
import sound5 from './romsound/5.mp3'
import sound6 from './romsound/6.mp3'
import sound7 from './romsound/7.mp3'
import sound8 from './romsound/8.mp3'
import sound9 from './romsound/9.mp3'
import sound10 from './romsound/10.mp3'
import sound11 from './romsound/11.mp3'
import sound12 from './romsound/12.mp3'
import sound13 from './romsound/13.mp3'

const romsoundData = [
  sound0, sound1, sound2, sound3, sound4, sound5, sound6,
  sound7, sound8, sound9, sound10, sound11, sound12, sound13,
]

type RuntimeWindow = Window & typeof globalThis & Record<string, unknown>

function romSoundId(value: unknown): number | null {
  const matched = /^romsound:\/\/(\d+)$/.exec(String(value ?? ''))
  if (!matched) return null
  const id = Number(matched[1])
  return Number.isInteger(id) ? id : null
}

export function resolveRomSoundUrl(value: unknown): string | null {
  const id = romSoundId(value)
  const data = id === null ? null : romsoundData[id]
  return data ?? null
}

export function installRomSoundProtocol(target: RuntimeWindow): void {
  if (target.__ARIB_HTML5_ROMSOUND__) return
  target.__ARIB_HTML5_ROMSOUND__ = true

  const prototype = target.HTMLMediaElement?.prototype
  if (!prototype) return

  const source = Object.getOwnPropertyDescriptor(prototype, 'src')
  if (source?.get && source.set) {
    Object.defineProperty(prototype, 'src', {
      configurable: true,
      enumerable: source.enumerable,
      get: source.get,
      set(value: string) {
        source.set!.call(this, resolveRomSoundUrl(value) ?? value)
      },
    })
  }

  const play = prototype.play
  prototype.play = function(): Promise<void> {
    const configured = this.getAttribute('src')
    const resolved = resolveRomSoundUrl(configured)
    if (resolved) source?.set?.call(this, resolved)
    return play.call(this)
  }

  const rewrite = (root: Node): void => {
    const media: HTMLMediaElement[] = []
    if (root instanceof target.HTMLMediaElement) media.push(root)
    if (root instanceof target.Element || root === target.document) {
      media.push(...(root as ParentNode).querySelectorAll<HTMLMediaElement>(
        'audio[src^="romsound://"], video[src^="romsound://"]',
      ))
    }
    for (const element of media) {
      const resolved = resolveRomSoundUrl(element.getAttribute('src'))
      if (resolved) source?.set?.call(element, resolved)
    }
  }

  const observer = new target.MutationObserver((mutations) => {
    for (const mutation of mutations) {
      if (mutation.type === 'attributes') rewrite(mutation.target)
      for (const node of mutation.addedNodes) rewrite(node)
    }
  })
  observer.observe(target.document.documentElement, {
    attributes: true,
    attributeFilter: ['src'],
    childList: true,
    subtree: true,
  })
  rewrite(target.document)
}
