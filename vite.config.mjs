import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'

const root = path.dirname(fileURLToPath(import.meta.url))
const broadcastRoot = path.join(root, 'samples', 'bsp4k')

const runtimeBootstrap = `
<script>
  if (parent && typeof parent.__ARIB_HTML5_INSTALL__ === 'function') {
    parent.__ARIB_HTML5_INSTALL__(window)
  } else {
    console.error('ARIB HTML5 runtime host is not available')
  }
</script>
`

function broadcastHtmlMiddleware() {
  const install = (server) => {
    server.middlewares.use(async (request, response, next) => {
      const pathname = decodeURIComponent(new URL(request.url ?? '/', 'http://localhost').pathname)
      // MH-AIT supplies the entry path; neither it nor later HTML documents
      // are required to use NHK's /sh4 and /sh8 directory convention.
      if (!/\.html?$/i.test(pathname)) return next()

      const filename = path.resolve(broadcastRoot, `.${pathname}`)
      if (!filename.startsWith(`${broadcastRoot}${path.sep}`)) return next()
      try {
        const source = await fs.readFile(filename, 'utf8')
        const html = source.includes('<head>')
          ? source.replace('<head>', `<head>${runtimeBootstrap}`)
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
