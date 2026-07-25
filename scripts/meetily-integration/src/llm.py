"""Ollama client for transcript analysis and trigger extraction.

Uses locally-loaded models:
  - ornith:9b — fast trigger extraction (cost-free, local)
  - qwen3-vl:4b — meeting summarisation
"""
import json
import logging
import httpx

logger = logging.getLogger(__name__)

DEFAULT_ENDPOINT = "http://localhost:11434"
DEFAULT_TRIGGER_MODEL = "ornith:9b"
DEFAULT_SUMMARY_MODEL = "qwen3-vl:4b"


class OllamaClient:
    """Client for Ollama chat completions used in the meeting pipeline."""

    def __init__(self, endpoint: str | None = None, model: str | None = None):
        self.endpoint = (endpoint or DEFAULT_ENDPOINT).rstrip("/")
        self.model = model or DEFAULT_TRIGGER_MODEL

    async def chat(
        self, messages: list[dict], *, format: str | None = None, **kwargs
    ) -> str:
        """Send a chat completion request to Ollama."""
        payload = {
            "model": self.model,
            "messages": messages,
            "stream": False,
            **kwargs,
        }
        if format:
            payload["format"] = format

        async with httpx.AsyncClient(timeout=120.0) as client:
            resp = await client.post(f"{self.endpoint}/api/chat", json=payload)
            resp.raise_for_status()
            data = resp.json()
            return data["message"]["content"]

    async def extract_triggers(
        self, transcript: str, action_items: list[str]
    ) -> list[dict]:
        """Extract structured action triggers from transcript action items.

        Uses ornith:9b for fast, cost-free extraction.

        Returns list of {type, params} dicts where type is one of:
          "email", "booking", "task", "save_note"
        """
        prompt = f"""Extract action triggers from this meeting transcript and action items.

TRANSCRIPT (excerpt):
{transcript[:4000]}

ACTION ITEMS:
{json.dumps(action_items, indent=2)}

Return ONLY a JSON array of trigger objects. Each object has:
  "type": one of "email", "booking", "task", "save_note"
  "params": object with trigger-specific fields

For "email": {{"recipient": str, "subject": str, "body": str}}
For "booking": {{"title": str, "date": str or null, "participant": str or null}}
For "task": {{"description": str, "assignee": str or null}}
For "save_note": {{"content": str, "topic": str}}

Return [] if no triggers found."""
        response = await self.chat([
            {
                "role": "system",
                "content": (
                    "You extract structured action triggers from meeting transcripts. "
                    "Return only valid JSON."
                ),
            },
            {"role": "user", "content": prompt},
        ])

        return self._parse_json(response)

    async def summarize(self, transcript: str) -> dict:
        """Generate structured summary from full transcript.

        Uses qwen3-vl:4b for meeting summarisation.
        """
        prompt = f"""Summarise this meeting transcript into:

Overview (2-3 sentences)
Bullet Points (key discussion points)
Action Items (concrete tasks mentioned)
Custom Notes (anything notable)

TRANSCRIPT:
{transcript[:8000]}

Return as JSON with keys: overview, bullet_points, action_items, custom_notes"""

        orig = self.model
        self.model = DEFAULT_SUMMARY_MODEL
        try:
            response = await self.chat(
                [
                    {
                        "role": "system",
                        "content": "You summarise meeting transcripts into structured JSON.",
                    },
                    {"role": "user", "content": prompt},
                ],
                format="json",
            )
            return json.loads(response)
        except (json.JSONDecodeError, KeyError) as e:
            logger.error("Summary JSON parse failed: %s", e)
            return {
                "overview": "",
                "bullet_points": [],
                "action_items": [],
                "custom_notes": "",
            }
        finally:
            self.model = orig

    def _parse_json(self, text: str) -> list[dict]:
        """Safely parse JSON from LLM response, handling markdown fences."""
        text = text.strip()
        # Remove markdown code fences if present
        if "```json" in text:
            text = text.split("```json")[1].split("```")[0].strip()
        elif "```" in text:
            text = text.split("```")[1].split("```")[0].strip()
        try:
            result = json.loads(text)
            if isinstance(result, list):
                return result
            return []
        except (json.JSONDecodeError, IndexError) as e:
            logger.warning("Failed to parse trigger JSON: %s", e)
            return []
