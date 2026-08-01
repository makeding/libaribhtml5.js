export type BroadcastMediaSlot = {
  element: HTMLElement
  rect: DOMRect
}

const rectsEqual = (left: DOMRect, right: DOMRect, tolerance = 1): boolean => {
  return Math.abs(left.left - right.left) <= tolerance &&
    Math.abs(left.top - right.top) <= tolerance &&
    Math.abs(left.width - right.width) <= tolerance &&
    Math.abs(left.height - right.height) <= tolerance
}

const hasAuthorDimensions = (object: HTMLElement): boolean => {
  return object.hasAttribute('width') || object.hasAttribute('height') ||
    object.style.getPropertyValue('width') !== '' ||
    object.style.getPropertyValue('height') !== ''
}

/**
 * Resolve the receiver video slot represented by a broadcast object.
 *
 * Chromium gives an unsized `<object>` its replaced-element fallback size
 * (normally 300 x 150). Broadcast applications also use an unsized object as
 * the sole child of a positioned video-slot wrapper. In that case the wrapper,
 * rather than the browser fallback box, is the receiver media plane.
 */
export const resolveBroadcastMediaSlot = (object: HTMLElement): BroadcastMediaSlot => {
  const document = object.ownerDocument
  let element = object
  let rect = object.getBoundingClientRect()
  let child = object
  let mayAdoptDifferentSizedWrapper = !hasAuthorDimensions(object) && (
    rect.width <= 0 || rect.height <= 0 ||
    (Math.abs(rect.width - 300) <= 1 && Math.abs(rect.height - 150) <= 1)
  )

  for (let parent = object.parentElement;
    parent && parent !== document.body && parent !== document.documentElement;
    parent = parent.parentElement) {
    const parentRect = parent.getBoundingClientRect()
    const mediaOnlyWrapper = parent.children.length === 1 &&
      parent.firstElementChild === child
    const sameRect = rectsEqual(parentRect, rect)
    if (!mediaOnlyWrapper || parentRect.width <= 0 || parentRect.height <= 0 ||
        (!sameRect && !mayAdoptDifferentSizedWrapper)) break

    element = parent
    rect = parentRect
    child = parent
    mayAdoptDifferentSizedWrapper = false
  }

  return { element, rect }
}
