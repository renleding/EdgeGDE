#!/usr/bin/env python3
"""Find video data in a Purple CFS lesson page, even behind auth."""
import sys, re, json, urllib.request

url = sys.argv[1]

req = urllib.request.Request(url, headers={
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
    "Accept": "text/html,application/xhtml+xml",
})
try:
    with urllib.request.urlopen(req, timeout=15) as r:
        html = r.read().decode()
except Exception as e:
    print(f"FETCH_ERROR:{e}")
    sys.exit(1)

# 1. Direct Vimeo URL
v = re.search(r'player\.vimeo\.com/video/(\d+)(?:\?h=([a-f0-9]+))?', html)
if v:
    print(f"VIMEO:{v.group(1)}:{v.group(2) or ''}")
    sys.exit(0)

# 2. LD JSON data
for m in re.finditer(r'<script[^>]+type=["\']application/json["\'][^>]*>(.*?)</script>', html, re.DOTALL):
    try:
        data = json.loads(m.group(1))
        s = json.dumps(data)
        vm = re.search(r'vimeo[/=](\d+)', s)
        if vm:
            print(f"VIMEO_JSON:{vm.group(1)}")
            sys.exit(0)
    except: pass

# 3. Check for ld_lesson_video data attributes  
for m in re.finditer(r'data-video-url=["\']([^"\']+)', html):
    print(f"VIDEO_URL:{m.group(1)}")
    sys.exit(0)

# 4. Check for wp-json or REST nonce
for m in re.finditer(r'wp_rest["\']*[^,}]*["\']([a-f0-9]+)', html):
    print(f"REST_NONCE:{m.group(1)}")

# 5. Check lesson_video shortcode
count = len(re.findall(r'lesson_video', html))
print(f"LESSON_VIDEO_SHORTCODE:{count}")
print(f"PAGE_LENGTH:{len(html)}")
# Check for auth wall
if 'mepr-unauth' in html or 'restricted-access' in html.lower()[:10000]:
    print("AUTH_WALL:MemberPress")
elif 'wp-login' in html.lower()[:10000]:
    print("AUTH_WALL:WordPress")
else:
    print("AUTH_WALL:none")
