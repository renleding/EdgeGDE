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

/** Inline SVG favicon (blue "A" on dark blue square). */
export const FAVICON_SVG = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">
  <rect width="32" height="32" fill="#0b5ed7"/>
  <text x="16" y="24" font-size="24" text-anchor="middle" fill="white" font-family="Arial" font-weight="bold">A</text>
</svg>`

/** Data URI for the favicon — inlined into every HTML response. */
export const FAVICON_DATA_URL = 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAzMiAzMiI+CiAgPHJlY3Qgd2lkdGg9IjMyIiBoZWlnaHQ9IjMyIiBmaWxsPSIjMGI1ZWQ3Ii8+CiAgPHRleHQgeD0iMTYiIHk9IjI0IiBmb250LXNpemU9IjI0IiB0ZXh0LWFuY2hvcj0ibWlkZGxlIiBmaWxsPSJ3aGl0ZSIgZm9udC1mYW1pbHk9IkFyaWFsIiBmb250LXdlaWdodD0iYm9sZCI+QTwvdGV4dD4KPC9zdmc+'

/** Link tag injected into every <head>. */
export const FAVICON_LINK = `<link rel="icon" type="image/svg+xml" href="${FAVICON_DATA_URL}">`

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