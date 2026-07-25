"""meetily-integration: Hermes-managed SQLite watcher + action engine.

Usage:
  python -m src.main watch          Start DB watcher daemon
  python -m src.main process <id>   Process a single meeting by ID
  python -m src.main list           List recent meetings
"""
import argparse
import asyncio
import sys


def main():
    parser = argparse.ArgumentParser(description="Meetily Integration Engine")
    sub = parser.add_subparsers(dest="command", required=True)

    sub.add_parser("watch", help="Start SQLite watcher daemon")
    proc = sub.add_parser("process", help="Process a single meeting")
    proc.add_argument("meeting_id", help="Meeting UUID to process")
    sub.add_parser("list", help="List recent completed meetings")

    args = parser.parse_args()

    if args.command == "watch":
        from .watcher import run_watcher
        run_watcher()
    elif args.command == "process":
        from .engine import process_meeting_by_id
        asyncio.run(process_meeting_by_id(args.meeting_id))
    elif args.command == "list":
        from .engine import run_list_meetings
        asyncio.run(run_list_meetings())


if __name__ == "__main__":
    main()
