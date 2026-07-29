"""Fiber Inspector — read-only React fiber tree walker for form validation diagnosis.

NOTE: The Salestrekker Add deal page does NOT use React. All React-specific 
approaches (fiber tree, React props, Formik state) are INVALID for this page.
"""
import json, sys, argparse
from patchright.sync_api import sync_playwright

FIBER_CHECK_SCRIPT = """
(() => {
    const results = {};
    
    // Framework detection
    results.hasReact = !!(window.React || window.__REACT_DEVTOOLS_GLOBAL_HOOK__);
    results.hasVue = !!(window.Vue || document.__vue_app__);
    results.hasFormikGlobal = typeof window.Formik !== 'undefined';
    
    // Scan for elements with custom __ properties
    let count = 0;
    let sample = null;
    for (const el of document.querySelectorAll('*')) {
        const keys = Object.getOwnPropertyNames(el);
        const custom = keys.filter(k => k.startsWith('__'));
        if (custom.length > 0) {
            count++;
            if (!sample) sample = { tag: el.tagName, keys: custom.slice(0, 5) };
        }
        if (count > 10) break;
    }
    results.elementsWithCustomProps = count;
    results.sampleCustomProps = sample;
    
    // Find target element
    let target = null;
    for (const el of document.querySelectorAll('button,[role=button],input')) {
        if (el.textContent?.trim() === 'Save' || el.getAttribute('name') === 'Save') {
            target = el; break;
        }
    }
    if (!target) return { ...results, error: 'Save button not found' };
    
    // Walk DOM ancestors looking for React fibers
    let ancestor = target.parentElement;
    let depth = 0;
    while (ancestor && depth < 30) {
        const keys = Object.getOwnPropertyNames(ancestor);
        const custom = keys.filter(k => k.startsWith('__'));
        if (custom.length > 0) {
            results.foundFiberAt = { depth, tag: ancestor.tagName, keys: custom };
            break;
        }
        ancestor = ancestor.parentElement;
        depth++;
    }
    results.maxDepthChecked = depth;
    
    return results;
})();
"""

def inspect_fiber(target_text: str = "Save"):
    """Run fiber inspection."""
    pw = sync_playwright().start()
    browser = pw.chromium.connect_over_cdp('http://localhost:9222')
    page = browser.contexts[0].pages[0]
    
    print(f"Page: {page.title()[:40]} | {page.url[:60]}")
    
    result = page.evaluate(FIBER_CHECK_SCRIPT)
    print(json.dumps(result, indent=2, default=str))
    
    print("\n--- ANALYSIS ---")
    if result.get('hasReact'):
        print("✅ Page uses React — fiber inspection is valid")
    elif result.get('hasVue'):
        print("✅ Page uses Vue")
    elif result.get('elementsWithCustomProps', 0) == 0:
        print("❌ Page uses UNKNOWN framework — no React/Vue/Angular/Svelte detected")
        print("   Event handlers are plain addEventListener closures.")
        print("   Cannot inspect fiber tree or Formik state.")
        print("   Recommend: OS-level events (pyautogui) or reverse-engineering framework state.")
    else:
        print(f"✅ Found {result['elementsWithCustomProps']} elements with custom properties")
    
    pw.stop()

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description='Inspect React fiber tree for form state')
    parser.add_argument('--target', default='Save', help='Element text to inspect')
    parser.add_argument('--check-framework', action='store_true', default=True,
                       help='Check what JS framework the page uses')
    args = parser.parse_args()
    inspect_fiber(args.target)
