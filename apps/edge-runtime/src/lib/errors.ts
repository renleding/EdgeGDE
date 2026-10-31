/**
 * EdgeGDE — Error narrowing utilities
 *
 * TypeScript's `catch` bindings are `unknown` (and always should be), but
 * route handlers routinely need a human-readable message for the JSON error
 * envelope. These helpers perform that narrowing once, so handlers do not
 * have to fall back to an untyped catch binding.
 *
 * @packageDocumentation
 */

/**
 * Narrow an unknown thrown value to a human-readable message.
 *
 * Handles `Error` instances, string throws, and objects carrying a `message`
 * property. Never throws and never returns `undefined`.
 *
 * @param err - The value caught in a `catch` block.
 * @returns The best available message, or a generic fallback.
 */
export function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message
  if (typeof err === 'string') return err
  if (err && typeof err === 'object' && 'message' in err) {
    const message = (err as { message: unknown }).message
    if (typeof message === 'string') return message
  }
  return 'Unknown error'
}
