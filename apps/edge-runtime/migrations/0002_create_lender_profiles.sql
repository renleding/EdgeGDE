-- 0002: Create lender_profiles table
-- Maps the 49-column Lenderniche criteria template into a structured D1 table.
-- Each row = one lender's full underwriting profile.
--
-- ⚠️ SEQUENCE NOTE (reconciled 2026-08-09): this file shares the 0002 prefix
-- with 0002_add_lead_scoring.sql. Both are APPLIED and recorded in the remote
-- d1_migrations table (lead_scoring first — lexical sort). DO NOT renumber:
-- wrangler matches migrations by full filename; a rename would be treated as
-- a new migration and re-run this CREATE TABLE (table already exists →
-- deploy failure). The duplicate prefix is intentional/harmless.

CREATE TABLE IF NOT EXISTS lender_profiles (
  id            TEXT PRIMARY KEY,
  lender_name   TEXT NOT NULL UNIQUE,

  -- Identity & positioning
  best_for             TEXT,        -- Brief: "Bridging & downsize"
  dont_use_for         TEXT,        -- Unsuitable scenarios

  -- Documentation & income
  living_statements    TEXT,        -- e.g. "3 months"
  short_emp_probation  TEXT,        -- Short employment / probation
  self_emp             TEXT,        -- Self-employed policy
  lo_alt_doc           TEXT,        -- Low doc / alt doc
  alt_doc_high_lmi     TEXT,        -- Alt doc high LMI up to 90%
  irregular_income     TEXT,        -- Irregular income
  overtime             TEXT,        -- Overtime
  bonuses              TEXT,        -- Bonuses
  allowances           TEXT,        -- Allowances
  maternity_leave      TEXT,        -- Mat leave
  foreign_income       TEXT,        -- Foreign income

  -- Serviceability
  floor_buffer         TEXT,        -- Assessment rate floor/buffer
  dti                  TEXT,        -- Debt-to-Income ratio limit
  rent_percent         TEXT,        -- Rental income %
  actual_payment_reducer TEXT,      -- Actual payment as common debt reducer

  -- Lending parameters
  credit_score         TEXT,        -- Minimum credit score
  lvr                  TEXT,        -- Max LVR (e.g. "95+LMI")
  lmi_insurer          TEXT,        -- LMI insurer
  lmi_waiver           TEXT,        -- LMI waiver policy
  lmi_95_include       TEXT,        -- LMI 95% inclusion
  lmi_98_capitalise    TEXT,        -- LMI 98% capitalisation
  cash_out_max_pct     TEXT,        -- Max cash-out %
  non_genuine_savings  TEXT,        -- Non-genuine savings
  interest_rate_type   TEXT,        -- Fixed / variable

  -- Property types
  construction         TEXT,        -- Construction lending
  smsf                 TEXT,        -- SMSF lending
  commercial           TEXT,        -- Commercial lending
  commercial_debt      TEXT,        -- Commercial debt
  commercial_add_backs TEXT,        -- Commercial add backs
  under_40sqm          TEXT,        -- <40sqm property
  over_2m_purchase     TEXT,        -- >$2M purchase
  agri_rural           TEXT,        -- Agricultural / rural
  vacant_land_only     TEXT,        -- Vacant land only
  free_upfront_val     TEXT,        -- Free upfront valuation

  -- Borrower types
  fhlds                TEXT,        -- First Home Loan Deposit Scheme
  non_resident         TEXT,        -- Non-resident
  visa_type            TEXT,        -- Acceptable visa types
  family_guarantee     TEXT,        -- Family guarantee
  family_tax_govt      TEXT,        -- Family tax / government benefits
  favourable_purchase_family TEXT,  -- Favourable purchase from family
  age_55_plus          TEXT,        -- 55+ policy
  age_end_loan_term    TEXT,        -- Max age at loan end

  -- Other
  bridging             TEXT,        -- Bridging finance
  one_yr_financials    TEXT,        -- 1-year financials
  arrears_defaults     TEXT,        -- Arrears / defaults
  pricing              TEXT,        -- Pricing notes
  digital_sign         TEXT,        -- Digital signature
  notes                TEXT,        -- General notes

  -- Metadata
  source_doc_id        TEXT REFERENCES lender_docs(id),
  created_at           TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  updated_at           TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);

-- Index for fast lender lookup
CREATE INDEX IF NOT EXISTS idx_lender_profiles_name ON lender_profiles(lender_name);

-- Record migration
INSERT INTO d1_migrations (name) VALUES ('0002_create_lender_profiles.sql');
