/**
 * EdgeGDE — OCR Processing View
 * Shown after upload while OCR extraction runs.
 * Replaced by verification card on success, or capture view on failure.
 */

export function renderProcessingView(): string {
  return `<!-- OCR Processing -->
<div id="ocr-capture" style="padding:12px;border-top:1px solid #2d3140;background:#1c2128">
  <div style="display:flex;align-items:center;gap:10px;padding:8px 0">
    <div style="width:20px;height:20px;border:2px solid #334155;border-top-color:#60a5fa;border-radius:50%;animation:ocrSpin 0.8s linear infinite"></div>
    <div>
      <div style="color:#e1e4e8;font-size:13px;font-weight:500">📸 Reading your document…</div>
      <div style="color:#8b949e;font-size:12px;margin-top:2px">Extracting details</div>
    </div>
  </div>
</div>
<style>
@keyframes ocrSpin { to { transform: rotate(360deg); } }
</style>`
}
