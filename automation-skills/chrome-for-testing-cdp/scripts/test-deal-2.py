#!/usr/bin/env python3
"""Complete Test Deal 2 automation using Chrome for Testing CDP.

Prerequisites:
  - Chrome for Testing running with CDP port 9222
  - SALESTREKKER_USERNAME, SALESTREKKER_PASSWORD, SALESTREKKER_TOTP_SECRET in env
"""

import os, time, pyotp, json
from datetime import datetime, timedelta
from playwright.sync_api import sync_playwright

CDP = "http://localhost:9222"
BASE = "https://pc.v2.salestrekker.com"
BOARD_UUID = "24f7b6a0-545a-4f8c-9e0f-0dc9ed175269"
U = os.environ.get("SALESTREKKER_USERNAME","")
P = os.environ.get("SALESTREKKER_PASSWORD","")
TS = os.environ.get("SALESTREKKER_TOTP_SECRET","")
REPORT = os.path.expanduser("~/Desktop/test-deal-2-report.json")
FINANCE_DUE = (datetime.now()+timedelta(days=14)).strftime("%d/%m/%Y")
SETTLEMENT = (datetime.now()+timedelta(days=90)).strftime("%d/%m/%Y")

def login(page):
    page.goto(f"{BASE}/dashboard", timeout=15000)
    time.sleep(2)
    if "sign-in" in page.url.lower():
        page.locator('input[type="email"]').fill(U)
        page.locator('input[type="password"]').fill(P)
        page.locator('button[type="submit"]').click(); time.sleep(3)
        code = pyotp.TOTP(TS).now()
        page.locator('input._bS').first.focus()
        page.keyboard.type(code, delay=50); time.sleep(1)
        page.locator('button:has-text("Verify code")').click(); time.sleep(4)
        page.goto(f"{BASE}/dashboard", timeout=15000); time.sleep(3)

def add_contact(page, first, last, email, phone, idx=0):
    """Add a contact via the inline form. idx=0 for first, 1 for second."""
    page.evaluate("""
        var divs = document.querySelectorAll('div[aria-haspopup]');
        for (var i = 0; i < divs.length; i++) {
            if (divs[i].textContent.trim() === 'Add contact') {
                divs[i].click(); break;
            }
        }
    """)
    time.sleep(2)
    page.locator('text="Add new person"').first.click(timeout=3000)
    time.sleep(3)
    page.locator('input[name="firstName"]').nth(idx).fill(first)
    page.locator('input[name="lastName"]').nth(idx).fill(last)
    page.locator('input[name="value"]').nth(idx*2).fill(phone)
    page.locator('input[name="value"]').nth(idx*2+1).fill(email)
    time.sleep(0.3)
    page.locator('button[title="Add"]:not([title*="contact"])').click(timeout=5000)
    time.sleep(3)

def save_deal(page):
    """Save deal via React onClick handler bypass."""
    return page.evaluate("""
        var btns = document.querySelectorAll('button');
        for (var i = 0; i < btns.length; i++) {
            if (btns[i].textContent.trim() === 'Save' && btns[i].offsetParent !== null) {
                var key = Object.keys(btns[i]).find(k => k.startsWith('__reactProps'));
                if (btns[i][key] && btns[i][key].onClick) {
                    btns[i][key].onClick(); return 'SAVED';
                }
            }
        }
        return 'FAILED';
    """)

def main():
    pw = sync_playwright().start()
    browser = pw.chromium.connect_over_cdp(CDP)
    page = browser.contexts[0].pages[0]
    try:
        login(page)
        page.locator('#deals div[aria-haspopup]').click(); time.sleep(2)
        page.locator('[role=menu]').locator('text=Home Loans').first.click(); time.sleep(4)
        page.locator('button:has-text("Add New")').first.click(); time.sleep(3)

        page.locator('input[name="name"]').fill("Test 2 - Purple Circle Onboarding")
        page.locator('input[name="value.total"]').fill("800000")
        dates = page.locator('input[placeholder="DD/MM/YYYY"]')
        if dates.count() >= 2:
            dates.nth(0).fill(FINANCE_DUE); dates.nth(1).fill(SETTLEMENT)

        add_contact(page, "Sam", "Smith", "sam.smith@example.com", "0400 000 000", 0)
        add_contact(page, "Amy", "Smith", "amy.smith@example.com", "0400 000 001", 1)

        result = save_deal(page)
        time.sleep(3)
        print(f"Deal saved: {result}")
    finally:
        pw.stop()

if __name__ == "__main__":
    main()
