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

  const mediaPrototype = target.HTMLMediaElement?.prototype
  const elementPrototype = target.Element?.prototype
  if (!mediaPrototype || !elementPrototype) return

  const resolve = (value: unknown) => resolveRomSoundUrl(value) ?? value
  const isMediaSource = (element: unknown): element is HTMLMediaElement | HTMLSourceElement =>
    element instanceof target.HTMLMediaElement ||
    Boolean(target.HTMLSourceElement && element instanceof target.HTMLSourceElement)

  // Attribute assignment bypasses the HTMLMediaElement.src property setter.
  // This is also the path used by libraries which construct media elements
  // from markup, so rewrite it synchronously before CSP sees romsound://.
  const setAttribute = elementPrototype.setAttribute
  elementPrototype.setAttribute = function(name: string, value: string): void {
    const nextValue = name.toLowerCase() === 'src' && isMediaSource(this)
      ? resolve(value)
      : value
    setAttribute.call(this, name, String(nextValue))
  }

  const setAttributeNS = elementPrototype.setAttributeNS
  elementPrototype.setAttributeNS = function(
    namespace: string | null,
    qualifiedName: string,
    value: string,
  ): void {
    const nextValue = qualifiedName.toLowerCase() === 'src' && isMediaSource(this)
      ? resolve(value)
      : value
    setAttributeNS.call(this, namespace, qualifiedName, String(nextValue))
  }

  const patchSourceProperty = (prototype: object | undefined): PropertyDescriptor | undefined => {
    if (!prototype) return undefined
    const descriptor = Object.getOwnPropertyDescriptor(prototype, 'src')
    if (!descriptor?.get || !descriptor.set) return descriptor
    Object.defineProperty(prototype, 'src', {
      configurable: true,
      enumerable: descriptor.enumerable,
      get: descriptor.get,
      set(value: string) {
        descriptor.set!.call(this, resolve(value))
      },
    })
    return descriptor
  }

  const mediaSource = patchSourceProperty(mediaPrototype)
  patchSourceProperty(target.HTMLSourceElement?.prototype)

  const play = mediaPrototype.play
  mediaPrototype.play = function(): Promise<void> {
    const resolved = resolveRomSoundUrl(this.getAttribute('src'))
    if (resolved) mediaSource?.set?.call(this, resolved)
    return play.call(this)
  }

  const rewrite = (root: Node): void => {
    const sources: Array<HTMLMediaElement | HTMLSourceElement> = []
    if (isMediaSource(root)) sources.push(root)
    if (root instanceof target.Element || root === target.document) {
      sources.push(...(root as ParentNode).querySelectorAll<HTMLMediaElement | HTMLSourceElement>(
        'audio[src^="romsound://"], video[src^="romsound://"], ' +
        'source[src^="romsound://"], [data-arib-romsound]',
      ))
    }
    for (const element of sources) {
      const deferred = element.getAttribute('data-arib-romsound')
      const configured = deferred ?? element.getAttribute('src')
      const resolved = resolveRomSoundUrl(configured)
      if (!resolved) continue
      if (element instanceof target.HTMLMediaElement && mediaSource?.set) {
        mediaSource.set.call(element, resolved)
      } else {
        setAttribute.call(element, 'src', resolved)
      }
      if (deferred !== null) element.removeAttribute('data-arib-romsound')
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
    attributeFilter: ['src', 'data-arib-romsound'],
    childList: true,
    subtree: true,
  })
  rewrite(target.document)
}
