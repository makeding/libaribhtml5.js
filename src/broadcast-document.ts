import { deferRomSoundMarkup } from './runtime/romsound-markup.ts'

export type BroadcastDocumentOptions = {
  /** Current carousel mount, for example /data-broadcast/sh4/. */
  basePath?: string
  /** Worker/server scope containing the mount, for example /data-broadcast/. */
  scopePath?: string
  /** Inline bootstrap inserted at the start of head, including its script tag. */
  bootstrap?: string
}

/**
 * Bootstrap a receiver-managed document before broadcaster deferred scripts run.
 *
 * A restored iframe can be parsed before the parent application's module has
 * installed its host callback.  Keep the receiver identity query usable during
 * that short window and retry the full installation once the parent is ready.
 */
export function createRuntimeBootstrap(scopePath = '/data-broadcast/'): string {
  const basePath = normalizeBasePath(scopePath)
  return `<script>
(function installAribHtml5Runtime(attempt) {
  var install
  try {
    install = parent && parent.__ARIB_HTML5_INSTALL__
  } catch (error) {
    install = null
  }
  if (typeof install === 'function') {
    try {
      install(window)
      return
    } catch (error) {
      console.error('ARIB HTML5 runtime installation failed', error)
    }
  }
  if (!navigator.receiverDevice) {
    Object.defineProperty(navigator, 'receiverDevice', {
      configurable: true,
      enumerable: true,
      value: {
        getSystemInformation: function () {
          return {
            browsername: 'unknown',
            browserversion: 'unknown',
            makerid: 'unknown',
            modelname: 'unknown',
            baseurl: new URL(${JSON.stringify(basePath)}, location.origin).href
          }
        }
      }
    })
  }
  if (attempt < 100) {
    setTimeout(function () { installAribHtml5Runtime(attempt + 1) }, 50)
  }
})(0)
</script>`
}

function normalizeBasePath(value: string | undefined): string {
  const base = value || '/data-broadcast/'
  return `/${base.replace(/^\/+|\/+$/g, '')}/`
}

export function rewriteBroadcastObjectMarkup(source: string): string {
  return source.replace(/<object\b[^>]*>/gi, tag => {
    const broadcast = /\btype\s*=\s*(?:["']video\/x-arib2-broadcast["']|video\/x-arib2-broadcast)(?:\s|\/?>)/i
      .test(tag)
    if (!broadcast) return tag
    return tag
      .replace(
        /\s+type\s*=\s*(?:["']video\/x-arib2-broadcast["']|video\/x-arib2-broadcast)/i,
        ' data-arib-type="video/x-arib2-broadcast"',
      )
      .replace(/\s+data\s*=\s*(["'])(.*?)\1/i, ' data-arib-data=$1$2$1')
  })
}

function receiverPath(path: string, base: string, scope: string): string {
  if (path.startsWith(scope)) return path
  const mount = base.startsWith(scope)
    ? base.slice(scope.length).replace(/^\/+|\/+$/g, '')
    : ''
  const requested = path.replace(/^\/+/, '')
  if (mount && (requested === mount || requested.startsWith(`${mount}/`))) {
    return `${scope}${requested}`
  }
  return `${base}${requested}`
}

export function prefixBroadcastRootAttributes(
  source: string,
  basePath?: string,
  scopePath?: string,
): string {
  const base = normalizeBasePath(basePath)
  const scope = normalizeBasePath(scopePath ?? basePath)
  return source.replace(
    /(\b(?:href|src|action|poster)\s*=\s*)(?:(['"])(\/[^/][^"']*)\2|(\/[^\s>]*))/gi,
    (match, name: string, quote: string | undefined, quotedPath: string | undefined,
      barePath: string | undefined) => {
      const path = quotedPath ?? barePath
      if (!path || path.startsWith(base)) return match
      const value = receiverPath(path, base, scope)
      return quote ? `${name}${quote}${value}${quote}` : `${name}${value}`
    },
  )
}

export function prepareBroadcastStylesheet(
  source: string,
  options: BroadcastDocumentOptions = {},
): string {
  const base = normalizeBasePath(options.basePath)
  const scope = normalizeBasePath(options.scopePath ?? options.basePath)
  return source
    .replace(
      /url\(\s*(["']?)(\/[^/)][^)]*)\1\s*\)/gi,
      (match, quote: string, path: string) => path.startsWith(base)
        ? match
        : `url(${quote}${receiverPath(path, base, scope)}${quote})`,
    )
    .replace(
      /(@import\s+)(["'])(\/[^/][^"']*)\2/gi,
      (match, keyword: string, quote: string, path: string) => path.startsWith(base)
        ? match
        : `${keyword}${quote}${receiverPath(path, base, scope)}${quote}`,
    )
}

export function prepareBroadcastHtml(
  source: string,
  options: BroadcastDocumentOptions = {},
): string {
  const prepared = prefixBroadcastRootAttributes(
    deferRomSoundMarkup(rewriteBroadcastObjectMarkup(source)),
    options.basePath,
    options.scopePath,
  )
  if (!options.bootstrap) return prepared
  const head = /<head(?:\s[^>]*)?>/i.exec(prepared)
  if (!head) return `${options.bootstrap}${prepared}`
  const offset = head.index + head[0].length
  return `${prepared.slice(0, offset)}${options.bootstrap}${prepared.slice(offset)}`
}
