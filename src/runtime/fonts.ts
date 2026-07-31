import aribSymbolsUrl from './fonts/arib-symbols.woff?url'
import aribEnclosedCjkUrl from './fonts/arib-enclosed-cjk.woff?url'

type RuntimeWindow = Window & typeof globalThis & Record<string, unknown>

const televisionSymbols = 'U+1F19B-1F1AC'
const enclosedCjkSymbols = 'U+1F200-1F202, U+1F210-1F23B, U+1F240-1F248, U+1F250-1F251'

/** Install the sparse receiver font without replacing ordinary Japanese text. */
export function installAribSymbolFont(target: RuntimeWindow): void {
  if (target.__ARIB_HTML5_SYMBOL_FONT__) return
  target.__ARIB_HTML5_SYMBOL_FONT__ = true

  const style = target.document.createElement('style')
  style.dataset.aribRuntime = 'symbol-font'
  const families = ['ARIB Symbols', '丸ゴシック', '太丸ゴシック', '角ゴシック']
  const symbolFaces = families.map(family => `@font-face {
      font-family: "${family}";
      src: url("${aribSymbolsUrl}") format("woff");
      font-style: normal;
      font-weight: normal;
      font-display: block;
      unicode-range: ${televisionSymbols};
    }`)
  const enclosedCjkFaces = families.map(family => `@font-face {
      font-family: "${family}";
      src: url("${aribEnclosedCjkUrl}") format("woff");
      font-style: normal;
      font-weight: normal;
      font-display: block;
      unicode-range: ${enclosedCjkSymbols};
    }`)
  style.textContent = `${[...symbolFaces, ...enclosedCjkFaces].join('\n')}
    :root { --arib-symbol-font: "ARIB Symbols"; }
  `
  ;(target.document.head ?? target.document.documentElement).append(style)
}
