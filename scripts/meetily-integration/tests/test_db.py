"""Tests for DB reader against fixture database."""
import pytest
import sys
import os

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "src"))

from db import MeetilyDB

FIXTURE_DB = os.path.join(os.path.dirname(__file__), "fixtures", "meeting_minutes.sqlite")


def test_get_new_meetings_returns_only_completed():
    db = MeetilyDB(FIXTURE_DB)
    meetings = db.get_new_meetings()
    assert len(meetings) == 1
    assert meetings[0]["id"] == "m1"
    assert meetings[0]["status"] == "COMPLETED"


def test_get_new_meetings_with_since_id():
    db = MeetilyDB(FIXTURE_DB)
    meetings = db.get_new_meetings(since_id="m1")
    assert len(meetings) == 0  # No completed meetings after m1


def test_get_all_meetings_limit():
    db = MeetilyDB(FIXTURE_DB)
    meetings = db.get_all_meetings(limit=1)
    assert len(meetings) == 1


def test_get_all_meetings_includes_pending():
    db = MeetilyDB(FIXTURE_DB)
    meetings = db.get_all_meetings()
    statuses = {m["status"] for m in meetings}
    assert "COMPLETED" in statuses
    assert "PENDING" in statuses
    assert "FAILED" in statuses


def test_get_meeting_by_id_found():
    db = MeetilyDB(FIXTURE_DB)
    m = db.get_meeting_by_id("m1")
    assert m is not None
    assert m["title"] == "Test Call with Client"
    assert "transcript_text" in m


def test_get_meeting_by_id_not_found():
    db = MeetilyDB(FIXTURE_DB)
    m = db.get_meeting_by_id("nonexistent")
    assert m is None


def test_get_meeting_result_is_parsed_json():
    db = MeetilyDB(FIXTURE_DB)
    m = db.get_meeting_by_id("m1")
    assert isinstance(m["result"], dict)
    assert "action_items" in m["result"]


def test_db_not_found():
    with pytest.raises(FileNotFoundError):
        MeetilyDB("/nonexistent/db.sqlite")
