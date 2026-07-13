#!/usr/bin/env python3
"""
Run dual OCR (qwen3-vl + Apple Vision) on video frames and save results as JSON.
"""
import json, os, base64, subprocess, sys, time, re
from pathlib import Path
from datetime import datetime

FRAMES_DIR = Path("/Users/warren/Documents/_HQ_AI/EdgeGDE/apps/EdgeGDE - Document DB/AFIRMICO Documents DB/AFIRMICO - PCFS - LMS Data/videos/welcome-orientation/frames")
OLLAMA_URL = "http://100.108.198.69:11434/v1/chat/completions"
POLLER_DIR = "/Users/warren/Documents/_HQ_AI/EdgeGDE/poller"

# Key slide frames (based on file size analysis + section timestamps)
KEY_FRAMES = [
    ("hook/hook_0001", "00:00", "Hook - Opening frame"),
    ("hook/hook_0010", "00:05", "Hook - Speaker appears"),
    ("timeline/frame_0003", "01:48", "Section intro slide"),
    ("timeline/frame_0013", "07:48", "Getting Started / LMS overview"),
    ("timeline/frame_0018", "10:48", "Accreditations - lender roadmap start"),
    ("timeline/frame_0025", "15:00", "Accreditations - lender list"),
    ("timeline/frame_0034", "20:24", "SFG / Accreditation details"),
    ("timeline/frame_0044", "26:24", "Deal Submission Process"),
    ("timeline/frame_0049", "29:24", "Deal submission - document checklist"),
    ("timeline/frame_0053", "31:48", "Mentor Deal Review"),
    ("timeline/frame_0058", "34:48", "File Checking Process"),
    ("timeline/frame_0061", "36:36", "File Checking - SLAs"),
]

def qwen_ocr(frame_path: str) -> dict:
    """Pass 1: qwen3-vl interpretive text extraction."""
    with open(frame_path, "rb") as f:
        b64 = base64.b64encode(f.read()).decode()
    
    prompt = """Extract ALL visible text from this slide/frame exactly as shown. 
Return only the text content preserving layout where possible.
Include: headings, bullet points, labels, numbers, and any fine print.
If this is a presentation slide, capture the slide title and all bullet points.
If this is a video call screen with a person, just say "[Talking head - speaker visible]".
Do NOT add any commentary or description — just the text you see."""

    try:
        resp = subprocess.run(["curl", "-s", "-X", "POST", OLLAMA_URL,
            "-H", "Content-Type: application/json",
            "-d", json.dumps({
                "model": "qwen3-vl:4b",
                "messages": [{"role": "user", "content": [
                    {"type": "text", "text": prompt},
                    {"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{b64}"}}
                ]}],
                "max_tokens": 1024,
                "temperature": 0.1,
            })], capture_output=True, text=True, timeout=30)
        
        data = json.loads(resp.stdout)
        text = data.get("choices", [{}])[0].get("message", {}).get("content", "")
        return {"success": True, "text": text, "source": "qwen3-vl"}
    except Exception as e:
        return {"success": False, "text": "", "error": str(e), "source": "qwen3-vl"}

def apple_vision_ocr(frame_path: str) -> dict:
    """Pass 2: Apple Vision Framework OCR via ocr_worker.py."""
    try:
        result = subprocess.run(
            [sys.executable, os.path.join(POLLER_DIR, "ocr", "ocr_worker.py"), frame_path],
            capture_output=True, text=True, timeout=30,
            env={**os.environ, "LANG": "en_AU.UTF-8", "LC_ALL": "en_AU.UTF-8"}
        )
        data = json.loads(result.stdout)
        if data.get("error"):
            return {"success": False, "text": "", "error": data["error"], "source": "apple-vision"}
        
        text = data.get("text", "")
        confidence = data.get("confidence", 0.0)
        fields = data.get("fields", [])
        return {"success": True, "text": text, "confidence": confidence, 
                "fields_count": len(fields), "source": "apple-vision"}
    except Exception as e:
        return {"success": False, "text": "", "error": str(e), "source": "apple-vision"}

def main():
    results = {}
    
    for frame_rel, timestamp, description in KEY_FRAMES:
        frame_path = str(FRAMES_DIR / f"{frame_rel}.jpg")
        if not os.path.exists(frame_path):
            print(f"SKIP: {frame_rel}.jpg not found")
            continue
        
        print(f"\n=== {timestamp} - {description} ===")
        print(f"Frame: {frame_path}")
        
        entry = {"timestamp": timestamp, "description": description}
        
        # Pass 1: qwen3-vl
        print("  qwen3-vl...", end=" ", flush=True)
        qwen_result = qwen_ocr(frame_path)
        entry["qwen"] = qwen_result
        if qwen_result["success"]:
            preview = qwen_result["text"][:200].replace("\n", " | ")
            print(f"OK ({len(qwen_result['text'])} chars): {preview}")
        else:
            print(f"FAIL: {qwen_result.get('error', 'unknown')}")
        
        # Pass 2: Apple Vision
        print("  Apple Vision...", end=" ", flush=True)
        av_result = apple_vision_ocr(frame_path)
        entry["apple_vision"] = av_result
        if av_result["success"]:
            preview = av_result["text"][:200].replace("\n", " | ")
            conf = av_result.get("confidence", 0)
            print(f"OK (conf={conf:.2f}, {len(av_result['text'])} chars): {preview}")
        else:
            print(f"FAIL: {av_result.get('error', 'unknown')}")
        
        results[frame_rel] = entry
    
    # Save all results
    output_path = FRAMES_DIR / "ocr_results.json"
    with open(output_path, "w") as f:
        json.dump(results, f, indent=2)
    
    print(f"\n\nResults saved to {output_path}")
    print(f"Frames processed: {len(results)}")

if __name__ == "__main__":
    main()
