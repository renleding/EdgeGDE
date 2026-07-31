# Product Requirements — Field Map (Salestrekker 2.0)

Page URL: `/deals/home-loan/{dealId}/{contactId}/product-requirements`

## Radio Buttons by Section

### RATE TYPE
| Legend | Values | Selected |
|--------|--------|----------|
| Fixed rate | `important`, `not_important`, `do_not_want` | `do_not_want` |
| Variable rate | `important`, `not_important`, `do_not_want` | `important` |
| Fixed and variable rate | `important`, `not_important`, `do_not_want` | `do_not_want` |

### REPAYMENT TYPE
| Legend | Values | Selected |
|--------|--------|----------|
| Principal and interest | `important`, `not_important`, `do_not_want` | `important` |
| Indicate preferred repayment frequency | `daily`, `weekly`, `fortnightly`, `monthly`, `quarterly`, `semiannually`, `annually` | `monthly` |
| Interest only | `important`, `not_important`, `do_not_want` | `do_not_want` |
| Interest in advance | `important`, `not_important`, `do_not_want` | `do_not_want` |

### PRODUCT TYPE
| Legend | Values | Selected |
|--------|--------|----------|
| Line of credit | `important`, `not_important`, `do_not_want` | `do_not_want` |
| Offset account | `important`, `not_important`, `do_not_want` | `important` |
| Redraw | `important`, `not_important`, `do_not_want` | `important` |

### WHAT IS IMPORTANT FOR YOU
| Legend | Values | Selected | Notes |
|--------|--------|----------|-------|
| Lowest overall loan cost | `most_important`, `somewhat_important`, `least_important` | `most_important` | Has "why" textarea |
| Loan approved quickly | `most_important`, `somewhat_important`, `least_important` | `somewhat_important` | |
| Specific loan features | `most_important`, `somewhat_important`, `least_important` | `least_important` | |
| Lender policy/borrowing capacity | `most_important`, `somewhat_important`, `least_important` | `somewhat_important` | **`most_important` REJECTED by server** — use `somewhat_important` instead |

### BRANCH / INTERNET
| Legend | Values | Selected |
|--------|--------|----------|
| How often do you go to a branch? | `all_the_time`, `sometimes`, `rarely` | `rarely` |
| How often do you use internet banking? | `all_the_time`, `sometimes`, `rarely` | `all_the_time` |

## Textareas
| Name | Label |
|------|-------|
| `productRequirements.otherRequirements` | "Do the applicant(s) have any other requirements..." |
| `productRequirements.whatIsImportantForYou.lowestOverallLoanCostComments` | "Please comment why is this important to you" |

## Text Inputs
| Name | Label | Value |
|------|-------|-------|
| `productRequirements.termOfCreditSought.preferredLenders` | Preferred lenders | "ANZ, CBA, NAB" |
| `productRequirements.termOfCreditSought.notLenders` | Any lenders you do not wish to deal with? | "None" |

## Combobox
| Field | Label | Interaction Pattern |
|-------|-------|---------------------|
| Years | AXComboBox "Select one" → "30 years" | Click to open dropdown → ArrowDown 10× → Enter |
| Months | AXComboBox "Select one" | No "0" option. Click "Clear" button to reset. Options: 1-11 months |

## Server-Side Validation (critical finding)

`lenderPolicy` with value `most_important` is **silently rejected by the server**. The API returns:
```json
{"status": true, "errors": null, "data": {"tools": null}}
```
But `tools: null` means the data was not persisted. Navigate away and back to verify.

`somewhat_important` and `least_important` persist correctly for `lenderPolicy`.

This may affect other fields with `danger` CSS class on the wrapper (vs `secondary`).

## Checkbox Sections (Why questions)

Each "Why?" section after a radio group uses checkboxes. Triggered by `r.click()` + `createEvent('MouseEvents')`.

### Why principal and interest is important?
- "Minimise interest paid over life of loan"
- "Higher lending limit"
- "Lower deposit required"
- "Build up equity from the start"
- "Other"

### Why offset account is important?
- "Allows paying off the loan sooner"
- "Allows access to funds"
- "For tax purposes"
- "Other"

### Why redraw is important?
- "Flexibility to access prepaid funds if needed"
- "Other"

### Variable rate why checkboxes
- "To take advantage of potential future decreases in the interest rate"
- "Flexibility with respect to repayment redraw and or early repayment of loan"
- "Other"
