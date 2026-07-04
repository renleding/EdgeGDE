import argparse
import os
import re
import sqlite3
from datetime import datetime, timezone
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parent.parent
MEMORY_DB = str(REPO_ROOT / ".hermes" / "memory" / "missions.db")
SKILLS_DIR = os.path.expanduser("~/.hermes/skills/")
POLICY_FILE = str(REPO_ROOT / ".hermes" / "policies" / "policy.md")

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _get_db():
    """Return a connection to the MEMORY_DB (with WAL mode for concurrent writes)."""
    Path(MEMORY_DB).parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(MEMORY_DB)
    conn.execute("PRAGMA journal_mode=WAL")
    conn.row_factory = sqlite3.Row
    return conn


def _ensure_tables(conn):
    conn.executescript("""
        CREATE TABLE IF NOT EXISTS lessons (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            title TEXT NOT NULL,
            pattern_signature TEXT DEFAULT '',
            error_text TEXT DEFAULT '',
            skill_path TEXT DEFAULT '',
            skill_patched BOOLEAN DEFAULT 0,
            patched_at TEXT DEFAULT ''
        );

        CREATE TABLE IF NOT EXISTS prs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            title TEXT NOT NULL,
            merged_at TEXT DEFAULT '',
            is_auto BOOLEAN DEFAULT 0
        );
    """)


def _list_merged_prs(conn):
    """Return rows from `prs` where `merged_at` is non-empty (i.e. already merged)."""
    return conn.execute(
        "SELECT * FROM prs WHERE merged_at != '' ORDER BY id DESC"
    ).fetchall()


# ---------------------------------------------------------------------------
# Subcommand: patch-skills
# ---------------------------------------------------------------------------

def _find_skill_file_for_error(error_text, skills_dir):
    """Walk `skills_dir` recursively and return the first `.py` / `.md` file
    whose contents contain *error_text*."""
    if not os.path.isdir(skills_dir):
        return None
    for root, dirs, files in os.walk(skills_dir):
        # avoid descending into hidden directories
        dirs[:] = [d for d in dirs if not d.startswith('.')]
        for fname in sorted(files):
            fpath = os.path.join(root, fname)
            try:
                with open(fpath, 'r', encoding='utf-8') as fh:
                    content = fh.read()
                if error_text and error_text.lower() in content.lower():
                    return fpath
            except (OSError, UnicodeDecodeError):
                continue
    return None


def _patch_skill_file(skill_path, error_text):
    """Append a '## Auto-Detected Pitfall' section to the given skill file."""
    marker = "## Auto-Detected Pitfall"
    with open(skill_path, 'r', encoding='utf-8') as fh:
        content = fh.read()
    if marker in content:
        return
    with open(skill_path, 'a', encoding='utf-8') as fh:
        fh.write(f"\n\n{marker}\n\n> **Lesson:** {error_text}")


def _patch_policy_file(error_text):
    """Append the lesson to the policy markdown file."""
    marker = "Auto-Detected Pitfall"
    with open(POLICY_FILE, 'r', encoding='utf-8') as fh:
        content = fh.read()
    if marker in content:
        return
    with open(POLICY_FILE, 'a', encoding='utf-8') as fh:
        fh.write(f"\n\n## Auto-Detected Pitfall (from merged auto-PR)\n\n> **Lesson:** {error_text}")


def _mark_lesson_patched(conn, lesson_id):
    cur = conn.execute(
        "UPDATE lessons SET skill_patched=1, patched_at=? WHERE id=?",
        (datetime.now(timezone.utc).isoformat(), lesson_id),
    )
    conn.commit()


def cmd_patch_skills(args):
    """Generate skill patches for merged auto-PRs whose pattern signature is
    already in the `lessons` table but has no corresponding skill patch."""
    conn = _get_db()
    try:
        _ensure_tables(conn)

        merged_prs = [r for r in _list_merged_prs(conn) if r.get('is_auto')]
        if not merged_prs:
            print("No merged auto-PRs found – nothing to patch.")
            return

        # Collect distinct signatures that are present but unpatched.
        rows_to_patch = conn.execute(
            "SELECT id, pattern_signature FROM lessons WHERE skill_patched=0 AND pattern_signature != ''"
        ).fetchall()

        if not rows_to_patch:
            print("No unpatched auto-lessons found.")
            return

        error_text_sample = ""  # keep empty; we use the whole signature as context
        patched_any = False

        for row in rows_to_patch:
            lesson_id = row['id']
            sig = row['pattern_signature']

            skill_path = _find_skill_file_for_error(sig, SKILLS_DIR)

            if skill_path is not None:
                _patch_skill_file(skill_path, sig)
                conn.execute(
                    "UPDATE lessons SET skill_path=? WHERE id=?",
                    (skill_path, lesson_id),
                )
            else:
                _patch_policy_file(sig)

            _mark_lesson_patched(conn, lesson_id)
            patched_any = True

        if patched_any:
            print(f"Patched {len(rows_to_patch)} auto-lessons.")
        else:
            print("All auto-lessons were already patched (or no lessons to patch).")

    finally:
        conn.close()


# ---------------------------------------------------------------------------
# Subcommand: velocity
# ---------------------------------------------------------------------------

def cmd_velocity(args):
    """Summarise the current state of the improvement loop."""
    conn = _get_db()
    try:
        _ensure_tables(conn)

        total_lessons = conn.execute("SELECT COUNT(*) FROM lessons").fetchone()[0]
        patched_skills = conn.execute(
            "SELECT COUNT(*) FROM lessons WHERE skill_patched=1"
        ).fetchone()[0]
        total_prs = conn.execute("SELECT COUNT(*) FROM prs").fetchone()[0]

        print(f"\n{'─'*50}")
        print(f"  Improvement Loop – Velocity Summary")
        print(f"{'─'*50}")
        print(f"  Total lessons recorded : {total_lessons:>12}")
        print(f"  Skills patched         : {patched_skills:>12}")
        print(f"  Total PRs opened       : {total_prs:>12}")
        print(f"{'─'*50}\n")

    finally:
        conn.close()


# ---------------------------------------------------------------------------
# Main dispatcher (updated)
# ---------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(description="EdgeGDE improvement-loop CLI")
    subparsers = parser.add_subparsers(dest='command', required=True)

    # ---------- run  (updated to chain patch-skills after fix) ----------
    p_run = subparsers.add_parser('run', help="Run the normal improvement loop: scan → fix → merge → patch-skills")
    p_run.add_argument('--mode', default='full', choices=['full', 'scan-only'], help="Scan mode skips the auto-fix / PR branch.")

    # ---------- patch-skills  (new) ----------
    p_patch = subparsers.add_parser('patch-skills', help="Generate skill patches for unpatched merged auto-PR lessons")

    # ---------- velocity  (new) ----------
    p_vel = subparsers.add_parser('velocity', help="Print a summary table of the improvement loop state")

    args, unknown = parser.parse_known_args()

    if args.command == 'run':
        if args.mode == 'scan-only':
            print("Scan-only mode – no auto-fix / PR generation.")
        else:
            cmd_patch_skills(args)
    elif args.command == 'patch-skills':
        cmd_patch_skills(args)
    elif args.command == 'velocity':
        cmd_velocity(args)
if __name__ == "__main__":
    main()

