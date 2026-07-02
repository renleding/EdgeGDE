# Functional Requirement Spec: Hermes Video Watch Capability

**Status:** Draft · **Version:** 0.1.0  
**Source:** Based on [claude-watch](https://github.com/taoufik123-collab/claude-watch) (MIT, taoufik)  
**Kanban:** DOC-RES-0006  
**Target Runtime:** Hermes Agent (Python, gateway-integrated)

---

## 1. Objective

Give Hermes the ability to **watch a video** — given a URL or local path, the agent downloads it, extracts frames at scene-change boundaries, pulls a timestamped transcript, and answers questions grounded in both the visual and audio content.

Currently Hermes can read text, browse web pages, and run code — but video is a blind spot. Pasting a YouTube link produces no actionable information. This skill closes that gap.

---

## 2. Current Baseline

Hermes has **no video processing capability**. The closest existing tools are:
- `vision_analyze()` — analyzes a single image (not a video stream)
- `browser_navigate()` — can view web pages, but cannot process video URLs
- `terminal()` — can run commands, but no existing video pipeline

---

## 3. Requirements

### R1: Core Pipeline

The skill must implement a 5-step pipeline:

```
User provides URL or path
  → 1. Download (yt-dlp for URLs; use local file directly)
  → 2. Frame extraction (ffmpeg scene-change or uniform, auto-scaled)
  → 3. Transcript (native captions first, Whisper fallback)
  → 4. Report generation (structured markdown with Claude-fill sections)
  → 5. Answer user grounded in frames + transcript
```

### R2: Source Support

| Source | Method | Priority |
|--------|--------|----------|
| YouTube URL | yt-dlp download | P0 |
| Local file (`.mp4`, `.mov`, `.mkv`, `.webm`) | Direct probe | P0 |
| Loom, TikTok, X/Twitter, Instagram, Vimeo | yt-dlp (supported natively) | P1 |
| Any yt-dlp-supported site | Generic via yt-dlp | P1 |

### R3: Auto-Scaled Frame Budget

Frames are the dominant token cost. The budget must scale intelligently:

| Duration | Default frames | Notes |
|----------|---------------|-------|
| ≤30s | ~30 | Dense — every key moment |
| 30s–1min | ~40 | Still dense |
| 1–3min | ~60 | Comfortable |
| 3–10min | ~80 | Sparse but workable |
| >10min | 100 | Caps at 100 (384K output limit) |
| Focused range (`--start`/`--end`) | Up to 2fps | Dense pass on a specific segment |

Hard limits: max 2fps, max 100 frames, 512px width by default (configurable).

### R4: Frame Extraction Modes

| Mode | Method | When |
|------|--------|------|
| **Scene-change** (default) | ffmpeg `select=gt(scene,0.3)` | One frame per detected shot — token-efficient, captures transitions |
| **Uniform** | ffmpeg `fps=N` | Fixed rate — use when scene-change misses content |
| **Focused** | Dense uniform within range | User specifies `--start`/`--end` — e.g. "check 2:30–3:00" |

### R5: 0–10s Hook Microscope

The opening 10 seconds is where every video earns or loses attention. The skill must:

- Run a **denser 2fps pass** on the first 10 seconds
- Run **word-level Whisper transcription** on the opening 10 seconds
- Include a "Hook Breakdown" section in the report: what was on screen as each word landed

This is optional and flaggable (`--no-hook-microscope`).

### R6: Transcript Sources

| Source | Quality | Cost | When Used |
|--------|---------|------|-----------|
| Native captions (via yt-dlp) | Good (manual) / OK (auto-generated) | Free | Default — works for most public videos |
| Whisper (Groq `whisper-large-v3`) | Excellent | Cheap (~$0.001/min) | Preferred fallback, faster than OpenAI |
| Whisper (OpenAI `whisper-1`) | Excellent | ~$0.006/min | Fallback when Groq unavailable |
| None | — | — | `--no-whisper` flag for frames-only mode |

### R7: Structured Report

The script must emit a structured `report.md` with:

```
# Watch Report

## TL;DR (pending Claude fill)
## Key Moments
## Hook Breakdown
## Editorial Profile
  - Duration, cuts, cuts/min, mean shot length
## Quotable Moments (pending Claude fill)
## Entities & Concepts (pending Claude fill)
## Transcript (timestamped)
```

Narrative sections use `<!-- pending Claude fill: ... -->` markers so the agent has explicit job-list items, not a blank document.

### R8: Skill Interface

The skill must be invocable from Hermes as:

```
/watch <url-or-path> [--start MM:SS] [--end MM:SS] [--intent "why"]
```

Supporting arguments:
- `--max-frames N` — cap total frames (default 80, hard max 100)
- `--resolution N` — frame width in pixels (default 512)
- `--start` / `--end` — focused range in seconds or `MM:SS`
- `--intent` — why the user is watching (shapes report emphasis)
- `--no-whisper` — skip transcription, frames only
- `--whisper groq|openai` — force specific backend
- `--no-scene-change` — uniform frame sampling
- `--no-hook-microscope` — skip hook analysis

### R9: Dependency Management

First-run auto-dependency install (macOS via `brew`, Linux via `apt`/`pip`):

| Dependency | Purpose | Install |
|-----------|---------|---------|
| `yt-dlp` | Video download | `brew install yt-dlp` or `pip install yt-dlp` |
| `ffmpeg` | Frame extraction, audio | `brew install ffmpeg` or `apt install ffmpeg` |
| `openai-whisper` or Groq SDK | Transcription fallback | `pip install openai-whisper` or `pip install groq` |

Dependencies must be checked at runtime and installed only if missing. No global pip installs — use venv or uv.

### R10: Frame Display

Frames must be displayed to the agent via the existing `Read` / `vision_analyze` tool. Each frame path is printed with a `t=MM:SS` timestamp marker so the agent can correlate frames with transcript segments.

---

## 4. Architecture

### 4.1 Module Structure

```
~/.hermes/skills/watch/
├── SKILL.md              # Skill definition with pipeline instructions
├── commands/watch.md      # Command definition for /watch
└── scripts/
    ├── watch.py           # Entry point — orchestrates pipeline
    ├── download.py        # yt-dlp wrapper
    ├── frames.py          # ffmpeg frame extraction (scene-change + uniform)
    ├── hook.py            # 0-10s hook microscope
    ├── pacing.py          # Editorial pacing metrics
    ├── transcribe.py      # Caption parsing (VTT)
    ├── whisper.py         # Whisper API backend (Groq + OpenAI)
    └── report.py          # Structured report.md generator
```

### 4.2 Data Flow

```
User: /watch https://youtu.be/xyz
  → Hermes parses args, invokes skill
  → watch.py creates tmp workdir
  → download.py: yt-dlp downloads to workdir/download/
  → frames.py: ffmpeg probes metadata → auto-fps → scene-change extraction
  → frames.py: if --start/--end, focused pass
  → hook.py: if not --no-hook-microscope, dense 2fps on first 10s
  → transcribe.py: yt-dlp captions → if none → whisper.py fallback
  → pacing.py: compute cuts/min, shot length
  → report.py: write workdir/report.md with all data + Claude-fill markers
  → Hermes reads report.md + each frame via vision_analyze
  → Hermes fills report narrative sections
  → Hermes answers user, grounded in frames + transcript
  → Hermes cleans up workdir (or offers to keep for follow-ups)
```

### 4.3 Integration with Hermes

The skill integrates as a Hermes skill (via `skill_view` / `skill_manage`):

```python
# Invoked by the agent when user types /watch
skill_view('watch')          # Loads SKILL.md for pipeline instructions
terminal('python3 scripts/watch.py <url> --intent "..."')  # Runs pipeline
vision_analyze(frame_path)   # Reads each frame (parallel where possible)
```

---

## 5. Comparison to claude-watch (Source)

| Feature | claude-watch | Hermes /watch (proposed) |
|---------|-------------|--------------------------|
| Frame extraction | ✅ Scene-change + uniform | ✅ Same |
| Auto-scaled budget | ✅ Duration-aware | ✅ Same |
| Hook microscope (0-10s) | ✅ Dense 2fps + Whisper | ✅ Same |
| Transcript | ✅ Captions → Whisper (Groq/OpenAI) | ✅ Same |
| Structured report | ✅ report.md with Claude-fill | ✅ Same |
| Obsidian auto-save | ✅ Via `$WATCH_VAULT_DIR` | 🟡 Phase 2 (if vault system exists) |
| Skill format | SKILL.md + plugin.json | ✅ SKILL.md + commands/watch.md |
| Platform | Claude Code, claude.ai, Codex CLI | ✅ Hermes Agent |
| Dependency mgmt | ✅ First-run auto-install | ✅ Same |
| Frame display | Claude `Read` (native) | Hermes `vision_analyze` (per-frame) |
| Pacing metrics | ✅ cuts/min, shot length | ✅ Same |
| Source license | MIT | ✅ Compatible |

---

## 6. Implementation Plan

### Phase 1 (Core — 2-3 days)

| Task | Files | Effort |
|------|-------|--------|
| Create skill structure | `SKILL.md`, `commands/watch.md`, `scripts/` | 2h |
| Port `download.py` | yt-dlp wrapper | 1h |
| Port `frames.py` | Scene-change + uniform + focused extraction | 3h |
| Port `transcribe.py` + `whisper.py` | VTT parsing, Groq/OpenAI backends | 3h |
| Port `report.py` | Structured markdown generator | 2h |
| Port `pacing.py` + `hook.py` | Metrics + hook microscope | 2h |
| Port `watch.py` | Entry point orchestrator | 2h |
| Port `setup.py` | Dependency auto-install | 1h |
| Test with sample YouTube URL | End-to-end pipeline | 2h |

### Phase 2 (Enhancement — 1-2 days)

| Task | Effort |
|------|--------|
| Parallel frame `Read` (batch vision_analyze) | 2h |
| Hermes skill caching (avoid redownload) | 1h |
| Vault/notes integration (if applicable) | 3h |
| Config via `~/.hermes/config.yaml` (Whisper API key, vault path) | 1h |
| Frame gallery preview in terminal (column view) | 2h |

---

## 7. Verification

| Check | Criteria |
|-------|----------|
| YouTube URL | Downloads, extracts ≥10 frames, transcript present, report generated |
| Local `.mp4` | Probes in place, frames extracted, no download |
| No captions | Falls back to Whisper, transcript still present |
| `--start`/`--end` | Focused pass returns denser frames within range |
| `--no-whisper` | Frames-only mode, no transcript, no errors |
| Long video (>10min) | Caps at 100 frames, warning printed |
| Dependency missing | Auto-installs on first run |

---

## 8. Open Questions

1. **Whisper API keys** — should they live in `~/.hermes/.env` under `GROQ_API_KEY` / `OPENAI_API_KEY`? (Yes — follow existing pattern)
2. **Obsidian vault integration** — Hermes doesn't have a vault system today. Phase 2 feature?
3. **Streaming video** — some sources (e.g. live streams) can't be downloaded. Best-effort or skip?

---

## 9. Credits

This spec is based on [claude-watch](https://github.com/taoufik123-collab/claude-watch) by taoufik (MIT license). The core pipeline — yt-dlp download, ffmpeg frames, Groq/OpenAI Whisper backends, auto-scaled fps, scene-change detection, hook microscope, pacing metrics, structured report — originates from that project and is used under the terms of the MIT license.
