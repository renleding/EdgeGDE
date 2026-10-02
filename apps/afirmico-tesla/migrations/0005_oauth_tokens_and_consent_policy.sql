-- FRS-010 F01/F02: the tables the live OAuth flow needs to persist to.
--
-- Why this migration exists
-- -------------------------
-- The member OAuth flow shipped in PR #136 completed a Tesla handshake and then
-- stored everything in KV: the session, the refresh token, the vehicle list. KV
-- is a cache with TTL eviction and no query surface, so a member who connected
-- left no durable record. That means F01-R02/R03 (consent), F01-R05 (member
-- record) and F02-R05 (token lifecycle) were not satisfied by a flow that
-- appeared to work.
--
-- Two tables are missing from the F08 schema and are added here.

-- ---------------------------------------------------------------------------
-- Member-scope OAuth tokens (F02-R05 / F02-R06)
-- ---------------------------------------------------------------------------
-- One row per member: Tesla issues one refresh token per member authorisation,
-- and it rotates. The previous token stays valid for up to 24h after rotation,
-- which is what `previous_*` is for — losing a rotated refresh token means the
-- member has to reconnect, so the old one is kept until it provably stops
-- working (or the grace period lapses).
--
-- The tokens are stored ENCRYPTED (AES-GCM, key held as a Worker secret). A
-- refresh token is a bearer credential for a member's vehicle: if this database
-- is ever exported, dumped to a bug report, or read by an operator, the tokens
-- in it must not be usable. Encryption at rest is the difference between "leaked
-- a table" and "leaked every member's vehicle access".
CREATE TABLE tesla_oauth_token (
  member_id            TEXT PRIMARY KEY REFERENCES tesla_member (member_id) ON DELETE CASCADE,
  -- Ciphertext is base64; `iv` and `key_version` are needed to decrypt.
  refresh_token_enc    TEXT NOT NULL,
  refresh_token_iv     TEXT NOT NULL,
  key_version          INTEGER NOT NULL DEFAULT 1,
  previous_token_enc   TEXT,
  previous_token_iv    TEXT,
  previous_rotated_at  TEXT,
  access_token_expires_at TEXT,
  scope                TEXT NOT NULL,
  -- Tesla identity binding: the `sub` claim this grant was issued to. Guards
  -- against a token being replayed against a different member row.
  tesla_sub            TEXT,
  created_at           TEXT NOT NULL,
  updated_at           TEXT NOT NULL,
  last_refreshed_at    TEXT,
  last_error           TEXT,
  revoked_at           TEXT
);

CREATE INDEX idx_tesla_oauth_token_expiry ON tesla_oauth_token (access_token_expires_at);

-- ---------------------------------------------------------------------------
-- Consent policy versions (F01-R02 / F01-R03 / F01 AC5)
-- ---------------------------------------------------------------------------
-- Consent must be versioned and the member must be able to see the exact text
-- they agreed to, byte-identical to what was stored (AC5).
--
-- The text itself lives in `src/consent-policy.ts` — a committed, reviewable,
-- diffable file — and this table holds the version, the hash of that text, and
-- a copy for audit. `tesla_consent.policy_sha256` then makes AC5 mechanically
-- checkable: hash the text the portal renders, compare to the hash on the
-- consent row the member granted. Equal hashes is byte-identity.
--
-- Duplicating the text here is deliberate. A consent record whose text cannot be
-- produced after the fact is not evidence, and a git history lookup is not
-- available to an auditor or a court.
CREATE TABLE tesla_consent_policy (
  policy_version    TEXT PRIMARY KEY,
  policy_sha256     TEXT NOT NULL,
  policy_text       TEXT NOT NULL,
  effective_from    TEXT NOT NULL,
  superseded_at     TEXT,
  created_at        TEXT NOT NULL
);

CREATE INDEX idx_tesla_consent_policy_effective
  ON tesla_consent_policy (effective_from);

-- ---------------------------------------------------------------------------
-- Consent scope: extend to the column set the flow actually needs
-- ---------------------------------------------------------------------------
-- F01-R03 requires the consent record to carry the text version, timestamp, IP
-- and user agent; F01-R07 needs the field set and the recipients. The F08 table
-- had policy_version but nothing to make AC5 checkable and no field-set record.
ALTER TABLE tesla_consent ADD COLUMN policy_sha256 TEXT;
ALTER TABLE tesla_consent ADD COLUMN collected_fields TEXT;   -- JSON array of field_key
ALTER TABLE tesla_consent ADD COLUMN recipients TEXT;         -- JSON array, may be empty
ALTER TABLE tesla_consent ADD COLUMN ip_hash TEXT;            -- hashed, never raw
ALTER TABLE tesla_consent ADD COLUMN user_agent TEXT;

-- F01-R05: mobile and postcode are required member attributes. Postcode drives
-- all anonymised aggregation (F01-R06), so it is NOT NULL-able at the point of
-- onboarding completeness — modelled as nullable here but surfaced as a gap,
-- because the Tesla OAuth handshake does not supply either.
ALTER TABLE tesla_member ADD COLUMN mobile TEXT;
ALTER TABLE tesla_member ADD COLUMN postcode TEXT;
ALTER TABLE tesla_member ADD COLUMN tier TEXT NOT NULL DEFAULT 'toca'
  CHECK (tier IN ('toca','non_toca'));

-- ---------------------------------------------------------------------------
-- Session identity
-- ---------------------------------------------------------------------------
-- The KV session held tokens; with tokens in D1 the session only needs to be a
-- pointer, and `tesla_auth_session` already exists for exactly that. This record
-- is what makes the dashboard persistent rather than until-the-KV-entry-expires.
CREATE INDEX idx_tesla_auth_session_member ON tesla_auth_session (member_id, created_at);
