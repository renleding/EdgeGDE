"""Email sending via Zoho SMTP (business) and Gmail API (personal broker)."""
import json
import logging
import os
import smtplib
import subprocess
import tempfile
from email.mime.text import MIMEText

logger = logging.getLogger(__name__)


def send_via_zoho(
    to: str,
    subject: str,
    body: str,
    sender: str | None = None,
    password: str | None = None,
) -> bool:
    """Send email via Zoho SMTP (business email for cal.com context)."""
    sender = sender or os.environ.get("ZOHO_EMAIL", "")
    password = password or os.environ.get("ZOHO_APP_PASSWORD", "")
    if not sender or not password:
        logger.error("ZOHO_EMAIL or ZOHO_APP_PASSWORD not set")
        return False

    msg = MIMEText(body, "plain")
    msg["Subject"] = subject
    msg["From"] = sender
    msg["To"] = to

    try:
        with smtplib.SMTP_SSL("smtp.zoho.com.au", 465) as server:
            server.login(sender, password)
            server.sendmail(sender, [to], msg.as_string())
        logger.info("Email sent via Zoho to %s: %s", to, subject)
        return True
    except Exception as e:
        logger.error("Zoho email failed: %s", e)
        return False


def send_via_gmail(
    to: str,
    subject: str,
    body: str,
    credentials_path: str | None = None,
) -> bool:
    """Send email via Hermes Gmail skill (personal broker emails)."""
    creds = credentials_path or os.environ.get("GMAIL_CREDENTIALS_PATH", "")
    if not creds:
        logger.error("GMAIL_CREDENTIALS_PATH not set")
        return False

    payload = json.dumps({"to": to, "subject": subject, "body": body})
    try:
        with tempfile.NamedTemporaryFile(
            mode="w", suffix=".json", delete=False
        ) as f:
            f.write(payload)
            f.flush()
            result = subprocess.run(
                ["hermes", "tool", "gmail", "send", f.name],
                capture_output=True,
                text=True,
                timeout=30,
            )
        if result.returncode == 0:
            logger.info("Email sent via Gmail to %s: %s", to, subject)
            return True
        else:
            logger.error("Gmail send failed: %s", result.stderr)
            return False
    except Exception as e:
        logger.error("Gmail send error: %s", e)
        return False
