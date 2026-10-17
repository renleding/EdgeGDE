/**
 * Shared page chrome for afirmico-tesla.
 *
 * Centralised so every page — the root splash, the member consent flow,
 * the dashboard, and the admin console — inherits the same favicon and
 * partner mark without each renderer having to copy it.
 *
 * The TOCA logo is a local asset, not a hotlink. The source art is used
 * exactly as supplied (black disc with white artwork), even though it is
 * low-contrast on our near-black background. Brand fidelity over legibility.
 */

/** AFIRMICO favicon — served from the committed static asset. */
export const FAVICON_HREF_64 = '/favicon-64.png'
export const FAVICON_HREF_32 = '/favicon-32.png'
export const FAVICON_APPLE = '/apple-touch-icon.png'

/** Link tags injected into every <head>. */
export const FAVICON_LINK = `<link rel="icon" type="image/png" sizes="64x64" href="${FAVICON_HREF_64}"><link rel="icon" type="image/png" sizes="32x32" href="${FAVICON_HREF_32}"><link rel="apple-touch-icon" href="${FAVICON_APPLE}">`

/** Site name used in titles and chrome. */
export const SITE_NAME = 'AFIRMICO Auto'

/** TOCA logo source — local asset. */
export const TOCA_LOGO_SRC = '/toca-logo.png'

/**
 * Renders the TOCA partner mark as an <img> tag.
 *
 * @param width - Display width in pixels.
 * @returns HTML string for the mark.
 */
export function tocaMark(width: number): string {
  return `<img src="${TOCA_LOGO_SRC}" alt="Tesla Owners Club Australia" width="${width}" height="auto" style="display:block;">`
}