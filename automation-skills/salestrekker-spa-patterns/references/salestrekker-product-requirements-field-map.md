# Product Requirements — Field Map & Helpers

## Page URL
```
/deals/home-loan/{deal_id}/{contact_id}/product-requirements
```

## Radio Group Helper Function

```python
def click_radio_by_legend(page, legend_text, value):
    """Click a radio button by its fieldset legend text.
    
    Uses dual approach: r.click() + legacy MouseEvents for stubborn React groups.
    
    Args:
        page: Patchright/CDP page object
        legend_text: The fieldset legend text (e.g. 'Fixed rate', 'Variable rate')
        value: The radio input value (e.g. 'important', 'do_not_want', 'most_important')
    """
    return page.evaluate('''(args)=>{
        const[t,v]=args;
        const all=document.querySelectorAll('fieldset');
        for(const f of all){
            const l=f.querySelector('legend');
            if(l&&l.textContent.trim()===t){
                const rs=f.querySelectorAll('input[type="radio"]');
                for(const r of rs){
                    if(r.value===v){
                        r.click();
                        const evt=document.createEvent('MouseEvents');
                        evt.initEvent('click',true,true);
                        r.dispatchEvent(evt);
                        return 'ok '+t;
                    }
                }
            }
        }
        return 'nf '+t;
    }''', [legend_text, value])
```

## Radio Group Legend → Value Table

### Rate Type
| Legend | Selected Value |
|---|---|
| Fixed rate | `do_not_want` |
| Variable rate | `important` |
| Fixed and variable rate | `do_not_want` |

### Repayment Type
| Legend | Selected Value |
|---|---|
| Principal and interest | `important` |
| Interest only | `do_not_want` |
| Interest in advance | `do_not_want` |
| Line of credit | `do_not_want` |
| Indicate preferred repayment frequency | `monthly` |

### Product Type
| Legend | Selected Value |
|---|---|
| Offset account | `important` |
| Redraw | `important` |

### What Is Important For You
| Legend | Selected Value |
|---|---|
| Lowest overall loan cost | `most_important` |
| Loan approved quickly | `somewhat_important` |
| Specific loan features | `least_important` |
| Lender policy/borrowing capacity | `somewhat_important` ⚠️ |

### Banking habits
| Legend | Selected Value |
|---|---|
| How often do you go to a branch? | `rarely` |
| How often do you use internet banking? | `all_the_time` |

## Textarea Fields (use HTMLTextAreaElement.prototype.value setter)

| Name attribute | Content |
|---|---|
| `productRequirements.otherRequirements` | "No other requirements or objectives not already stated." |
| `productRequirements.whatIsImportantForYou.lowestOverallLoanCostComments` | "Keeping monthly repayments affordable and minimising total interest paid over the life of the loan." |

```python
def fill_textarea_by_name(page, name_contains, text):
    return page.evaluate('''(args)=>{
        const[txt,nameContains]=args;
        const all=document.querySelectorAll('textarea');
        for(const ta of all){
            const n=ta.getAttribute('name')||'';
            if(n.includes(nameContains)){
                const s=Object.getOwnPropertyDescriptor(
                    window.HTMLTextAreaElement.prototype,'value'
                ).set;
                s.call(ta,txt);
                ta.dispatchEvent(new Event('input',{bubbles:true}));
                ta.dispatchEvent(new Event('change',{bubbles:true}));
                return true;
            }
        }
        return false;
    }''', [text, name_contains])
```

## Text Input Fields (use HTMLInputElement.prototype.value setter)

| ID | Content |
|---|---|
| `productRequirements.termOfCreditSought.preferredLenders` | "ANZ, CBA, NAB" |
| `productRequirements.termOfCreditSought.notLenders` | "None" |

```python
def fill_input_by_id(page, element_id, text):
    return page.evaluate('''(args)=>{
        const[txt,id]=args;
        const el=document.getElementById(id);
        if(!el)return false;
        const s=Object.getOwnPropertyDescriptor(
            window.HTMLInputElement.prototype,'value'
        ).set;
        s.call(el,txt);
        el.dispatchEvent(new Event('input',{bubbles:true}));
        el.dispatchEvent(new Event('change',{bubbles:true}));
        return true;
    }''', [text, element_id])
```

## Years/Months Combobox (role="combobox", no native select)

```python
def set_years_and_save(page):
    # Years = 30
    page.locator('#productRequirements\\.termOfCreditSought\\.years').click()
    time.sleep(0.5)
    page.keyboard.press('Home')  # jumps to 40 years (top)
    time.sleep(0.2)
    for _ in range(10):  # down 10 = 30 years
        page.keyboard.press('ArrowDown')
        time.sleep(0.03)
    page.keyboard.press('Enter')
    time.sleep(0.5)
```

Note: Month options are 1-11 only. No "0 months" option — implied by not selecting.

## ⚠️ Critical: `lenderPolicy` Server-Side Rejection

**`most_important` for "Lender policy/borrowing capacity" is silently discarded by the Salestrekker API.**

Despite HTTP 200 with `status:true, errors:null`, the value does NOT persist on reload.
This affects ONLY `lenderPolicy` among the 4 "What is important for you" radio groups.

The other 3 fields (lowestOverallLoanCost, loanApprovedQuickly, specificLoanFeatures)
persist any value correctly.

**Rule**: Use `somewhat_important` as the maximum accepted value for `lenderPolicy`.
The `danger` CSS class on this fieldset wrapper indicates a server-side business rule —
not a client automation limitation. No client-side approach (CDP, CUA, foreground, DOM
manipulation, direct API) bypasses this restriction.

---

## Full Fill Sequence (Python)

```python
def fill_product_requirements(page):
    # 1. Rate Type
    click_radio_by_legend(page, "Fixed rate", "do_not_want")
    click_radio_by_legend(page, "Variable rate", "important")
    click_radio_by_legend(page, "Fixed and variable rate", "do_not_want")
    
    # 2. Repayment Type
    click_radio_by_legend(page, "Principal and interest", "important")
    click_radio_by_legend(page, "Interest only", "do_not_want")
    click_radio_by_legend(page, "Interest in advance", "do_not_want")
    click_radio_by_legend(page, "Line of credit", "do_not_want")
    click_radio_by_legend(page, "Indicate preferred repayment frequency", "monthly")
    
    # 3. Product Type
    click_radio_by_legend(page, "Offset account", "important")
    click_radio_by_legend(page, "Redraw", "important")
    
    # 4. Other requirements textarea
    fill_textarea_by_name(page, "otherRequirements", 
        "No other requirements or objectives not already stated.")
    
    # 5. What Is Important For You
    click_radio_by_legend(page, "Lowest overall loan cost", "most_important")
    click_radio_by_legend(page, "Loan approved quickly", "somewhat_important")
    click_radio_by_legend(page, "Specific loan features", "least_important")
    click_radio_by_legend(page, "Lender policy/borrowing capacity", "somewhat_important")  # ⚠️ most_important is server-rejected
    
    # 6. Comment textarea
    fill_textarea_by_name(page, "lowestOverallLoanCostComments",
        "Keeping monthly repayments affordable and minimising total interest paid over the life of the loan.")
    
    # 7. Banking habits
    click_radio_by_legend(page, "How often do you go to a branch?", "rarely")
    click_radio_by_legend(page, "How often do you use internet banking?", "all_the_time")
    
    # 8. Term of credit
    set_years_and_save(page)
    fill_input_by_id(page, "productRequirements.termOfCreditSought.preferredLenders", "ANZ, CBA, NAB")
    fill_input_by_id(page, "productRequirements.termOfCreditSought.notLenders", "None")
    
    # 9. Save
    page.evaluate('''()=>{
        const b=document.querySelectorAll('button');
        for(let i=0;i<b.length;i++)
            if(b[i].offsetParent&&b[i].textContent.trim()==='Save')
                {b[i].click();return}
    }''')
    time.sleep(3)
```
