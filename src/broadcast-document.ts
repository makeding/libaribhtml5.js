import { deferRomSoundMarkup } from './runtime/romsound-markup.ts'

export type BroadcastDocumentOptions = {
  /** Receiver-owned same-origin URL namespace, for example /data-broadcast/. */
  basePath?: string
  /** Inline bootstrap inserted at the start of head, including its script tag. */
  bootstrap?: string
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

export function prefixBroadcastRootAttributes(source: string, basePath?: string): string {
  const base = normalizeBasePath(basePath)
  return source.replace(
    /(\b(?:href|src|action|poster)\s*=\s*)(?:(['"])(\/[^/][^"']*)\2|(\/[^\s>]*))/gi,
    (match, name: string, quote: string | undefined, quotedPath: string | undefined,
      barePath: string | undefined) => {
      const path = quotedPath ?? barePath
      if (!path || path.startsWith(base)) return match
      const value = `${base}${path.slice(1)}`
      return quote ? `${name}${quote}${value}${quote}` : `${name}${value}`
    },
  )
}

export function prepareBroadcastStylesheet(
  source: string,
  options: BroadcastDocumentOptions = {},
): string {
  const base = normalizeBasePath(options.basePath)
  return source
    .replace(
      /url\(\s*(["']?)(\/[^/)][^)]*)\1\s*\)/gi,
      (match, quote: string, path: string) => path.startsWith(base)
        ? match
        : `url(${quote}${base}${path.slice(1)}${quote})`,
    )
    .replace(
      /(@import\s+)(["'])(\/[^/][^"']*)\2/gi,
      (match, keyword: string, quote: string, path: string) => path.startsWith(base)
        ? match
        : `${keyword}${quote}${base}${path.slice(1)}${quote}`,
    )
}

export function prepareBroadcastHtml(
  source: string,
  options: BroadcastDocumentOptions = {},
): string {
  const prepared = prefixBroadcastRootAttributes(
    deferRomSoundMarkup(rewriteBroadcastObjectMarkup(source)),
    options.basePath,
  )
  if (!options.bootstrap) return prepared
  const head = /<head(?:\s[^>]*)?>/i.exec(prepared)
  if (!head) return `${options.bootstrap}${prepared}`
  const offset = head.index + head[0].length
  return `${prepared.slice(0, offset)}${options.bootstrap}${prepared.slice(offset)}`
}
