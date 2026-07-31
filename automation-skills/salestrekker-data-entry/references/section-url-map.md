# Deal Editor Section URL Map (27 Jul 2026)

## Pattern

All sections in the home loan editor are accessed via:
```
/deals/home-loan/{DEAL_ID}/{CONTACT_ID}/{section-slug}
```

## Section Slugs

| Section Name       | Slug                          |
|--------------------|-------------------------------|
| Client profile     | `applicant-1`                 |
| (second applicant) | `applicant-2`                 |
| Assets             | `assets`                      |
| Liabilities        | `liabilities`                 |
| Income             | `income`                      |
| Expenses           | `expenses`                    |
| Needs & objectives | `needs-and-objectives`        |
| Risks (per appl.)  | `risks-1`, `risks-2`, etc.    |
| Product reqs       | `product-requirements`        |
| Insurance          | `insurance`                   |
| Other advisers     | `other-advisers`              |
| Security details   | `security-details`            |
| Funding worksheet  | `funding-worksheet`           |
| Product search     | `products-search`             |
| Compare products   | `compare-products`            |
| Commissions        | `commissions`                 |
| Compliance         | `compliance-comments-and-documents` |
| Summary            | `summary`                     |
| Diversification    | `diversification-opportunities` |

## Usage

Navigate to a section:
```python
page.evaluate(f"window.location.href = '/deals/home-loan/{did}/{cid}/assets'")
time.sleep(4)
```

Expand the Home loan tab first to enable the sidebar:
```python
page.evaluate("""
    var tabs = document.querySelectorAll('[role=tab]');
    for(var t of tabs) {
        if(t.textContent.includes('Home loan')) { t.click(); break; }
    }
""")
time.sleep(3)
```

## Notes
- `/deals/board` and `/deals` URLs may hang with "Loading..." when navigated
  via `window.location.href`. Use sidebar clicks to reach the board instead.
- Dashboard URL (`/dashboard`) always renders reliably.
- `window.location.href` works for section navigation; `page.goto()` to any
  authenticated SPA URL triggers sign-out.
