"""Main action engine — orchestrates DB → LLM → action dispatch.

Processing pipeline:
  1. Read completed meeting from Meetily DB
  2. Extract action triggers via Ollama (ornith:9b)
  3. Save to MemPalace (always)
  4. Dispatch actions per trigger type:
     - email → Zoho (business) or Gmail (personal)
     - booking → cal.com API v2
     - task → Salestrekker CRM
     - save_note → already handled by MemPalace step
"""
import json
import logging
import os
from datetime import datetime, timezone, timedelta

from .db import MeetilyDB
from .llm import OllamaClient
from .actions.cal_com import CalComClient
from .actions.email import send_via_zoho, send_via_gmail
from .actions.salestrekker import SalestrekkerClient
from .actions.mempalace import MemPalaceClient

logger = logging.getLogger(__name__)

DEFAULT_DB_PATH = os.path.expanduser(
    "~/Library/Application Support/com.meetily.ai/meeting_minutes.sqlite"
)


def _env(key: str) -> str:
    val = os.environ.get(key)
    if not val:
        raise ValueError(f"Missing required env var: {key}")
    return val


async def process_meeting(meeting: dict) -> None:
    """Process a single meeting: extract triggers and dispatch actions."""
    logger.info("Processing meeting: %s", meeting.get("title", "unknown"))

    # 1. Parse summary from Meetily
    summary = meeting.get("result", {})
    if isinstance(summary, str):
        try:
            summary = json.loads(summary)
        except json.JSONDecodeError:
            summary = {"raw": summary}

    action_items = summary.get("action_items", [])
    if isinstance(action_items, str):
        action_items = [action_items]

    transcript = meeting.get("transcript_text", "")

    # 2. Extract triggers via Ollama (ornith:9b)
    llm = OllamaClient(
        endpoint=os.environ.get("OLLAMA_ENDPOINT"),
        model=os.environ.get("OLLAMA_TRIGGER_MODEL", "ornith:9b"),
    )
    triggers = await llm.extract_triggers(transcript, action_items)
    logger.info(
        "Extracted %d triggers: %s",
        len(triggers),
        [t.get("type") for t in triggers],
    )

    # 3. Save to MemPalace (always — archival)
    mempalace = MemPalaceClient(
        api_url=os.environ.get("MEMPALACE_API_URL", "http://localhost:8910"),
    )
    saved = await mempalace.save_meeting(
        meeting_id=meeting["id"],
        title=meeting.get("title", "Untitled Meeting"),
        transcript=transcript,
        summary=summary,
        triggers=triggers,
    )
    if not saved:
        logger.warning("MemPalace save failed, continuing with triggers")

    # 4. Dispatch actions per trigger type
    for trigger in triggers:
        ttype = trigger.get("type")
        params = trigger.get("params", {})
        try:
            if ttype == "email":
                await _dispatch_email(params)
            elif ttype == "booking":
                await _dispatch_booking(params, meeting)
            elif ttype == "task":
                await _dispatch_task(params)
            elif ttype == "save_note":
                logger.info(
                    "Note already saved via MemPalace: %s",
                    params.get("topic", "general"),
                )
            else:
                logger.warning("Unknown trigger type: %s", ttype)
        except Exception as e:
            logger.error("Trigger dispatch failed for %s: %s", ttype, e)

    logger.info("Meeting %s processed successfully", meeting["id"])


async def _dispatch_email(params: dict) -> None:
    """Send email via Zoho (business/cal.com) or Gmail (personal)."""
    to = params.get("recipient", "")
    subject = params.get("subject", "Meeting follow-up")
    body = params.get("body", "")

    if not to:
        logger.warning("Email trigger missing recipient")
        return

    # Try Zoho first (business emails from cal.com context)
    success = send_via_zoho(to, subject, body)
    if not success:
        # Fall back to Gmail (personal broker emails)
        logger.info("Zoho failed, trying Gmail fallback")
        send_via_gmail(to, subject, body)


async def _dispatch_booking(params: dict, meeting: dict) -> None:
    """Create a cal.com follow-up booking."""
    title = params.get("title", f"Follow-up: {meeting.get('title', 'Meeting')}")
    participant = params.get("participant", "")
    email = params.get("email", "")
    date_str = params.get("date")

    if not date_str:
        # Default: 7 days from now at 10am AEST
        future = datetime.now(timezone.utc) + timedelta(days=7)
        date_str = future.replace(hour=0, minute=0, second=0).isoformat()

    cal = CalComClient()
    await cal.create_booking(
        title=title,
        start=date_str,
        attendee_name=participant or "Client",
        attendee_email=email,
        description=(
            f"Auto-scheduled follow-up from meeting: "
            f"{meeting.get('title', '')}"
        ),
    )


async def _dispatch_task(params: dict) -> None:
    """Create a Salestrekker CRM task."""
    description = params.get("description", "")
    if not description:
        logger.warning("Task trigger missing description")
        return

    client = SalestrekkerClient()
    await client.create_task(
        description=description,
        assignee=params.get("assignee"),
    )


async def process_meeting_by_id(meeting_id: str) -> None:
    """Load a meeting from DB by ID and process it."""
    db_path = os.environ.get("MEETILY_DB_PATH") or DEFAULT_DB_PATH
    db = MeetilyDB(db_path)
    meeting = db.get_meeting_by_id(meeting_id)
    if not meeting:
        print(f"Meeting not found: {meeting_id}")
        return
    await process_meeting(meeting)


async def run_list_meetings() -> None:
    """List recent meetings from the DB for CLI inspection."""
    db_path = os.environ.get("MEETILY_DB_PATH") or DEFAULT_DB_PATH
    db = MeetilyDB(db_path)
    meetings = db.get_all_meetings(limit=20)
    if not meetings:
        print("No meetings found in database.")
        return
    print(f"{'ID':<36} {'Title':<40} {'Created':<25} {'Status':<12}")
    print("-" * 113)
    for m in meetings:
        print(
            f"{m['id'][:34]:<36} "
            f"{m['title'][:38]:<40} "
            f"{m['created_at'][:22]:<25} "
            f"{m['status']:<12}"
        )
