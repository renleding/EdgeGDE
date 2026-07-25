# AI Meeting Note-Taking: Alternatives to Meetily

**Date:** 2026-07-23  
**Project Context:** cal.com (free plan, public API, Cal Video as default meeting communications)  
**Kanban Task:** DOC-RES-0001  

---

## Requirements Summary

| Requirement | Priority |
|---|---|
| Meeting transcription (local preferred) | Core |
| Ollama compatible (local LLM) | Core |
| Invisible to participants (no bot joins) | Core |
| Real-time actionable transcripts (triggers) | Core |
| Speaker recognition (diarization) | Core |
| Auto language detect | Core |
| Summarisation (Overview, Bullet Points, Action Items, Custom Notes) | Core |
| Realtime coaching/suggestions to host | Desired |
| Conversation tracking (sentiment, topics) | Desired |
| Host/participant talk-time, talk speed | Desired |
| Meeting goals/objectives scoring | Desired |
| Knowledge base updates from conversation | Future |
| MCP compatible or at least API | Future |
| Shareable audio clips (wav/mp3) | Nice-to-have |
| Multilingual AI voice agent | Future |
| cal.com integration (Cal Video, public API) | Context |

---

## Top 10 Alternatives

### 1. Anarlog (ex-Hyprnote) — ★ Top Pick

- **GitHub:** https://github.com/fastrepl/anarlog
- **Stars:** 8.8k | **License:** MIT
- **Platform:** macOS (Tauri desktop app)
- **Transcription:** Parakeet V3, Whisper Small ("Cactus") + 7 cloud engines
- **LLM:** Ollama, LM Studio, or any OpenAI-compatible endpoint
- **Invisible:** ✅ Captures system audio — no bot joins
- **Speaker diarisation:** ✅ Yes (planned for June release)

**Strengths:**
- Built-in notepad merges your manual notes with transcript into structured output via templates
- Every meeting saved as a `.md` file on disk — inspectable, searchable, syncable via iCloud/Dropbox/git
- Built by fastrepl (active maintainers)
- Designed as Granola AI alternative with full local-first ethos

**Gaps:**
- No real-time triggers/actionable transcripts
- No coaching/suggestions to host
- macOS only (no Windows/Linux)

**cal.com fit:** File-based output makes API integration straightforward. Could use cal.com API to book follow-ups from `.md` action items.

---

### 2. Screenpipe — ★ Best for Hermes Native Setup

- **GitHub:** https://github.com/screenpipe/screenpipe
- **Stars:** ~13k | **License:** Source-available (MIT-like core)
- **Platform:** macOS, Windows, Linux
- **Transcription:** Whisper (local, OpenAI-compatible)
- **LLM:** Ollama, OpenAI, Anthropic, Gemini — fully pluggable
- **Invisible:** ✅ Captures system audio + screen 24/7 — no bot
- **Speaker diarisation:** ✅ Yes
- **MCP compatible:** ✅ YES — built-in MCP server support

**Strengths:**
- **YC S26** — active development, well-funded
- 24/7 screen + audio capture → searchable AI memory of everything
- "Pipes" system — agents triggered by work activity (actionable transcripts!)
- **Hermes integration confirmed** — Threads post shows Screenpipe feeds Hermes agents with real context
- Multi-language cloud transcription returning
- Privacy redaction, HD recording, selective sync to phone

**Gaps:**
- Source-available license (not pure MIT)
- 24/7 recording may capture non-meeting audio → privacy management overhead
- Realtime coaching not built-in
- Meeting scoring/goals tracking not built-in

**Hermes Native Setup:** Run Screenpipe in background → extract meeting transcripts → trigger Hermes agent actions (email via gmail skill, CRM update, cal.com booking via API). This satisfies the "actionable transcript" requirement natively.

---

### 3. Meetily (Reference Product)

- **GitHub:** https://github.com/Zackriya-Solutions/meetily
- **Stars:** 25.9k | **License:** MIT
- **Platform:** macOS, Windows
- **Transcription:** Parakeet (4x faster than Whisper), Whisper
- **LLM:** Ollama (local), Claude, Groq, OpenRouter, OpenAI-compatible
- **Invisible:** ✅ Captures system audio — no bot
- **Speaker diarisation:** ✅ Yes (PRO feature planned mid-June)

**Strengths:**
- Most mature OSS meeting note-taker (556 commits, 370k+ downloads)
- Rust-based — fast, efficient
- Built-in AI summarisation with pluggable models
- Active community (Discord, Reddit)
- PRO tier adds advanced exports, custom workflows, team features

**Gaps:**
- No real-time triggers / actionable transcripts
- No coaching/suggestions to host
- No API/MCP (desktop-only app)
- Speaker diarisation is PRO-only
- No cal.com integration

---

### 4. OpenWhispr

- **GitHub:** https://github.com/OpenWhispr/openwhispr
- **License:** MIT
- **Platform:** macOS, Windows, Linux
- **Transcription:** Whisper, NVIDIA Parakeet (local or BYOK cloud)
- **LLM:** Ollama + cloud providers
- **Invisible:** ✅ Desktop capture — no bot
- **Speaker diarisation:** ✅ On Pro plan
- **API/MCP:** ✅ API and MCP access on paid plans

**Strengths:**
- Cross-platform (Mac, Windows, Linux)
- Dual local/cloud — privacy choice
- Dictation mode + meeting transcription in one tool
- Free forever tier for unlimited local dictation
- Agent mode on paid plan

**Gaps:**
- Speaker labels require Pro ($)
- API/MCP requires paid plan
- No real-time triggers/coaching built-in
- Newer project, smaller community

**cal.com fit:** API access enables cal.com webhook integration for post-meeting actions.

---

### 5. Cal.com Notes (Native cal.com Feature)

- **URL:** https://cal.com/notes
- **Platform:** Cloud (Cal Video calls only)
- **Transcription:** Built-in Cal Video transcription
- **LLM:** Cloud (cal.com managed)
- **Invisible:** ✅ Native to Cal Video — no extra bot
- **Speaker diarisation:** Presumably yes (native video)
- **Integration:** 100% native to your existing cal.com setup

**Strengths:**
- **Zero setup** — already part of cal.com ecosystem
- Auto-summarises every Cal Video call
- Free on your existing cal.com free plan
- Tightest possible cal.com integration

**Gaps:**
- Cloud-only (no local processing)
- No Ollama support (cal.com-managed LLM)
- Cal Video only — doesn't cover Zoom/Teams/Meet calls
- Waitlist still active (not generally available)
- No real-time triggers, coaching, or advanced analytics
- No MCP/API for custom actions

**Verdict:** Use for cal.com-native meetings. Combine with a local tool (Screenpipe/Anarlog) for full coverage.

---

### 6. Scriberr

- **GitHub:** https://github.com/rishikanthc/Scriberr
- **License:** MIT
- **Platform:** Docker (web UI — self-hosted)
- **Transcription:** Whisper.cpp (local)
- **LLM:** Ollama, OpenAI-compatible
- **Invisible:** N/A — file upload / post-meeting only
- **Speaker diarisation:** ✅ Via WhisperX

**Strengths:**
- Fully self-hosted via Docker Compose
- Chat with transcripts ("ask questions about your meeting")
- Summarise with Ollama
- GPU support (CUDA)
- Web UI accessible from any device

**Gaps:**
- **Not real-time** — upload audio file after meeting
- No invisible capture (no system audio recording)
- No triggers, coaching, or advanced analytics
- Post-meeting only (not live)

**cal.com fit:** Could accept cal.com's Cal Video recording exports for post-meeting processing, but doesn't meet the "invisible" or "real-time" requirement.

---

### 7. Vibe

- **GitHub:** https://github.com/thewh1teagle/vibe
- **License:** MIT
- **Platform:** macOS, Windows, Linux
- **Transcription:** Whisper.cpp (local)
- **LLM:** ❌ No built-in LLM
- **Invisible:** ❌ File upload only
- **Speaker diarisation:** ❌ No
- **API:** ✅ HTTP API with Swagger docs

**Strengths:**
- Lightweight, cross-platform
- CLI support
- HTTP API with Swagger for automation
- Multilingual (supports 99+ languages)
- Custom model integration

**Gaps:**
- No built-in LLM for summaries (transcription only)
- No real-time capture (file/URL upload)
- No diarisation
- No triggers, coaching, or analytics
- Pure transcription tool — needs separate LLM pipeline

**Verdict:** Good as a transcription engine component, not a complete meeting assistant.

---

### 8. Whisper (Custom Build — Python/Flask)

- **Approach:** DIY with Whisper + Ollama + Flask web app
- **Reference:** https://medium.com/data-science-collective/i-built-an-self-hosted-ai-meeting-note-taker-that-runs-100-offline-heres-how-you-can-too-d110b7ef0b95
- **Platform:** Any (Python)
- **Transcription:** OpenAI Whisper
- **LLM:** Ollama (any model)
- **Invisible:** Depends on capture method
- **Speaker diarisation:** Via WhisperX or pyannote

**Strengths:**
- Fully customisable — exactly your requirements
- Complete control over pipeline
- Any LLM via Ollama
- Can integrate cal.com API directly

**Gaps:**
- DIY — significant development effort
- No built-in UI
- No coaching/analytics out of the box
- Requires ongoing maintenance

**Verdict:** Viable if you have development resources. Use Screenpipe for capture, Whisper for transcription, Ollama for LLM, Hermes for actions.

---

### 9. Otter.ai

- **URL:** https://otter.ai
- **Platform:** Cloud (Web, iOS, Android)
- **Transcription:** Cloud-based AI
- **LLM:** Cloud (proprietary)
- **Invisible:** ❌ Bot joins meetings
- **Speaker diarisation:** ✅ Yes
- **Real-time:** ✅ Live transcription + triggers

**Strengths:**
- Mature product with real-time features
- Speaker identification
- Action items, summaries, bullet points
- Team collaboration

**Gaps:**
- **Bot joins** — visible to participants, changes meeting dynamics
- **Cloud-only** — no local processing, all audio uploaded
- Class action lawsuit (2025) for recording without consent
- $8.33/mo+ (not free)
- No Ollama compatibility

**Verdict:** Feature-rich but fails the "invisible" and "Ollama" requirements. Privacy concerns.

---

### 10. Granola.ai

- **URL:** https://granola.ai
- **Platform:** macOS (local capture + cloud AI)
- **Transcription:** Local capture, GPT-4 for AI
- **LLM:** GPT-4 (not replaceable)
- **Invisible:** ✅ Captures system audio locally
- **Speaker diarisation:** ✅ Yes
- **Integration:** ✅ Cal.com integration (blogged by cal.com)

**Strengths:**
- Invisible capture (no bot)
- Polished UX with note-taking during meetings
- cal.com integration documented
- GPT-4 powered summaries

**Gaps:**
- **$18/mo** — not free
- **Not Ollama compatible** — locked to GPT-4
- macOS only (no Windows/Linux)
- Not open source — no customisation
- No real-time triggers/coaching
- No MCP/API

**Verdict:** The cal.com integration is notable, but proprietary and expensive. Anarlog is the open-source equivalent.

---

## Hermes Agent Native Setup — Detailed Analysis

### Option A: Screenpipe + Hermes Agent

This is the most capable native Hermes setup:

```
cal.com (booking) → Cal Video (call) → Screenpipe (capture + transcribe)
                                            ↓
                                      Hermes Agent (action)
                                      ├── Gmail → email documents
                                      ├── CRM → update task status
                                      ├── cal.com API → book follow-up
                                      └── Memory → save knowledge
```

**Why this works:**
- Screenpipe captures system audio 24/7 — invisible to participants
- Transcribes locally with Whisper (Ollama for search/analysis)
- MCP server built into Screenpipe — Hermes can query transcript data
- "Pipes" system allows agent-triggered actions based on activity
- Hermes has Gmail, cal.com, and CRM skills already

**Current capability gaps:**
- No real-time phrase triggers yet (post-meeting analysis only)
- No coaching/suggestions to host
- Screenpipe captures everything (needs filtering for meeting-only context)
- Speaker diarisation quality depends on Whisper model

### Option B: Custom Whisper + Ollama + Hermes Pipeline

Build using existing Hermes tools:
- Use macOS system audio capture (BlackHole or SoundFlower)
- Feed to Whisper.cpp for real-time transcription
- Pipe transcript to Ollama for summary/action extraction
- Hermes processes extracted actions (email, cal.com API, CRM)
- cal.com API for booking follow-ups

**Advantage:** Complete control, all Ollama-compatible, Hermes-native
**Disadvantage:** Significant build effort, no UI

### Option C: Anarlog + Hermes cron

- Anarlog captures meeting → saves `.md` files to disk
- Hermes cron watches the directory → processes new `.md` files
- Extracts action items → dispatches via Gmail/cal.com/CRM skills

**Advantage:** Zero build (Anarlog exists), file-based integration
**Disadvantage:** Post-meeting only (no real-time), macOS only

---

## Recommendation

| Priority | Tool | Why |
|---|---|---|
| **Immediate** | **Screenpipe** | Best Hermes-native fit, MCP support, YC-backed, cross-platform. Captures all meetings including Cal Video. |
| **Immediate** | **Cal.com Notes** | Zero-effort for Cal Video calls. Already in your stack. Use alongside Screenpipe for overlap. |
| **Short-term** | **Anarlog** | Best pure meeting note-taker UX for macOS. Saves as `.md` — easy to script Hermes integration. |
| **Future** | **Custom Hermes pipeline** | Only path to real-time triggers, coaching, and multilingual voice agent. Uses Screenpipe as capture layer + Hermes for action orchestration. |

**Build-vs-buy split:** Use Screenpipe + Cal.com Notes for capture/transcription now. Build Hermes-triggered actions on top (email, CRM, cal.com booking). The voice agent requirement is custom work regardless of tool choice.

---

## Sources

- https://github.com/Zackriya-Solutions/meetily — Meetily GitHub
- https://github.com/fastrepl/anarlog — Anarlog GitHub
- https://github.com/screenpipe/screenpipe — Screenpipe GitHub
- https://github.com/OpenWhispr/openwhispr — OpenWhispr GitHub
- https://github.com/rishikanthc/Scriberr — Scriberr GitHub
- https://github.com/thewh1teagle/vibe — Vibe GitHub
- https://cal.com/notes — Cal.com Notes
- https://cal.com/blog/calcom-v6-7 — Cal.com v6.7 release
- https://anarlog.so/blog/selfhosted-ai-notetakers — Self-hosted notetaker comparison
- https://meetily.ai/blog/best-self-hosted-meeting-transcription-tools-2026 — 10 OSS tools compared
- https://screenpipe.com/resources/use-cases/ai-meeting-notes — Screenpipe meeting notes
