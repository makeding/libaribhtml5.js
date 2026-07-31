import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'

const root = path.dirname(fileURLToPath(import.meta.url))
const broadcastRoot = path.join(root, 'samples', 'bsp4k')
const broadcastBasePath = '/data-broadcast/'

const runtimeBootstrap = `
<script>
  if (parent && typeof parent.__ARIB_HTML5_INSTALL__ === 'function') {
    parent.__ARIB_HTML5_INSTALL__(window)
  } else {
    console.error('ARIB HTML5 runtime host is not available')
  }
</script>
`

function deferStaticRomSoundSources(source) {
  return source.replace(/<(?:audio|video|source)\b[^>]*>/gi, (tag) =>
    tag.replace(
      /\bsrc\s*=\s*(?:"(romsound:\/\/\d+)"|'(romsound:\/\/\d+)'|(romsound:\/\/\d+))/gi,
      (_attribute, doubleQuoted, singleQuoted, unquoted) =>
        `data-arib-romsound="${doubleQuoted ?? singleQuoted ?? unquoted}"`,
    ),
  )
}

function broadcastHtmlMiddleware() {
  const install = (server) => {
    server.middlewares.use(async (request, response, next) => {
      const requestUrl = new URL(request.url ?? '/', 'http://localhost')
      const pathname = decodeURIComponent(requestUrl.pathname)
      if (!pathname.startsWith(broadcastBasePath)) return next()
      const broadcastPathname = `/${pathname.slice(broadcastBasePath.length)}`
      // MH-AIT supplies the entry path; neither it nor later HTML documents
      // are required to use NHK's /sh4 and /sh8 directory convention.
      if (!/\.html?$/i.test(broadcastPathname)) {
        request.url = `${broadcastPathname}${requestUrl.search}`
        return next()
      }

      const filename = path.resolve(broadcastRoot, `.${broadcastPathname}`)
      if (!filename.startsWith(`${broadcastRoot}${path.sep}`)) return next()
      try {
        const source = deferStaticRomSoundSources(await fs.readFile(filename, 'utf8'))
        const html = /<head(?:\s[^>]*)?>/i.test(source)
          ? source.replace(/<head(\s[^>]*)?>/i, (head) => `${head}${runtimeBootstrap}`)
          : `${runtimeBootstrap}${source}`
        response.statusCode = 200
        response.setHeader('Content-Type', 'text/html; charset=utf-8')
        response.setHeader('Cache-Control', 'no-store')
        response.end(html)
      } catch (error) {
        if (error && error.code === 'ENOENT') return next()
        next(error)
      }
    })
  }
  return {
    name: 'arib-broadcast-html-runtime',
    configureServer: install,
    configurePreviewServer: install,
  }
}

export default defineConfig({
  publicDir: 'samples/bsp4k',
  plugins: [broadcastHtmlMiddleware()],
})
