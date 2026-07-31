# Asset & Liability Field Maps (26 Jul 2026)

Discovered via CDP native interaction on Salestrekker 2.0 React SPA.

## Vehicle (Vehicles make and model)

| Field name | Type | Value | Notes |
|---|---|---|---|
| `name` | text | "BMW X5 2018" | Make/model/description |
| `vehicleBuildDate` | text | "06/2018" | MM/YYYY format |
| `value` | text | "40000" | Numeric, no commas |
| `vehicleRegoNumber` | text | "XYZ123" | Registration |
| `percent` | text | "50" | Ownership split (1 per applicant) |

## Home Contents (Home content)

| Field name | Type | Value | Notes |
|---|---|---|---|
| `name` | text | "Home contents" | Description |
| `value` | text | "100000" | Numeric |

## Bank Account / Savings

| Field name | Type | Value | Notes |
|---|---|---|---|
| `name` | text | "ANZ Savings" | Account name |
| `value` | text | "350000" | Balance |
| `bsb` | text | "123-456" | BSB number |
| `accountNumber` | text | "987654321" | Account number |

## Credit Card

| Field name | Type | Value | Notes |
|---|---|---|---|
| `name` | text | "ANZ Visa" | Card name |
| `creditCardNumber` | text | "654321987" | Last 6-8 digits |
| `limit` | text | "5000" | Credit limit ($ prefix in UI, pass bare number) |
| `balance` | text | "0" | Current balance ($ prefix) |
| `repayment` | text | "0" | Minimum monthly |
| `percent` | text | "100" | Ownership split |

## Vehicle Loan

| Field name | Type | Value | Notes |
|---|---|---|---|
| `name` | text | "BMW Financial" | Loan name |
| `value` or `balance` | text | "10000" | Outstanding balance |
| `repayment` | text | "260" | Monthly repayment |

## Known UI Behaviours

- **$ prefix:** value fields like `limit`, `balance`, `value` show "$ 0" as placeholder.
  The native setter works with bare numbers — "$" is UI-only formatting.
- **Percent fields:** Default to 50% for joint applicants. Set 100% for single-owner items.
- **Duplicate field names:** Multiple elements may share the same `name` attribute
  (e.g., `percent`, `totalValue`). The first visible empty field is the one to fill.
- **No hidden fields:** All fields are visible in the DOM (`offsetParent !== null` check).
  If a field isn't visible, the parent modal/dropdown hasn't been opened yet.
