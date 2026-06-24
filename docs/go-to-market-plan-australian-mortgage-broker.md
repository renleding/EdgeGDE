# Australian Residential Mortgage Market — Go-to-Market Plan for a Solo Broker

**Prepared for:** Warren (individual broker, EdgeGDE-aligned)  
**Date:** June 2026  
**Methodology:** Desk research (RBA, ABS, APRA, industry sources) + EdgeGDE deterministic-process framework

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Underserved Borrower Segments with Market Sizing](#2-underserved-borrower-segments-with-market-sizing)
3. [Lead Generation Channels Ranked by ROI](#3-lead-generation-channels-ranked-by-roi)
4. [Tech Stack Recommendation](#4-tech-stack-recommendation)
5. [90-Day Launch Plan](#5-90-day-launch-plan)
6. [Risk Register](#6-risk-register)
7. [EdgeGDE Implementation Notes](#7-edgegde-implementation-notes)
8. [Appendix: Key Data Sources](#8-appendix-key-data-sources)

---

## 1. Executive Summary

The Australian residential mortgage market stands at approximately **$2.4 trillion in housing credit outstanding** (RBA, 2025). Brokers now originate **~70% of all new residential home loans**, up from ~55% a decade ago. The market is in a transition phase: the RBA cash rate is 3.60% (November 2025), headline inflation is 3.2%, and underlying inflation is 3.0%. Household cash-flow pressures are gradually easing as inflation moderates and rate-cutting expectations build.

For a solo broker applying EdgeGDE principles—deterministic processes, minimal viable operations, post-hoc verification, and compensating actions for fallout—the opportunity lies in **deep specialisation on one or two underserved segments** rather than competing for vanilla borrowers against 17,000+ other brokers and digital lenders.

**This plan targets six underserved segments and delivers a practical 90-day launch sequence with a $5,000–$8,000 upfront tech/regulatory budget and a target of 8–12 settled loans within the first six months.**

---

## 2. Underserved Borrower Segments with Market Sizing

### 2.1 Self-Employed / Gig Economy Borrowers (Tier 1 — Primary Focus)

| Metric | Value |
|---|---|
| **Estimated addressable market** | ~2.5 million self-employed Australians (ABS LFS); ~25% of all mortgage applicants are self-employed |
| **Annual loan volume in this segment** | ~$60–80 billion across the broker channel |
| **Incumbency advantage of specialist** | Low-touch brokers reject ~40% of self-employed applicants due to "difficult income verification" |
| **Typical loan size** | $350k–$750k |
| **Commission per deal (avg)** | ~$5,000–$9,000 upfront (0.65–0.70% upfront plus trail) |

**Why underserved:** Major banks apply rigid two-year business tax return requirements and serviceability buffers that exclude profitable but newly GST-registered or ABN-based borrowers. Non-bank lenders (Liberty, Pepper, Bluestone, La Trobe) accept **one-year BAS statements**, **CPA letters**, and **low-doc or alt-doc** verification. Most brokers batch-process these as "difficult" and refer them to a single lender rather than shopping across the non-bank panel.

**EdgeGDE application:** Build a deterministic pre-qualification engine for self-employed borrowers—document checklist → automated lender match → broker review → formal application.

### 2.2 First Home Buyers with Small Deposits (5–10%) (Tier 2)

| Metric | Value |
|---|---|
| **Addressable market** | ~110,000 FHBs per year (ABS Housing Finance); ~35% of FHBs use less than 10% deposit |
| **FHOG + scheme-assisted volume** | ~$15–20 billion per year via FHB schemes (First Home Guarantee, Family Home Guarantee, state-based grants) |
| **Typical loan size** | $400k–$600k |
| **Conversion challenge** | LMI (Lenders Mortgage Insurance) + genuine savings assessment is opaque; many FHBs bounce between 3–5 lenders before settling |

**Why underserved:** Major bank digital applications (e.g., CommBank app, ANZ digital) routinely reject marginal FHBs with high DTI ratios and no existing banking relationship. These borrowers fall into a "no man's land" between the Big Four digital origination and the non-bank specialist space. A broker who can navigate the guaranteed-scheme landscape (up to 17 different state-based and federal schemes) captures FHBs that digital platforms cannot.

**EdgeGDE application:** Standardised FHB checklist → assess eligibility across all guarantee schemes simultaneously → "dry-run" pre-qualification before formal application.

### 2.3 Non-Bank Lending / Specialist Credit (Tier 3)

| Metric | Value |
|---|---|
| **Market share of non-bank lenders** | ~8.5% of total housing credit (APRA/ABS, growing at ~15% p.a.) |
| **Typical borrower profile** | Recent defaults (2+ years ago), discharged bankruptcy, high DTI, contractor income, PR visa holders |
| **Commission premium** | 0.15–0.25% higher upfront than prime bank loans |

**Why underserved:** Banks have a zero-tolerance policy on credit events within 2–5 years. Non-bank lenders (Pepper, Resimac, FirstMac, Liberty) have bespoke credit policies but limited distribution. Most brokers only approach these lenders as a "last resort" rather than proactively.

### 2.4 SMSF Property Investors

| Metric | Value |
|---|---|
| **SMSF housing loans outstanding** | ~$6–8 billion (ATO data) |
| **Segment growth** | ~8–10% p.a., driven by rising property values and super balance growth |
| **Typical loan size** | $300k–$500k (recourse to super balance, typically 20–30% deposit) |

**Why underserved:** Requires specialist knowledge of SIS Act compliance, limited-recourse borrowing arrangements (LRBAs), and off-plan restrictions. Fewer than 500 brokers nationally are competent in SMSF lending.

### 2.5 Expat / Non-Resident Borrowers

| Metric | Value |
|---|---|
| **Addressable volume** | ~$10–15 billion (estimated cross-border mortgage inquiries) |
| **Fee structure** | Upfront fees of $2,000–$5,000 + higher rates (6.5–8.5% typical) |
| **Lender panel** | ~8 specialist lenders (Athena, St.George expat desk, Bankwest, specialist non-banks) |

**Why underserved:** Major banks have tightened expat lending. Non-bank specialists accept foreign-currency income, PAYG from overseas employers, and rental income.

### 2.6 Construction and Bespoke Property Finance

| Metric | Value |
|---|---|
| **Construction loans as % of new lending** | ~12–15% |
| **Dropout rate at major banks** | ~30% of construction loan applications are rejected or delayed due to cost-blowout concerns |
| **Broker expertise premium** | Construction lending requires drawdown scheduling, progress payment management, and cost-verification skills |

**Why underserved:** Most bank processes treat construction loans as "standard variable" with limited visibility. A broker who can manage the six-step drawdown process (slab → frame → lock-up → fixing → fit-out → completion) for clients adds real economic value.

### 2.7 Segment Priority Matrix for a Solo Broker

```
                HIGH MARGIN ──────────────► LOW MARGIN
                ┌──────────────────────────────────────┐
     HIGH       │  Self-Employed (A)    │  FHBs (B)    │
     VOLUME     │  Expat (E)            │              │
                ├──────────────────────────────────────┤
     LOW        │  Non-Bank Special (C) │ Construction │
     VOLUME     │  SMSF (D)             │  (F)         │
                └──────────────────────────────────────┘
```

**Recommendation:** Enter through **Segment A (Self-Employed)** as primary niche. Layer **Segment B (FHB with small deposit)** as secondary volume driver in months 4–6. Add **Segment C (Non-Bank Specialist)** in month 7+ after establishing cash flow.

---

## 3. Lead Generation Channels Ranked by ROI

Cost and time-to-first-client estimates are for a solo operator with a $5–8k launch budget.

### 3.1 Channel Rankings

| Rank | Channel | Est. Monthly Cost | Est. Time to First Lead | Est. Conversion | ROI Rating | Notes |
|:----:|---------|:-----------------:|:----------------------:|:---------------:|:----------:|-------|
| **1** | Warm referral network (existing professional contacts) | $0 | 1–4 weeks | 30–50% | ★★★★★ | Highest conversion; requires explicit ask + process |
| **2** | Accountant / bookkeeper referral partnerships | $50 (coffee/lunch) | 2–6 weeks | 40–60% | ★★★★★ | Accountants are the #1 source of broker leads nationally |
| **3** | Real estate agent referral partnerships | $100–200 (attending opens, coffee) | 3–8 weeks | 30–50% | ★★★★☆ | Highly competitive; build a USP (e.g., "I fix deal-fails at the finance stage") |
| **4** | Google Local Services Ads | $500–$1,000/mo | 2–4 weeks | 10–15% | ★★★★☆ | Pay per lead; cap budget tightly; target niche keywords ("self-employed home loan broker [city]") |
| **5** | LinkedIn content + networking | $0–100 (premium) | 4–12 weeks | 5–10% | ★★★☆☆ | Publish 2×/week on self-employed lending; long-tail compounding ROI |
| **6** | Facebook / Instagram targeted ads | $300–$800/mo | 2–6 weeks | 3–8% | ★★★☆☆ | Target by occupation (tradies, contractors) + suburb; use case studies and loan calculators |
| **7** | SEO / content blog | $0–500 (tools) | 12–24 weeks | 2–5% | ★★☆☆☆ | Required for long-term organic pipeline; publish pillar pages on self-employed lending |
| **8** | Google Search Ads (branded) | $500–$2,000/mo | 1–2 weeks | 5–10% | ★★☆☆☆ | Expensive in competitive metro areas; better for brand building after month 6 |
| **9** | Community sponsorship (local sports, events) | $200–$500/mo | 8–16 weeks | 3–8% | ★★☆☆☆ | Good for brand awareness, weak for direct lead generation |
| **10** | Outbound cold calling/SDR | $0 (time only) | 4–12 weeks | 1–3% | ★☆☆☆☆ | Poor ROI for solo broker; avoid |
| **11** | Third-party lead generation (Lendi, OIEO, etc.) | Variable (per lead) | Immediate | 2–5% | ★☆☆☆☆ | Low conversion, low-quality leads; OK as last-resort fill |

### 3.2 Recommended Channel Mix (Months 1–3)

| Channel | Monthly Budget | Focus |
|---------|:-------------:|-------|
| Accountant partnerships | $200 | 6–10 accountant visits per month; provide them a "referral pack" with your self-employed lending expertise |
| Google Local Services Ads | $600 | $20/day, capped; targeted at "self-employed home loan + [city]" keywords |
| Warm referrals (organic) | $0 | Personal outreach to 30+ contacts with a clear "I'm now a mortgage broker, here's who I help" message |
| LinkedIn | $0 | 2 posts/week: self-employed lending case studies, scheme updates, FHB guarantee explainers |

**Total monthly lead-gen budget (months 1–3): ~$800.**

### 3.3 Key Metrics to Track

| Metric | Target (Month 3) | Target (Month 6) |
|--------|:----------------:|:----------------:|
| Inbound leads per month | 8–12 | 15–20 |
| Pre-qualifications completed | 6–8 | 10–15 |
| Formal applications submitted | 3–5 | 6–8 |
| Settlements | 1–2 | 3–5 |
| Cost per lead | $40–$70 | $25–$40 |
| Cost per settlement | $300–$600 | $200–$400 |
| Average loan size | $450k | $550k |

---

## 4. Tech Stack Recommendation

The principle: **use existing tools, don't build.** Your stack should be operational within 2–3 days.

### 4.1 Core Stack

| Function | Recommended Tool | Monthly Cost | Why |
|----------|-----------------|:------------:|-----|
| **Aggregator/AFSL** | Connective / AFG / Choice Aggregation | $200–$400 (BAU fee) | Mandatory; provides lender panel, paraplanning support, compliance. Connective has strong self-employed lending panel. |
| **CRM** | Nod / Sherlock (or Salesforce Essentials) | $79–$150 | Nod is mortgage-specific; tracks lead source, commission, lender pipeline. Avoid generic CRMs. |
| **LOS (Loan Origination System)** | ApplyOnline / Quickli | $50–$100 (per user) | Included via most aggregators. ApplyOnline is the market standard. |
| **Comparison & Fact Find** | RateAll / InfoChoice | $0–$50 | RateAll for live rate comparisons; InfoChoice for lender policy data |
| **Document Management** | Huddle / BGL DocLink | $30–$60 | Aggregator-provided; standard compliance repository |
| **Valuation & Property Data** | CoreLogic RP Data / ValEx | $0 (via aggregator) or $150 standalone | Property valuation, suburb data, sales history |
| **SMS / Email Marketing** | Mailchimp or HubSpot Free | $0–$30 | Drip campaigns for referral partners and past clients |
| **Website (brochure + blog)** | WordPress or Squarespace + Contact Form 7 | $15–$30 | Simple 5-page site: About, Self-Employed Loans, FHB Guide, Contact, Blog |
| **E-signature** | Docusign / Adobe Sign | $30–$50 | Accelerate document exchange with clients |
| **Financial modelling** | Calculator Cloud or Custom Google Sheets | $0–$20 | Pre-qual calculators, loan comparison sheets |

### 4.2 Optional / Growth Stack (Month 4+)

| Function | Tool | Cost |
|----------|------|:----:|
| AI client intake (voice-to-data) | Fireflies / Otter.ai | $20/mo |
| Automated appraisal engine | ApplyOnline auto-quote | Included |
| Lead scoring | Nod lead scoring add-on | $20/mo |
| Video meeting scheduler | Calendly | Free–$15 |
| Review/trust platform | Google Business + RateMyAgent | Free |

### 4.3 Total Tech Cost

| Phase | Monthly Cost | One-Time Setup |
|-------|:------------:|:--------------:|
| Month 1 | $450–$750 | $300–$500 (website, registrations, trademark) |
| Month 2–3 | $350–$550 | $0 |
| Month 4+ | $400–$650 | As needed |

### 4.4 EdgeGDE Process Automation

| Process Step | Tool/Template | Method |
|-------------|---------------|--------|
| Client intake → Fact Find | Nod + Calendly (15-min discovery) | Automated scheduling, pre-filled form |
| Document collection → Document checklist | Huddle + custom checklist | Deterministic checklist (self-employed: 12 docs, FHB: 10 docs) |
| Pre-qual → Lender match | Google Sheets + RateAll API | Automated rate/policy matching against client profile |
| Broker review → Formal application | ApplyOnline | Human review; compensating action step built in |
| Settlement → Trail/commission tracking | Nod pipeline | Automated commission forecasting |
| **Compensating action (deal fallout)** | Spreadsheet trigger | If app >30 days without update → broker for review |
| **Post-hoc verification** | Monthly review checklist | Every settled file reviewed within 7 days of settlement |

---

## 5. 90-Day Launch Plan

### Week -2 to Week 0: Foundation (pre-launch)

| Day | Task | Dependencies | Verification |
|-----|------|-------------|-------------|
| D-14 | Register ABN, ASIC broker registration (RG 146 / Certificate IV in Finance & Mortgage Broking) | Completed qualification | ASIC register check |
| D-12 | Choose aggregator (recommended: Connective for self-employed panel) | ABN, qualification | Written agreement signed |
| D-10 | Join MFAA or FBAA membership | Aggregator letter | Member number received |
| D-8 | Set up bank accounts (business offset, trust account if required) | ABN, ASIC reg | Account numbers created |
| D-6 | Purchase/configure tech stack (CRM + LOS + document management) | Aggregator set-up | Live login to ApplyOnline + Nod |
| D-4 | Build website (5 pages: Home, About, Self-Employed Loans, FHB Guide, Blog) | Domain + hosting | Site live, contact form works |
| D-3 | Create Google Business Profile + RateMyAgent profile | Business address (home office OK) | Profile verified, 5+ reviews from test clients |
| D-2 | Prepare referral partner one-pagers (accountant pack, agent pack, client pack) | Branding materials | Print + PDF ready |
| D-1 | Set up lead tracking spreadsheet / CRM pipeline stages | CRM configured | Pipeline: Lead → Fact Find → Pre-Qual → Formal → Unconditional → Settled → Trail |
| D0 | **Launch** — personal outreach to 30 warm contacts | All above | 30 personalised emails sent |

### Week 1–4: Pipeline Build

| Week | Focus | Actions | Deliverable |
|:----:|-------|---------|-------------|
| 1 | Personal network activation | Call 10 contacts/day; offer free 15-min "mortgage health check" | 20 intro calls booked |
| 2 | Accountant outreach | Visit 5 accountant offices with referral pack + 5-visit per month target; offer CPD session on self-employed lending | 3 referral agreements signed |
| 3 | Content + SEO foundation | Publish 2 blog posts ("Self-employed home loans: what you need to know" + "FHB guarantee schemes guide") + 1 LinkedIn post/day | 4 posts live; LinkedIn 5% engagement |
| 4 | Google Local Services Ads go live | $20/day budget; keyword: "mortgage broker self-employed [city]" + "[suburb] home loan broker" | 5–10 clicks/week; 2–3 form fills |

### Month 2: Process Maturation

| Week | Focus | Actions | Deliverable |
|:----:|-------|---------|-------------|
| 5–6 | First deals | Process first 3–5 pre-quals; submit 2–3 formal apps; document each case for post-hoc review | Pipeline: ≥3 pre-quals, ≥1 formal app |
| 7 | Referral partner nurturing | Revisit accountant partners; host one virtual lunch-and-learn on non-bank lending for self-employed | 2+ new referrals from accountants |
| 8 | Optimise ad spend | Review Google LSA: kill losing keywords, double down on top-5% converting | Cost per lead ≤$50 |

### Month 3: Systems + Growth

| Week | Focus | Actions | Deliverable |
|:----:|-------|---------|-------------|
| 9–10 | First settlements | Manage first 1–3 loans to settlement; complete post-hoc verification checklists | 1–3 settled loans; verify trail commission set-up |
| 11 | Compensating actions review | Audit any loans that took >30 days from app to settlement; determine root cause; adjust checklist/process | Process improvement notes filed |
| 12 | Review + Month 4 plan | Cumulative review: total pipeline, cost per lead, cost per settlement, referral source mix | Month 3 report → adjust channel mix for Month 4 |

### Month 4–6: Scaling

| Focus | Actions | Target |
|-------|---------|:------:|
| Add FHB segment | Layer FHB content, accountant partners now also refer FHBs | 2–3 additional FHB leads/month |
| Non-bank specialist | Add 3–5 non-bank lenders to panel; update website with alt-doc lending page | 1–2 non-bank deals/month |
| Client review cycle | Every settled client gets a 6-month "rate review" reminder; trail commission data feeds into automated review schedule | 50%+ client retention rate |

### Milestone Summary

| Milestone | Target | Verification |
|-----------|:------:|-------------|
| First pre-qualification | Day 10 | CRM log |
| First formal application | Day 18 | LOS submission |
| First unconditional approval | Day 30 | Lender letter |
| First settlement | Day 45 | Settlement statement + commission notification |
| 3 settlements | Day 60 | Aggregator commission report |
| 5 settlements | Day 90 | P&L statement |
| 10 settlements | Day 180 | Annualised run-rate >$5M settled |

---

## 6. Risk Register

### 6.1 Risk Matrix

| ID | Risk | Probability | Impact | Score | Mitigation | Compensating Action |
|:--:|------|:----------:|:------:|:----:|------------|---------------------|
| **R1** | **Deal fallout / failed settlement** (borrower loses job, valuation shortfall, lender declines) | High | High (loss of trail income, wasted time) | **Critical** | Pre-qualify against multiple lenders (dry-run before formal app); maintain 80% LVR buffer; verify income + employment at each stage | If deal falls >30 days in → commission clawback provision; maintain 3-month operating reserve |
| **R2** | **Regulatory non-compliance** (ASIC breach, best-interest duty failure, license condition breach) | Low | Critical (loss of license, fines) | **High** | Aggregator compliance support; weekly compliance checklist; document everything; ROA oversight | Monthly compliance self-audit; aggregator compliance officer review quarterly |
| **R3** | **Referral partner churn** (accountants sign with incumbent broker, REA switches to competitor) | Medium | Medium–High (loss of 40–60% of lead source) | **High** | Never rely on one partner >30% of leads; build direct-to-consumer channel (ads, SEO, content); offer accountant partners value beyond commissions (CPD, referrals to their practice) | Monthly partner check-in; diversify to 6+ active partners within 6 months |
| **R4** | **Cash flow drought** (3+ months without settlement; commission lag of 60–90 days post-settlement) | Medium | High (personal financial stress, business failure) | **High** | Maintain personal runway of 6+ months; set up business overdraft; negotiate trail-commission advance from aggregator (if available); track pipeline value weekly | Set minimum settlement target: 1 deal every 45 days |
| **R5** | **Broker burnout / time bankruptcy** (solo operator doing everything: sales, admin, compliance, marketing) | Medium | Medium | **Medium** | Automate intake, document collection, reminders; strict 8-hour workday; outsource bookkeeping ($200/mo) in month 4; batch tasks (all calls Tue/Thu, all apps Wed) | Monthly self-assessment against capacity model; if >60 hrs/week for 2 weeks → trigger outsourcing |
| **R6** | **Economic downturn / interest rate shock** (prolonged high rates, falling property values, reduced borrowing capacity) | Medium | Medium (reduced deal volume, higher fallout) | **Medium** | Specialise in non-bank/alt-doc lending (counter-cyclical demand); target borrowers exiting fixed rates; refinance opportunities increase when rates are volatile | If unemployment rises >1% in 3 months → shift marketing to refinance/release equity |
| **R7** | **Lender policy change** (major lender exits self-employed space; changes servicing calculator reducing capacity) | Medium | Medium | **Medium** | Maintain 10+ lender panel; never >40% of apps go to one lender; regular policy alerts via aggregator; rate-lock when possible | Monthly lender panel review; if lender drops >2% market share → replace with alternative within 1 week |
| **R8** | **Commission clawback** (borrower refinances within 12 months; lender demands clawback of upfront commission) | Medium | Medium (loss of $3k–$9k per clawback) | **Medium** | Avoid clients with high refi risk (interest-only expiry, low equity); disclose clawback terms to clients; maintain 2% trail reserve fund; check buyer's intentions at settlement | Track clawback rate monthly; if >10% → adjust borrower qualification criteria |
| **R9** | **Competition / price pressure** (digital brokers offer lower rates/fees, commoditisation of vanilla loans) | Medium | Medium | **Medium** | Don't compete on rate; compete on expertise (self-employed, non-bank, bespoke); build personal brand; offer value-add (mortgage health checks, property strategy) that digital cannot match | Quarterly industry scan; if >20% of prospects are price-shopping → shift marketing to higher-value niche |
| **R10** | **Technology failure / data loss** (CRM corruption, document loss, LOS outage) | Low | High | **Medium** | Daily CRM + document backups (cloud); maintain offline copies of deal files; aggregator LOS has redundancy built in | If >4 hours system outage → manual process with paper checklist; restore from backup within 24 hours |

### 6.2 Key Risk Thresholds

| Trigger | Action |
|---------|--------|
| Settlement rate <50% (apps submitted vs settled) for 60 days | Review pre-qualification criteria; tighten lender matching |
| Cost per lead >$80 for 30 days | Kill bottom-3 ad keywords; review targeting |
| Any single referral partner >50% of leads | Actively recruit 2+ new referral partners |
| Time-to-settlement >60 days for 3 consecutive deals | Review lodgement quality; assess lender service levels |
| Operating expenses >$4k/mo before reaching 4 settlements/month | Review cost base; delay non-essential spend |

---

## 7. EdgeGDE Implementation Notes

### 7.1 Deterministic Process: The Pre-Qual → Broker Review Pipeline

```
┌─────────────────┐    ┌──────────────────┐    ┌───────────────────┐
│  1. Client       │    │  2. Automated     │    │  3. Broker         │
│     Intake       │───►│     Pre-Qual      │───►│     Review         │
│  (Calendly +     │    │  (RateAll +       │    │  (15-min expert    │
│   Nod form)      │    │   Google Sheet)   │    │   assessment)      │
└─────────────────┘    └──────────────────┘    └────────┬──────────┘
                                                         │
                                    ┌────────────────────┘
                                    ▼
                        ┌───────────────────┐
                        │  4. Dry-Run       │
                        │     Multi-Lender  │
                        │     Check         │
                        │  (3-5 lenders)    │
                        └────────┬──────────┘
                                 │
                                 ▼
                        ┌───────────────────┐
                        │  5. Formal App    │
                        │     (ApplyOnline) │
                        └────────┬──────────┘
                                 │
                                 ▼
                        ┌───────────────────┐
                        │  6. Settlement    │
                        └────────┬──────────┘
                                 │
                                 ▼
                        ┌───────────────────┐
                        │  7. Post-hoc      │
                        │     Verification  │
                        │  (7-day review)   │
                        └───────────────────┘
```

### 7.2 Compensating Actions

| Scenario | Compensating Action |
|----------|---------------------|
| Pre-qual fails on 3+ lenders | Escalate to non-bank panel; if all fail → no-fee "credit fix" plan with clear timeline |
| Formal app >30 days with no update | Broker triggers manual chase with lender BDM; update client within 48 hours |
| Valuation shortfall >5% | Re-check against 3 comparable sales; if valid → renegotiate price or restructure LVR with LMI |
| Deal falls through post-unconditional | Commission clawback risk triggered → 3-month zero-interest reserve; shift focus to next pipeline deal |
| Client refinances within 6 months | Lesson-learned review: was the loan structured correctly? Did we miss early-refinance intent? |

### 7.3 Minimal Viable Process

**Phase 1 (Months 1–3): Use aggregator stock tools.** No custom development. CRM templates provided by Nod. Document management via aggregator's Huddle instance. Pre-qual via manual but standardised Google Sheet with conditional formatting.

**Phase 2 (Month 4+):** Automate pre-qual with Make/Zapier → RateAll API → instant email to client. Add SMS reminders for document collection.

### 7.4 Post-Hoc Verification Checklist (completed within 7 days of settlement)

- [ ] Client's stated income matches actual lender documents
- [ ] LVR within assessed range
- [ ] Product suitability documented (best-interest duty)
- [ ] Loan term matched client's stated objective
- [ ] All fee disclosures signed and dated
- [ ] Commission statement matches broker agreement
- [ ] Referral partner (if any) paid correctly
- [ ] File notes complete and timestamped
- [ ] Trail commission set-up confirmed in aggregator system

---

## 8. Appendix: Key Data Sources

| Source | Data Point | Link |
|--------|-----------|------|
| RBA Statement on Monetary Policy (Nov 2025) | Cash rate 3.60%, inflation 3.2%, GDP outlook | https://www.rba.gov.au/publications/smp/2025/nov/overview.html |
| RBA Financial Stability Review (Oct 2025) | Household resilience, banking system strength, mortgage arrears data | https://www.rba.gov.au/publications/fsr/2025/oct/ |
| RBA Chart Pack (Jun 2026) | Housing credit, interest rates, household balance sheets | https://www.rba.gov.au/chart-pack/ |
| ABS Housing Finance Commitments | FHB numbers, total lending, investor vs owner-occupier split | https://www.abs.gov.au/statistics/economy/finance/housing-finance-commitments |
| APRA Mortgage Market Statistics | ADI housing exposures, LVR distribution, serviceability buffers | https://www.apra.gov.au/statistics |
| MFAA Industry Reports | Broker market share (~70%), industry composition | https://www.mfaa.com.au/ |
| ASIC RG 209 & RG 270 | Credit licensing, responsible lending obligations | https://asic.gov.au/regulatory-resources/credit/ |

---

*This report is prepared for informational purposes as part of a go-to-market planning exercise. Market data is drawn from publicly available sources as of June 2026. The author makes no representation as to the accuracy of third-party data. All financial projections are indicative; actual results will vary based on market conditions, execution quality, and individual circumstances.*
