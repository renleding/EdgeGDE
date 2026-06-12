/**
 * Minimal Node test shims for typecheck.
 * Runtime tests run under tsx/Node, so these declarations only keep `tsc`
 * from treating Node globals as missing while avoiding an extra dependency.
 */

declare module 'node:assert' {
  function ok(value: unknown, message?: string | Error): void
  function strictEqual(actual: unknown, expected: unknown, message?: string | Error): void
  function deepStrictEqual(actual: unknown, expected: unknown, message?: string | Error): void
  function notDeepStrictEqual(actual: unknown, expected: unknown, message?: string | Error): void
  function throws(fn: () => unknown, error?: unknown, message?: string | Error): void

  const assert: {
    ok: typeof ok
    strictEqual: typeof strictEqual
    deepStrictEqual: typeof deepStrictEqual
    notDeepStrictEqual: typeof notDeepStrictEqual
    throws: typeof throws
  }

  export default assert
}

declare const process: {
  env: Record<string, string | undefined>
  exit(code?: number): never
}
