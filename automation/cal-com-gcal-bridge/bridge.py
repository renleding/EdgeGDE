#!/usr/bin/env python3
"""cal.com -> Google Calendar bridge.

Polls cal.com /v2/bookings and mirrors every ACCEPTED booking into a Google
Calendar so bookings made on cal.com (whose destination is Apple/iOS only)
also appear in Google Calendar.

Design:
  - Source of truth for identity = cal.com booking `uid` (stable, also the
    iCalUID). Stored on the Google event as extendedProperties.private so we
    can dedupe without an external state file.
  - Reschedule = same uid, different time/title -> update the Google event.
  - Cancellation = booking status CANCELLED -> delete the Google event.
  - Token refresh is handled inline (google_token.json holds refresh_token;
    access tokens last ~1 hour, the bridge refreshes when expired).

Schedule is enforced by the launchd agent (see com.calcom-gcal-bridge.plist):
  Mon-Fri every 15 min, Sat-Sun every 30 min, 08:00-20:00 Australia/Sydney.

Usage:
  python bridge.py            # one poll+sync pass
  python bridge.py --dry-run  # show what would change, write nothing
  python bridge.py --once-verbose
"""

from __future__ import annotations

import argparse
import json
import sys
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path

# --- config -----------------------------------------------------------------
HERMES_HOME = Path(__import__("os").environ.get("HERMES_HOME", "").strip() or Path.home() / ".hermes")
CAL_API_BASE = "https://api.cal.com/v2"
CAL_API_VERSION = "2024-06-01"
GOOGLE_TOKEN_PATH = HERMES_HOME / "google_token.json"
GOOGLE_CAL_ID = "primary"  # warren.ledingham@gmail.com
STATE_PATH = HERMES_HOME / "calcom_gcal_bridge_state.json"
# How far forward/back to look. Bookings are usually future; keep a wide net.
LOOKBACK_DAYS = 2
LOOKAHEAD_DAYS = 120
# Sydney time for windowing (cal.com returns UTC; user's calendar is AET).
SYDNEY = timezone(timedelta(hours=10))  # std offset; AEDT handled via convert below


def _load_json(path: Path) -> dict:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return {}


# --- cal.com ----------------------------------------------------------------
def cal_get(path: str, api_key: str) -> dict:
    url = CAL_API_BASE + path
    # cal.com sits behind Cloudflare, which returns Error 1010
    # ("browser_signature_banned") for the default urllib User-Agent.
    # Send a browser-like UA so the WAF lets the request through.
    req = urllib.request.Request(url, headers={
        "Authorization": f"Bearer {api_key}",
        "cal-api-version": CAL_API_VERSION,
        "Accept": "application/json",
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                      "AppleWebKit/537.36 (KHTML, like Gecko) "
                      "Chrome/126.0 Safari/537.36",
    })
    with urllib.request.urlopen(req, timeout=30) as resp:
        return json.load(resp)


def cal_list_bookings(api_key: str, start: str, end: str, max_results: int = 100) -> list[dict]:
    q = urllib.parse.urlencode({
        "startDate": start, "endDate": end,
        "maxResults": str(max_results),
    })
    d = cal_get(f"/bookings?{q}", api_key)
    return d.get("data", {}).get("bookings", []) or []


# --- google -----------------------------------------------------------------
def _google_token() -> dict:
    tok = _load_json(GOOGLE_TOKEN_PATH)
    if not tok.get("refresh_token"):
        raise SystemExit("google_token.json has no refresh_token; re-run setup.py --auth-url")
    return tok


def _google_refresh(tok: dict) -> dict:
    """Refresh the access token in place using the stored refresh_token."""
    body = urllib.parse.urlencode({
        "client_id": tok["client_id"],
        "client_secret": tok["client_secret"],
        "refresh_token": tok["refresh_token"],
        "grant_type": "refresh_token",
    }).encode()
    req = urllib.request.Request(tok["token_uri"], data=body)
    with urllib.request.urlopen(req, timeout=30) as resp:
        data = json.load(resp)
    tok["token"] = data["access_token"]
    # expiry is ISO; store the new one if provided
    if "expires_in" in data:
        tok["expiry"] = (datetime.now(timezone.utc) + timedelta(seconds=data["expires_in"])).strftime("%Y-%m-%dT%H:%M:%SZ")
    GOOGLE_TOKEN_PATH.write_text(json.dumps(tok, indent=2))
    return tok


def _token_is_expired(tok: dict) -> bool:
    exp = tok.get("expiry")
    if not exp:
        return True
    try:
        # Google expiry is Zulu
        dt = datetime.strptime(exp, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc)
        return datetime.now(timezone.utc) >= dt - timedelta(minutes=2)
    except Exception:
        return True


def _google_auth_headers(tok: dict) -> dict:
    if _token_is_expired(tok):
        tok = _google_refresh(tok)
    return {"Authorization": f"Bearer {tok['token']}", "Content-Type": "application/json"}


def google_get(path: str, params: dict, tok: dict) -> dict:
    q = urllib.parse.urlencode(params)
    req = urllib.request.Request(f"https://www.googleapis.com/calendar/v3/{path}?{q}",
                               headers=_google_auth_headers(tok))
    with urllib.request.urlopen(req, timeout=30) as resp:
        return json.load(resp)


def google_post(path: str, payload: dict, tok: dict) -> dict:
    req = urllib.request.Request(f"https://www.googleapis.com/calendar/v3/{path}",
                               data=json.dumps(payload).encode(),
                               headers=_google_auth_headers(tok), method="POST")
    with urllib.request.urlopen(req, timeout=30) as resp:
        return json.load(resp)


def google_put(path: str, payload: dict, tok: dict) -> dict:
    req = urllib.request.Request(f"https://www.googleapis.com/calendar/v3/{path}",
                               data=json.dumps(payload).encode(),
                               headers=_google_auth_headers(tok), method="PUT")
    with urllib.request.urlopen(req, timeout=30) as resp:
        return json.load(resp)


def google_delete(path: str, tok: dict) -> None:
    req = urllib.request.Request(f"https://www.googleapis.com/calendar/v3/{path}",
                               headers=_google_auth_headers(tok), method="DELETE")
    with urllib.request.urlopen(req, timeout=30) as resp:
        resp.read()


# --- conversion -------------------------------------------------------------
def utc_to_iso_local(utc_str: str) -> str:
    """2026-10-16T05:00:00.000Z -> 2026-10-16T16:00:00+11:00 (Sydney)."""
    dt = datetime.fromisoformat(utc_str.replace("Z", "+00:00"))
    # Sydney DST: AEDT (+11) first Sunday Oct 02:00 -> first Sunday Apr 03:00
    y = dt.year

    def first_sunday(d: datetime) -> datetime:
        return d + timedelta(days=(6 - d.weekday()) % 7)

    dst_start = first_sunday(datetime(y, 10, 1))
    dst_end = first_sunday(datetime(y + 1, 4, 1))
    offset = 11 if dst_start <= dt.replace(tzinfo=None) < dst_end else 10
    local = dt.astimezone(timezone(timedelta(hours=offset)))
    return local.isoformat()


def booking_to_gcal_event(b: dict) -> dict:
    title = b.get("title") or "cal.com booking"
    attendee_email = (b.get("responses", {}) or {}).get("email")
    video = (b.get("metadata", {}) or {}).get("videoCallUrl") or b.get("location")
    attendees = [{"email": attendee_email}] if attendee_email else []
    start = b.get("startTime") or ""
    end = b.get("endTime") or ""
    ev = {
        "summary": title,
        "start": {"dateTime": utc_to_iso_local(start)},
        "end": {"dateTime": utc_to_iso_local(end)},
        "extendedProperties": {"private": {"calComUid": b.get("uid", "")}},
    }
    if attendees:
        ev["attendees"] = attendees
    if video:
        ev["location"] = video
    desc = b.get("description") or ""
    if desc:
        ev["description"] = desc
    return ev


def find_gcal_by_uid(uid: str, tok: dict) -> dict | None:
    """Search primary calendar for an event carrying this calComUid."""
    now = datetime.now(timezone.utc)
    d = google_get(
        f"calendars/{GOOGLE_CAL_ID}/events",
        {"timeMin": (now - timedelta(days=LOOKBACK_DAYS)).isoformat(),
         "timeMax": (now + timedelta(days=LOOKAHEAD_DAYS)).isoformat(),
         "singleEvents": "true", "maxResults": "2500"}, tok)
    for it in d.get("items", []):
        priv = (it.get("extendedProperties", {}) or {}).get("private", {}) or {}
        if priv.get("calComUid") == uid:
            return it
    return None


def find_gcal_by_title_start(title: str, start_local: str, tok: dict) -> dict | None:
    """Fallback dedupe for events created before the bridge stamped a uid
    (e.g. a manual copy). Matches on summary + start dateTime."""
    now = datetime.now(timezone.utc)
    d = google_get(
        f"calendars/{GOOGLE_CAL_ID}/events",
        {"timeMin": (now - timedelta(days=LOOKBACK_DAYS)).isoformat(),
         "timeMax": (now + timedelta(days=LOOKAHEAD_DAYS)).isoformat(),
         "singleEvents": "true", "maxResults": "2500"}, tok)
    for it in d.get("items", []):
        if (it.get("summary") or "").strip() != title.strip():
            continue
        if (it.get("start", {}) or {}).get("dateTime", "") == start_local:
            return it
    return None


# --- sync ------------------------------------------------------------------
def sync(api_key: str, tok: dict, dry_run: bool = False) -> dict:
    now = datetime.now(timezone.utc)
    start = (now - timedelta(days=LOOKBACK_DAYS)).strftime("%Y-%m-%d")
    end = (now + timedelta(days=LOOKAHEAD_DAYS)).strftime("%Y-%m-%d")
    bookings = cal_list_bookings(api_key, start, end)
    report = {"poll": len(bookings), "created": [], "updated": [], "deleted": [], "skipped": [], "errors": []}

    # Map uid -> booking for cancellation detection
    active_uids = set()
    for b in bookings:
        uid = b.get("uid")
        status = (b.get("status") or "").upper()
        if status not in ("ACCEPTED", "UPCOMING", "BOOKED"):
            # cancelled / no-show -> remove from google
            if uid:
                ev = find_gcal_by_uid(uid, tok)
                if ev:
                    if dry_run:
                        report["deleted"].append({"uid": uid, "title": b.get("title")})
                    else:
                        try:
                            google_delete(f"calendars/{GOOGLE_CAL_ID}/events/{ev['id']}", tok)
                            report["deleted"].append({"uid": uid, "title": b.get("title")})
                        except Exception as e:
                            report["errors"].append({"uid": uid, "op": "delete", "err": str(e)})
            continue
        if not uid:
            continue
        active_uids.add(uid)
        ev = find_gcal_by_uid(uid, tok)
        payload = booking_to_gcal_event(b)
        # Fallback: an identical event may already exist from a manual copy
        # (no calComUid stamped). Adopt it and stamp the uid so future runs
        # dedupe by uid and can detect reschedules.
        if ev is None and not dry_run:
            ev = find_gcal_by_title_start(payload["summary"], payload["start"]["dateTime"], tok)
            if ev is not None:
                payload["id"] = ev["id"]
                try:
                    google_put(f"calendars/{GOOGLE_CAL_ID}/events/{ev['id']}", payload, tok)
                    report["updated"].append({"uid": uid, "title": payload["summary"], "note": "adopted+stamped"})
                    continue
                except Exception as e:
                    report["errors"].append({"uid": uid, "op": "adopt", "err": str(e)})
        if ev is None:
            # No match anywhere: create a fresh event.
            if dry_run:
                report["created"].append({"uid": uid, "title": payload["summary"]})
            else:
                try:
                    google_post(f"calendars/{GOOGLE_CAL_ID}/events", payload, tok)
                    report["created"].append({"uid": uid, "title": payload["summary"]})
                except Exception as e:
                    report["errors"].append({"uid": uid, "op": "create", "err": str(e)})
        else:
            # Existing event (by uid, or adopted above): update if changed.
            existing_start = (ev.get("start", {}) or {}).get("dateTime", "")
            if existing_start != payload["start"]["dateTime"] or (ev.get("summary") or "") != payload["summary"]:
                payload["id"] = ev["id"]
                if dry_run:
                    report["updated"].append({"uid": uid, "title": payload["summary"]})
                else:
                    try:
                        google_put(f"calendars/{GOOGLE_CAL_ID}/events/{ev['id']}", payload, tok)
                        report["updated"].append({"uid": uid, "title": payload["summary"]})
                    except Exception as e:
                        report["errors"].append({"uid": uid, "op": "update", "err": str(e)})
            else:
                report["skipped"].append({"uid": uid, "title": payload["summary"]})

    if not dry_run:
        STATE_PATH.write_text(json.dumps({
            "last_run": now.isoformat(),
            "active_uids": sorted(active_uids),
            "report": report,
        }, indent=2))
    return report


def main() -> int:
    ap = argparse.ArgumentParser(description="cal.com -> Google Calendar bridge")
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--api-key", default=__import__("os").environ.get("CAL_COM_API_KEY", ""))
    args = ap.parse_args()

    if not args.api_key:
        print("ERROR: CAL_COM_API_KEY not set (env or --api-key)", file=sys.stderr)
        return 2
    tok = _google_token()
    report = sync(args.api_key, tok, dry_run=args.dry_run)
    print(json.dumps(report, indent=2))
    return 0 if not report.get("errors") else 1


if __name__ == "__main__":
    sys.exit(main())
