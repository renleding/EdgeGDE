/**
 * EdgeGDE — OCR Capture View
 * HTMX-native capture UI: form hx-trigger="change" submits on file selection.
 * Zero client-side JS. No onchange, no onclick.
 */

export function renderCaptureView(sessionId: string): string {
  return `<!-- OCR Capture -->
<div id="ocr-capture" style="padding:12px;border-top:1px solid #2d3140;background:#1c2128">
  <form hx-post="/api/v1/ocr/upload"
        hx-target="#ocr-capture"
        hx-swap="outerHTML"
        hx-encoding="multipart/form-data"
        hx-trigger="change"
        style="display:flex;gap:8px;align-items:center">
    <input type="hidden" name="sessionId" value="${escapeHtml(sessionId)}">
    <label style="flex:1;padding:8px 12px;border-radius:8px;border:1px solid #334155;background:#0d1117;color:#e1e4e8;font-size:13px;cursor:pointer;text-align:center">
      📸 Tap to capture or choose a photo
      <input type="file" name="image" accept="image/jpeg,image/png,image/heic" style="display:none">
    </label>
    <button type="submit"
            style="padding:8px 12px;border-radius:8px;border:1px solid #334155;background:transparent;color:#8b949e;cursor:pointer;font-size:13px">
      ⌨️ Type Manually
    </button>
  </form>
</div>`
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}
