import aribSymbolsUrl from './fonts/arib-symbols.woff?url'

type RuntimeWindow = Window & typeof globalThis & Record<string, unknown>

const televisionSymbols = 'U+1F19B-1F1AC'

/** Install the sparse receiver font without replacing ordinary Japanese text. */
export function installAribSymbolFont(target: RuntimeWindow): void {
  if (target.__ARIB_HTML5_SYMBOL_FONT__) return
  target.__ARIB_HTML5_SYMBOL_FONT__ = true

  const style = target.document.createElement('style')
  style.dataset.aribRuntime = 'symbol-font'
  const faces = ['ARIB Symbols', '丸ゴシック', '太丸ゴシック', '角ゴシック']
    .map(family => `@font-face {
      font-family: "${family}";
      src: url("${aribSymbolsUrl}") format("woff");
      font-style: normal;
      font-weight: normal;
      font-display: block;
      unicode-range: ${televisionSymbols};
    }`)
    .join('\n')
  style.textContent = `${faces}
    :root { --arib-symbol-font: "ARIB Symbols"; }
  `
  ;(target.document.head ?? target.document.documentElement).append(style)
}
