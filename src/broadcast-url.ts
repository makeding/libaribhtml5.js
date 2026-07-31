export const DEFAULT_BROADCAST_BASE_PATH = '/data-broadcast/'

export function normalizeBroadcastBaseUrl(
  value: string | URL | undefined,
  documentUrl: string | URL,
): URL {
  const base = new URL(value ?? DEFAULT_BROADCAST_BASE_PATH, documentUrl)
  if (!/^https?:$/.test(base.protocol)) {
    throw new TypeError(`Broadcast base URL must use HTTP(S): ${base.href}`)
  }
  if (!base.pathname.endsWith('/')) base.pathname += '/'
  base.search = ''
  base.hash = ''
  return base
}

/** Map a receiver-visible broadcast path into its isolated HTTP namespace. */
export function resolveBroadcastUrl(value: string | URL, base: URL): URL {
  const resolved = new URL(value, base)
  if (resolved.origin !== base.origin || !/^https?:$/.test(resolved.protocol)) return resolved
  if (!resolved.pathname.startsWith(base.pathname)) {
    resolved.pathname = `${base.pathname}${resolved.pathname.replace(/^\/+/, '')}`
  }
  return resolved
}

