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
import { deferRomSoundMarkup } from './romsound-markup'
import { shouldSuppressRomSoundPlayback } from './platform'

export { deferRomSoundMarkup } from './romsound-markup'

const romsoundData = [
  sound0, sound1, sound2, sound3, sound4, sound5, sound6,
  sound7, sound8, sound9, sound10, sound11, sound12, sound13,
]

type RuntimeWindow = Window & typeof globalThis & Record<string, unknown>

function romSoundId(value: unknown): number | null {
  const matched = /^romsound:\/\/(\d+)$/i.exec(String(value ?? ''))
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
  const suppressPlayback = shouldSuppressRomSoundPlayback(target.navigator)

  const resolve = (value: unknown) => resolveRomSoundUrl(value) ?? String(value)
  const isMediaSource = (element: unknown): element is HTMLMediaElement | HTMLSourceElement =>
    element instanceof target.HTMLMediaElement ||
    Boolean(target.HTMLSourceElement && element instanceof target.HTMLSourceElement)

  const markerName = 'data-arib-romsound'
  const getAttribute = elementPrototype.getAttribute
  const setAttribute = elementPrototype.setAttribute
  const removeAttribute = elementPrototype.removeAttribute
  const getMarker = (element: Element): string | null =>
    getAttribute.call(element, markerName)
  const rememberSource = (element: Element, value: unknown): string => {
    const configured = String(value)
    const resolved = resolveRomSoundUrl(configured)
    if (resolved) setAttribute.call(element, markerName, configured)
    else removeAttribute.call(element, markerName)
    return resolved ?? configured
  }

  const suppressSource = (element: Element, value: unknown): boolean => {
    if (!suppressPlayback || !resolveRomSoundUrl(value)) return false
    rememberSource(element, value)
    removeAttribute.call(element, 'src')
    return true
  }

  // Preserve the receiver-visible custom URL even though the browser-facing
  // attribute contains a data URL. This keeps libraries such as jQuery from
  // creating a new <audio> element on every playRomSound() call.
  elementPrototype.getAttribute = function(name: string): string | null {
    if (name.toLowerCase() === 'src' && isMediaSource(this)) {
      const configured = getMarker(this)
      if (configured !== null) return configured
    }
    return getAttribute.call(this, name)
  }

  elementPrototype.setAttribute = function(name: string, value: string): void {
    if (name.toLowerCase() === 'src' && isMediaSource(this) && suppressSource(this, value)) {
      return
    }
    const nextValue = name.toLowerCase() === 'src' && isMediaSource(this)
      ? rememberSource(this, value)
      : String(value)
    setAttribute.call(this, name, String(nextValue))
  }

  const setAttributeNS = elementPrototype.setAttributeNS
  elementPrototype.setAttributeNS = function(
    namespace: string | null,
    qualifiedName: string,
    value: string,
  ): void {
    if (qualifiedName.toLowerCase() === 'src' && isMediaSource(this) && suppressSource(this, value)) {
      return
    }
    const nextValue = qualifiedName.toLowerCase() === 'src' && isMediaSource(this)
      ? rememberSource(this, value)
      : String(value)
    setAttributeNS.call(this, namespace, qualifiedName, String(nextValue))
  }

  elementPrototype.removeAttribute = function(name: string): void {
    if (name.toLowerCase() === 'src' && isMediaSource(this)) {
      removeAttribute.call(this, markerName)
    }
    removeAttribute.call(this, name)
  }

  const patchSourceProperty = (prototype: object | undefined): PropertyDescriptor | undefined => {
    if (!prototype) return undefined
    const descriptor = Object.getOwnPropertyDescriptor(prototype, 'src')
    if (!descriptor?.get || !descriptor.set) return descriptor
    Object.defineProperty(prototype, 'src', {
      configurable: true,
      enumerable: descriptor.enumerable,
      get() {
        return isMediaSource(this) ? getMarker(this) ?? descriptor.get!.call(this) : descriptor.get!.call(this)
      },
      set(value: string) {
        if (isMediaSource(this) && suppressSource(this, value)) return
        descriptor.set!.call(this, isMediaSource(this) ? rememberSource(this, value) : resolve(value))
      },
    })
    return descriptor
  }

  const mediaSource = patchSourceProperty(mediaPrototype)
  patchSourceProperty(target.HTMLSourceElement?.prototype)

  const play = mediaPrototype.play
  mediaPrototype.play = function(): Promise<void> {
    const directSource = getMarker(this) ?? getAttribute.call(this, 'src')
    const resolved = resolveRomSoundUrl(directSource)
    if (suppressPlayback) {
      const childSource = this.querySelector?.(`source[${markerName}]`)
      const childResolved = childSource ? resolveRomSoundUrl(getMarker(childSource)) : null
      if (resolved || childResolved) return Promise.resolve()
    }
    if (resolved) mediaSource?.set?.call(this, resolved)
    return play.call(this)
  }

  const patchMarkupProperty = (prototype: object | undefined, name: 'innerHTML' | 'outerHTML') => {
    if (!prototype) return
    const descriptor = Object.getOwnPropertyDescriptor(prototype, name)
    if (!descriptor?.get || !descriptor.set) return
    Object.defineProperty(prototype, name, {
      configurable: true,
      enumerable: descriptor.enumerable,
      get: descriptor.get,
      set(value: string) {
        descriptor.set!.call(this, deferRomSoundMarkup(String(value)))
      },
    })
  }

  // HTML parsers do not call JavaScript-overridden setAttribute(). Patch the
  // markup entry points used by jQuery and application code before parsing.
  patchMarkupProperty(elementPrototype, 'innerHTML')
  patchMarkupProperty(elementPrototype, 'outerHTML')
  patchMarkupProperty(target.ShadowRoot?.prototype, 'innerHTML')

  const insertAdjacentHTML = elementPrototype.insertAdjacentHTML
  elementPrototype.insertAdjacentHTML = function(position: InsertPosition, text: string): void {
    insertAdjacentHTML.call(this, position, deferRomSoundMarkup(String(text)))
  }

  const rangePrototype = target.Range?.prototype
  if (rangePrototype) {
    const createContextualFragment = rangePrototype.createContextualFragment
    rangePrototype.createContextualFragment = function(fragment: string): DocumentFragment {
      return createContextualFragment.call(this, deferRomSoundMarkup(String(fragment)))
    }
  }

  const parserPrototype = target.DOMParser?.prototype
  if (parserPrototype) {
    const parseFromString = parserPrototype.parseFromString
    parserPrototype.parseFromString = function(string: string, type: DOMParserSupportedType): Document {
      return parseFromString.call(this, deferRomSoundMarkup(String(string)), type)
    }
  }

  const documentPrototype = target.Document?.prototype
  if (documentPrototype) {
    const write = documentPrototype.write
    const writeln = documentPrototype.writeln
    documentPrototype.write = function(...text: string[]): void {
      write.apply(this, text.map(value => deferRomSoundMarkup(String(value))))
    }
    documentPrototype.writeln = function(...text: string[]): void {
      writeln.apply(this, text.map(value => deferRomSoundMarkup(String(value))))
    }
  }

  const rewrite = (root: Node): void => {
    const sources: Array<HTMLMediaElement | HTMLSourceElement> = []
    if (isMediaSource(root)) sources.push(root)
    if (root instanceof target.Element || root === target.document) {
      sources.push(...(root as ParentNode).querySelectorAll<HTMLMediaElement | HTMLSourceElement>(
        'audio[src^="romsound://"], video[src^="romsound://"], ' +
        'source[src^="romsound://"], audio[data-arib-romsound], ' +
        'video[data-arib-romsound], source[data-arib-romsound]',
      ))
    }
    for (const element of sources) {
      const deferred = getMarker(element)
      const configured = deferred ?? getAttribute.call(element, 'src')
      const resolved = resolveRomSoundUrl(configured)
      if (!resolved) continue
      if (suppressPlayback) {
        removeAttribute.call(element, 'src')
        if (element instanceof target.HTMLMediaElement) {
          removeAttribute.call(element, 'autoplay')
          element.pause()
        }
        continue
      }
      if (element instanceof target.HTMLMediaElement && mediaSource?.set) {
        if (mediaSource.get?.call(element) !== resolved) mediaSource.set.call(element, resolved)
      } else {
        if (getAttribute.call(element, 'src') !== resolved) setAttribute.call(element, 'src', resolved)
      }
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
