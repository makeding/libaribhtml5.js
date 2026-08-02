/** Resolve extensionless Vite source imports used by the direct Node test. */
export async function resolve(specifier, context, nextResolve) {
  if (context.parentURL?.endsWith('/src/runtime/external-media-hole.ts') &&
      specifier === './media-slot') {
    return nextResolve(`${specifier}.ts`, context)
  }
  if (context.parentURL?.endsWith('/src/runtime/media-plane-runtime.ts') &&
      (specifier === './external-media-hole' || specifier === './media-slot')) {
    return nextResolve(`${specifier}.ts`, context)
  }
  return nextResolve(specifier, context)
}
