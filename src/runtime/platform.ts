type NavigatorPlatform = Pick<Navigator, 'maxTouchPoints' | 'platform' | 'userAgent'>

/** iOS media elements can replace the receiver player's active media session. */
export function shouldSuppressRomSoundPlayback(navigator: NavigatorPlatform): boolean {
  return /iPad|iPhone|iPod/i.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
}
