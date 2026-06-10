/**
 * EdgeGDE — OCR Verification Card
 * Server-rendered editable field verification with Confirm/Reject.
 * Replaced by summary card via outerHTML on confirm/reject.
 */

import type { OcrExtraction } from '../lib/ocr-extractor'

export function renderVerificationCard(fields: OcrExtraction, sessionId: string): string {
  return `<!-- OCR Verification -->
<div id="ocr-verification" style="padding:12px;border-top:1px solid #2d3140;background:#1c2128">
  <div style="font-size:13px;color:#60a5fa;font-weight:500;margin-bottom:10px">✅ ID Scanned — Please verify your details</div>
  
  <form hx-post="/api/v1/ocr/confirm"
        hx-target="#ocr-verification"
        hx-swap="outerHTML"
        style="display:flex;flex-direction:column;gap:8px">
    <input type="hidden" name="sessionId" value="${escapeHtml(sessionId)}">

    <div class="ocr-field">
      <label style="font-size:11px;color:#8b949e;display:block;margin-bottom:2px">Full Name</label>
      <input type="text" name="fullName" value="${escapeHtml(fields.fullName)}"
             style="width:100%;padding:8px 10px;border-radius:6px;border:1px solid #334155;background:#0d1117;color:#e1e4e8;font-size:13px">
    </div>

    <div class="ocr-field">
      <label style="font-size:11px;color:#8b949e;display:block;margin-bottom:2px">Date of Birth</label>
      <input type="text" name="dob" value="${escapeHtml(fields.dob)}"
             style="width:100%;padding:8px 10px;border-radius:6px;border:1px solid #334155;background:#0d1117;color:#e1e4e8;font-size:13px">
    </div>

    <div class="ocr-field">
      <label style="font-size:11px;color:#8b949e;display:block;margin-bottom:2px">Address</label>
      <input type="text" name="address" value="${escapeHtml(fields.address)}"
             style="width:100%;padding:8px 10px;border-radius:6px;border:1px solid #334155;background:#0d1117;color:#e1e4e8;font-size:13px">
    </div>

    <div class="ocr-field">
      <label style="font-size:11px;color:#8b949e;display:block;margin-bottom:2px">License Number</label>
      <input type="text" name="licenseNum" value="${escapeHtml(fields.licenseNum)}"
             style="width:100%;padding:8px 10px;border-radius:6px;border:1px solid #334155;background:#0d1117;color:#e1e4e8;font-size:13px">
    </div>

    <div style="display:flex;gap:8px;margin-top:4px">
      <button type="submit" name="action" value="confirm"
              style="flex:1;padding:8px 0;border-radius:8px;border:none;background:#3b82f6;color:white;cursor:pointer;font-size:13px;font-weight:500">
        ✅ Looks Good!
      </button>
      <button type="submit" name="action" value="reject"
              style="flex:1;padding:8px 0;border-radius:8px;border:1px solid #334155;background:transparent;color:#8b949e;cursor:pointer;font-size:13px">
        ✕ Reject &amp; Manual
      </button>
    </div>
  </form>
</div>`
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}
