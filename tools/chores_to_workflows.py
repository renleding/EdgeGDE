import argparse, json, re, sqlite3
from datetime import datetime
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
MEMORY_DIR = REPO_ROOT / ".hermes" / "memory"
MISSION_DB = MEMORY_DIR / "missions.db"
MISSION_DIR = REPO_ROOT / ".hermes" / "logs" / "missions"
WORKFLOW_DIR = REPO_ROOT / ".github" / "workflows"

def _init_db():
    MEMORY_DIR.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(MISSION_DB))
    conn.execute("CREATE TABLE IF NOT EXISTS chores (id INTEGER PRIMARY KEY AUTOINCREMENT,task TEXT NOT NULL UNIQUE,normalized TEXT NOT NULL,count INTEGER DEFAULT 0,workflow_file TEXT,created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)")
    conn.commit()
    return conn

def _normalize_command(raw):
    cmd = raw.strip()
    cmd = re.sub(r"\d{4}[-/]\d{1,2}[-/]\d{1,2}", "<DATE>", cmd)
    cmd = re.sub(r"\d{1,2}:\d{2}(?::\d{2})?", "", cmd)
    cmd = re.sub(r"/tmp/[^ ]+", "<TMP>", cmd)
    cmd = re.sub(r"[/\\][^ ]+\.py(?=\s|$)", "<SCRIPT>", cmd)
    cmd = re.sub(r"\s{2,}", " ", cmd).strip()
    return cmd.lower()[:200]

def detect_chores():
    conn = _init_db()
    if not MISSION_DIR.exists():
        print("[chores] no mission reports"); return []
    counts = {}
    for rpt in sorted(MISSION_DIR.glob("*.report.json")):
        try:
            data = json.loads(rpt.read_text())
        except: continue
        for task in data.get("tasks", {}).get("results", []):
            if task.get("operation") == "shell":
                cmd = task.get("output","") or task.get("args",{}).get("command","") or ""
                if cmd:
                    norm = _normalize_command(cmd)
                    counts[norm] = counts.get(norm, 0) + 1
    chores = [(n,c) for n,c in counts.items() if c >= 5]
    for n,c in chores:
        conn.execute("INSERT OR IGNORE INTO chores (task,normalized,count) VALUES (?,?,?)", (n[:200],n,c))
    conn.commit(); conn.close()
    print(f"[chores] {len(chores)} recurring task(s)")
    for n,c in chores: print(f"  x{c} {n[:80]}")
    return [n for n,_ in chores]

def generate(chores=None):
    if chores is None: chores = detect_chores()
    if not chores: print("[workflows] none to generate"); return
    conn = _init_db()
    for i,task in enumerate(chores):
        short = re.sub(r"\W+", "_", task[:30]).strip("_") or f"chore-{i}"
        content = f"name: Auto {short}\non:\n  push:\n    branches: [main]\njobs:\n  {short}:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@v4\n      - run: bun install --frozen-lockfile\n      - run: {task}\n"
        fpath = WORKFLOW_DIR / f"auto-{i+1}-{short}.yml"
        fpath.parent.mkdir(parents=True, exist_ok=True)
        fpath.write_text(content)
        conn.execute("UPDATE chores SET workflow_file=? WHERE task=?", (str(fpath), task))
        print(f"[workflows] wrote {fpath}")
    conn.commit(); conn.close()

def cmd_detect(a): detect_chores()
def cmd_generate(a): generate()
def cmd_run(a):
    c = detect_chores()
    if c: generate(c)
    else: print("[done] nothing to automate")

if __name__ == "__main__":
    p = argparse.ArgumentParser(description="Phase 3")
    s = p.add_subparsers(dest="command", required=True)
    for n,h in [("detect-chores","Scan"),("generate","Create workflows"),("run","Detect+generate")]:
        x = s.add_parser(n,help=h)
        x.set_defaults(func={"detect-chores":cmd_detect,"generate":cmd_generate,"run":cmd_run}[n])
    args = p.parse_args()
    args.func(args)
