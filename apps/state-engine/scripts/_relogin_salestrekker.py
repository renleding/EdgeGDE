"""One-shot Salestrekker re-login (Approach A — CDP, max 2 attempts).

Separate step — NEVER embedded in automation scripts. Fails fast if the
session is already alive (read-only check only).
"""
import os
import sys
import time

import pyotp
from patchright.sync_api import sync_playwright

MAX_ATTEMPTS = 2
attempt = 0


def check_state(page):
    t = page.title().lower()
    if 'dashboard' in t or 'deals' in t or 'board' in t:
        return 'dashboard'
    if 'two-factor' in t or 'totp' in t:
        return 'totp'
    return 'signin'


pw = sync_playwright().start()
browser = pw.chromium.connect_over_cdp('http://localhost:9222')
page = browser.contexts[0].pages[0]
page.goto('https://pc.v2.salestrekker.com/auth/sign-in', timeout=20000)
time.sleep(5)

if check_state(page) == 'dashboard':
    print('Already authenticated — no login needed')
    pw.stop()
    sys.exit(0)

u = os.environ['SALESTREKKER_USERNAME']
p = os.environ['SALESTREKKER_PASSWORD']

while attempt < MAX_ATTEMPTS:
    attempt += 1
    print(f'Login attempt {attempt}/{MAX_ATTEMPTS}')
    page.goto('https://pc.v2.salestrekker.com/auth/sign-in', timeout=20000)
    time.sleep(4)

    # Check profile auto-fill FIRST — never double-fill
    email_val = page.evaluate(
        '() => document.querySelector("input[type=email]")?.value || ""')
    if not email_val:
        page.locator('input[type="email"]').first.type(u, delay=20)
        time.sleep(0.3)
        page.locator('input[type="password"]').first.type(p, delay=20)
        time.sleep(0.3)
    # locator.click() — CDP Input.dispatchMouseEvent (evaluate click is ignored)
    page.locator('button:has-text("Sign in")').first.click()
    time.sleep(8)

    state = check_state(page)
    if state == 'totp':
        code = pyotp.TOTP(os.environ['SALESTREKKER_TOTP_SECRET']).now()
        page.locator('input').first.focus()
        page.keyboard.type(code, delay=60)  # per-digit React onChange
        time.sleep(0.5)
        page.keyboard.press('Enter')
        time.sleep(8)
        state = check_state(page)

    if state == 'dashboard':
        print(f'LOGIN OK after {attempt} attempt(s) — title: {page.title()}')
        pw.stop()
        sys.exit(0)

    print(f'Attempt {attempt} failed — state: {state}')

print('LOGIN FAILED after 2 attempts — account may be rate-limited (20min). STOP.')
pw.stop()
sys.exit(1)
