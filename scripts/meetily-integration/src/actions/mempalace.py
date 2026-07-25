"""MemPalace knowledge base actions — persist and retrieve meeting records."""
import json
import logging
import os
import httpx

logger = logging.getLogger(__name__)


class MemPalaceClient:
    """Client for MemPalace knowledge base API."""

    def __init__(self, api_url: str | None = None):
        self.api_url = (
            api_url or os.environ.get("MEMPALACE_API_URL", "http://localhost:8910")
        ).rstrip("/")

    async def save_meeting(
        self,
        meeting_id: str,
        title: str,
        transcript: str,
        summary: dict,
        triggers: list[dict],
    ) -> bool:
        """Persist a meeting record to MemPalace."""
        payload = {
            "entity_id": f"meeting:{meeting_id}",
            "predicates": {
                "type": "meeting",
                "title": title,
                "transcript": transcript[:50000],
                "summary": json.dumps(summary),
                "triggers": json.dumps(triggers),
                "source": "meetily",
            },
        }
        try:
            async with httpx.AsyncClient(timeout=30.0) as client:
                resp = await client.post(
                    f"{self.api_url}/api/entities",
                    json=payload,
                )
                resp.raise_for_status()
                logger.info("Meeting saved to MemPalace: %s", meeting_id)
                return True
        except Exception as e:
            logger.error("MemPalace save failed: %s", e)
            return False

    async def search_meetings(self, query: str, limit: int = 5) -> list[dict]:
        """Search past meeting records in MemPalace."""
        try:
            async with httpx.AsyncClient(timeout=15.0) as client:
                resp = await client.get(
                    f"{self.api_url}/api/search",
                    params={"q": query, "limit": limit, "type": "meeting"},
                )
                resp.raise_for_status()
                return resp.json().get("results", [])
        except Exception as e:
            logger.error("MemPalace search failed: %s", e)
            return []
