/**
 * EdgeGDE — Mock NDJSON Stream Helper
 * Generates deterministic streaming responses for Playwright tests.
 */

export interface MockStreamToken {
  type: 'token'
  value: string
}

export interface MockStreamFinal {
  debug?: Record<string, unknown>
  message?: string
}

export function createMockNDJSONStream(
  tokens: string[],
  finalMessage?: string
): string {
  const lines = tokens.map(t => JSON.stringify({ token: t }))
  lines.push(JSON.stringify({ done: true, message: finalMessage || tokens.join('') }))
  return lines.join('\n') + '\n'
}

export function createMockFailureStream(): string {
  return 'invalid ndjson\n'
}

export function createMockDisclosureStream(
  tokens: string[],
  finalMessage: string,
  disclosureText: string
): string {
  return createMockNDJSONStream(tokens, finalMessage + '\n\n⚠ ' + disclosureText)
}
