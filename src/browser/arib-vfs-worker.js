import {
  prepareBroadcastHtml,
  prepareBroadcastStylesheet,
} from '../broadcast-document'

const scopeUrl = new URL(self.registration.scope)
const VFS_PREFIX = scopeUrl.pathname.endsWith('/') ? scopeUrl.pathname : `${scopeUrl.pathname}/`
const CACHE_NAME = `libaribhtml5-arib-vfs-v1:${VFS_PREFIX}`
const CACHE_RESOURCE_PATH = `${VFS_PREFIX}.libaribhtml5-arib-vfs-resource`
const CACHE_SESSION_PATH = `${VFS_PREFIX}.libaribhtml5-arib-vfs-session`
const RUNTIME_BOOTSTRAP = '<script>parent.__ARIB_HTML5_INSTALL__?.(window)</script>'

const resources = new Map()
const waiters = new Map()
let enabled = false
let uniqueBasenameFallback = false
let restorePromise = null

function cacheRequest(path) {
  const url = new URL(CACHE_RESOURCE_PATH, self.location.origin)
  url.searchParams.set('path', path)
  return new Request(url.href)
}

function sessionRequest() {
  return new Request(new URL(CACHE_SESSION_PATH, self.location.origin).href)
}

async function beginPersistentSession() {
  await caches.delete(CACHE_NAME)
  const cache = await caches.open(CACHE_NAME)
  await cache.put(sessionRequest(), new Response('', {
    headers: {
      'X-Arib-VFS-Session': 'active',
      'X-Arib-VFS-Unique-Basename-Fallback': uniqueBasenameFallback ? '1' : '0',
    },
  }))
  restorePromise = null
}

async function persistResource(path, resource) {
  const cache = await caches.open(CACHE_NAME)
  await cache.put(cacheRequest(path), new Response(resource.data.slice(), {
    headers: {
      'Content-Type': resource.contentType || 'application/octet-stream',
      'X-Arib-VFS-Path': path,
    },
  }))
}

async function restorePersistentResources() {
  if (enabled) return true
  if (restorePromise) return restorePromise
  restorePromise = (async () => {
    const cache = await caches.open(CACHE_NAME)
    const session = await cache.match(sessionRequest())
    if (!session) return false
    uniqueBasenameFallback =
      session.headers.get('X-Arib-VFS-Unique-Basename-Fallback') === '1'
    for (const request of await cache.keys()) {
      const response = await cache.match(request)
      const path = response?.headers.get('X-Arib-VFS-Path')
      if (!path) continue
      resources.set(path, {
        data: new Uint8Array(await response.arrayBuffer()),
        contentType: response.headers.get('Content-Type') || '',
      })
    }
    enabled = true
    return true
  })()
  try {
    return await restorePromise
  } finally {
    restorePromise = null
  }
}

function normalizePath(value) {
  let pathname
  try {
    pathname = decodeURIComponent(new URL(String(value), self.location.origin).pathname)
  } catch {
    return null
  }
  if (pathname.startsWith(VFS_PREFIX)) pathname = pathname.slice(VFS_PREFIX.length)
  const parts = pathname.split('/').filter(Boolean)
  if (!parts.length || parts.some(part => part === '.' || part === '..')) return null
  return parts.join('/')
}

function uniqueBasenameMatch(path) {
  if (!uniqueBasenameFallback) return null
  const slash = path.lastIndexOf('/')
  const basename = slash >= 0 ? path.slice(slash + 1) : path
  if (!basename) return null
  let match = null
  for (const candidate of resources.keys()) {
    if (candidate !== basename && !candidate.endsWith(`/${basename}`)) continue
    if (match !== null) return null
    match = candidate
  }
  return match
}

function hasBroadcastRoot(path) {
  const slash = path.indexOf('/')
  const root = slash < 0 ? path : path.slice(0, slash)
  for (const candidate of resources.keys()) {
    if (candidate === root || candidate.startsWith(`${root}/`)) return true
  }
  return false
}

function hasResourceCandidate(value) {
  const path = normalizePath(value)
  return Boolean(path && (
    resources.has(path) || hasBroadcastRoot(path) || uniqueBasenameMatch(path) !== null
  ))
}

function contentType(path, supplied) {
  if (supplied) return supplied
  const extension = path.slice(path.lastIndexOf('.')).toLowerCase()
  return new Map([
    ['.html', 'text/html; charset=utf-8'],
    ['.htm', 'text/html; charset=utf-8'],
    ['.css', 'text/css; charset=utf-8'],
    ['.js', 'text/javascript; charset=utf-8'],
    ['.json', 'application/json; charset=utf-8'],
    ['.svg', 'image/svg+xml'],
    ['.png', 'image/png'],
    ['.jpg', 'image/jpeg'],
    ['.jpeg', 'image/jpeg'],
    ['.gif', 'image/gif'],
    ['.webp', 'image/webp'],
    ['.woff', 'font/woff'],
    ['.woff2', 'font/woff2'],
  ]).get(extension) || 'application/octet-stream'
}

function broadcastRootPath(path) {
  const separator = path.indexOf('/')
  return separator <= 0 ? VFS_PREFIX : `${VFS_PREFIX}${path.slice(0, separator)}/`
}

function wake(path, resource) {
  const exact = waiters.get(path)
  if (exact) {
    waiters.delete(path)
    for (const resolve of exact) resolve({ path, resource })
  }
  if (!uniqueBasenameFallback) return
  for (const [requestedPath, pending] of [...waiters]) {
    const fallback = uniqueBasenameMatch(requestedPath)
    if (!fallback) continue
    const fallbackResource = resources.get(fallback)
    if (!fallbackResource) continue
    waiters.delete(requestedPath)
    for (const resolve of pending) resolve({ path: fallback, resource: fallbackResource })
  }
}

function waitFor(path, timeout = 30000) {
  const current = resources.get(path)
  if (current) return Promise.resolve({ path, resource: current })
  const fallback = uniqueBasenameMatch(path)
  if (fallback) return Promise.resolve({ path: fallback, resource: resources.get(fallback) })
  return new Promise(resolve => {
    const pending = waiters.get(path) || new Set()
    pending.add(resolve)
    waiters.set(path, pending)
    setTimeout(() => {
      pending.delete(resolve)
      if (!pending.size) waiters.delete(path)
      resolve(null)
    }, timeout)
  })
}

async function hasAvailableResource(value) {
  await restorePersistentResources()
  const path = normalizePath(`/${value || ''}`)
  return Boolean(enabled && path && resources.has(path))
}

async function serve(request) {
  const path = normalizePath(request.url)
  if (!path) return new Response('Bad broadcast path', { status: 400 })
  const resolved = await waitFor(path)
  if (!resolved) return new Response('Broadcast resource is not available', { status: 404 })
  if (resolved.path !== path) {
    return Response.redirect(new URL(`${VFS_PREFIX}${resolved.path}`, self.location.origin), 302)
  }
  const resource = resolved.resource
  const type = contentType(path, resource.contentType)
  let body = resource.data.slice(0)
  if (/^text\/html(?:;|$)/i.test(type)) {
    const source = prepareBroadcastHtml(new TextDecoder().decode(resource.data), {
      basePath: broadcastRootPath(resolved.path),
      scopePath: VFS_PREFIX,
      bootstrap: RUNTIME_BOOTSTRAP,
    })
    body = new TextEncoder().encode(source)
  } else if (/^text\/css(?:;|$)/i.test(type)) {
    const source = prepareBroadcastStylesheet(new TextDecoder().decode(resource.data), {
      basePath: broadcastRootPath(resolved.path),
      scopePath: VFS_PREFIX,
    })
    body = new TextEncoder().encode(source)
  }
  return new Response(request.method === 'HEAD' ? null : body, {
    status: 200,
    headers: {
      'Cache-Control': 'no-store',
      'Content-Type': type,
      'Content-Security-Policy': "default-src 'self' data: blob:; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'self'; object-src 'none'; frame-src 'none'",
      'X-Content-Type-Options': 'nosniff',
    },
  })
}

self.addEventListener('install', event => {
  event.waitUntil(self.skipWaiting())
})

self.addEventListener('activate', event => {
  event.waitUntil(self.clients.claim())
})

self.addEventListener('message', event => {
  const message = event.data || {}
  const reply = value => event.ports[0]?.postMessage(value)
  const handle = async () => {
    if (message.type === 'arib-vfs-probe') {
      reply({ ok: true, available: await hasAvailableResource(message.path) })
      return
    }
    if (message.type === 'arib-vfs-begin') {
      enabled = true
      uniqueBasenameFallback = Boolean(message.uniqueBasenameFallback)
      resources.clear()
      for (const pending of waiters.values()) {
        for (const resolve of pending) resolve(null)
      }
      waiters.clear()
      await beginPersistentSession()
      reply({ ok: true })
      return
    }
    if (message.type === 'arib-vfs-put') {
      const path = normalizePath(`/${message.path || ''}`)
      if (!path || !(message.data instanceof ArrayBuffer)) {
        reply({ ok: false, error: 'invalid resource' })
        return
      }
      const resource = {
        data: new Uint8Array(message.data),
        contentType: String(message.contentType || ''),
      }
      enabled = true
      resources.set(path, resource)
      await persistResource(path, resource)
      wake(path, resource)
      reply({ ok: true })
      return
    }
    if (message.type === 'arib-vfs-reset') {
      enabled = false
      uniqueBasenameFallback = false
      resources.clear()
      restorePromise = null
      for (const pending of waiters.values()) {
        for (const resolve of pending) resolve(null)
      }
      waiters.clear()
      await caches.delete(CACHE_NAME)
      reply({ ok: true })
      return
    }
    reply({ ok: false, error: 'unsupported VFS message' })
  }
  event.waitUntil(handle().catch(error => {
    reply({ ok: false, error: error?.message || String(error) })
  }))
})

self.addEventListener('fetch', event => {
  const url = new URL(event.request.url)
  if (url.origin !== self.location.origin ||
      !url.pathname.startsWith(VFS_PREFIX) ||
      (event.request.method !== 'GET' && event.request.method !== 'HEAD')) return
  event.respondWith((async () => {
    await restorePersistentResources()
    if (!enabled || !hasResourceCandidate(url.pathname)) return fetch(event.request)
    return serve(event.request)
  })())
})
