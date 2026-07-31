/**
 * Keep receiver ROM-sound URLs out of the browser's HTML parser. The runtime
 * resolves the deferred marker after it has installed the custom protocol.
 */
export function deferRomSoundMarkup(source: string): string {
  return source.replace(
    /\s+src\s*=\s*(?:(["'])(romsound:\/\/\d+)\1|(romsound:\/\/\d+)(?=[\s/>]))/gi,
    (_match, _quote: string | undefined, quoted: string | undefined, bare: string | undefined) =>
      ` data-arib-romsound="${quoted ?? bare}"`,
  )
}
