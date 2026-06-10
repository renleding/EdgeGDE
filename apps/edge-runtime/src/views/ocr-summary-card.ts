/**
 * EdgeGDE — OCR Summary Card (Read-Only)
 * Displayed after OCR confirm. Permanently replaces the verification card.
 */

export function renderSummaryCard(): string {
  return `<!-- OCR Summary -->
<div id="ocr-summary" style="padding:12px;border-top:1px solid #2d3140;background:#1c2128">
  <div style="display:flex;align-items:center;gap:8px">
    <span style="font-size:16px">✅</span>
    <span style="color:#34d399;font-size:13px;font-weight:500">ID Verified: Details added to your application</span>
  </div>
</div>`
}
