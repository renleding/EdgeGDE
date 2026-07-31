# Salestrekker Field Name Mapping

Discovered through trial-and-error automation. Each section uses specific `name` attributes (not placeholders). 

## Personal Details (Sam Smith)

```
firstName → Sam
middleName → John (optional, not in test data)
lastName → Smith
preferredName → Sam
previousName → 
date of birth → DD/MM/YYYY format
countryOfResidency → Select one dropdown
countryOfTaxResidence → Select one dropdown
citizenshipOf → Select one dropdown
countryOfBirth → Select one dropdown
cityOfBirth → 
mothersMaidenName → 
```

**Buttons:** `Add current employment`, `Add previous employment`, `Add new address`, `Add next of kin`

## Assets

**Dropdown types:** Owner occupied properties, Secondary residence properties, Investment property address, **Vehicles make and model**, **Home content**, Super fund institutions, Other, Balance sheet, Shares, **Bank account**

### Vehicle fields
```
name → vehicle desc (e.g. "BMW X5")
vehicleBuildDate → MM/YYYY format (e.g. "06/2018")
value → dollar amount (e.g. 40000)
vehicleRegoNumber → rego (e.g. "XYZ123")
percent → auto-calculated 33% per applicant
```

### Home Content fields
```
name → description (e.g. "Home Contents")
value → dollar amount
percent → auto-calculated
```

### Bank Account fields
```
bankName → bank name (e.g. "ANZ Savings")
bankBSB → BSB (e.g. "123-456")
bankAccountNumber → account number (e.g. "987654321")
value → balance amount
percent → auto-calculated
```

**Button:** `Add asset` opens type dropdown → click type → fields appear

## Liabilities

**Dropdown types:** Mortgage loan, **Credit card**, **Vehicle loan**, Personal loan, Education debt, Other, Balance sheet, Buy now pay later, Payday loan, Overdraft, SMSF loan

### Credit Card fields
```
name → Select one (issuer)
creditCardNumber → card number
limit → credit limit (e.g. 5000)
balance → outstanding balance (e.g. 0)
repayment → monthly repayment (e.g. 0)
percent → auto-calculated
```

### Vehicle Loan fields
Uses same field structure as Credit Card when added from Liabilities:
```
name → description (e.g. "BMW X5 Loan")
limit → loan amount (e.g. 20000)
balance → outstanding (e.g. 10000)
repayment → monthly (e.g. 260)
```

When multiple liabilities exist, use nth occurrence counting. Vehicle loan is typically the 3rd `limit`/`balance`/`repayment` set.

**Button:** `Add liability` opens type dropdown → click type → fields appear  
**IMPORTANT:** When the vehicle asset was created in Assets, a `Add vehicle loan` button may auto-appear.

## Income

**Dropdown types:** **PAYG income**, Business income, Other taxable income, Non taxable income

### PAYG fields
```
employerName → employer (e.g. "Wealth Wages")
grossSalary → annual salary (e.g. 150000)
bonus → 
overtimeEssential → 
overtimeNonEssential → 
commission → 
allowance → 
```

**Button:** `Add income` → type dropdown → `Add` button

## Expenses

**IMPORTANT:** Must select the applicant FIRST (checkbox for Sam Smith / Amy Smith) before clicking Add expense. The applicant selector shows a "tick box" per applicant.

Fields after selecting applicant:
```
value → weekly/monthly amount
monthly → auto-calculated from value + frequency
percent → ownership % (100% if single applicant)
comment → optional note
```

**Frequency buttons:** `Monthly`, `Fortnightly`, `Weekly`  
**Button:** `Add expense` → select applicant → click Add → choose frequency → fill fields

## Insurance

**Dropdown types:** Home and contents, Private health, Motor warranty, Vehicle, TPD provider, Other, **Income protection**, GAP, Life provider, Trauma, Loan protection

### Income Protection fields
```
name → provider (e.g. "Youi")
policyNumber → policy number
value → sum insured (e.g. 250000)
premium → monthly premium (e.g. 90)
```

**Button:** `Add insurance` → type dropdown → fields appear

## General Patterns

1. **Currency fields** display as "$ 0" by default. Set raw number value via native setter + dispatch events.
2. **Select dropdowns** use `input[placeholder="Select one"]`. To set, use the native setter to set value, then dispatch change event.
3. **Percentage fields** auto-calculate (33% per applicant when 3 applicants).
4. **Save button** is `Save and calculate` on most sections, just `Save` on Insurance.
5. **AppleScript JS vs Playwright**: Playwright `locator.fill()` works for ALL field types. The native setter pattern is only needed for AppleScript JS injection fallback.
