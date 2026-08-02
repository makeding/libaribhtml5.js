import type { AribMediaPlaneStackEntry } from '../media-plane'
import { resolveBroadcastMediaSlot } from './media-slot'

type RuntimeWindow = Window & typeof globalThis

/**
 * Temporarily clears the DOM paint that covers an externally composed media
 * plane and restores the exact inline values when the slot changes or exits.
 */
export class ExternalMediaHoleController {
  private readonly target: RuntimeWindow
  private readonly placeholderOpacities = new Map<HTMLElement, {
    value: string
    priority: string
    computed: number
  }>()
  private readonly backgrounds = new Map<HTMLElement, {
    color: { value: string; priority: string }
    image: { value: string; priority: string }
  }>()

  constructor(target: RuntimeWindow) {
    this.target = target
  }

  set(object: HTMLElement, enabled: boolean): void {
    this.setPlaceholder(object, enabled)
    if (!enabled) {
      this.restoreBackgrounds()
      return
    }

    // An external video surface sits below the iframe. Clear backgrounds which
    // cover the slot while leaving application content on the iframe plane.
    const desired = new Set<HTMLElement>()
    for (let element = object.parentElement;
      element && element !== this.target.document.body &&
      element !== this.target.document.documentElement;
      element = element.parentElement) {
      const style = this.target.getComputedStyle(element)
      if (!this.backgrounds.has(element) && this.hasTransparentBackground(style)) continue
      desired.add(element)
    }

    const objectRect = resolveBroadcastMediaSlot(object).rect
    const coversMediaSlot = (element: HTMLElement) => {
      const rect = element.getBoundingClientRect()
      const tolerance = 1
      return rect.width > 0 && rect.height > 0 &&
        rect.left <= objectRect.left + tolerance &&
        rect.top <= objectRect.top + tolerance &&
        rect.right >= objectRect.right - tolerance &&
        rect.bottom >= objectRect.bottom - tolerance
    }
    for (const element of this.target.document.querySelectorAll<HTMLElement>('body *')) {
      if (element === object || element.contains(object) || object.contains(element)) continue
      const style = this.target.getComputedStyle(element)
      // A background already cleared by this controller computes transparent.
      // Keep tracking it while it covers the slot to avoid restore/clear churn.
      if (!this.backgrounds.has(element) && this.hasTransparentBackground(style)) continue
      if (coversMediaSlot(element)) desired.add(element)
    }

    for (const element of [...this.backgrounds.keys()]) {
      if (!desired.has(element)) this.restoreBackground(element)
    }
    for (const element of desired) {
      if (this.backgrounds.has(element)) continue
      this.backgrounds.set(element, {
        color: {
          value: element.style.getPropertyValue('background-color'),
          priority: element.style.getPropertyPriority('background-color'),
        },
        image: {
          value: element.style.getPropertyValue('background-image'),
          priority: element.style.getPropertyPriority('background-image'),
        },
      })
      element.style.setProperty('background-color', 'transparent', 'important')
      element.style.setProperty('background-image', 'none', 'important')
    }
  }

  restore(): void {
    this.restorePlaceholders()
    this.restoreBackgrounds()
  }

  describeStackingPath(object: HTMLElement): AribMediaPlaneStackEntry[] {
    const path: AribMediaPlaneStackEntry[] = []
    let element: HTMLElement | null = object
    while (element) {
      const style = this.target.getComputedStyle(element)
      path.push({
        tagName: element.tagName.toLowerCase(),
        ...(element.id ? { id: element.id } : {}),
        position: style.position,
        zIndex: style.zIndex,
        display: style.display,
        visibility: style.visibility,
        opacity: this.placeholderOpacities.get(element)?.computed ?? Number(style.opacity),
        transform: style.transform,
      })
      element = element.parentElement
    }
    return path.reverse()
  }

  private hasTransparentBackground(style: CSSStyleDeclaration): boolean {
    return (style.backgroundColor === 'rgba(0, 0, 0, 0)' ||
      style.backgroundColor === 'transparent') && style.backgroundImage === 'none'
  }

  private placeholderElements(object: HTMLElement): HTMLElement[] {
    const elements = [object]
    const slot = resolveBroadcastMediaSlot(object)
    const objectRect = slot.rect
    const tolerance = 1
    let child = object
    for (let parent = object.parentElement;
      parent && parent !== this.target.document.body &&
      parent !== this.target.document.documentElement;
      parent = parent.parentElement) {
      const rect = parent.getBoundingClientRect()
      const isMediaOnlyWrapper = parent.children.length === 1 &&
        parent.firstElementChild === child &&
        (parent === slot.element || (
          Math.abs(rect.left - objectRect.left) <= tolerance &&
          Math.abs(rect.top - objectRect.top) <= tolerance &&
          Math.abs(rect.width - objectRect.width) <= tolerance &&
          Math.abs(rect.height - objectRect.height) <= tolerance
        ))
      if (!isMediaOnlyWrapper) break
      elements.push(parent)
      child = parent
    }
    return elements
  }

  private setPlaceholder(object: HTMLElement, enabled: boolean): void {
    if (!enabled) {
      this.restorePlaceholders()
      return
    }

    const desired = new Set(this.placeholderElements(object))
    for (const element of [...this.placeholderOpacities.keys()]) {
      if (!desired.has(element)) this.restorePlaceholder(element)
    }
    for (const element of desired) {
      if (!this.placeholderOpacities.has(element)) {
        this.placeholderOpacities.set(element, {
          value: element.style.getPropertyValue('opacity'),
          priority: element.style.getPropertyPriority('opacity'),
          computed: Number(this.target.getComputedStyle(element).opacity),
        })
      }
      if (element.style.getPropertyValue('opacity') !== '0' ||
          element.style.getPropertyPriority('opacity') !== 'important') {
        element.style.setProperty('opacity', '0', 'important')
      }
    }
  }

  private restorePlaceholder(element: HTMLElement): void {
    const original = this.placeholderOpacities.get(element)
    if (!original) return
    if (original.value) element.style.setProperty('opacity', original.value, original.priority)
    else element.style.removeProperty('opacity')
    this.placeholderOpacities.delete(element)
  }

  private restorePlaceholders(): void {
    for (const element of [...this.placeholderOpacities.keys()]) {
      this.restorePlaceholder(element)
    }
  }

  private restoreBackground(element: HTMLElement): void {
    const original = this.backgrounds.get(element)
    if (!original) return
    for (const [property, value] of [
      ['background-color', original.color],
      ['background-image', original.image],
    ] as const) {
      if (value.value) element.style.setProperty(property, value.value, value.priority)
      else element.style.removeProperty(property)
    }
    this.backgrounds.delete(element)
  }

  private restoreBackgrounds(): void {
    for (const element of [...this.backgrounds.keys()]) {
      this.restoreBackground(element)
    }
  }
}
