"""Salestrekker CRM actions — create and complete tasks."""
import logging
import os
import httpx

logger = logging.getLogger(__name__)


class SalestrekkerClient:
    """Client for Salestrekker CRM API."""

    def __init__(
        self,
        api_key: str | None = None,
        base_url: str | None = None,
    ):
        self.api_key = api_key or os.environ.get("SALESTREKKER_API_KEY", "")
        self.base_url = (
            base_url
            or os.environ.get("SALESTREKKER_BASE_URL", "https://api.salestrekker.com")
        ).rstrip("/")
        if not self.api_key:
            raise ValueError("SALESTREKKER_API_KEY not set")

    async def create_task(
        self,
        description: str,
        due_date: str | None = None,
        assignee: str | None = None,
    ) -> dict:
        """Create a new task in Salestrekker."""
        payload = {"description": description}
        if due_date:
            payload["due_date"] = due_date
        if assignee:
            payload["assignee"] = assignee

        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.post(
                f"{self.base_url}/api/v1/tasks",
                headers=self._headers(),
                json=payload,
            )
            resp.raise_for_status()
            data = resp.json()
            logger.info("Salestrekker task created: %s", data.get("id"))
            return data

    async def complete_task(self, task_id: str) -> dict:
        """Mark a Salestrekker task as completed."""
        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.patch(
                f"{self.base_url}/api/v1/tasks/{task_id}",
                headers=self._headers(),
                json={"status": "completed"},
            )
            resp.raise_for_status()
            logger.info("Salestrekker task %s completed", task_id)
            return resp.json()

    def _headers(self) -> dict:
        return {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
        }
