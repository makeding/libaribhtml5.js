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

/**
 * Derive the current carousel mount from a served document URL.
 * `/data-broadcast/<mount>/...` maps broadcast-root paths below `<mount>`.
 */
export function deriveBroadcastRootUrl(
  documentUrl: string | URL,
  base: URL,
): URL {
  const document = new URL(documentUrl, base)
  if (document.origin !== base.origin || !document.pathname.startsWith(base.pathname)) {
    return new URL(base.href)
  }
  const relativePath = document.pathname.slice(base.pathname.length).replace(/^\/+/, '')
  const separator = relativePath.indexOf('/')
  if (separator <= 0) return new URL(base.href)
  const root = new URL(base.href)
  root.pathname = `${base.pathname}${relativePath.slice(0, separator)}/`
  root.search = ''
  root.hash = ''
  return root
}

/** Map a receiver-visible broadcast path into its isolated HTTP namespace. */
export function resolveBroadcastUrl(
  value: string | URL,
  base: URL,
  broadcastRoot: URL = base,
): URL {
  const resolved = new URL(value, base)
  if (resolved.origin !== base.origin || !/^https?:$/.test(resolved.protocol)) return resolved
  if (!resolved.pathname.startsWith(base.pathname)) {
    resolved.pathname = `${broadcastRoot.pathname}${resolved.pathname.replace(/^\/+/, '')}`
  }
  return resolved
}
