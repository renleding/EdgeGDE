# Salestrekker 2.0 Field Name Map

## Sam/Amy Smith Personal

| Name | Type | Description |
|------|------|-------------|
| `firstName` | input | First name |
| `lastName` | input | Last name |
| `middleName` | input | Middle name |
| `preferredName` | input | Preferred name |
| `previousName` | input | Previous name |
| `dob` (format: DD/MM/YYYY) | input | Date of birth |
| `Email_ps` (personal) or `email` | input | Personal email |
| `Phone_mobile` or `mobilePhone` | input | Mobile phone |
| `Type` | select or custom | Contact type |
| `Search address` | input | Address search |
| Country of residency | custom combobox | Country |
| Country of tax residence | custom combobox | Country |
| Citizenship | custom combobox | Country |
| Mother's maiden name | input | Mother's maiden name |

## Employment (Add Current Employment — Nested Menu → Modal Pattern)

Employment uses a 3-level nested menu approach (not inline expansion):

1. Click "Add current employment" → dropdown: Salaried/Self/Retired/Unemployed
2. Click "Salaried employee" → sub-dropdown: Add new company / Add existing company
3. Click "Add new company" → MODAL opens with fields:
   - `name` (Entity name — on the modal, not the inline form)
   - Type of business entity (combobox)
   - ABN (text)
   - Email (text)
4. Click "Add" in modal → modal closes → inline employment form renders

Inline employment form fields (after modal close):
| Field | Selector approach | Description |
|-------|------------------|-------------|
| Occupation | `input` by nth() (after modal fields removed) | Electrician |
| Employment priority | combobox | Primary |
| Employment basis | combobox | Permanent full-time |
| Start date | DD/MM/YYYY date input | 20/05/2015 |
| ABN | text input | Optional |
| Employer name | combobox (pre-filled from modal) | Wealth Wages |
| ANZSCO code | combobox | Search or enter |
| Employer type | combobox | Select one |
| Employer ACN | text input | Optional |

## Vehicle Asset

| Name | Type | Description |
|------|------|-------------|
| `name` | input | Vehicle make and model |
| `vehicleBuildDate` | input | Build date (MM/YYYY) |
| `value` | input (currency) | Vehicle value |
| `vehicleRegoNumber` | input | Registration |

## Home Contents

| Name | Type | Description |
|------|------|-------------|
| `name` | input | Description |
| `value` | input (currency) | Value |

## Bank Account

| Name | Type | Description |
|------|------|-------------|
| `bankName` | input | Bank name |
| `bankBSB` | input | BSB |
| `bankAccountNumber` | input | Account number |
| `value` | input (currency) | Balance |

## Credit Card (Liabilities)

| Name | Type | Description |
|------|------|-------------|
| `name` | input | Card name/type |
| `limit` | input (currency) | Credit limit |
| `balance` | input (currency) | Current balance |
| `repayment` | input (currency) | Minimum repayment |

## Vehicle Loan (Liabilities)

(Same field names as Credit Card — differentiate by nth occurrence)

| Name | Type | Description |
|------|------|-------------|
| `name` | input | Loan description |
| `limit` | input (currency) | Loan limit |
| `balance` | input (currency) | Outstanding balance |
| `repayment` | input (currency) | Monthly repayment |

## PAYG Income

| Name | Type | Description |
|------|------|-------------|
| `grossSalary` | input (currency) | Gross annual salary |
| `bonus` | input (currency) | Annual bonus |
| `overtimeEssential` | input (currency) | Essential overtime |
| `overtimeNonEssential` | input (currency) | Non-essential overtime |
| `commission` | input (currency) | Commission |
| `allowance` | input (currency) | Allowance |

## Expenses

| Name | Type | Description |
|------|------|-------------|
| `value` | input (currency) | Amount |
| `monthly` | input (currency) | Auto-calculated monthly |
| `percent` | input | Ownership % |
| `comment` | input | Free text |

## Needs and Objectives (textarea)

| Name | Type | Description |
|------|------|-------------|
| `reasonForSeekingCredit` | textarea | Reason |
| `immediateNeedsAndObjectives` | textarea | Immediate needs |
| `longerTerm` | textarea | Longer term goals |

## Product Requirements (textarea)

| Name | Type | Description |
|------|------|-------------|
| `otherRequirements` | textarea | Other requirements |
| `preferredLenders` | textarea | Preferred lenders |
| `notLenders` | textarea | Excluded lenders |

## Security Details

| Name | Type | Description |
|------|------|-------------|
| `name` | input | Property address |
| `value` | input (currency) | Property value |
| `propertyRunningCosts` | input (currency) | Running costs |
| `percent` | input (×3) | Ownership split |

## Funding Worksheet

| Name | Type | Description |
|------|------|-------------|
| `purposeFunds` | input (currency) | Purpose of funds |
| `stampDuty` | input (currency) | Stamp duty |
| `lenderFees` | input (currency) | Lender fees |
| `legalFees` | input (currency) | Legal fees |
| `proposedLoanAmount` | input (currency) | Loan amount |
| `savings` | input (currency) | Available savings |
| `baseLvr` | input (%) | Calculated LVR |
| `totalLvr` | input (%) | Total LVR |

## Insurance — Income Protection

| Name | Type | Description |
|------|------|-------------|
| `name` | input | Provider name |
| `policyNumber` | input | Policy number |
| `value` | input (currency) | Insured amount |
| `premium` | input (currency) | Monthly premium |

## Product Search (Cannot Be Automated)

Uses React combobox (`role="combobox"`) with inner `<input>`. React ignores programmatic events. Must be filled manually.

---

## Product Requirements — Radio Button Pattern (26 Jul 2026)

Uses `<input type="radio">` inside `<fieldset>` with `<legend>` for group labels.  
Radio values: `important`, `not_important`, `do_not_want`, `most_important`, `somewhat_important`, `least_important`, `rarely`, `all_the_time`.

```python
def click_radio(page, legend, value):
    return page.evaluate('''(a)=>{
        const[t,v]=a;const all=document.querySelectorAll('fieldset');
        for(const f of all){
            const l=f.querySelector('legend');
            if(l&&l.textContent.trim()===t){
                const rs=f.querySelectorAll('input[type="radio"]');
                for(const r of rs){
                    if(r.value===v){
                        r.click();
                        # CRITICAL: Some React radios need legacy MouseEvents
                        const evt=document.createEvent('MouseEvents');
                        evt.initEvent('click',true,true);
                        r.dispatchEvent(evt);
                        return true
                    }
                }
            }
        }
        return false
    }''', [legend, value])
```

**NOTE:** The legacy `document.createEvent('MouseEvents')` pattern is REQUIRED for the "Lender policy/borrowing capacity" radio group (and possibly others). Without it, `input.checked` stays `false` and the value won't persist on Save.

## Product Requirements Text Fields

| Name | Type | Value |
|------|------|-------|
| `productRequirements.termOfCreditSought.preferredLenders` | text input | "ANZ, CBA, NAB" |
| `productRequirements.termOfCreditSought.notLenders` | text input | "None" |
| `productRequirements.otherRequirements` | textarea | "No other requirements or objectives not already stated." |
| `productRequirements.whatIsImportantForYou.lowestOverallLoanCostComments` | textarea | comment on why lowest cost matters |

**Textarea fill uses HTMLTextAreaElement.prototype (NOT HTMLInputElement.prototype):**
```python
const s=Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype,'value').set;
s.call(el,'text');
```

Text → preferredLenders, excludedLenders/notLenders, otherRequirements (textarea), lowestOverallLoanCostComments (textarea)

Page: `/deals/home-loan/{D}/{C}/product-requirements`
