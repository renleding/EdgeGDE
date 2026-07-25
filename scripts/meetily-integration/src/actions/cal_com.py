"""cal.com API v2 actions — create bookings via the REST API."""
import logging
import os
import httpx

logger = logging.getLogger(__name__)

CAL_API_BASE = "https://api.cal.com/v2"
CAL_API_VERSION = "2024-06-01"


class CalComClient:
    """Client for cal.com API v2 (free plan)."""

    def __init__(self, api_key: str | None = None, event_type_id: int | None = None):
        self.api_key = api_key or os.environ.get("CAL_COM_API_KEY", "")
        self.event_type_id = event_type_id or int(
            os.environ.get("CAL_COM_EVENT_TYPE_ID", "0")
        )
        if not self.api_key:
            raise ValueError("CAL_COM_API_KEY not set")
        if not self.event_type_id:
            raise ValueError("CAL_COM_EVENT_TYPE_ID not set")

    async def create_booking(
        self,
        title: str,
        start: str,
        attendee_name: str,
        attendee_email: str,
        description: str = "",
    ) -> dict:
        """Create a Cal Video booking via API v2."""
        payload = {
            "eventTypeId": self.event_type_id,
            "start": start,
            "attendees": [
                {
                    "name": attendee_name,
                    "email": attendee_email,
                    "timeZone": "Australia/Sydney",
                }
            ],
            "title": title,
            "description": description,
            "calVideoSettings": {
                "enableAutomaticRecordingForOrganizer": False,
                "enableAutomaticTranscription": True,
            },
        }
        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.post(
                f"{CAL_API_BASE}/bookings",
                headers=self._headers(),
                json=payload,
            )
            resp.raise_for_status()
            data = resp.json()
            logger.info("Cal.com booking created: %s", data.get("uid", "unknown"))
            return data

    async def get_event_types(self) -> list[dict]:
        """List available event types (for setup/verification)."""
        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.get(
                f"{CAL_API_BASE}/event-types",
                headers=self._headers(),
            )
            resp.raise_for_status()
            data = resp.json()
            return data.get("data", data.get("eventTypes", []))

    def _headers(self) -> dict:
        return {
            "Authorization": f"Bearer {self.api_key}",
            "cal-api-version": CAL_API_VERSION,
            "Content-Type": "application/json",
        }
