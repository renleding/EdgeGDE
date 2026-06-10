/**
 * EdgeGDE — OTP Auth (Flow-Scoped)
 *
 * One-time password verification bound to a flow within ChatSession_DO.
 * OTP is generated and verified entirely within the session — no external
 * SMS/email integration in v1. Stored in-memory, max 3 attempts, 5min TTL.
 */

const ATTEMPT_LIMIT = 3
const TTL_MS = 5 * 60 * 1000

interface OtpState {
  code: string
  attempts: number
  expiresAt: number
}

const otpStore = new Map<string, OtpState>()

export function generateOtp(sessionId: string, flowId: string): string {
  const key = `${sessionId}:${flowId}`
  const code = Math.floor(100000 + Math.random() * 900000).toString()
  otpStore.set(key, { code, attempts: 0, expiresAt: Date.now() + TTL_MS })
  return code
}

export function verifyOtp(sessionId: string, flowId: string, code: string): { valid: boolean; reason?: string } {
  const key = `${sessionId}:${flowId}`
  const otp = otpStore.get(key)

  if (!otp) return { valid: false, reason: 'NO_CHALLENGE' }
  if (Date.now() > otp.expiresAt) {
    otpStore.delete(key)
    return { valid: false, reason: 'EXPIRED' }
  }
  if (otp.attempts >= ATTEMPT_LIMIT) {
    otpStore.delete(key)
    return { valid: false, reason: 'ATTEMPTS_EXCEEDED' }
  }

  otp.attempts++

  if (otp.code !== code) {
    return { valid: false, reason: 'INCORRECT_CODE' }
  }

  otpStore.delete(key)
  return { valid: true }
}
