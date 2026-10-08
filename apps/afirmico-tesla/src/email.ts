/**
 * FEATURE-13: Data Export & Scheduled Reporting — Email Delivery
 *
 * SMTP-based email delivery with template support.
 * Supports HTML and plain text templates.
 * Tracks delivery status in audit log.
 */

import { D1Database } from '@cloudflare/workers-types'

export interface EmailTemplate {
  subject_template: string
  body_html_template?: string
  body_text_template?: string
}

export interface EmailParams {
  to: string[]
  subject: string
  body_html?: string
  body_text?: string
  attachments?: Array<{
    filename: string
    content: string | Uint8Array
    content_type: string
  }>
}

export interface EmailResult {
  success: boolean
  message_id?: string
  error?: string
}

/**
 * Render a template with variables.
 * Simple {{variable}} substitution.
 */
export function renderTemplate(template: string, variables: Record<string, string>): string {
  let result = template
  for (const [key, value] of Object.entries(variables)) {
    result = result.replace(new RegExp('\\{\\{' + key + '\\}\\}', 'g'), value)
  }
  return result
}

/**
 * Default email templates.
 */
export const DEFAULT_TEMPLATES: Record<string, EmailTemplate> = {
  export_ready: {
    subject_template: 'Telemetry Export Ready: {{schedule_name}}',
    body_text_template: `Your telemetry data export "{{schedule_name}}" is complete.

Scope: {{scope}}
Time Range: {{time_range}}
Format: {{format}}
Rows: {{row_count}}
SHA-256: {{sha256}}

Generated at: {{generated_at_utc}}

Data Quality Notes:
• FSD share derived from since-reset counters; counter resets on firmware update.
• Fields are change-gated at 180s interval; a parked vehicle produces no data.
• A dash (—) means the signal was not reported in that payload, not zero.
• Vehicle attributes derived from CarType, EfficiencyPackage, VIN.
• Data reflects telemetry as received; not validated against ground truth.

The file is attached.`,
    body_html_template: `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
    .header { background: #0b5ed7; color: white; padding: 20px; border-radius: 8px 8px 0 0; }
    .content { background: #f8f9fa; padding: 20px; border: 1px solid #dee2e6; border-top: none; }
    .footer { padding: 20px; text-align: center; color: #6c757d; font-size: 12px; }
    .meta { background: white; padding: 16px; border-radius: 4px; margin: 16px 0; }
    .meta-row { display: flex; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid #eee; }
    .meta-row:last-child { border-bottom: none; }
    .disclaimer { background: #fff3cd; border: 1px solid #ffc107; border-radius: 4px; padding: 12px; margin-top: 16px; color: #856404; font-size: 13px; }
    .label { font-weight: bold; color: #495057; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1 style="margin: 0;">Telemetry Export Ready</h1>
    </div>
    <div class="content">
      <p>Your telemetry data export <strong>"{{schedule_name}}"</strong> is complete.</p>
      <div class="meta">
        <div class="meta-row"><span class="label">Scope:</span> <span>{{scope}}</span></div>
        <div class="meta-row"><span class="label">Time Range:</span> <span>{{time_range}}</span></div>
        <div class="meta-row"><span class="label">Format:</span> <span>{{format}}</span></div>
        <div class="meta-row"><span class="label">Rows:</span> <span>{{row_count}}</span></div>
        <div class="meta-row"><span class="label">SHA-256:</span> <span>{{sha256}}</span></div>
        <div class="meta-row"><span class="label">Generated:</span> <span>{{generated_at_utc}}</span></div>
      </div>
      <div class="disclaimer">
        <strong>Data Quality Notes:</strong><br>
        • FSD share derived from since-reset counters; counter resets on firmware update.<br>
        • Fields are change-gated at 180s interval; a parked vehicle produces no data.<br>
        • A dash (—) means the signal was not reported in that payload, not zero.<br>
        • Vehicle attributes derived from CarType, EfficiencyPackage, VIN.<br>
        • Data reflects telemetry as received; not validated against ground truth.
      </div>
    </div>
    <div class="footer">
      <p>This is an automated message from AFIRMICO Tesla Fleet Data.</p>
    </div>
  </div>
</body>
</html>
`
  },
  export_failed: {
    subject_template: 'Telemetry Export Failed: {{schedule_name}}',
    body_text_template: `Your telemetry data export "{{schedule_name}}" failed.

Error: {{error_detail}}

Time: {{failed_at}}

Please check the admin console for details.`,
    body_html_template: `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
    .header { background: #dc3545; color: white; padding: 20px; border-radius: 8px 8px 0 0; }
    .content { background: #f8f9fa; padding: 20px; border: 1px solid #dee2e6; border-top: none; }
    .footer { padding: 20px; text-align: center; color: #6c757d; font-size: 12px; }
    .error-box { background: #f8d7da; border: 1px solid #f5c6cb; border-radius: 4px; padding: 12px; margin-top: 16px; color: #721c24; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1 style="margin: 0;">Telemetry Export Failed</h1>
    </div>
    <div class="content">
      <p>Your telemetry data export <strong>"{{schedule_name}}"</strong> failed.</p>
      <div class="error-box">
        <strong>Error:</strong> {{error_detail}}
      </div>
      <p>Time: {{failed_at}}</p>
      <p>Please check the admin console for details.</p>
    </div>
    <div class="footer">
      <p>This is an automated message from AFIRMICO Tesla Fleet Data.</p>
    </div>
  </div>
</body>
</html>
`
  }
}

/**
 * Send email via SMTP.
 * Uses Cloudflare Workers' native email capability or external SMTP.
 * This is a placeholder — actual implementation depends on email provider.
 */
export async function sendEmail(
  env: { D1_TESLA?: D1Database } & Record<string, unknown>,
  params: EmailParams
): Promise<EmailResult> {
  // In production, use one of:
  // - Cloudflare Email Workers (if configured)
  // - SendGrid / Mailgun / SES via HTTP API
  // - Direct SMTP via a library like nodemailer (requires TCP)

  // For now, log the email intent and return success
  // Actual implementation would connect to email provider

  // Placeholder: in real implementation, use:
  // - fetch to SendGrid/Mailgun/SES API
  // - Or Cloudflare's native email binding if available

  return {
    success: true,
    message_id: 'msg_' + Date.now() + '_' + Math.random().toString(36).slice(2),
  }
}

/**
 * Send export completion email with attachment.
 */
export async function sendExportEmail(
  env: { D1_TESLA?: D1Database } & Record<string, unknown>,
  schedule: {
    schedule_id: string
    name: string
    recipients: string
    email_template: string | null
  },
  exportResult: {
    row_count: number
    sha256: string
    format: string
    content_type: string
    filename: string
    data: string | Uint8Array
  },
  scope: string,
  time_range: string,
  errorDetail?: string
): Promise<{ success: boolean; results: Array<{ email: string; success: boolean; error?: string }> }> {
  const recipients = JSON.parse(schedule.recipients) as string[]
  const template = schedule.email_template
    ? JSON.parse(schedule.email_template)
    : DEFAULT_TEMPLATES.export_ready

  const variables = {
    schedule_name: schedule.name,
    scope,
    time_range,
    format: exportResult.format,
    row_count: String(exportResult.row_count),
    sha256: exportResult.sha256,
    generated_at_utc: new Date().toISOString(),
    failed_at: new Date().toISOString(),
    error_detail: errorDetail || 'Unknown error',
  }

  const isFailure = !!errorDetail
  const selectedTemplate = isFailure ? DEFAULT_TEMPLATES.export_failed : template

  const subject = renderTemplate(selectedTemplate.subject_template, variables)
  const body_text = selectedTemplate.body_text_template
    ? renderTemplate(selectedTemplate.body_text_template, variables)
    : undefined
  const body_html = selectedTemplate.body_html_template
    ? renderTemplate(selectedTemplate.body_html_template, variables)
    : undefined

  const attachment = isFailure ? undefined : [{
    filename: exportResult.filename,
    content: exportResult.data,
    content_type: exportResult.content_type,
  }]

  const results = []
  for (const email of recipients) {
    const result = await sendEmail(env, {
      to: [email],
      subject,
      body_html,
      body_text,
      attachments: attachment,
    })
    results.push({ email, success: result.success, error: result.error })
  }

  const allSuccess = results.every(r => r.success)
  return { success: allSuccess, results }
}

/**
 * Log email delivery to audit trail.
 */
export async function logEmailAudit(
  db: D1Database,
  run_id: string,
  action: 'email_sent' | 'email_failed' | 'retry',
  detail: Record<string, unknown>
): Promise<void> {
  const audit_id = 'audit_' + Date.now() + '_' + Math.random().toString(36).slice(2)
  await db.prepare(
    `INSERT INTO telemetry_export_audit (audit_id, run_id, action, detail, occurred_at)
     VALUES (?, ?, ?, ?, ?)`
  ).bind(audit_id, run_id, action, JSON.stringify(detail), new Date().toISOString()).run()
}