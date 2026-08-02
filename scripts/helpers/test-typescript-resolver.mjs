/** Resolve extensionless Vite source imports used by the direct Node test. */
export async function resolve(specifier, context, nextResolve) {
  if (/\.(?:mp3|woff)(?:\?url)?$/.test(specifier)) {
    return {
      url: `data:text/javascript,${encodeURIComponent(`export default ${JSON.stringify(specifier)}`)}`,
      shortCircuit: true,
    }
  }
  if (context.parentURL?.endsWith('/src/runtime/external-media-hole.ts') &&
      specifier === './media-slot') {
    return nextResolve(`${specifier}.ts`, context)
  }
  if (context.parentURL?.endsWith('/src/runtime/media-plane-runtime.ts') &&
      (specifier === './external-media-hole' || specifier === './media-slot')) {
    return nextResolve(`${specifier}.ts`, context)
  }
  if (context.parentURL?.endsWith('/src/receiver/canvas-controller.ts') &&
      specifier === '../layout') {
    return nextResolve(`${specifier}.ts`, context)
  }
  if (context.parentURL?.endsWith('/src/runtime/application-controller.ts') &&
      specifier === './application-boundary') {
    return nextResolve(`${specifier}.ts`, context)
  }
  if (context.parentURL?.includes('/src/') && context.parentURL.endsWith('.ts') &&
      /^\.\.?\//.test(specifier) && !/\.[a-z0-9]+(?:\?.*)?$/i.test(specifier)) {
    return nextResolve(`${specifier}.ts`, context)
  }
  return nextResolve(specifier, context)
}
