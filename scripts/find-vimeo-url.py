#!/usr/bin/env python3
"""Find Vimeo URL on Purple CFS lesson page — try multiple strategies."""
import sys, re, json, urllib.request, urllib.parse

url = sys.argv[1] if len(sys.argv) > 1 else "https://purplecfs.com.au/lessons/handover-to-academy/"

# Strategy 1: Direct HTML
req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
try:
    with urllib.request.urlopen(req, timeout=10) as resp:
        html = resp.read().decode()
except Exception as e:
    print(f"FAIL: {e}")
    sys.exit(1)

# Check for Vimeo in HTML
vimeo = re.search(r'player\.vimeo\.com/video/(\d+)(?:\?h=([a-f0-9]+))?', html)
if vimeo:
    vid, h = vimeo.group(1), vimeo.group(2) or ""
    print(f"VIMEO:{vid}:{h}")
    sys.exit(0)

# Strategy 2: Look for lesson_video shortcode data
lesson_video = re.search(r'data-lesson-id[=:][\s]*["\']?(\d+)', html)
if lesson_video:
    lesson_id = lesson_video.group(1)
    print(f"LESSON_ID:{lesson_id}")

# Strategy 3: Look for WordPress post ID
post_id = re.search(r'post[-\s]*id[=:][\s]*["\']?(\d+)', html)
if post_id:
    print(f"POST_ID:{post_id.group(1)}")

# Strategy 4: Look for REST API nonce
nonce = re.search(r'wp_rest["\']*[^,}]*["\']([a-f0-9]+)', html)
if nonce:
    print(f"REST_NONCE:{nonce.group(1)}")

print("NO_VIMEO_FOUND")
