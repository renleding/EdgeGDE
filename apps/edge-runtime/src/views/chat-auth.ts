/**
 * EdgeGDE — Chat Auth View
 * HTMX fragment: OTP input for secure flow verification.
 * Swapped into chat header area via HTMX.
 */

export function renderAuthChallenge(flowId: string, sessionId: string): string {
  return `<!-- Auth Challenge -->
<div id="auth-challenge" style="padding:8px 12px;background:#1c2128;border-top:1px solid #2d3140">
  <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">
    <span style="font-size:12px;color:#fbbf24;font-weight:500">🔒 Secure Mode</span>
    <span style="font-size:11px;color:#8b949e">Identity verification required</span>
  </div>
  <form hx-post="/api/v1/chat/auth-verify"
        hx-target="#auth-challenge"
        hx-swap="outerHTML"
        style="display:flex;gap:6px;align-items:center">
    <input type="hidden" name="sessionId" value="${escapeHtml(sessionId)}">
    <input type="hidden" name="flowId" value="${escapeHtml(flowId)}">
    <input type="text" name="otp" placeholder="Enter 6-digit code" maxlength="6" pattern="[0-9]{6}"
           style="flex:1;padding:6px 10px;border-radius:6px;border:1px solid #334155;background:#0d1117;color:#e1e4e8;font-size:13px;text-align:center;letter-spacing:4px"
           autocomplete="one-time-code">
    <button type="submit"
            style="padding:6px 14px;border-radius:6px;border:none;background:#3b82f6;color:white;cursor:pointer;font-size:12px;font-weight:500">
      Verify
    </button>
  </form>
  <div style="font-size:10px;color:#4a4d55;margin-top:4px">Code sent to your registered contact</div>
</div>`
}

export function renderSecureIndicator(): string {
  return `<span id="secure-indicator" style="display:inline-flex;align-items:center;gap:4px;padding:2px 8px;border-radius:4px;background:rgba(251,191,36,0.15);color:#fbbf24;font-size:11px;font-weight:500">
    🔒 Secure
  </span>`
}

export function renderVerifiedIndicator(): string {
  return `<span id="secure-indicator" style="display:inline-flex;align-items:center;gap:4px;padding:2px 8px;border-radius:4px;background:rgba(52,211,153,0.15);color:#34d399;font-size:11px;font-weight:500">
    ✅ Verified
  </span>`
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}
