/**
 * EdgeGDE EDR — Runtime: Page Orchestrator (Final HTML Assembly)
 * Assembles the final deterministic HTML document from CSS + body content.
 * UTF-8, BOM-free, NFC-normalized.
 *
 * @packageDocumentation
 */

/**
 * Assemble the final deterministic HTML document from CSS and body content.
 */
export function renderPage(css: string, body: string): string {
  const rawHtml = [
    '<!DOCTYPE html>',
    '<html lang="en">',
    '<head>',
    '<meta charset="utf-8"/>',
    '<meta name="viewport" content="width=device-width, initial-scale=1"/>',
    '<style>',
    css,
    '</style>',
    '</head>',
    '<body>',
    body,
    '</body>',
    '</html>',
  ].join('')
  return rawHtml.trim().normalize('NFC')
}
