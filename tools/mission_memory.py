#!/usr/bin/env python3
"""
Cross-Mission Memory (EG-FEAT-0001)

SQLite-backed memory store that persists mission outcomes and injects
relevant context from past missions into new ones.

Usage:
  python3 tools/mission_memory.py store --manifest <path> --report <path>
  python3 tools/mission_memory.py recall --path <file-path>
  python3 tools/mission_memory.py recall --mission <mission-id>
  python3 tools/mission_memory.py summarize --mission <mission-id>
"""

import argparse
import hashlib
import json
import sqlite3
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional


HERMES_DIR = Path(__file__).resolve().parents[1] / ".hermes"
MEMORY_DIR = HERMES_DIR / "memory"
MEMORY_DB = MEMORY_DIR / "missions.db"


def _get_db() -> sqlite3.Connection:
    MEMORY_DIR.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(MEMORY_DB))
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("""
        CREATE TABLE IF NOT EXISTS mission_memory (
            mission_id TEXT PRIMARY KEY,
            timestamp TEXT NOT NULL,
            objective TEXT,
            repo TEXT DEFAULT '',
            files_affected TEXT DEFAULT '[]',
            operations TEXT DEFAULT '[]',
            success BOOLEAN NOT NULL DEFAULT 0,
            compensation_used BOOLEAN NOT NULL DEFAULT 0,
            verification_summary TEXT DEFAULT '',
            lessons TEXT DEFAULT '',
            checksum TEXT NOT NULL
        )
    """)
    conn.execute("""
        CREATE INDEX IF NOT EXISTS idx_memory_timestamp ON mission_memory(timestamp)
    """)
    conn.execute("""
        CREATE INDEX IF NOT EXISTS idx_memory_files ON mission_memory(files_affected)
    """)
    conn.commit()
    return conn


def cmd_store(args):
    """Parse a mission manifest + report and store structured memory."""
    manifest_path = Path(args.manifest)
    report_path = Path(args.report)

    if not manifest_path.exists():
        print(f"Error: manifest not found: {manifest_path}")
        sys.exit(1)
    if not report_path.exists():
        print(f"Error: report not found: {report_path}")
        sys.exit(1)

    manifest = json.loads(manifest_path.read_text())
    report = json.loads(report_path.read_text())

    mission_id = manifest.get("mission_id", report.get("mission_id", "unknown"))
    objective = manifest.get("objective", "")
    tasks = manifest.get("tasks", [])

    # Extract files and operations
    files_affected = set()
    operations = set()
    for task in tasks:
        ops = task.get("operation", "")
        operations.add(ops)
        args = task.get("args", {})
        if "path" in args:
            files_affected.add(args["path"])

    # Determine success
    status = report.get("status", "unknown")
    success = status == "success"
    compensation_used = report.get("compensation_used", False)
    task_details = report.get("task_details", [])
    errors = report.get("errors", [])

    # Generate lessons from errors/compensation
    lessons_parts = []
    if errors:
        lessons_parts.append(f"Errors: {'; '.join(errors[:3])}")
    if compensation_used:
        compensated = sum(1 for t in task_details if t.get("status") == "compensated")
        lessons_parts.append(f"Compensated {compensated} task(s)")
    if success:
        completed = report.get("tasks", {}).get("completed", 0)
        lessons_parts.append(f"Completed {completed}/{len(tasks)} tasks")

    lessons = "; ".join(lessons_parts) if lessons_parts else "No lessons extracted"

    # Create checksum
    canonical = f"{mission_id}:{timestamp()}:{json.dumps(list(files_affected))}:{json.dumps(list(operations))}"
    checksum = hashlib.sha256(canonical.encode()).hexdigest()[:16]

    # Extract repo from file paths
    repo = ""
    for f in files_affected:
        parts = Path(f).parts
        if len(parts) >= 2:
            repo = parts[0]
            break

    conn = _get_db()
    conn.execute("""
        INSERT OR REPLACE INTO mission_memory
            (mission_id, timestamp, objective, repo, files_affected, operations,
             success, compensation_used, verification_summary, lessons, checksum)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    """, (
        mission_id,
        timestamp(),
        objective,
        repo,
        json.dumps(list(files_affected)),
        json.dumps(list(operations)),
        int(success),
        int(compensation_used),
        f"status={status}, errors={len(errors)}",
        lessons,
        checksum,
    ))
    conn.commit()
    print(f"Stored memory for {mission_id}")


def cmd_recall(args):
    """Retrieve relevant memory for a target."""
    conn = _get_db()
    cursor = conn.cursor()

    if args.path:
        # Find missions that touched this file
        path_pattern = f"%{args.path}%"
        cursor.execute("""
            SELECT mission_id, timestamp, objective, success, files_affected, operations,
                   compensation_used, lessons
            FROM mission_memory
            WHERE files_affected LIKE ?
            ORDER BY timestamp DESC
            LIMIT 10
        """, (path_pattern,))
        rows = cursor.fetchall()
        if not rows:
            print(f"No memory found for path: {args.path}")
            return
        print(f"Memory for {args.path}:")
        for r in rows:
            print(f"  [{r[1]}] {r[0]} — {r[2][:60]}")
            print(f"    Status: {'✅' if r[3] else '❌'} | Files: {r[4]} | Ops: {r[5]}")
            print(f"    Lessons: {r[7][:120]}")
            print()

    elif args.mission:
        cursor.execute("""
            SELECT mission_id, timestamp, objective, success, files_affected, operations,
                   compensation_used, verification_summary, lessons
            FROM mission_memory
            WHERE mission_id = ?
        """, (args.mission,))
        row = cursor.fetchone()
        if not row:
            print(f"No memory found for mission: {args.mission}")
            return
        print(f"Mission: {row[0]}")
        print(f"  Timestamp: {row[1]}")
        print(f"  Objective: {row[2]}")
        print(f"  Status: {'✅ Success' if row[3] else '❌ Failure'}")
        print(f"  Files: {row[4]}")
        print(f"  Operations: {row[5]}")
        print(f"  Compensation used: {'Yes' if row[6] else 'No'}")
        print(f"  Verification: {row[7]}")
        print(f"  Lessons: {row[8]}")

    else:
        # Show recent missions
        cursor.execute("""
            SELECT mission_id, timestamp, objective, success, lessons
            FROM mission_memory
            ORDER BY timestamp DESC
            LIMIT 20
        """)
        rows = cursor.fetchall()
        print(f"Recent missions ({len(rows)}):")
        for r in rows:
            print(f"  [{r[1]}] {'' if r[3] else '❌'} {r[0]} — {r[2][:60]}")
            print(f"    Lessons: {r[4][:80]}")


def cmd_summarize(args):
    """Produce an injection summary for a new mission context."""
    conn = _get_db()
    cursor = conn.cursor()

    # Get recent missions
    cursor.execute("""
        SELECT COUNT(*), SUM(success), SUM(compensation_used),
               MAX(timestamp), MIN(timestamp)
        FROM mission_memory
    """)
    stats = cursor.fetchone()

    total = stats[0] or 0
    success_count = stats[1] or 0
    failure_count = total - success_count
    print(f"Cross-Mission Memory Summary")
    print(f"  Total missions: {total}")
    print(f"  Success rate: {success_count}/{total} ({success_count/max(total,1)*100:.0f}%)")
    print(f"  Missions with compensation: {stats[2] or 0}")
    print(f"  Timespan: {stats[4] or 'N/A'} to {stats[3] or 'N/A'}")
    print()

    if args.mission:
        # Produce injection text for a specific mission
        cursor.execute("""
            SELECT lessons, files_affected, operations, compensation_used
            FROM mission_memory
            WHERE mission_id = ?
        """, (args.mission,))
        row = cursor.fetchone()
        if row and row[0]:
            print(f"Context for {args.mission}:")
            print(f"  Previous lessons: {row[0]}")
            print(f"  Previous files: {row[1]}")
            print(f"  Operations: {row[2]}")


def timestamp() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def main():
    parser = argparse.ArgumentParser(description="Cross-Mission Memory (EG-FEAT-0001)")
    sub = parser.add_subparsers(dest="command", required=True)

    p = sub.add_parser("store", help="Store mission outcome in memory")
    p.add_argument("--manifest", required=True, help="Path to Mission Manifest JSON")
    p.add_argument("--report", required=True, help="Path to execution report JSON")

    p = sub.add_parser("recall", help="Recall memory for a file path or mission")
    p.add_argument("--path", help="File path to search for")
    p.add_argument("--mission", help="Mission ID to recall")

    p = sub.add_parser("summarize", help="Show cross-mission memory summary")
    p.add_argument("--mission", help="Optional: produce injection for a specific mission")

    args = parser.parse_args()
    {"store": cmd_store, "recall": cmd_recall, "summarize": cmd_summarize}[args.command](args)


if __name__ == "__main__":
    main()
