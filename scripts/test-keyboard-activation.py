#!/usr/bin/env python3
"""Test keyboard activation for Add Contact button.
Based on analysis: the button likely uses a Popover/Radix wrapper
that responds to keyboard (Enter/Space) but not programmatic clicks.
"""

import os, time, pyotp
from patchright.sync_api import sync_playwright

PROFILE = os.path.expanduser("~/Library/Application Support/Google/Chrome/8um7547w")
BASE = "https://pc.v2.salestrekker.com"
U = os.environ.get("SALESTREKKER_USERNAME","")
P = os.environ.get("SALESTREKKER_PASSWORD","")
TS = os.environ.get("SALESTREKKER_TOTP_SECRET","")

def main():
    pw = sync_playwright().start()
    ctx = pw.chromium.launch_persistent_context(
        PROFILE, channel="chrome", headless=False,
        args=["--no-first-run"], viewport={"width":1280,"height":900})
    page = ctx.pages[0] if ctx.pages else ctx.new_page()

    try:
        # Navigate and login if needed
        page.goto(f"{BASE}/dashboard", timeout=30000)
        time.sleep(3)
        if "sign-in" in page.url.lower():
            print("→ Logging in...")
            page.locator('input[type="email"]').fill(U)
            page.locator('input[type="password"]').fill(P)
            page.locator('button[type="submit"]').click()
            time.sleep(4)
            body = page.evaluate("document.body?.innerText?.substring(0,500)||''")
            if any(w in body.lower() for w in ["code","totp","authenticator","2fa"]):
                code = pyotp.TOTP(TS).now()
                print(f"  → TOTP: {code}")
                inputs = page.locator('input:visible').all()
                di = 0
                for inp in inputs:
                    b = inp.bounding_box()
                    if b and b['width'] < 60 and inp.get_attribute('type') != 'hidden' and di < len(code):
                        inp.fill(code[di])
                        di += 1
                time.sleep(1)
                page.locator('button[type="submit"], button:has-text("Verify")').first.click()
                time.sleep(4)
            page.goto(f"{BASE}/dashboard", timeout=15000)
            time.sleep(3)

        print(f"Logged in: {'dashboard' in page.url.lower()}")

        # Navigate to the existing deal
        uuid = "24f7b6a0-545a-4f8c-9e0f-0dc9ed175269"
        page.goto(f"{BASE}/deals/add/{uuid}/deal-information", timeout=15000)
        time.sleep(4)
        print(f"On deal page: {page.title()[:50]}")

        # Find Add Contact button
        ac = page.locator('button:has-text("Add contact")')
        print(f"Add contact: visible={ac.is_visible()} enabled={ac.is_enabled()}")

        # Method 1: Keyboard Enter
        print("\n--- Method 1: Focus + Enter ---")
        ac.focus()
        time.sleep(0.5)
        page.keyboard.press("Enter")
        time.sleep(3)
        children = page.evaluate("document.querySelector('[role=dialog] section')?.children?.length || 0")
        print(f"Modal children: {children}")
        
        if children == 0:
            # Method 2: Keyboard Space
            print("\n--- Method 2: Focus + Space ---")
            ac.focus()
            time.sleep(0.5)
            page.keyboard.press("Space")
            time.sleep(3)
            children = page.evaluate("document.querySelector('[role=dialog] section')?.children?.length || 0")
            print(f"Modal children: {children}")

        if children == 0:
            # Method 3: Click parent
            print("\n--- Method 3: Parent click ---")
            parent = page.evaluate("""
                (function() {
                    var btns = document.querySelectorAll('button');
                    for (var i = 0; i < btns.length; i++) {
                        if (btns[i].textContent.trim() === 'Add contact' && btns[i].offsetParent !== null) {
                            // Try clicking the parent div
                            var p = btns[i].parentElement;
                            if (p) {
                                p.click();
                                return 'CLICKED_PARENT';
                            }
                        }
                    }
                    return 'NOT_FOUND';
                })()
            """)
            print(f"Parent click: {parent}")
            time.sleep(3)
            children = page.evaluate("document.querySelector('[role=dialog] section')?.children?.length || 0")
            print(f"Modal children: {children}")

        if children > 0:
            print("\n✅ SUCCESS! Modal content loaded!")
            # Log what's in the modal
            text = page.evaluate("document.querySelector('[role=dialog]')?.innerText?.substring(0,300)||''")
            print(f"Modal text: {text}")
        else:
            print("\n❌ Modal still empty. Trying Chrome for Testing...")

        input("\nPress Enter to close...")

    finally:
        pw.stop()

if __name__ == "__main__":
    main()
