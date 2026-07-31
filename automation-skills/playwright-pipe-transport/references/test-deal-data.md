# Operational Notes & Test Deal Data

## Headless Rendering Limitation

Salestrekker's kanban board view does NOT render deal cards in headless Chrome. The board shows "All deals (0)" even when deals exist in the workflow. This is NOT a Playwright bug — it's a browser-engine limitation of the SPA's kanban/drag-and-drop view.

**Fix**: Use headed mode with window positioned off-screen so the user isn't disturbed:
```javascript
headless: false,
args: ['--window-position=-3000,0', '--window-size=1920,1080']
```

This renders the full SPA on the external display at negative coordinates. The user never sees it.

## Login Retry Safety (Hard Rule)

MAX 2 login attempts per session. If both fail, stop and ask the user for intervention. Never retry a third time with a different approach — this risks account lockout.

## Test Deal Data (Salestrekker 2.0 Getting Started Guide v3.1)

### Deal
| Field | Value |
|-------|-------|
| Title | TEST - Smith, S & A, Purch, OO $800K |
| Value | $800,000 |
| Loan amount | $640,000 |
| Lead source | Client referral |
| Owner | Warren Ledingham |

### Contacts
- **Sam Smith** — sam@fakeemail.com, 0421 123 123
- **Amy Smith** — amy@fakeemail.com

### Sam Smith — Personal & Employment
- Occupation: Electrician
- Employer: Wealth Wages (contact: Sally Carmichael)
- Salary: $150,000/year

### Assets
| Type | Description | Value | Ownership |
|------|-------------|-------|-----------|
| Vehicle | BMW X5, est 2018, reg XYZ123 | $40,000 | Sam 100% |
| Home contents | Home Contents | $100,000 | Sam 50%, Amy 50% |
| Bank account | ANZ Savings, BSB 123-456, Acc 987654321 | $350,000 | Sam 50%, Amy 50% |

### Liabilities
| Type | Details | Limit/Amount | Balance | Repayment |
|------|---------|-------------|---------|-----------|
| Credit card (Sam) | | $5,000 | $0 | |
| Credit card (Amy) | | $5,000 | $0 | |
| Vehicle loan | BMW | $20,000 | $10,000 | $260/month |

### Expenses
| Category | Amount | Frequency |
|----------|--------|-----------|
| Groceries | $270 | Weekly |
| Clothing | $200 | Monthly |
| Phone/Internet | $110 | Monthly |

### Insurance
- **Income Protection**: Youi, $250,000 cover, $90/month premium
