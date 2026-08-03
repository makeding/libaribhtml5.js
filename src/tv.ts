/**
 * Android TV receiver build entry.
 *
 * Keep Komorebi-specific receiver integration here so the public SDK and the
 * npm package remain platform-neutral. The TV build intentionally exposes the
 * same global API as the SDK IIFE.
 */
export * from './index'
