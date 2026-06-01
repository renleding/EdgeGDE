-- Phase 9: Identity Layer — Contacts & Brokers
-- Enables deduplicated lead-to-contact linking and broker attribution.

CREATE TABLE IF NOT EXISTS contacts (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  name TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_contacts_tenant_email
  ON contacts(tenant_id, email)
  WHERE email != '';

CREATE INDEX IF NOT EXISTS idx_contacts_tenant_phone
  ON contacts(tenant_id, phone)
  WHERE phone != '';

CREATE TABLE IF NOT EXISTS brokers (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'broker',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_brokers_tenant_email
  ON brokers(tenant_id, email);

-- Add contact_id and current_stage to form_submissions
ALTER TABLE form_submissions
  ADD COLUMN contact_id TEXT DEFAULT '';

ALTER TABLE form_submissions
  ADD COLUMN current_stage TEXT DEFAULT 'new_lead';

CREATE INDEX IF NOT EXISTS idx_form_submissions_contact
  ON form_submissions(tenant_id, contact_id);
